-- ============================================================================
-- AUTO-CREATE PROFILE TRIGGER
-- ============================================================================
-- This trigger automatically creates a student profile when a user signs up.
-- It ensures students.id always matches auth.users.id.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
BEGIN
  INSERT INTO public.students (
    id,
    email,
    full_name,
    role,
    avatar_emoji,
    eco_points,
    streak_days,
    created_at,
    updated_at
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(new.user_metadata->>''full_name'', new.email),
    ''student'',
    ''🌱'',
    0,
    0,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
EXCEPTION
  WHEN unique_violation THEN
    RETURN new;
END;
';

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger that fires AFTER INSERT on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ============================================================================
-- VERIFY TRIGGER IS ACTIVE
-- ============================================================================
-- Run this to confirm: SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
