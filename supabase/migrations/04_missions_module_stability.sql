-- ============================================================================
-- MISSIONS MODULE STABILITY (MISSIONS + SUBMISSIONS + RLS)
-- ============================================================================
-- Canonical tables for MissionsPage integration.

-- Missions table hardening.
CREATE TABLE IF NOT EXISTS public.missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  difficulty TEXT,
  eco_points_reward BIGINT NOT NULL DEFAULT 0,
  icon_url TEXT,
  requires_photo BOOLEAN NOT NULL DEFAULT TRUE,
  requires_location BOOLEAN NOT NULL DEFAULT FALSE,
  requires_teacher_approval BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS difficulty TEXT;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS eco_points_reward BIGINT DEFAULT 0;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS icon_url TEXT;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS requires_photo BOOLEAN DEFAULT TRUE;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS requires_location BOOLEAN DEFAULT FALSE;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS requires_teacher_approval BOOLEAN DEFAULT TRUE;
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.missions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Canonical submissions table.
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  photo_url TEXT,
  notes TEXT,
  submitted_at TIMESTAMPTZ,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  proof_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mission_id)
);

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS proof_metadata JSONB;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_missions_category ON public.missions(category);
CREATE INDEX IF NOT EXISTS idx_missions_difficulty ON public.missions(difficulty);
CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON public.submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_mission_id ON public.submissions(mission_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON public.submissions(status);

-- RLS: missions public read.
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS missions_select_public ON public.missions;
CREATE POLICY missions_select_public ON public.missions
  FOR SELECT USING (true);

-- RLS: submissions own data.
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS submissions_select_own ON public.submissions;
DROP POLICY IF EXISTS submissions_insert_own ON public.submissions;
DROP POLICY IF EXISTS submissions_update_own ON public.submissions;
CREATE POLICY submissions_select_own ON public.submissions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY submissions_insert_own ON public.submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY submissions_update_own ON public.submissions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Leaderboard public read alignment.
GRANT SELECT ON public.leaderboard TO anon;
GRANT SELECT ON public.leaderboard TO authenticated;

-- Refresh schema cache for PostgREST/Supabase API.
NOTIFY pgrst, 'reload schema';
