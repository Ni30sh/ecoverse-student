-- ============================================================================
-- LEADERBOARD MODULE STABILITY (PERIOD + SCOPE + RANK + RLS)
-- ============================================================================

-- Profiles compatibility table used by leaderboard aggregations.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_emoji TEXT,
  eco_points BIGINT NOT NULL DEFAULT 0,
  points BIGINT,
  streak_days INTEGER NOT NULL DEFAULT 0,
  school_id UUID,
  role TEXT DEFAULT 'student',
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_emoji TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS eco_points BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS points BIGINT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS streak_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'student';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.profiles
SET eco_points = COALESCE(eco_points, points, 0),
    points = COALESCE(points, eco_points, 0)
WHERE eco_points IS NULL OR points IS NULL;

-- Weekly points table used for this_week/this_month filters.
CREATE TABLE IF NOT EXISTS public.weekly_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.weekly_points ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.weekly_points ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.weekly_points ADD COLUMN IF NOT EXISTS points_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.weekly_points ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.weekly_points ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.weekly_points ALTER COLUMN date SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'weekly_points_points_earned_non_negative'
      AND conrelid = 'public.weekly_points'::regclass
  ) THEN
    ALTER TABLE public.weekly_points
      ADD CONSTRAINT weekly_points_points_earned_non_negative
      CHECK (points_earned >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_weekly_points_user_date ON public.weekly_points(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_points_date ON public.weekly_points(date DESC);

-- Period + scope aware leaderboard function.
CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_period TEXT DEFAULT 'all_time',
  p_scope TEXT DEFAULT 'global',
  p_limit INTEGER DEFAULT 20,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  avatar_emoji TEXT,
  eco_points BIGINT,
  streak_days INTEGER,
  level_title TEXT,
  rank BIGINT,
  is_bot BOOLEAN,
  school_id UUID,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT := LOWER(COALESCE(p_period, 'all_time'));
  v_scope TEXT := LOWER(COALESCE(p_scope, 'global'));
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 20), 500));
  v_requester UUID := COALESCE(p_user_id, auth.uid());
  v_from_date DATE;
BEGIN
  IF v_period = 'this_week' THEN
    v_from_date := date_trunc('week', CURRENT_DATE)::DATE;
  ELSIF v_period = 'this_month' THEN
    v_from_date := date_trunc('month', CURRENT_DATE)::DATE;
  ELSE
    v_period := 'all_time';
    v_from_date := NULL;
  END IF;

  IF v_scope NOT IN ('global', 'my_school') THEN
    v_scope := 'global';
  END IF;

  RETURN QUERY
  WITH profiles_base AS (
    SELECT
      COALESCE(s.id, p.id) AS user_id,
      COALESCE(NULLIF(s.full_name, ''), NULLIF(p.full_name, ''), 'Student') AS full_name,
      COALESCE(NULLIF(s.avatar_emoji, ''), NULLIF(p.avatar_emoji, ''), '🌱') AS avatar_emoji,
      COALESCE(s.eco_points, p.eco_points, p.points, 0)::BIGINT AS all_time_points,
      COALESCE(s.streak_days, p.streak_days, 0)::INTEGER AS streak_days,
      COALESCE(s.school_id, p.school_id) AS school_id,
      COALESCE(s.updated_at, p.updated_at, NOW()) AS updated_at,
      COALESCE(s.is_bot, p.is_bot, FALSE) AS is_bot,
      COALESCE(s.role, p.role, 'student') AS role
    FROM public.students s
    FULL OUTER JOIN public.profiles p ON p.id = s.id
  ),
  scoped_profiles AS (
    SELECT pb.*
    FROM profiles_base pb
    LEFT JOIN profiles_base requester ON requester.user_id = v_requester
    WHERE COALESCE(pb.role, 'student') = 'student'
      AND (
        v_scope <> 'my_school'
        OR v_requester IS NULL
        OR requester.school_id IS NULL
        OR pb.school_id = requester.school_id
      )
  ),
  period_points AS (
    SELECT
      wp.user_id,
      SUM(COALESCE(wp.points_earned, 0))::BIGINT AS period_points
    FROM public.weekly_points wp
    WHERE v_period = 'all_time' OR wp.date >= v_from_date
    GROUP BY wp.user_id
  ),
  scored AS (
    SELECT
      sp.user_id,
      sp.full_name,
      sp.avatar_emoji,
      CASE
        WHEN v_period = 'all_time' THEN sp.all_time_points
        ELSE COALESCE(pp.period_points, 0)
      END::BIGINT AS eco_points,
      sp.streak_days,
      sp.school_id,
      sp.updated_at,
      sp.is_bot
    FROM scoped_profiles sp
    LEFT JOIN period_points pp ON pp.user_id = sp.user_id
  ),
  ranked AS (
    SELECT
      s.user_id,
      s.full_name,
      s.avatar_emoji,
      s.eco_points,
      s.streak_days,
      CASE
        WHEN COALESCE(s.eco_points, 0) >= 5000 THEN 'Eco Champion'
        WHEN COALESCE(s.eco_points, 0) >= 2500 THEN 'Eco Leader'
        WHEN COALESCE(s.eco_points, 0) >= 1000 THEN 'Eco Ranger'
        WHEN COALESCE(s.eco_points, 0) >= 300 THEN 'Eco Starter'
        ELSE 'Eco Rookie'
      END AS level_title,
      RANK() OVER (ORDER BY s.eco_points DESC, s.updated_at ASC, s.user_id ASC) AS rank,
      s.is_bot,
      s.school_id,
      s.updated_at
    FROM scored s
  )
  SELECT
    r.user_id,
    r.full_name,
    r.avatar_emoji,
    r.eco_points,
    r.streak_days,
    r.level_title,
    r.rank,
    r.is_bot,
    r.school_id,
    r.updated_at
  FROM ranked r
  ORDER BY r.rank ASC, r.user_id ASC
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard_rank(
  p_user_id UUID,
  p_period TEXT DEFAULT 'all_time',
  p_scope TEXT DEFAULT 'global'
)
RETURNS TABLE (
  user_id UUID,
  rank BIGINT,
  eco_points BIGINT,
  level_title TEXT,
  school_id UUID,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT *
    FROM public.get_leaderboard(p_period, p_scope, 100000, p_user_id)
  )
  SELECT
    r.user_id,
    r.rank,
    r.eco_points,
    r.level_title,
    r.school_id,
    r.updated_at
  FROM ranked r
  WHERE r.user_id = p_user_id
  LIMIT 1;
END;
$$;

ALTER TABLE public.weekly_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_points_select_own ON public.weekly_points;
DROP POLICY IF EXISTS weekly_points_insert_own ON public.weekly_points;

CREATE POLICY weekly_points_select_own ON public.weekly_points
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY weekly_points_insert_own ON public.weekly_points
  FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

GRANT SELECT, INSERT ON public.weekly_points TO authenticated;
GRANT SELECT ON public.leaderboard TO authenticated;
GRANT SELECT ON public.leaderboard TO anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, TEXT, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_rank(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
