-- ============================================================================
-- MISSION SCHEMA + STORAGE COMPATIBILITY HARDENING
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Ensure mission_steps compatibility for clients that query step_order.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mission_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  step_number INTEGER,
  step_order INTEGER,
  order_index INTEGER,
  title TEXT NOT NULL DEFAULT 'Step',
  description TEXT,
  instructions TEXT,
  required_proof BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mission_steps ADD COLUMN IF NOT EXISTS step_number INTEGER;
ALTER TABLE public.mission_steps ADD COLUMN IF NOT EXISTS step_order INTEGER;
ALTER TABLE public.mission_steps ADD COLUMN IF NOT EXISTS order_index INTEGER;
ALTER TABLE public.mission_steps ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.mission_steps ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.mission_steps ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE public.mission_steps ADD COLUMN IF NOT EXISTS required_proof BOOLEAN DEFAULT FALSE;
ALTER TABLE public.mission_steps ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.mission_steps
SET step_order = COALESCE(step_order, step_number, order_index, 0)
WHERE step_order IS NULL;

UPDATE public.mission_steps
SET step_number = COALESCE(step_number, step_order, order_index, 0)
WHERE step_number IS NULL;

UPDATE public.mission_steps
SET order_index = COALESCE(order_index, step_order, step_number, 0)
WHERE order_index IS NULL;

CREATE INDEX IF NOT EXISTS idx_mission_steps_mission_id ON public.mission_steps(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_steps_step_order ON public.mission_steps(mission_id, step_order);

-- --------------------------------------------------------------------------
-- Ensure mission_step_submissions compatibility for both submission_id keys.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mission_step_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID,
  mission_submission_id UUID,
  mission_step_id UUID NOT NULL REFERENCES public.mission_steps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  notes TEXT,
  submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS submission_id UUID;
ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS mission_submission_id UUID;
ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS mission_step_id UUID;
ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'in_progress';
ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.mission_step_submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.mission_step_submissions
SET submission_id = COALESCE(submission_id, mission_submission_id)
WHERE submission_id IS NULL;

UPDATE public.mission_step_submissions
SET mission_submission_id = COALESCE(mission_submission_id, submission_id)
WHERE mission_submission_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mission_step_submissions_submission_id
  ON public.mission_step_submissions(submission_id);
CREATE INDEX IF NOT EXISTS idx_mission_step_submissions_mission_submission_id
  ON public.mission_step_submissions(mission_submission_id);
CREATE INDEX IF NOT EXISTS idx_mission_step_submissions_step_id
  ON public.mission_step_submissions(mission_step_id);
CREATE INDEX IF NOT EXISTS idx_mission_step_submissions_user_id
  ON public.mission_step_submissions(user_id);

-- --------------------------------------------------------------------------
-- Ensure mission-photos storage bucket exists (fixes "Bucket not found").
-- --------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'mission-photos',
  'mission-photos',
  true,
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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

NOTIFY pgrst, 'reload schema';

COMMIT;
