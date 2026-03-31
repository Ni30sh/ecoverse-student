import { supabase } from "@/integrations/supabase/client";
import { supabaseQueries } from "@/integrations/supabase/queries";
import { getLevelForPoints } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

export type TimePeriod = "all_time" | "this_week" | "this_month";
export type LeaderboardScope = "global" | "my_school";

export interface LeaderboardEntry {
  user_id: string;
  full_name: string;
  avatar_emoji: string;
  school_name: string;
  eco_points: number;
  streak_days: number;
  rank: number;
  level_title: string;
  missions_completed?: number;
  is_bot?: boolean;
}

const ECO_BOTS: Omit<LeaderboardEntry, "rank" | "level_title">[] = [
  {
    user_id: "bot-maya",
    full_name: "Maya 🌿",
    avatar_emoji: "🌿",
    school_name: "EcoBot Academy",
    eco_points: 1850,
    streak_days: 12,
    is_bot: true,
  },
  {
    user_id: "bot-arjun",
    full_name: "Arjun 🌱",
    avatar_emoji: "🌱",
    school_name: "EcoBot Academy",
    eco_points: 1340,
    streak_days: 8,
    is_bot: true,
  },
  {
    user_id: "bot-priya",
    full_name: "Priya 🍃",
    avatar_emoji: "🍃",
    school_name: "EcoBot Academy",
    eco_points: 890,
    streak_days: 5,
    is_bot: true,
  },
  {
    user_id: "bot-sam",
    full_name: "Sam 🌳",
    avatar_emoji: "🌳",
    school_name: "EcoBot Academy",
    eco_points: 420,
    streak_days: 3,
    is_bot: true,
  },
];

/**
 * Get the start of the current week (Sunday)
 */
function getStartOfWeek(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day;
  const sunday = new Date(now.getFullYear(), now.getMonth(), diff);
  return sunday.toISOString().split("T")[0];
}

/**
 * Get the start of the current month
 */
function getStartOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
}

/**
 * Normalize school name for consistent filtering
 */
function normalizeSchoolName(name?: string | null): string {
  return (name || "").trim().toLowerCase();
}

/**
 * Fetch student profiles with validation
 */
async function fetchStudentProfiles(schoolFilter?: string): Promise<any[]> {
  try {
    const rows = await supabaseQueries.profiles.getByRole("student");

    if (!rows || rows.length === 0) {
      return [];
    }

    if (!schoolFilter) {
      return rows;
    }

    const normalizedFilter = normalizeSchoolName(schoolFilter);
    return rows.filter(
      (p) => normalizeSchoolName(p.school_name) === normalizedFilter,
    );
  } catch (error) {
    console.error("[leaderboard] fetchStudentProfiles error:", error);
    return [];
  }
}

/**
 * Fetch all-time leaderboard with eco_points from profiles
 */
async function fetchAllTimeLeaderboard(schoolFilter?: string) {
  try {
    const profiles = await fetchStudentProfiles(schoolFilter);

    if (profiles.length === 0) {
      return [];
    }

    return profiles
      .filter((p) => p.id && p.full_name) // Validate required fields
      .map((p) => ({
        user_id: p.id,
        full_name: p.full_name,
        avatar_emoji: p.avatar_emoji || "🌱",
        school_name: p.school_name ?? "",
        eco_points: Math.max(0, p.eco_points || 0), // Ensure non-negative
        streak_days: Math.max(0, p.streak_days || 0), // Ensure non-negative
      }))
      .sort((a, b) => b.eco_points - a.eco_points)
      .slice(0, 50);
  } catch (error) {
    console.error("[leaderboard] fetchAllTimeLeaderboard error:", error);
    return [];
  }
}

/**
 * Fetch leaderboard for a time period (this_week or this_month)
 * Aggregates points from daily_points table
 */
async function fetchTimePeriodLeaderboard(
  period: "this_week" | "this_month",
  schoolFilter?: string,
) {
  try {
    const startDate =
      period === "this_week" ? getStartOfWeek() : getStartOfMonth();

    // Fetch daily points for the period
    const { data: pointsData, error: pointsError } = await supabase
      .from("daily_points")
      .select("user_id, points_earned")
      .gte("date", startDate);

    if (pointsError) {
      throw pointsError;
    }

    if (!pointsData || pointsData.length === 0) {
      return [];
    }

    // Aggregate points by user
    const userPoints = new Map<string, number>();
    for (const row of pointsData) {
      if (row.user_id && typeof row.points_earned === "number") {
        const current = userPoints.get(row.user_id) || 0;
        userPoints.set(row.user_id, current + row.points_earned);
      }
    }

    if (userPoints.size === 0) {
      return [];
    }

    const userIds = Array.from(userPoints.keys());

    // Fetch profiles for these users
    let profiles = await fetchStudentProfiles(schoolFilter);
    profiles = profiles.filter((p) => p.id && userIds.includes(p.id));

    if (profiles.length === 0) {
      return [];
    }

    return profiles
      .map((p) => ({
        user_id: p.id,
        full_name: p.full_name,
        avatar_emoji: p.avatar_emoji || "🌱",
        school_name: p.school_name ?? "",
        eco_points: Math.max(0, userPoints.get(p.id) ?? 0),
        streak_days: Math.max(0, p.streak_days || 0),
      }))
      .sort((a, b) => b.eco_points - a.eco_points);
  } catch (error) {
    console.error("[leaderboard] fetchTimePeriodLeaderboard error:", error);
    return [];
  }
}

/**
 * Rank entries with proper tie-breaking and bot injection
 */
function rankEntries(
  entries: Omit<LeaderboardEntry, "rank" | "level_title">[],
  injectBots: boolean,
): LeaderboardEntry[] {
  if (!entries || entries.length === 0) {
    return [];
  }

  let combined = [...entries];

  if (injectBots) {
    combined = [...combined, ...ECO_BOTS];
  }

  // Sort by eco_points descending, then by user_id for consistent tie-breaking
  combined.sort((a, b) => {
    const pointsDiff = b.eco_points - a.eco_points;
    if (pointsDiff !== 0) return pointsDiff;
    // Tie-breaker: sort by user_id for consistency
    return String(a.user_id).localeCompare(String(b.user_id));
  });

  // Assign ranks with proper handling of ties
  return combined.map((e, i) => ({
    ...e,
    rank: i + 1,
    level_title: getLevelForPoints(e.eco_points).title,
  }));
}

/**
 * Student leaderboard hook
 */
export function useLeaderboardData(
  period: TimePeriod = "all_time",
  scope: LeaderboardScope = "global",
  injectBots: boolean = true,
) {
  const { user, profile } = useAuth();
  const schoolName = (profile?.school_name || "").trim();

  // Validate scope and determine school filter
  const isValidScope = scope === "global" || scope === "my_school";
  const schoolFilter =
    isValidScope && scope === "my_school" ? schoolName : undefined;
  const shouldInjectBots = injectBots && scope === "global";

  return useQuery({
    queryKey: ["leaderboard", period, scope, schoolFilter],
    queryFn: async () => {
      let raw: Omit<LeaderboardEntry, "rank" | "level_title">[] = [];

      if (period === "all_time") {
        raw = await fetchAllTimeLeaderboard(schoolFilter);
      } else if (period === "this_week" || period === "this_month") {
        raw = await fetchTimePeriodLeaderboard(period, schoolFilter);
      }

      if (raw.length === 0) {
        return {
          entries: [],
          top3: [],
          rest: [],
          currentUserEntry: undefined,
          isInTop20: false,
        };
      }

      const ranked = rankEntries(raw, shouldInjectBots);
      const top3 = ranked.slice(0, 3);
      const rest = ranked.slice(3, 20);
      const currentUserEntry = user
        ? ranked.find((e) => e.user_id === user.id)
        : undefined;
      const isInTop20 = currentUserEntry ? currentUserEntry.rank <= 20 : false;

      return {
        entries: ranked,
        top3,
        rest,
        currentUserEntry,
        isInTop20,
      };
    },
    enabled: isValidScope && (scope === "global" || !!schoolName),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}

/**
 * Teacher leaderboard hook with analytics
 */
export function useTeacherLeaderboardData(period: TimePeriod = "all_time") {
  const { profile } = useAuth();
  const schoolName = (profile?.school_name || "").trim();

  return useQuery({
    queryKey: ["teacher-leaderboard", period, schoolName],
    queryFn: async () => {
      if (!schoolName) {
        return {
          entries: [],
          top3: [],
          rest: [],
          totalPoints: 0,
          totalStudents: 0,
          pointsChart: [],
          weeklyGrowth: [],
          insights: {
            topPerformer: null,
            lowPerformers: [],
            trendDirection: "flat",
            averagePoints: 0,
          },
        };
      }

      try {
        // Fetch scoped students
        const scopedStudents = await fetchStudentProfiles(schoolName);
        if (scopedStudents.length === 0) {
          return {
            entries: [],
            top3: [],
            rest: [],
            totalPoints: 0,
            totalStudents: 0,
            pointsChart: [],
            weeklyGrowth: [],
            insights: {
              topPerformer: null,
              lowPerformers: [],
              trendDirection: "flat",
              averagePoints: 0,
            },
          };
        }

        const scopedStudentIds = scopedStudents
          .map((s) => s.id)
          .filter(Boolean);

        if (scopedStudentIds.length === 0) {
          return {
            entries: [],
            top3: [],
            rest: [],
            totalPoints: 0,
            totalStudents: 0,
            pointsChart: [],
            weeklyGrowth: [],
            insights: {
              topPerformer: null,
              lowPerformers: [],
              trendDirection: "flat",
              averagePoints: 0,
            },
          };
        }

        // Fetch approved submissions
        const { data: submissions, error: submissionsError } = await supabase
          .from("mission_submissions")
          .select("user_id")
          .in("user_id", scopedStudentIds)
          .eq("status", "approved");

        if (submissionsError) {
          throw submissionsError;
        }

        const submissionsByStudent = new Map<string, number>();
        (submissions || []).forEach((sub) => {
          if (sub.user_id) {
            submissionsByStudent.set(
              sub.user_id,
              (submissionsByStudent.get(sub.user_id) ?? 0) + 1,
            );
          }
        });

        // Calculate points for period
        const pointsForPeriod = new Map<string, number>();

        if (period === "all_time") {
          scopedStudents.forEach((s) => {
            if (s.id) {
              pointsForPeriod.set(s.id, Math.max(0, s.eco_points ?? 0));
            }
          });
        } else {
          const startDate =
            period === "this_week" ? getStartOfWeek() : getStartOfMonth();
          const { data: periodPoints, error: pointsError } = await supabase
            .from("daily_points")
            .select("user_id, points_earned")
            .in("user_id", scopedStudentIds)
            .gte("date", startDate);

          if (pointsError) {
            throw pointsError;
          }

          (periodPoints || []).forEach((row) => {
            if (row.user_id && typeof row.points_earned === "number") {
              pointsForPeriod.set(
                row.user_id,
                (pointsForPeriod.get(row.user_id) ?? 0) + row.points_earned,
              );
            }
          });
        }

        // Sort students by points
        const sortedStudents = [...scopedStudents].sort(
          (a, b) =>
            (pointsForPeriod.get(b.id) ?? 0) - (pointsForPeriod.get(a.id) ?? 0),
        );

        // Build entries
        const entries: LeaderboardEntry[] = sortedStudents
          .filter((s) => s.id) // Validate ID exists
          .map((s, index) => {
            const points = pointsForPeriod.get(s.id) ?? 0;
            return {
              user_id: s.id,
              full_name: s.full_name || "Unnamed Student",
              avatar_emoji: s.avatar_emoji || "🌱",
              school_name: s.school_name ?? "",
              eco_points: Math.max(0, points),
              streak_days: Math.max(0, s.streak_days || 0),
              rank: index + 1,
              level_title: getLevelForPoints(points).title,
              missions_completed: submissionsByStudent.get(s.id) ?? 0,
            };
          });

        // Calculate totals
        const totalPoints = entries.reduce((sum, s) => sum + s.eco_points, 0);
        const totalStudents = entries.length;
        const averagePoints =
          totalStudents > 0 ? Math.round(totalPoints / totalStudents) : 0;

        // Points chart (top 10)
        const pointsChart = entries.slice(0, 10).map((s) => ({
          name: s.full_name,
          points: s.eco_points,
        }));

        // Weekly growth
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const weekStart = sevenDaysAgo.toISOString().split("T")[0];

        const { data: weeklyRows, error: weeklyError } = await supabase
          .from("daily_points")
          .select("date, points_earned")
          .in("user_id", scopedStudentIds)
          .gte("date", weekStart);

        if (weeklyError) {
          throw weeklyError;
        }

        const byDate: Record<string, number> = {};
        (weeklyRows || []).forEach((row) => {
          if (row.date && typeof row.points_earned === "number") {
            byDate[row.date] = (byDate[row.date] ?? 0) + row.points_earned;
          }
        });

        const weeklyGrowth = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (6 - i));
          const dateKey = d.toISOString().split("T")[0];
          const label = d.toLocaleDateString("en-US", { weekday: "short" });
          return {
            day: label,
            points: byDate[dateKey] ?? 0,
          };
        });

        // Insights
        const lowPerformers = entries
          .slice()
          .sort((a, b) => a.eco_points - b.eco_points)
          .slice(0, 3)
          .map((s) => ({
            user_id: s.user_id,
            full_name: s.full_name,
            points: s.eco_points,
          }));

        const topPerformer = entries[0]
          ? {
              user_id: entries[0].user_id,
              full_name: entries[0].full_name,
              points: entries[0].eco_points,
            }
          : null;

        const trendDirection =
          weeklyGrowth.length >= 2
            ? weeklyGrowth[weeklyGrowth.length - 1].points >=
              weeklyGrowth[0].points
              ? "up"
              : "down"
            : "flat";

        return {
          entries,
          top3: entries.slice(0, 3),
          rest: entries.slice(3),
          totalPoints,
          totalStudents,
          pointsChart,
          weeklyGrowth,
          insights: {
            topPerformer,
            lowPerformers,
            trendDirection,
            averagePoints,
          },
        };
      } catch (error) {
        console.error("[leaderboard] useTeacherLeaderboardData error:", error);
        return {
          entries: [],
          top3: [],
          rest: [],
          totalPoints: 0,
          totalStudents: 0,
          pointsChart: [],
          weeklyGrowth: [],
          insights: {
            topPerformer: null,
            lowPerformers: [],
            trendDirection: "flat",
            averagePoints: 0,
          },
        };
      }
    },
    enabled: !!schoolName,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
