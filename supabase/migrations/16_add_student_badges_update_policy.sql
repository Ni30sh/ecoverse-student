-- ============================================================================
-- ADD STUDENT_BADGES UPDATE POLICY
-- ============================================================================
-- Adds missing UPDATE RLS policy for student_badges table to support upsert operations

BEGIN;

-- Add UPDATE policy for student_badges to allow users to update their own badges
DROP POLICY IF EXISTS student_badges_update_own ON public.student_badges;
CREATE POLICY student_badges_update_own ON public.student_badges
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Notify Supabase to reload schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
