-- ============================================================================
-- TEACHER ASSIGNMENT FOR STUDENTS
-- ============================================================================
-- Adds teacher_id column to students table and profiles table
-- Teacher must be from the same school as the student

-- Add teacher_id to students table
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS teacher_id UUID;
ALTER TABLE public.students ADD CONSTRAINT fk_students_teacher 
  FOREIGN KEY (teacher_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_teacher_id ON public.students(teacher_id);

-- Add teacher_id to profiles table for consistency
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS teacher_id UUID;

-- Add college_name column for schools (same as school name, just more descriptive)
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS college_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS college_name TEXT;

-- Function to get teacher from same school
CREATE OR REPLACE FUNCTION public.get_teacher_for_student(p_student_id UUID)
RETURNS TABLE(
  teacher_id UUID,
  teacher_name TEXT,
  teacher_email TEXT,
  school_id UUID,
  school_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id as teacher_id,
    t.full_name as teacher_name,
    t.email as teacher_email,
    st.school_id,
    sc.name as school_name
  FROM auth.users t
  JOIN public.students st ON t.id = st.id
  JOIN public.students s ON s.school_id = st.school_id
  JOIN public.schools sc ON sc.id = st.school_id
  WHERE s.id = p_student_id
    AND st.role = 'teacher'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;
