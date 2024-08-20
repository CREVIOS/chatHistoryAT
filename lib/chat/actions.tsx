import 'server-only'
import { v4 as uuidv4 } from 'uuid'
import { embed } from 'ai';
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';

import {
  createAI,
  createStreamableUI,
  getMutableAIState,
  getAIState,
  streamUI,
  createStreamableValue
} from 'ai/rsc'
import { openai } from '@ai-sdk/openai'

import {
  spinner,
  BotCard,
  BotMessage,
  SystemMessage,
  Stock,
  Purchase
} from '@/components/stocks'

import { z } from 'zod'
import {
  formatNumber,
  runAsyncFnWithoutBlocking,
  sleep,
  nanoid
} from '@/lib/utils'
import { saveChat } from '@/app/actions'
import { SpinnerMessage, UserMessage } from '@/components/stocks/message'
import { Chat, Message } from '@/lib/types'
import { auth } from '@/auth'


async function handleUserAction(action: string, params: any) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()

  const processing = createStreamableUI(
    <div className="inline-flex items-start gap-1 md:items-center">
      {spinner}
      <p className="mb-2">Processing {action}...</p>
    </div>
  )

  const systemMessage = createStreamableUI(null)

  runAsyncFnWithoutBlocking(async () => {
    await sleep(1000)

    processing.update(
      <div className="inline-flex items-start gap-1 md:items-center">
        {spinner}
        <p className="mb-2">Still working on {action}...</p>
      </div>
    )

    await sleep(1000)

    processing.done(
      <div>
        <p className="mb-2">
          Successfully completed {action} with parameters: {JSON.stringify(params)}
        </p>
      </div>
    )

    systemMessage.done(
      <SystemMessage>
        Action {action} completed with params: {JSON.stringify(params)}.
      </SystemMessage>
    )

    aiState.done({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: nanoid(),
          role: 'system',
          content: `[Action ${action} completed with params: ${JSON.stringify(params)}]`
        }
      ]
    })
  })

  return {
    processingUI: processing.value,
    newMessage: {
      id: nanoid(),
      display: systemMessage.value
    }
  }
}

async function submitUserMessage(content: string) {
  'use server'

  
  const cookieStore = cookies();

  // Create the Supabase client
  const supabase = createClient(cookieStore);

  const aiState = getMutableAIState<typeof AI>()

  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: content,
  });


  const { data: messageData, error: messageError } = await supabase
    .from('messages')
    .insert([{ message_id: uuidv4(), conversation_id: '011bd535-0aa9-4e37-a0b7-f90b46a55c2a', role: 'user', content , embedding}])
    .single();

  if (messageData) {
    console.log(`Successfully inserted user message: ${messageData}`);
  }
  if (messageError) {
    console.log(`Error inserting user message: ${messageError.message}`);
  }

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content
      }
    ]
  })
  let data = ''; // Initialize the data variable to capture content
  let textStream: undefined | ReturnType<typeof createStreamableValue<string>>;
  let textNode: undefined | React.ReactNode;

  // Create a promise to handle the completion of streaming
  const dataPromise = new Promise((resolve, reject) => {
    const result = streamUI({
      model: openai('gpt-3.5-turbo'),
      initial: <SpinnerMessage />,
      system: `
      You are a highly intelligent AI assistant. You can understand and respond to a wide range of tasks, from answering questions and providing information to assisting with complex problem-solving. Engage in conversation, perform tasks, and offer insights in a helpful and friendly manner.
      
      If the user asks for something beyond your abilities or requires clarification, provide guidance or suggest alternative approaches. Adapt your responses to the context and needs of the user, always aiming to be clear, concise, and accurate.`,
      messages: aiState.get().messages.map((message: any) => ({
        role: message.role,
        content: message.content,
        name: message.name,
      })),
      text: ({ content, done, delta }) => {
        // Initialize textStream on the first run
        if (!textStream) {
          textStream = createStreamableValue('');
          textNode = <BotMessage content={textStream.value} />;
        }

        // Update data as new content arrives
        data += delta || '';

        // Finalize textStream when done
        if (done) {
          textStream.done();
          aiState.done({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: nanoid(),
                role: 'assistant',
                content: data,
              },
            ],
          });

          // Resolve the promise with the final data
          resolve(data);
        } else {
          textStream.update(delta);
        }

        return textNode;
      },
    });

    result.catch(reject); // Handle any errors in streaming
  });

  // Wait for the data to be fully populated
  const finalData = await dataPromise;

  // Ensure the final data is a valid string and not empty
  if (typeof finalData !== 'string' || finalData.trim() === '') {
    console.log('Assistant content is invalid or empty.');
  }

  // Generate and store the embedding for the assistant's response
  const { embedding: assistantEmbedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: finalData, // Make sure this is a valid string
  });

  const { data: assistantMessageData, error: assistantMessageError } = await supabase
    .from('messages')
    .insert([{ message_id: uuidv4(), conversation_id: '011bd535-0aa9-4e37-a0b7-f90b46a55c2a', role: 'assistant', content: finalData, embedding: assistantEmbedding }])
    .single();

  if (assistantMessageError) {
    console.log(`Error inserting assistant message: ${assistantMessageError.message}`);
  } else {
    console.log(`Successfully inserted assistant message: ${assistantMessageData}`);
  }

  return {
    id: nanoid(),
    display: textNode,
  };
}
export type AIState = {
  chatId: string
  messages: Message[]
}

export type UIState = {
  id: string
  display: React.ReactNode
}[]

export const AI = createAI<AIState, UIState>({
  actions: {
    submitUserMessage,
    handleUserAction
  },
  initialUIState: [],
  initialAIState: { chatId: uuidv4(), messages: [] },
  onGetUIState: async () => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const aiState = getAIState() as Chat

      if (aiState) {
        const uiState = getUIStateFromAIState(aiState)
        return uiState
      }
    } else {
      return
    }
  },
  onSetAIState: async ({ state }) => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const { chatId, messages } = state

      const createdAt = new Date()
      const userId = session.user.id as string
      const path = `/chat/${chatId}`

      const firstMessageContent = messages[0].content as string
      const title = firstMessageContent.substring(0, 100)

      const chat: Chat = {
        id: chatId,
        title,
        userId,
        createdAt,
        messages,
        path
      }

      await saveChat(chat)
    } else {
      return
    }
  }
})
export const getUIStateFromAIState = (aiState: Chat) => {
  return aiState.messages
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      id: `${aiState.chatId}-${index}`,
      display:
        message.role === 'tool' ? (
          message.content.map(tool => {
            // Using a type guard to narrow down the type of `tool.result`
            if (tool.toolName === 'handleAction') {
              const result = tool.result as { action: string; params: Record<string, any> }
              return (
                <BotMessage
                  content={`Performed action: ${result.action} with parameters: ${JSON.stringify(result.params)}`}
                />
              )
            } 
            return null
          })
        ) : message.role === 'user' ? (
          <UserMessage>{message.content as string}</UserMessage>
        ) : message.role === 'assistant' &&
          typeof message.content === 'string' ? (
          <BotMessage content={message.content} />
        ) : null
    }))
}

