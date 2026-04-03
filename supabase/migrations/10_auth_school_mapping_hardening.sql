-- ============================================================================
-- AUTH SIGNUP SCHOOL MAPPING HARDENING
-- ============================================================================
-- Ensures student/profile school mapping is created server-side from auth metadata
-- so teacher visibility by school remains consistent even if client sync is delayed.

CREATE TABLE IF NOT EXISTS public.schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_name_normalized
    ON public.schools ((UPPER(TRIM(name))));

    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
    v_full_name text;
    v_school_name text;
    v_school_id uuid;
    BEGIN
    v_full_name := COALESCE(new.user_metadata->>'full_name', new.email);
    v_school_name := UPPER(TRIM(COALESCE(new.user_metadata->>'school_name', '')));

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
          new.id,
          new.email,
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
          email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
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
            new.id,
            new.email,
            v_full_name,
            'student',
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
            email = EXCLUDED.email,
            full_name = EXCLUDED.full_name,
            role = 'student',
            updated_at = NOW();
      WHEN OTHERS THEN
        RAISE LOG 'handle_new_user students upsert failed for user %: %', new.id, SQLERRM;
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
        new.id,
        v_full_name,
        'student',
        v_school_id,
        NULLIF(v_school_name, ''),
        NOW(),
        NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
        full_name = EXCLUDED.full_name,
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
            new.id,
            v_full_name,
            'student',
            v_school_id,
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
            full_name = EXCLUDED.full_name,
            role = 'student',
            school_id = COALESCE(EXCLUDED.school_id, public.profiles.school_id),
            updated_at = NOW();
    END;

    RETURN new;
    EXCEPTION
    WHEN unique_violation THEN
        RETURN new;
    WHEN OTHERS THEN
        RAISE LOG 'handle_new_user failed for user %: %', new.id, SQLERRM;
        RETURN new;
    END;
    $$;

    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
