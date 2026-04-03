-- ============================================================================
-- MISSION SUBMISSION + APPROVAL RPCS (SOURCE OF TRUTH)
-- ============================================================================

BEGIN;

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
  v_reward integer := 0;
  v_awarded integer := 0;
  v_streak integer := 0;
  v_notification_sent boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_photo_url IS NULL OR trim(p_photo_url) = '' THEN
    RAISE EXCEPTION 'photo_url is required';
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

  SELECT
    coalesce(m.requires_teacher_approval, true),
    greatest(0, coalesce(m.eco_points_reward, 0))::integer
  INTO v_requires_teacher_approval, v_reward
  FROM public.missions m
  WHERE m.id = v_mission_id
  LIMIT 1;

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
      INSERT INTO public.notifications (user_id, title, body, type, created_at)
      VALUES (
        v_user_id,
        'Mission Approved',
        'Your mission was auto-approved and points were added.',
        'mission_approved',
        now()
      );
      v_notification_sent := true;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        v_notification_sent := false;
    END;
  END IF;

  RETURN QUERY
  SELECT
    v_submission_id,
    v_user_id,
    v_mission_id,
    'approved'::text,
    coalesce(v_awarded, 0),
    coalesce(v_streak, 0),
    coalesce(v_notification_sent, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_mission_submission(
  p_user_id uuid,
  p_mission_id uuid,
  p_feedback text DEFAULT NULL
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
  v_actor_role text := '';
  v_submission_id uuid;
  v_status text := '';
  v_reward integer := 0;
  v_awarded integer := 0;
  v_streak integer := 0;
  v_notification_sent boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(coalesce(p.role, ''))
  INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor
  LIMIT 1;

  IF v_actor_role = '' THEN
    BEGIN
      SELECT lower(coalesce(s.role, ''))
      INTO v_actor_role
      FROM public.students s
      WHERE s.id = v_actor
      LIMIT 1;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        v_actor_role := '';
    END;
  END IF;

  IF v_actor_role NOT IN ('teacher', 'admin') THEN
    RAISE EXCEPTION 'Only teacher/admin can approve mission submissions';
  END IF;

  SELECT s.id, lower(coalesce(s.status, 'pending'))
  INTO v_submission_id, v_status
  FROM public.submissions s
  WHERE s.user_id = p_user_id
    AND s.mission_id = p_mission_id
  ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_submission_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found for user and mission';
  END IF;

  SELECT greatest(0, coalesce(m.eco_points_reward, 0))::integer
  INTO v_reward
  FROM public.missions m
  WHERE m.id = p_mission_id
  LIMIT 1;

  IF v_status <> 'approved' THEN
    BEGIN
      UPDATE public.submissions
      SET
        status = 'approved',
        notes = CASE
          WHEN p_feedback IS NOT NULL AND trim(p_feedback) <> ''
            THEN trim(coalesce(notes, '') || E'\nTeacher feedback: ' || trim(p_feedback))
          ELSE notes
        END,
        reviewed_by = v_actor,
        reviewed_at = now(),
        feedback = coalesce(nullif(trim(p_feedback), ''), feedback),
        updated_at = now()
      WHERE id = v_submission_id;
    EXCEPTION
      WHEN undefined_column THEN
        UPDATE public.submissions
        SET
          status = 'approved',
          notes = CASE
            WHEN p_feedback IS NOT NULL AND trim(p_feedback) <> ''
              THEN trim(coalesce(notes, '') || E'\nTeacher feedback: ' || trim(p_feedback))
            ELSE notes
          END,
          updated_at = now()
        WHERE id = v_submission_id;
    END;
  END IF;

  IF v_status <> 'approved' AND v_reward > 0 THEN
    v_awarded := v_reward;

    BEGIN
      UPDATE public.students
      SET
        eco_points = greatest(0, coalesce(eco_points, 0)) + v_reward,
        streak_days = greatest(0, coalesce(streak_days, 0)) + 1,
        updated_at = now()
      WHERE id = p_user_id
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
      WHERE id = p_user_id;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        NULL;
    END;

    BEGIN
      INSERT INTO public.daily_points (user_id, date, points_earned, updated_at)
      VALUES (p_user_id, current_date, v_reward, now())
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
          WHERE user_id = p_user_id
            AND date = current_date;

          IF NOT FOUND THEN
            INSERT INTO public.daily_points (user_id, date, points_earned, updated_at)
            VALUES (p_user_id, current_date, v_reward, now());
          END IF;
        EXCEPTION
          WHEN undefined_table OR undefined_column THEN
            NULL;
        END;
    END;

    BEGIN
      INSERT INTO public.weekly_points (user_id, date, points_earned, created_at)
      VALUES (p_user_id, current_date, v_reward, now())
      ON CONFLICT (user_id, date) DO UPDATE
      SET points_earned = greatest(0, coalesce(public.weekly_points.points_earned, 0)) + EXCLUDED.points_earned;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        NULL;
      WHEN others THEN
        BEGIN
          UPDATE public.weekly_points
          SET points_earned = greatest(0, coalesce(points_earned, 0)) + v_reward
          WHERE user_id = p_user_id
            AND date = current_date;

          IF NOT FOUND THEN
            INSERT INTO public.weekly_points (user_id, date, points_earned, created_at)
            VALUES (p_user_id, current_date, v_reward, now());
          END IF;
        EXCEPTION
          WHEN undefined_table OR undefined_column THEN
            NULL;
        END;
    END;

    BEGIN
      INSERT INTO public.notifications (user_id, title, body, type, created_at)
      VALUES (
        p_user_id,
        'Mission Approved',
        coalesce(nullif(trim(p_feedback), ''), 'Your mission was approved and points were added.'),
        'mission_approved',
        now()
      );
      v_notification_sent := true;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        v_notification_sent := false;
    END;
  END IF;

  RETURN QUERY
  SELECT
    v_submission_id,
    p_user_id,
    p_mission_id,
    'approved'::text,
    coalesce(v_awarded, 0),
    coalesce(v_streak, 0),
    coalesce(v_notification_sent, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_mission_proof(uuid, uuid, text, text, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_mission_submission(uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
