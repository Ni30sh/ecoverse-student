-- 08_profile_page_stability.sql
-- Stabilize ProfilePage backend contract (profile updates, activity history, aggregates)

BEGIN;

-- Keep profiles table aligned with app expectations.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS school_name text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS avatar_emoji text;

-- Backfill invalid avatar_emoji values to default before enforcing constraint.
UPDATE public.profiles
SET avatar_emoji = '🌱'
WHERE avatar_emoji IS NOT NULL
  AND avatar_emoji NOT IN (
    '🌱','🌿','🍀','🌳','🌲','🪴','🌻','🌎','♻️','🐢','🦋','🌊','☀️','🍃','🌼'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_avatar_emoji_allowed'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_avatar_emoji_allowed CHECK (
        avatar_emoji IS NULL OR avatar_emoji IN (
          '🌱','🌿','🍀','🌳','🌲','🪴','🌻','🌎','♻️','🐢','🦋','🌊','☀️','🍃','🌼'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'avatar_emoji'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_avatar_emoji_allowed'
      AND conrelid = 'public.students'::regclass
  ) THEN
    UPDATE public.students
    SET avatar_emoji = '🌱'
    WHERE avatar_emoji IS NOT NULL
      AND avatar_emoji NOT IN (
        '🌱','🌿','🍀','🌳','🌲','🪴','🌻','🌎','♻️','🐢','🦋','🌊','☀️','🍃','🌼'
      );

    ALTER TABLE public.students
      ADD CONSTRAINT students_avatar_emoji_allowed CHECK (
        avatar_emoji IS NULL OR avatar_emoji IN (
          '🌱','🌿','🍀','🌳','🌲','🪴','🌻','🌎','♻️','🐢','🦋','🌊','☀️','🍃','🌼'
        )
      );
  END IF;
END $$;

-- Make submissions/activity query path reliable.
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz DEFAULT now();

UPDATE public.submissions
SET submitted_at = COALESCE(submitted_at, created_at, now())
WHERE submitted_at IS NULL;

ALTER TABLE public.submissions
  ALTER COLUMN submitted_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'submissions_status_valid'
      AND conrelid = 'public.submissions'::regclass
  ) THEN
    -- Backfill invalid status values to 'pending' before enforcing constraint.
    UPDATE public.submissions
    SET status = 'pending'
    WHERE status IS NULL
       OR status NOT IN ('pending', 'approved', 'rejected');

    ALTER TABLE public.submissions
      ADD CONSTRAINT submissions_status_valid CHECK (
        status IN ('pending','approved','rejected')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_submissions_user_submitted_at
  ON public.submissions (user_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_user_created_at
  ON public.submissions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_user_status
  ON public.submissions (user_id, status);

-- Mirror baseline RLS behavior for profiles if missing.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own
      ON public.profiles
      FOR SELECT
      USING (auth.uid() = id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own
      ON public.profiles
      FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.submissions TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
