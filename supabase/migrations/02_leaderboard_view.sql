-- ============================================================================
-- LEADERBOARD RELATION (VIEW)
-- ============================================================================
-- Provides a read-only relation consumed by dashboard/profile pages.
-- Includes both id and user_id aliases for compatibility.

-- Ensure compatibility columns exist on students before building the view.
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

DROP VIEW IF EXISTS public.leaderboard;

CREATE VIEW public.leaderboard AS
SELECT
  s.id,
  s.id AS user_id,
  s.email,
  s.full_name,
  s.avatar_emoji,
  s.eco_points,
  s.streak_days,
  s.school_id,
  COALESCE(s.is_bot, FALSE) AS is_bot,
  CASE
    WHEN COALESCE(s.eco_points, 0) >= 5000 THEN 'Eco Champion'
    WHEN COALESCE(s.eco_points, 0) >= 2500 THEN 'Eco Leader'
    WHEN COALESCE(s.eco_points, 0) >= 1000 THEN 'Eco Ranger'
    WHEN COALESCE(s.eco_points, 0) >= 300 THEN 'Eco Starter'
    ELSE 'Eco Rookie'
  END AS level_title,
  s.role,
  s.created_at,
  s.updated_at,
  RANK() OVER (ORDER BY s.eco_points DESC, s.updated_at ASC, s.id ASC) AS rank
FROM public.students s
WHERE COALESCE(s.role, 'student') = 'student';

-- Leaderboard is read-only; allow app clients to select.
GRANT SELECT ON public.leaderboard TO authenticated;
GRANT SELECT ON public.leaderboard TO anon;

-- Performance indexes used by leaderboard sorting and lookups.
CREATE INDEX IF NOT EXISTS idx_students_eco_points ON public.students(eco_points DESC, updated_at ASC);
CREATE INDEX IF NOT EXISTS idx_students_id ON public.students(id);

-- Refresh PostgREST schema cache so Supabase clients can resolve new relation immediately.
NOTIFY pgrst, 'reload schema';
