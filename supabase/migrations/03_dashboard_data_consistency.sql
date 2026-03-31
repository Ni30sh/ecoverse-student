-- ============================================================================
-- DASHBOARD DATA CONSISTENCY + RLS
-- ============================================================================
-- Ensures required relations exist and authenticated users can access dashboard data.

-- Students profile table linked 1:1 with auth.users.
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_emoji TEXT DEFAULT '🌱',
  eco_points BIGINT NOT NULL DEFAULT 0,
  streak_days INTEGER NOT NULL DEFAULT 0,
  school_id UUID,
  role TEXT DEFAULT 'student',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mission submissions relation expected by dashboard/missions flows.
CREATE TABLE IF NOT EXISTS public.mission_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  notes TEXT,
  proof_photo_url TEXT,
  proof_url TEXT,
  photo_url TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_mission_submissions_user_id ON public.mission_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_mission_submissions_mission_id ON public.mission_submissions(mission_id);

-- Keep old submissions table consistent if it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'submissions'
  ) THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS user_id UUID';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    BEGIN
      EXECUTE 'ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS mission_id UUID';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;

-- RLS on students.
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS students_select_own ON public.students;
DROP POLICY IF EXISTS students_update_own ON public.students;
CREATE POLICY students_select_own ON public.students
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY students_update_own ON public.students
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- RLS on missions (readable by authenticated users).
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS missions_select_authenticated ON public.missions;
CREATE POLICY missions_select_authenticated ON public.missions
  FOR SELECT USING (auth.role() = 'authenticated');

-- RLS on mission_submissions.
ALTER TABLE public.mission_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mission_submissions_select_own ON public.mission_submissions;
DROP POLICY IF EXISTS mission_submissions_insert_own ON public.mission_submissions;
DROP POLICY IF EXISTS mission_submissions_update_own ON public.mission_submissions;
CREATE POLICY mission_submissions_select_own ON public.mission_submissions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY mission_submissions_insert_own ON public.mission_submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY mission_submissions_update_own ON public.mission_submissions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Legacy submissions table policies when table exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'submissions'
  ) THEN
    EXECUTE 'ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS submissions_select_own ON public.submissions';
    EXECUTE 'DROP POLICY IF EXISTS submissions_insert_own ON public.submissions';
    EXECUTE 'DROP POLICY IF EXISTS submissions_update_own ON public.submissions';
    EXECUTE 'CREATE POLICY submissions_select_own ON public.submissions FOR SELECT USING (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY submissions_insert_own ON public.submissions FOR INSERT WITH CHECK (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY submissions_update_own ON public.submissions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
  END IF;
END $$;

-- Public read access for leaderboard relation and schema cache refresh.
GRANT SELECT ON public.leaderboard TO authenticated;
GRANT SELECT ON public.leaderboard TO anon;
NOTIFY pgrst, 'reload schema';
