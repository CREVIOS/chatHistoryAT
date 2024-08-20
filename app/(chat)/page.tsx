import { v4 as uuidv4 } from 'uuid'
import { Chat } from '@/components/chat'
import { AI } from '@/lib/chat/actions'
import { auth } from '@/auth'
import { Session } from '@/lib/types'
import { getMissingKeys } from '@/app/actions'

export const metadata = {
  title: 'Chat History Work'
}

export default async function IndexPage() {
  // Generate a new UUID for every page load (i.e., every request)
  const chatId = uuidv4()

  const session = (await auth()) as Session
  const missingKeys = await getMissingKeys()

  // Use the UUID in your database operations, for example:
  // await db.saveChatId({ chatId, userId: session.user.id })

  console.log(chatId) // For debugging: remove or comment out in production

  return (
    <AI initialAIState={{ chatId, messages: [] }}>
      <Chat id={chatId} session={session} missingKeys={missingKeys} />
    </AI>
  )
}
