ALTER TABLE public.ai_runs 
ADD COLUMN IF NOT EXISTS purpose TEXT,
ADD COLUMN IF NOT EXISTS thinking_level TEXT,
ADD COLUMN IF NOT EXISTS media_resolution TEXT,
ADD COLUMN IF NOT EXISTS cached_content_token_count INTEGER,
ADD COLUMN IF NOT EXISTS thoughts_token_count INTEGER;
