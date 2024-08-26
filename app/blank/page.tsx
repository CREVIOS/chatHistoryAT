"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { SearchForm } from "./inputForm";
import OpenAI from "openai";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Page() {
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);

  const supabase = createClient();

  const openai = new OpenAI({
    apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  const handleSearch = async (queryContent) => {
    try {
      const embedding = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: queryContent,
        encoding_format: "float",
      });

      const query_embedding = embedding.data[0].embedding;

      const { data: messages, error } = await supabase.rpc(
        "ranked_match_messages_updated",
        {
          query_embedding: query_embedding,
          match_threshold: 0.2,
          match_count: 10,
        }
      );

      if (error) {
        setError(error.message);
        console.error("Error fetching matched messages:", error.message);
      } else {
        setMessages(messages);
        setError(null);
      }
    } catch (err) {
      setError("An unexpected error occurred.");
      console.error(err);
    }
  };

  return (
    <div className="p-4">
      <SearchForm onSearch={handleSearch} />
      {error && <p className="text-red-500">Error: {error}</p>}
      {messages?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {messages.map((message, index) => (
            <Card key={index} className="shadow-lg">
              <CardHeader>
                <CardTitle>Conversation ID: {message.conversation_id}</CardTitle>
                <CardDescription>{message.title}</CardDescription>
              </CardHeader>
              <CardContent>
                <p>{message.content}</p>
                <Badge variant="outline" className="mt-4">
                  Similarity Score: {message.max_similarity}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
