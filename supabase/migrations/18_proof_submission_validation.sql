-- ============================================================================
-- PROOF SUBMISSION VALIDATION FIX
-- ============================================================================
-- Ensures missions cannot be submitted without required proof:
-- - photo_url is required and not empty
-- - location (latitude, longitude) is required if mission requires_location=true

BEGIN;

-- Update the main submit_mission_proof RPC with proper validation
CREATE OR REPLACE FUNCTION public.submit_mission_proof(
  p_submission_id uuid DEFAULT NULL,
  p_mission_id uuid DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL
)
RETURNS TABLE (
  submission_id uuid,
  user_id uuid,
  mission_id uuid,
  status text,
  awarded_points integer,
  streak_days integer,
  notification_sent boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_submission_id uuid;
  v_user_id uuid;
  v_mission_id uuid;
  v_status text;
  v_requires_teacher_approval boolean := true;
  v_requires_location boolean := false;
  v_reward integer := 0;
  v_awarded integer := 0;
  v_streak integer := 0;
  v_notification_sent boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate photo_url is not null and not empty
  IF p_photo_url IS NULL OR trim(p_photo_url) = '' THEN
    RAISE EXCEPTION 'photo_url is required and cannot be empty';
  END IF;

  IF p_submission_id IS NOT NULL THEN
    SELECT s.id, s.user_id, s.mission_id, lower(coalesce(s.status, 'in_progress'))
    INTO v_submission_id, v_user_id, v_mission_id, v_status
    FROM public.submissions s
    WHERE s.id = p_submission_id
    LIMIT 1;
  END IF;

  IF v_submission_id IS NULL THEN
    SELECT s.id, s.user_id, s.mission_id, lower(coalesce(s.status, 'in_progress'))
    INTO v_submission_id, v_user_id, v_mission_id, v_status
    FROM public.submissions s
    WHERE s.user_id = v_actor
      AND s.mission_id = p_mission_id
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_submission_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF v_user_id <> v_actor THEN
    RAISE EXCEPTION 'Cannot submit proof for another user';
  END IF;

  -- Get mission details including requires_location and requires_teacher_approval
  SELECT
    coalesce(m.requires_teacher_approval, true),
    coalesce(m.requires_location, false),
    greatest(0, coalesce(m.eco_points_reward, 0))::integer
  INTO v_requires_teacher_approval, v_requires_location, v_reward
  FROM public.missions m
  WHERE m.id = v_mission_id
  LIMIT 1;

  -- Validate location is provided if mission requires it
  IF v_requires_location = true THEN
    IF (p_latitude IS NULL OR p_longitude IS NULL) THEN
      RAISE EXCEPTION 'Location proof is required for this mission';
    END IF;
  END IF;

  IF v_requires_teacher_approval THEN
    UPDATE public.submissions
    SET
      photo_url = trim(p_photo_url),
      proof_photo_url = trim(p_photo_url),
      proof_url = trim(p_photo_url),
      notes = coalesce(nullif(trim(p_notes), ''), notes),
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
      submitted_at = coalesce(submitted_at, now()),
      status = CASE WHEN lower(coalesce(status, 'in_progress')) = 'approved' THEN 'approved' ELSE 'pending' END,
      updated_at = now()
    WHERE id = v_submission_id;

    SELECT lower(coalesce(s.status, 'pending'))
    INTO v_status
    FROM public.submissions s
    WHERE s.id = v_submission_id;

    RETURN QUERY
    SELECT v_submission_id, v_user_id, v_mission_id, v_status, 0, 0, false;
    RETURN;
  END IF;

  -- Auto-approve path: idempotent reward awarding.
  UPDATE public.submissions
  SET
    photo_url = trim(p_photo_url),
    proof_photo_url = trim(p_photo_url),
    proof_url = trim(p_photo_url),
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    latitude = coalesce(p_latitude, latitude),
    longitude = coalesce(p_longitude, longitude),
    submitted_at = coalesce(submitted_at, now()),
    status = 'approved',
    updated_at = now()
  WHERE id = v_submission_id;

  IF v_status <> 'approved' AND v_reward > 0 THEN
    v_awarded := v_reward;

    BEGIN
      UPDATE public.students
      SET
        eco_points = greatest(0, coalesce(eco_points, 0)) + v_reward,
        streak_days = greatest(0, coalesce(streak_days, 0)) + 1,
        updated_at = now()
      WHERE id = v_user_id
      RETURNING coalesce(streak_days, 0)::integer INTO v_streak;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        v_streak := 0;
    END;

    BEGIN
      UPDATE public.profiles
      SET
        eco_points = greatest(0, coalesce(eco_points, coalesce(points, 0))) + v_reward,
        points = greatest(0, coalesce(points, coalesce(eco_points, 0))) + v_reward,
        updated_at = now()
      WHERE id = v_user_id;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        NULL;
    END;

    BEGIN
      INSERT INTO public.daily_points (user_id, date, points_earned, updated_at)
      VALUES (v_user_id, current_date, v_reward, now())
      ON CONFLICT (user_id, date) DO UPDATE
      SET
        points_earned = greatest(0, coalesce(public.daily_points.points_earned, 0)) + EXCLUDED.points_earned,
        updated_at = now();
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        NULL;
      WHEN others THEN
        BEGIN
          UPDATE public.daily_points
          SET
            points_earned = greatest(0, coalesce(points_earned, 0)) + v_reward,
            updated_at = now()
          WHERE user_id = v_user_id
            AND date = current_date;

          IF NOT FOUND THEN
            INSERT INTO public.daily_points (user_id, date, points_earned, updated_at)
            VALUES (v_user_id, current_date, v_reward, now());
          END IF;
        EXCEPTION
          WHEN undefined_table OR undefined_column THEN
            NULL;
        END;
    END;

    BEGIN
      INSERT INTO public.weekly_points (user_id, date, points_earned, created_at)
      VALUES (v_user_id, current_date, v_reward, now())
      ON CONFLICT (user_id, date) DO UPDATE
      SET points_earned = greatest(0, coalesce(public.weekly_points.points_earned, 0)) + EXCLUDED.points_earned;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        NULL;
      WHEN others THEN
        BEGIN
          UPDATE public.weekly_points
          SET points_earned = greatest(0, coalesce(points_earned, 0)) + v_reward
          WHERE user_id = v_user_id
            AND date = current_date;

          IF NOT FOUND THEN
            INSERT INTO public.weekly_points (user_id, date, points_earned, created_at)
            VALUES (v_user_id, current_date, v_reward, now());
          END IF;
        EXCEPTION
          WHEN undefined_table OR undefined_column THEN
            NULL;
        END;
    END;

    BEGIN
      v_notification_sent := true;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        v_notification_sent := false;
    END;
  END IF;

  SELECT lower(coalesce(s.status, 'approved'))
  INTO v_status
  FROM public.submissions s
  WHERE s.id = v_submission_id;

  RETURN QUERY
  SELECT v_submission_id, v_user_id, v_mission_id, v_status, v_awarded, v_streak, v_notification_sent;
END;
$$;

-- Update submit_proof_for_submission with location validation
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
  v_requires_location BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_submission_id IS NULL THEN
    RAISE EXCEPTION 'submission_id is required';
  END IF;

  -- Validate photo_url is not null and not empty
  IF p_photo_url IS NULL OR TRIM(p_photo_url) = '' THEN
    RAISE EXCEPTION 'photo_url is required and cannot be empty';
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

  -- Get mission's location requirement
  SELECT coalesce(m.requires_location, false)
  INTO v_requires_location
  FROM public.missions m
  WHERE m.id = v_mission_id
  LIMIT 1;

  -- Validate location if mission requires it
  IF v_requires_location = true THEN
    IF (p_latitude IS NULL OR p_longitude IS NULL) THEN
      RAISE EXCEPTION 'Location proof is required for this mission';
    END IF;
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

COMMIT;
