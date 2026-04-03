-- ============================================================================
-- PROFILE RECOVERY RPC
-- ============================================================================
-- Allows authenticated users to self-heal missing students/profiles rows
-- after successful auth signup/signin if trigger-based creation was skipped.

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

  -- Only allow users to create/update their own profile rows.
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
