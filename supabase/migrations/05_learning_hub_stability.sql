-- ============================================================================
-- LEARNING HUB STABILITY (TOPICS + LESSONS + COMPLETIONS + RLS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.learning_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES public.learning_topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content JSONB,
  video_url TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure required columns exist for pre-existing lessons tables.
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS topic_id UUID;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS content_json JSONB;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS eco_points_reward BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS fact_boxes JSONB;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS key_takeaways TEXT[];

-- Backfill topic_id for old records that predate relational topics.
DO $$
DECLARE
  fallback_topic_id UUID;
BEGIN
  INSERT INTO public.learning_topics (title, icon, color)
  VALUES ('General', 'book', '#22C55E')
  ON CONFLICT DO NOTHING;

  SELECT id INTO fallback_topic_id
  FROM public.learning_topics
  ORDER BY created_at ASC
  LIMIT 1;

  IF fallback_topic_id IS NOT NULL THEN
    UPDATE public.lessons
    SET topic_id = fallback_topic_id
    WHERE topic_id IS NULL;
  END IF;
END $$;

-- Normalize lesson content columns used by LessonReader.
UPDATE public.lessons
SET content_json = COALESCE(content_json, content)
WHERE content_json IS NULL
  AND content IS NOT NULL;

UPDATE public.lessons
SET body = COALESCE(body, content_json->>'body')
WHERE body IS NULL
  AND content_json IS NOT NULL;

UPDATE public.lessons
SET summary = COALESCE(summary, content_json->>'summary')
WHERE summary IS NULL
  AND content_json IS NOT NULL;

ALTER TABLE public.lessons ALTER COLUMN topic_id SET NOT NULL;

-- Add FK constraint for topic_id when missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lessons_topic_id_fkey'
      AND conrelid = 'public.lessons'::regclass
  ) THEN
    ALTER TABLE public.lessons
      ADD CONSTRAINT lessons_topic_id_fkey
      FOREIGN KEY (topic_id) REFERENCES public.learning_topics(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Backward compatibility for existing text content column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lessons' AND column_name = 'content'
  ) THEN
    NULL;
  ELSE
    EXECUTE 'ALTER TABLE public.lessons ADD COLUMN content JSONB';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.lesson_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, lesson_id)
);

-- Deduplicate old completion rows before enforcing uniqueness.
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lesson_id
      ORDER BY completed_at DESC, id DESC
    ) AS rn
  FROM public.lesson_completions
)
DELETE FROM public.lesson_completions lc
USING ranked r
WHERE lc.ctid = r.ctid
  AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lesson_completions_user_id_lesson_id_key'
      AND conrelid = 'public.lesson_completions'::regclass
  ) THEN
    ALTER TABLE public.lesson_completions
      ADD CONSTRAINT lesson_completions_user_id_lesson_id_key
      UNIQUE (user_id, lesson_id);
  END IF;
END $$;

-- Atomic lesson completion + EcoPoints reward award for LessonReader.
CREATE OR REPLACE FUNCTION public.complete_lesson(p_lesson_id UUID)
RETURNS TABLE (
  already_completed BOOLEAN,
  completion_id UUID,
  awarded_points BIGINT,
  eco_points BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_completion_id UUID;
  v_reward BIGINT := 0;
  v_eco_points BIGINT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(l.eco_points_reward, 0)::BIGINT
  INTO v_reward
  FROM public.lessons l
  WHERE l.id = p_lesson_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lesson not found';
  END IF;

  SELECT lc.id
  INTO v_completion_id
  FROM public.lesson_completions lc
  WHERE lc.user_id = v_user_id
    AND lc.lesson_id = p_lesson_id
  ORDER BY lc.completed_at DESC
  LIMIT 1;

  IF v_completion_id IS NOT NULL THEN
    SELECT COALESCE(s.eco_points, 0)::BIGINT
    INTO v_eco_points
    FROM public.students s
    WHERE s.id = v_user_id
    LIMIT 1;

    RETURN QUERY
    SELECT TRUE, v_completion_id, 0::BIGINT, COALESCE(v_eco_points, 0)::BIGINT;
    RETURN;
  END IF;

  INSERT INTO public.lesson_completions (user_id, lesson_id, completed_at)
  VALUES (v_user_id, p_lesson_id, NOW())
  RETURNING id INTO v_completion_id;

  UPDATE public.students
  SET eco_points = COALESCE(eco_points, 0) + v_reward,
      updated_at = NOW()
  WHERE id = v_user_id
  RETURNING COALESCE(eco_points, 0)::BIGINT INTO v_eco_points;

  RETURN QUERY
  SELECT FALSE, v_completion_id, v_reward, COALESCE(v_eco_points, 0)::BIGINT;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_lessons_topic_id ON public.lessons(topic_id);
CREATE INDEX IF NOT EXISTS idx_lessons_order_index ON public.lessons(order_index);
CREATE INDEX IF NOT EXISTS idx_lesson_completions_user_id ON public.lesson_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_completions_lesson_id ON public.lesson_completions(lesson_id);

ALTER TABLE public.learning_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learning_topics_select_public ON public.learning_topics;
DROP POLICY IF EXISTS lessons_select_public ON public.lessons;
DROP POLICY IF EXISTS lesson_completions_select_own ON public.lesson_completions;
DROP POLICY IF EXISTS lesson_completions_insert_own ON public.lesson_completions;

CREATE POLICY learning_topics_select_public ON public.learning_topics
  FOR SELECT USING (true);

CREATE POLICY lessons_select_public ON public.lessons
  FOR SELECT USING (true);

CREATE POLICY lesson_completions_select_own ON public.lesson_completions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY lesson_completions_insert_own ON public.lesson_completions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

GRANT SELECT ON public.learning_topics TO anon;
GRANT SELECT ON public.learning_topics TO authenticated;
GRANT SELECT ON public.lessons TO anon;
GRANT SELECT ON public.lessons TO authenticated;
GRANT SELECT, INSERT ON public.lesson_completions TO authenticated;
GRANT SELECT, UPDATE ON public.students TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_lesson(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
