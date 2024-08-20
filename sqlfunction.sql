CREATE OR REPLACE FUNCTION ranked_match_messages_updated(
  query_embedding vector(1536),
  match_threshold FLOAT,
  match_count INT
)
RETURNS TABLE (
  conversation_id UUID,
  title TEXT,
  content TEXT,
  max_similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  WITH ranked_messages AS (
    SELECT
      messages.conversation_id,
      messages.message_id,
      messages.content,
      1 - (messages.embedding <=> query_embedding) AS similarity
    FROM public.messages
    WHERE 1 - (messages.embedding <=> query_embedding) > match_threshold
  ),
  max_similarity_per_conversation AS (
    SELECT
      conversation_id,
      MAX(similarity) AS max_similarity
    FROM ranked_messages
    GROUP BY conversation_id
  )
  SELECT
    c.conversation_id,
    c.title,
    m.content,
    r.max_similarity
  FROM max_similarity_per_conversation r
  JOIN public.conversations c ON c.conversation_id = r.conversation_id
  JOIN public.messages m 
    ON m.conversation_id = r.conversation_id
    AND 1 - (m.embedding <=> query_embedding) = r.max_similarity
  ORDER BY r.max_similarity DESC
  LIMIT match_count;
$$;

-- indexing based on vector
SET maintenance_work_mem = '64MB';  -- Increase the value as needed
CREATE INDEX ON public.messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
