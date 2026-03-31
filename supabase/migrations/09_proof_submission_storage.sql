-- ============================================================================
-- PROOF SUBMISSION STORAGE + RLS (MISSION PHOTOS BUCKET)
-- ============================================================================
-- Stabilizes Supabase Storage integration for ProofSubmissionSheet uploads.

BEGIN;

-- Ensure mission-photos bucket exists and is properly configured.
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'mission-photos',
  'mission-photos',
  true,
  false,
  5242880,  -- 5MB limit per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880;

-- ============================================================================
-- STORAGE POLICIES: mission-photos bucket (public read, auth write own)
-- ============================================================================

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

-- ============================================================================
-- HELPER: Update submission with proof metadata (atomic)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_proof_for_submission(
  p_submission_id UUID,
  p_photo_url TEXT,
  p_notes TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE (
  submission_id UUID,
  user_id UUID,
  mission_id UUID,
  status TEXT,
  photo_url TEXT,
  notes TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  submitted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_mission_id UUID;
  v_current_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_submission_id IS NULL THEN
    RAISE EXCEPTION 'submission_id is required';
  END IF;

  IF p_photo_url IS NULL OR TRIM(p_photo_url) = '' THEN
    RAISE EXCEPTION 'photo_url is required';
  END IF;

  -- Fetch submission details and verify ownership.
  SELECT s.user_id, s.mission_id, s.status
  INTO v_user_id, v_mission_id, v_current_status
  FROM public.submissions s
  WHERE s.id = p_submission_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot update submission you do not own';
  END IF;

  IF v_mission_id IS NULL THEN
    RAISE EXCEPTION 'Submission missing mission_id';
  END IF;

  -- Update submission with proof data atomically.
  UPDATE public.submissions
  SET
    photo_url = TRIM(p_photo_url),
    proof_url = TRIM(p_photo_url),
    proof_photo_url = TRIM(p_photo_url),
    notes = CASE WHEN p_notes IS NOT NULL THEN TRIM(p_notes) ELSE notes END,
    latitude = COALESCE(p_latitude, latitude),
    longitude = COALESCE(p_longitude, longitude),
    submitted_at = CASE
      WHEN v_current_status = 'in_progress' THEN NOW()
      ELSE submitted_at
    END,
    status = CASE
      WHEN v_current_status = 'in_progress' THEN 'submitted'
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = p_submission_id
  RETURNING
    id, user_id, mission_id, status, photo_url, notes, latitude, longitude, submitted_at;
END;
$$;

-- ============================================================================
-- HELPER: Verify bucket access (check if bucket is accessible)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_mission_photos_bucket()
RETURNS TABLE (
  bucket_id TEXT,
  bucket_name TEXT,
  is_public BOOLEAN,
  max_file_size BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id::TEXT,
    b.name::TEXT,
    b.public::BOOLEAN,
    COALESCE(b.file_size_limit, 0)::BIGINT
  FROM storage.buckets b
  WHERE b.id = 'mission-photos'
  LIMIT 1;
END;
$$;

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.submit_proof_for_submission(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_mission_photos_bucket() TO authenticated;
GRANT ALL ON storage.objects TO authenticated;

-- Refresh schema cache for Supabase API.
NOTIFY pgrst, 'reload schema';

COMMIT;
