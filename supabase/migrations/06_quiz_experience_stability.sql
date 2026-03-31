-- ============================================================================
-- QUIZ EXPERIENCE STABILITY (QUIZ_ATTEMPTS + REWARD + RLS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES public.learning_topics(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compatibility columns used by existing app paths.
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES public.lessons(id) ON DELETE SET NULL;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS total INTEGER;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS is_perfect BOOLEAN;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS client_attempt_id TEXT;

-- Ensure canonical columns exist for older deployments.
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS topic_id UUID;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS total_questions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS points_earned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill canonical values from compatibility fields if needed.
UPDATE public.quiz_attempts
SET total_questions = COALESCE(total_questions, total, 0)
WHERE total_questions IS NULL OR total_questions = 0;

UPDATE public.quiz_attempts
SET points_earned = CASE
  WHEN points_earned IS NOT NULL AND points_earned > 0 THEN points_earned
  WHEN total_questions > 0 THEN GREATEST(0, ROUND((score::NUMERIC / total_questions::NUMERIC) * 10)::INTEGER)
  ELSE GREATEST(0, ROUND(score::NUMERIC / 10)::INTEGER)
END
WHERE points_earned IS NULL OR points_earned = 0;

ALTER TABLE public.quiz_attempts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.quiz_attempts ALTER COLUMN topic_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quiz_attempts_score_non_negative'
      AND conrelid = 'public.quiz_attempts'::regclass
  ) THEN
    ALTER TABLE public.quiz_attempts
      ADD CONSTRAINT quiz_attempts_score_non_negative
      CHECK (score >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quiz_attempts_total_questions_non_negative'
      AND conrelid = 'public.quiz_attempts'::regclass
  ) THEN
    ALTER TABLE public.quiz_attempts
      ADD CONSTRAINT quiz_attempts_total_questions_non_negative
      CHECK (total_questions >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quiz_attempts_points_earned_non_negative'
      AND conrelid = 'public.quiz_attempts'::regclass
  ) THEN
    ALTER TABLE public.quiz_attempts
      ADD CONSTRAINT quiz_attempts_points_earned_non_negative
      CHECK (points_earned >= 0);
  END IF;
END $$;

-- Add FK for topic_id when missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quiz_attempts_topic_id_fkey'
      AND conrelid = 'public.quiz_attempts'::regclass
  ) THEN
    ALTER TABLE public.quiz_attempts
      ADD CONSTRAINT quiz_attempts_topic_id_fkey
      FOREIGN KEY (topic_id) REFERENCES public.learning_topics(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON public.quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_topic_id ON public.quiz_attempts(topic_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_created_at ON public.quiz_attempts(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_attempts_user_client_attempt
  ON public.quiz_attempts(user_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;

-- Atomic attempt write + EcoPoints update for leaderboard/dashboard consistency.
CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(
  p_topic_id UUID,
  p_score INTEGER,
  p_total_questions INTEGER,
  p_points_earned INTEGER DEFAULT NULL,
  p_client_attempt_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  attempt_id UUID,
  user_id UUID,
  topic_id UUID,
  score INTEGER,
  total_questions INTEGER,
  points_earned INTEGER,
  eco_points BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_points INTEGER := 0;
  v_attempt_id UUID;
  v_eco_points BIGINT := 0;
  v_existing record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_topic_id IS NULL THEN
    RAISE EXCEPTION 'topic_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.learning_topics lt
    WHERE lt.id = p_topic_id
  ) THEN
    RAISE EXCEPTION 'Topic not found';
  END IF;

  v_points := COALESCE(
    NULLIF(p_points_earned, 0),
    CASE
      WHEN COALESCE(p_total_questions, 0) > 0 THEN GREATEST(0, ROUND((COALESCE(p_score, 0)::NUMERIC / p_total_questions::NUMERIC) * 10)::INTEGER)
      ELSE GREATEST(0, ROUND(COALESCE(p_score, 0)::NUMERIC / 10)::INTEGER)
    END,
    0
  );

  IF p_client_attempt_id IS NOT NULL THEN
    SELECT
      qa.id,
      qa.score,
      qa.total_questions,
      qa.points_earned,
      qa.created_at
    INTO v_existing
    FROM public.quiz_attempts qa
    WHERE qa.user_id = v_user_id
      AND qa.client_attempt_id = p_client_attempt_id
    LIMIT 1;

    IF FOUND THEN
      SELECT COALESCE(s.eco_points, 0)::BIGINT
      INTO v_eco_points
      FROM public.students s
      WHERE s.id = v_user_id
      LIMIT 1;

      RETURN QUERY
      SELECT
        v_existing.id,
        v_user_id,
        p_topic_id,
        v_existing.score,
        v_existing.total_questions,
        v_existing.points_earned,
        COALESCE(v_eco_points, 0)::BIGINT,
        v_existing.created_at;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.quiz_attempts (
    user_id,
    topic_id,
    score,
    total_questions,
    points_earned,
    total,
    is_perfect,
    client_attempt_id,
    created_at
  )
  VALUES (
    v_user_id,
    p_topic_id,
    COALESCE(p_score, 0),
    COALESCE(p_total_questions, 0),
    v_points,
    COALESCE(p_total_questions, 0),
    COALESCE(p_total_questions, 0) > 0 AND COALESCE(p_score, 0) >= COALESCE(p_total_questions, 0),
    NULLIF(TRIM(p_client_attempt_id), ''),
    NOW()
  )
  RETURNING id, created_at INTO v_attempt_id, created_at;

  UPDATE public.students
  SET eco_points = COALESCE(eco_points, 0) + v_points,
      updated_at = NOW()
  WHERE id = v_user_id
  RETURNING COALESCE(eco_points, 0)::BIGINT INTO v_eco_points;

  IF v_eco_points IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'profiles'
    ) THEN
      UPDATE public.profiles
      SET eco_points = COALESCE(eco_points, points, 0) + v_points,
          points = COALESCE(points, eco_points, 0) + v_points,
          updated_at = NOW()
      WHERE id = v_user_id
      RETURNING COALESCE(eco_points, points, 0)::BIGINT INTO v_eco_points;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_attempt_id,
    v_user_id,
    p_topic_id,
    COALESCE(p_score, 0),
    COALESCE(p_total_questions, 0),
    v_points,
    COALESCE(v_eco_points, 0)::BIGINT,
    NOW();
END;
$$;

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_attempts_select_own ON public.quiz_attempts;
DROP POLICY IF EXISTS quiz_attempts_insert_own ON public.quiz_attempts;

CREATE POLICY quiz_attempts_select_own ON public.quiz_attempts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY quiz_attempts_insert_own ON public.quiz_attempts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.quiz_attempts TO authenticated;
GRANT SELECT, UPDATE ON public.students TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'students'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'students'
      AND policyname = 'students_update_own'
  ) THEN
    EXECUTE 'ALTER TABLE public.students ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY students_update_own ON public.students FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    EXECUTE 'GRANT SELECT, UPDATE ON public.profiles TO authenticated';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
        AND policyname = 'profiles_update_own'
    ) THEN
      EXECUTE 'ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY';
      EXECUTE 'CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (auth.uid() = id OR auth.uid() = user_id) WITH CHECK (auth.uid() = id OR auth.uid() = user_id)';
    END IF;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(UUID, INTEGER, INTEGER, INTEGER, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
