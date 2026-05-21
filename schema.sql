-- Users table (if you want to manage auth yourself instead of using Supabase Auth)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Positions table
CREATE TABLE IF NOT EXISTS public.positions (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT,
    "group" TEXT,
    "order" INTEGER DEFAULT 0,
    shares NUMERIC DEFAULT 0,
    cost NUMERIC DEFAULT 0,
    "dcaAmount" NUMERIC DEFAULT 0,
    "dcaCycle" TEXT,
    "dcaLastAt" TEXT,
    "updatedAt" BIGINT
);

-- Optional: Enable Row Level Security (RLS) if needed
-- ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
