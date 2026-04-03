-- ============================================================================
-- SUBMISSIONS TABLE SCHEMA COMPATIBILITY
-- ============================================================================
-- Ensures submissions table exists with all required columns for proof submission
-- This fixes: "Could not find the 'proof_photo_url' column of 'submissions'"

BEGIN;

-- Create submissions table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  photo_url TEXT,
  proof_photo_url TEXT,
  proof_url TEXT,
  proof_metadata JSONB,
  notes TEXT,
  feedback TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ DEFAULT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns if table already exists (backward compatibility)
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS mission_id UUID REFERENCES public.missions(id) ON DELETE CASCADE;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'in_progress';
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS proof_photo_url TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS proof_metadata JSONB;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS feedback TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.submissions ALTER COLUMN submitted_at DROP NOT NULL;

-- Align status constraint with current app lifecycle states.
ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_status_valid;
ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_status_valid CHECK (
    status IN (
      'in_progress',
      'pending',
      'submitted',
      'approved',
      'verified',
      'rejected',
      'archived',
      'cancelled'
    )
  );

-- Remove duplicate active submissions before creating unique index.
-- Keep the most recently updated row per (user_id, mission_id).
DELETE FROM public.submissions s
USING public.submissions d
WHERE s.id = d.id
  AND s.id <> (
    SELECT keep.id
    FROM public.submissions keep
    WHERE keep.user_id = s.user_id
      AND keep.mission_id = s.mission_id
      AND lower(coalesce(keep.status, 'in_progress')) NOT IN ('rejected', 'archived', 'cancelled')
    ORDER BY keep.updated_at DESC NULLS LAST, keep.created_at DESC NULLS LAST, keep.id DESC
    LIMIT 1
  )
  AND s.user_id IS NOT NULL
  AND s.mission_id IS NOT NULL
  AND lower(coalesce(s.status, 'in_progress')) NOT IN ('rejected', 'archived', 'cancelled')
  AND d.user_id = s.user_id
  AND d.mission_id = s.mission_id
  AND lower(coalesce(d.status, 'in_progress')) NOT IN ('rejected', 'archived', 'cancelled');

-- Create unique constraint on user_id + mission_id to prevent duplicate submissions
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_user_mission_unique
  ON public.submissions(user_id, mission_id)
  WHERE status NOT IN ('rejected', 'archived', 'cancelled');

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON public.submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_mission_id ON public.submissions(mission_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON public.submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_updated_at ON public.submissions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_reviewed_by ON public.submissions(reviewed_by);

-- Synchronize photo_url fields (normalize to all three: photo_url, proof_photo_url, proof_url)
UPDATE public.submissions
SET 
  proof_photo_url = COALESCE(proof_photo_url, photo_url),
  proof_url = COALESCE(proof_url, photo_url)
WHERE proof_photo_url IS NULL OR proof_url IS NULL;

-- Create legacy mission_submissions table if it doesn't exist (for backward compatibility)
CREATE TABLE IF NOT EXISTS public.mission_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  photo_url TEXT,
  proof_photo_url TEXT,
  proof_url TEXT,
  proof_metadata JSONB,
  notes TEXT,
  feedback TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ DEFAULT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure all optional columns exist in mission_submissions table
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS mission_id UUID REFERENCES public.missions(id) ON DELETE CASCADE;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'in_progress';
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS proof_photo_url TEXT;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS proof_metadata JSONB;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS feedback TEXT;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.mission_submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.mission_submissions ALTER COLUMN submitted_at DROP NOT NULL;

-- Align legacy table status constraint with current app lifecycle states.
ALTER TABLE public.mission_submissions DROP CONSTRAINT IF EXISTS mission_submissions_status_valid;
ALTER TABLE public.mission_submissions DROP CONSTRAINT IF EXISTS mission_submissions_status_check;
ALTER TABLE public.mission_submissions
  ADD CONSTRAINT mission_submissions_status_valid CHECK (
    status IN (
      'in_progress',
      'pending',
      'submitted',
      'approved',
      'verified',
      'rejected',
      'archived',
      'cancelled'
    )
  );

-- Remove duplicate active mission_submissions before creating unique index.
-- Keep the most recently updated row per (user_id, mission_id).
DELETE FROM public.mission_submissions s
USING public.mission_submissions d
WHERE s.id = d.id
  AND s.id <> (
    SELECT keep.id
    FROM public.mission_submissions keep
    WHERE keep.user_id = s.user_id
      AND keep.mission_id = s.mission_id
      AND lower(coalesce(keep.status, 'in_progress')) NOT IN ('rejected', 'archived', 'cancelled')
    ORDER BY keep.updated_at DESC NULLS LAST, keep.created_at DESC NULLS LAST, keep.id DESC
    LIMIT 1
  )
  AND s.user_id IS NOT NULL
  AND s.mission_id IS NOT NULL
  AND lower(coalesce(s.status, 'in_progress')) NOT IN ('rejected', 'archived', 'cancelled')
  AND d.user_id = s.user_id
  AND d.mission_id = s.mission_id
  AND lower(coalesce(d.status, 'in_progress')) NOT IN ('rejected', 'archived', 'cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_submissions_user_mission_unique
  ON public.mission_submissions(user_id, mission_id)
  WHERE status NOT IN ('rejected', 'archived', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_mission_submissions_user_id ON public.mission_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_mission_submissions_student_id ON public.mission_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_mission_submissions_mission_id ON public.mission_submissions(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_submissions_status ON public.mission_submissions(status);
CREATE INDEX IF NOT EXISTS idx_mission_submissions_updated_at ON public.mission_submissions(updated_at DESC);

-- Normalize mission_submissions photo fields
UPDATE public.mission_submissions
SET 
  proof_photo_url = COALESCE(proof_photo_url, photo_url),
  proof_url = COALESCE(proof_url, photo_url)
WHERE proof_photo_url IS NULL OR proof_url IS NULL;

-- Compatibility for older badge table name used by some clients.
CREATE TABLE IF NOT EXISTS public.student_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, badge_id)
);

ALTER TABLE public.student_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_badges_read_own ON public.student_badges;
CREATE POLICY student_badges_read_own ON public.student_badges
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS student_badges_insert_own ON public.student_badges;
CREATE POLICY student_badges_insert_own ON public.student_badges
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_student_badges_user_id ON public.student_badges(user_id);

-- Ensure mission-photos bucket and upload policies exist.
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'mission-photos',
  'mission-photos',
  true,
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880;

DROP POLICY IF EXISTS mission_photos_public_read ON storage.objects;
CREATE POLICY mission_photos_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'mission-photos');

DROP POLICY IF EXISTS mission_photos_auth_upload ON storage.objects;
CREATE POLICY mission_photos_auth_upload ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'mission-photos'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS mission_photos_auth_delete_own ON storage.objects;
CREATE POLICY mission_photos_auth_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'mission-photos'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Enable RLS on submissions
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Students can only see their own submissions
DROP POLICY IF EXISTS submissions_student_read ON public.submissions;
CREATE POLICY submissions_student_read ON public.submissions
  FOR SELECT USING (auth.uid() = user_id);

-- Students can insert and update their own submissions
DROP POLICY IF EXISTS submissions_student_insert ON public.submissions;
CREATE POLICY submissions_student_insert ON public.submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS submissions_student_update ON public.submissions;
CREATE POLICY submissions_student_update ON public.submissions
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Teachers/admins can read and update submissions (with school-based RLS handled at app level)
DROP POLICY IF EXISTS submissions_reviewer_read ON public.submissions;
CREATE POLICY submissions_reviewer_read ON public.submissions
  FOR SELECT USING (
    -- Student owns it
    auth.uid() = user_id
    -- OR reviewer (teacher/admin)
    OR (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('teacher', 'admin')
    ))
    OR (EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = auth.uid() AND s.role IN ('teacher', 'admin')
    ))
  );

DROP POLICY IF EXISTS submissions_reviewer_update ON public.submissions;
CREATE POLICY submissions_reviewer_update ON public.submissions
  FOR UPDATE USING (
    auth.uid() = reviewed_by
    OR (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('teacher', 'admin')
    ))
    OR (EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = auth.uid() AND s.role IN ('teacher', 'admin')
    ))
  )
  WITH CHECK (
    auth.uid() = reviewed_by
    OR (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('teacher', 'admin')
    ))
    OR (EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = auth.uid() AND s.role IN ('teacher', 'admin')
    ))
  );

-- Enable RLS on mission_submissions (legacy table)
ALTER TABLE public.mission_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_submissions_student_read ON public.mission_submissions;
CREATE POLICY mission_submissions_student_read ON public.mission_submissions
  FOR SELECT USING (
    auth.uid() = user_id OR auth.uid() = student_id
  );

DROP POLICY IF EXISTS mission_submissions_student_insert ON public.mission_submissions;
CREATE POLICY mission_submissions_student_insert ON public.mission_submissions
  FOR INSERT WITH CHECK (
    auth.uid() = COALESCE(user_id, student_id)
  );

DROP POLICY IF EXISTS mission_submissions_student_update ON public.mission_submissions;
CREATE POLICY mission_submissions_student_update ON public.mission_submissions
  FOR UPDATE USING (auth.uid() = COALESCE(user_id, student_id))
  WITH CHECK (auth.uid() = COALESCE(user_id, student_id));

-- Notify Supabase to reload schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
