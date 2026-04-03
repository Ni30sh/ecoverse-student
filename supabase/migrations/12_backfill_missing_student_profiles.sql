-- ============================================================================
-- BACKFILL MISSING STUDENT/PROFILE ROWS
-- ============================================================================
-- One-time repair for existing auth users that do not have matching
-- rows in public.students / public.profiles.

BEGIN;

-- Ensure recovery RPC exists even if previous migration was not applied.
CREATE OR REPLACE FUNCTION public.ensure_student_profile(
  p_user_id uuid,
  p_email text,
  p_full_name text DEFAULT NULL,
  p_school_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_school_name text;
  v_school_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_full_name := COALESCE(NULLIF(TRIM(p_full_name), ''), NULLIF(TRIM(p_email), ''), p_user_id::text);
  v_school_name := UPPER(TRIM(COALESCE(p_school_name, '')));

  IF v_school_name NOT IN ('MPGI', 'PSIT', 'KIT', 'KGI', 'AKTU') THEN
    v_school_name := '';
  END IF;

  IF v_school_name <> '' THEN
    SELECT id
    INTO v_school_id
    FROM public.schools
    WHERE UPPER(TRIM(name)) = v_school_name
    LIMIT 1;

    IF v_school_id IS NULL THEN
      BEGIN
        INSERT INTO public.schools (name)
        VALUES (v_school_name)
        RETURNING id INTO v_school_id;
      EXCEPTION
        WHEN unique_violation THEN
          SELECT id
          INTO v_school_id
          FROM public.schools
          WHERE UPPER(TRIM(name)) = v_school_name
          LIMIT 1;
      END;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.students (
      id,
      email,
      full_name,
      role,
      school_id,
      avatar_emoji,
      eco_points,
      streak_days,
      created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      COALESCE(NULLIF(TRIM(p_email), ''), p_user_id::text || '@unknown.local'),
      v_full_name,
      'student',
      v_school_id,
      '🌱',
      0,
      0,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      email = COALESCE(EXCLUDED.email, public.students.email),
      full_name = COALESCE(EXCLUDED.full_name, public.students.full_name),
      role = 'student',
      school_id = COALESCE(EXCLUDED.school_id, public.students.school_id),
      updated_at = NOW();
  EXCEPTION
    WHEN undefined_column THEN
      INSERT INTO public.students (
        id,
        email,
        full_name,
        role,
        created_at,
        updated_at
      )
      VALUES (
        p_user_id,
        COALESCE(NULLIF(TRIM(p_email), ''), p_user_id::text || '@unknown.local'),
        v_full_name,
        'student',
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET
        email = COALESCE(EXCLUDED.email, public.students.email),
        full_name = COALESCE(EXCLUDED.full_name, public.students.full_name),
        role = 'student',
        updated_at = NOW();
  END;

  BEGIN
    INSERT INTO public.profiles (
      id,
      full_name,
      role,
      school_id,
      school_name,
      created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      v_full_name,
      'student',
      v_school_id,
      NULLIF(v_school_name, ''),
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      role = 'student',
      school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
      school_name = COALESCE(EXCLUDED.school_name, public.profiles.school_name),
      updated_at = NOW();
  EXCEPTION
    WHEN undefined_column THEN
      INSERT INTO public.profiles (
        id,
        full_name,
        role,
        school_id,
        created_at,
        updated_at
      )
      VALUES (
        p_user_id,
        v_full_name,
        'student',
        v_school_id,
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        role = 'student',
        school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
        updated_at = NOW();
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_student_profile(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_student_profile(uuid, text, text, text) TO authenticated;

-- Ensure schools table exists for school mapping.
CREATE TABLE IF NOT EXISTS public.schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_name_normalized
  ON public.schools ((UPPER(TRIM(name))));

-- Seed supported school names (idempotent by normalized unique index).
INSERT INTO public.schools (name)
VALUES ('MPGI'), ('PSIT'), ('KIT'), ('KGI'), ('AKTU')
ON CONFLICT DO NOTHING;

WITH auth_base AS (
  SELECT
    u.id AS user_id,
    u.email,
    COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''), u.email) AS full_name,
    UPPER(TRIM(COALESCE(u.raw_user_meta_data->>'school_name', ''))) AS school_name
  FROM auth.users u
), auth_mapped AS (
  SELECT
    ab.user_id,
    ab.email,
    ab.full_name,
    CASE
      WHEN ab.school_name IN ('MPGI', 'PSIT', 'KIT', 'KGI', 'AKTU') THEN ab.school_name
      ELSE NULL
    END AS school_name
  FROM auth_base ab
), auth_with_school AS (
  SELECT
    am.user_id,
    am.email,
    am.full_name,
    am.school_name,
    s.id AS school_id
  FROM auth_mapped am
  LEFT JOIN public.schools s
    ON UPPER(TRIM(s.name)) = am.school_name
)
INSERT INTO public.students (
  id,
  email,
  full_name,
  role,
  school_id,
  avatar_emoji,
  eco_points,
  streak_days,
  created_at,
  updated_at
)
SELECT
  aws.user_id,
  aws.email,
  aws.full_name,
  'student',
  aws.school_id,
  '🌱',
  0,
  0,
  NOW(),
  NOW()
FROM auth_with_school aws
LEFT JOIN public.students st ON st.id = aws.user_id
WHERE st.id IS NULL
ON CONFLICT (id) DO NOTHING;

WITH auth_base AS (
  SELECT
    u.id AS user_id,
    COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''), u.email) AS full_name,
    UPPER(TRIM(COALESCE(u.raw_user_meta_data->>'school_name', ''))) AS school_name
  FROM auth.users u
), auth_mapped AS (
  SELECT
    ab.user_id,
    ab.full_name,
    CASE
      WHEN ab.school_name IN ('MPGI', 'PSIT', 'KIT', 'KGI', 'AKTU') THEN ab.school_name
      ELSE NULL
    END AS school_name
  FROM auth_base ab
), auth_with_school AS (
  SELECT
    am.user_id,
    am.full_name,
    am.school_name,
    s.id AS school_id
  FROM auth_mapped am
  LEFT JOIN public.schools s
    ON UPPER(TRIM(s.name)) = am.school_name
)
INSERT INTO public.profiles (
  id,
  full_name,
  role,
  school_id,
  school_name,
  created_at,
  updated_at
)
SELECT
  aws.user_id,
  aws.full_name,
  'student',
  aws.school_id,
  aws.school_name,
  NOW(),
  NOW()
FROM auth_with_school aws
LEFT JOIN public.profiles p ON p.id = aws.user_id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
