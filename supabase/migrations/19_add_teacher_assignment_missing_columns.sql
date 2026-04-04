-- ============================================================================
-- TEACHER ASSIGNMENT BACKFILL
-- ============================================================================
-- Restores the teacher-assignment columns that some environments may be missing.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS teacher_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_students_teacher'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT fk_students_teacher
      FOREIGN KEY (teacher_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_teacher_id
  ON public.students (teacher_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS teacher_id UUID;
