import { supabaseQueries } from "@/integrations/supabase/queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useToast } from "./use-toast";
import { useAuth } from "./useAuth";

export interface ProfileStats {
  missionsCompleted: number;
  treesPlanted: number;
  waterMissions: number;
  wasteMissions: number;
  categoriesCount: number;
  weeklyPoints: number;
  monthlyMissions: number;
  realUserCount: number;
  rank: number;
}

export interface SubmissionsPage {
  data: any[];
  count: number;
  hasMore: boolean;
}

export interface UseProfileDataReturn extends ProfileStats {
  submissionsQuery: (
    offset: number,
    limit: number,
    filter: "all" | "week" | "month",
  ) => any;
  updateProfile: any;
  updateAvatar: any;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Get the start of the week (days ago calculation)
 */
function getWeekStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

/**
 * Get the start of the month
 */
function getMonthStartDate(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Hook to fetch and manage student profile data
 * Provides stats, submissions, and profile mutations
 * Optimized for mobile/Expo with Supabase integration
 */
export function useProfileData(): UseProfileDataReturn {
  const { user, profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const userId = user?.id;

  // Validate user is authenticated
  const isEnabled = !!userId;

  // Fetch approved submissions (base query for derived stats)
  const approvedSubmissionsQuery = useQuery({
    queryKey: ["profile-approved-submissions", userId],
    queryFn: async () => {
      if (!userId) {
        return [];
      }

      try {
        const submissions =
          await supabaseQueries.missionSubmissions.getUserSubmissions(userId);

        if (!submissions || submissions.length === 0) {
          return [];
        }

        // Filter for approved submissions only
        const approved = submissions.filter(
          (s) => s && s.status === "approved",
        );

        return approved;
      } catch (error) {
        console.error(
          "[useProfileData] Failed to fetch approved submissions:",
          error,
        );
        return [];
      }
    },
    enabled: isEnabled,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Calculate derived stats from approved submissions
  const calculateStats = useCallback((submissions: any[]) => {
    if (!Array.isArray(submissions) || submissions.length === 0) {
      return {
        missionsCompleted: 0,
        treesPlanted: 0,
        waterMissions: 0,
        wasteMissions: 0,
        categoriesCount: 0,
        monthlyMissions: 0,
      };
    }

    const monthStart = getMonthStartDate();
    let treesPlanted = 0;
    let waterMissions = 0;
    let wasteMissions = 0;
    const categories = new Set<string>();
    let monthlyMissions = 0;

    submissions.forEach((s) => {
      if (!s) return;

      // Category tracking
      const category = s.missions?.category || null;
      if (category) {
        categories.add(String(category));
      }

      // Count by category
      if (category === "planting") treesPlanted++;
      if (category === "water") waterMissions++;
      if (category === "waste") wasteMissions++;

      // Monthly missions count
      const submittedAt = s.submitted_at ? String(s.submitted_at) : "";
      if (submittedAt >= monthStart) {
        monthlyMissions++;
      }
    });

    return {
      missionsCompleted: submissions.length,
      treesPlanted,
      waterMissions,
      wasteMissions,
      categoriesCount: categories.size,
      monthlyMissions,
    };
  }, []);

  // Memoized stats
  const stats = useMemo(
    () => calculateStats(approvedSubmissionsQuery.data || []),
    [approvedSubmissionsQuery.data, calculateStats],
  );

  // Fetch weekly points
  const weeklyPointsQuery = useQuery({
    queryKey: ["profile-weekly-points", userId],
    queryFn: async () => {
      if (!userId) {
        return 0;
      }

      try {
        const weekly =
          await supabaseQueries.dailyPoints.getWeeklyPoints(userId);

        if (!weekly || weekly.length === 0) {
          return 0;
        }

        const total = weekly.reduce((sum, d) => {
          const points = d?.points_earned ? Number(d.points_earned) : 0;
          return sum + (Number.isFinite(points) ? points : 0);
        }, 0);

        return total;
      } catch (error) {
        console.error("[useProfileData] Failed to fetch weekly points:", error);
        return 0;
      }
    },
    enabled: isEnabled,
    staleTime: 60 * 1000, // 60 seconds
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Fetch real user count (less frequently)
  const realUserCountQuery = useQuery({
    queryKey: ["profile-real-user-count"],
    queryFn: async () => {
      try {
        const profiles = await supabaseQueries.profiles.getAll();

        if (!profiles || profiles.length === 0) {
          return 0;
        }

        return profiles.length;
      } catch (error) {
        console.error("[useProfileData] Failed to fetch user count:", error);
        return 0;
      }
    },
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  });

  // Fetch user rank
  const rankQuery = useQuery({
    queryKey: ["profile-rank", userId],
    queryFn: async () => {
      if (!userId) {
        return 999;
      }

      try {
        const rank = await supabaseQueries.leaderboard.getRank(userId);
        return Number.isFinite(rank) ? rank : 999;
      } catch (error) {
        console.error("[useProfileData] Failed to fetch rank:", error);
        return 999;
      }
    },
    enabled: isEnabled,
    staleTime: 2 * 60 * 1000, // 2 minutes (rank updates frequently)
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Dynamic submissions query factory
  const submissionsQuery = useCallback(
    (
      offset: number = 0,
      limit: number = 20,
      filter: "all" | "week" | "month" = "all",
    ) => {
      return useQuery({
        queryKey: ["profile-submissions", userId, offset, limit, filter],
        queryFn: async () => {
          if (!userId) {
            return { data: [], count: 0, hasMore: false };
          }

          try {
            let submissions =
              await supabaseQueries.missionSubmissions.getUserSubmissions(
                userId,
              );

            if (!submissions || submissions.length === 0) {
              return { data: [], count: 0, hasMore: false };
            }

            // Apply date filter
            let filtered = submissions;
            if (filter === "week") {
              const weekStart = getWeekStartDate();
              filtered = submissions.filter((s) => {
                const submittedAt = s?.submitted_at
                  ? String(s.submitted_at)
                  : "";
                return submittedAt >= weekStart;
              });
            } else if (filter === "month") {
              const monthStart = getMonthStartDate();
              filtered = submissions.filter((s) => {
                const submittedAt = s?.submitted_at
                  ? String(s.submitted_at)
                  : "";
                return submittedAt >= monthStart;
              });
            }

            // Sort by submitted_at descending
            const sorted = filtered.sort((a, b) => {
              const aTime = a?.submitted_at
                ? new Date(a.submitted_at).getTime()
                : 0;
              const bTime = b?.submitted_at
                ? new Date(b.submitted_at).getTime()
                : 0;
              return bTime - aTime;
            });

            const totalCount = sorted.length;
            const paginated = sorted.slice(offset, offset + limit);
            const hasMore = offset + limit < totalCount;

            return {
              data: paginated,
              count: totalCount,
              hasMore,
            };
          } catch (error) {
            console.error(
              "[useProfileData] Failed to fetch submissions:",
              error,
            );
            return { data: [], count: 0, hasMore: false };
          }
        },
        enabled: isEnabled,
        staleTime: 20 * 1000, // 20 seconds (frequently viewed)
        gcTime: 5 * 60 * 1000, // 5 minutes
        retry: 2,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      });
    },
    [userId],
  );

  // Update profile mutation
  const updateProfile = useMutation({
    mutationFn: async (updates: {
      full_name?: string;
      school_name?: string;
      city?: string;
    }) => {
      if (!userId) {
        throw new Error("Not authenticated");
      }

      if (!updates || Object.keys(updates).length === 0) {
        throw new Error("No fields to update");
      }

      try {
        await supabaseQueries.profiles.update(userId, {
          ...updates,
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[useProfileData] Failed to update profile:", error);
        throw error;
      }
    },
    onSuccess: async () => {
      // Refresh auth profile
      await refreshProfile();

      // Invalidate related queries
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["profile-approved-submissions", userId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["profile-submissions", userId],
        }),
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
        queryClient.invalidateQueries({ queryKey: ["profile-rank", userId] }),
      ]);

      showToast({
        title: "Profile updated! 🌿",
        type: "success",
      });
    },
    onError: (err: Error) => {
      console.error("[useProfileData] Update profile error:", err);
      showToast({
        title: "Error",
        description: err.message || "Failed to update profile",
        type: "error",
      });
    },
  });

  // Update avatar mutation
  const updateAvatar = useMutation({
    mutationFn: async (avatar_emoji: string) => {
      if (!userId) {
        throw new Error("Not authenticated");
      }

      if (!avatar_emoji || typeof avatar_emoji !== "string") {
        throw new Error("Invalid avatar emoji");
      }

      try {
        await supabaseQueries.profiles.update(userId, {
          avatar_emoji,
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[useProfileData] Failed to update avatar:", error);
        throw error;
      }
    },
    onSuccess: async () => {
      // Refresh auth profile
      await refreshProfile();

      // Invalidate leaderboard to reflect new avatar
      await queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      await queryClient.invalidateQueries({
        queryKey: ["teacher-leaderboard"],
      });

      showToast({
        title: "Avatar updated! ✨",
        type: "success",
      });
    },
    onError: (err: Error) => {
      console.error("[useProfileData] Update avatar error:", err);
      showToast({
        title: "Error",
        description: err.message || "Failed to update avatar",
        type: "error",
      });
    },
  });

  // Collect errors
  const queryError =
    approvedSubmissionsQuery.error ||
    weeklyPointsQuery.error ||
    realUserCountQuery.error ||
    rankQuery.error ||
    null;

  // Determine overall loading state
  const isLoading =
    approvedSubmissionsQuery.isFetching ||
    weeklyPointsQuery.isFetching ||
    rankQuery.isFetching;

  return {
    missionsCompleted: stats.missionsCompleted,
    treesPlanted: stats.treesPlanted,
    waterMissions: stats.waterMissions,
    wasteMissions: stats.wasteMissions,
    categoriesCount: stats.categoriesCount,
    weeklyPoints: weeklyPointsQuery.data ?? 0,
    monthlyMissions: stats.monthlyMissions,
    realUserCount: realUserCountQuery.data ?? 0,
    rank: rankQuery.data ?? 999,
    submissionsQuery,
    updateProfile,
    updateAvatar,
    isLoading,
    error: queryError,
  };
}

/**
 * Lighter hook for just profile stats (without submissions queries)
 */
export function useProfileStats() {
  const { user } = useAuth();
  const userId = user?.id;

  const approvedSubmissionsQuery = useQuery({
    queryKey: ["profile-approved-submissions", userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const submissions =
          await supabaseQueries.missionSubmissions.getUserSubmissions(userId);
        return submissions?.filter((s) => s?.status === "approved") || [];
      } catch (error) {
        console.error("[useProfileStats] Error:", error);
        return [];
      }
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });

  const stats = useMemo(() => {
    const submissions = approvedSubmissionsQuery.data || [];
    return {
      missionsCompleted: submissions.length,
      treesPlanted: submissions.filter(
        (s) => s?.missions?.category === "planting",
      ).length,
      waterMissions: submissions.filter(
        (s) => s?.missions?.category === "water",
      ).length,
      wasteMissions: submissions.filter(
        (s) => s?.missions?.category === "waste",
      ).length,
    };
  }, [approvedSubmissionsQuery.data]);

  return { ...stats, isLoading: approvedSubmissionsQuery.isFetching };
}

/**
 * Hook for user rank only
 */
export function useUserRank() {
  const { user } = useAuth();
  const userId = user?.id;

  const rankQuery = useQuery({
    queryKey: ["profile-rank", userId],
    queryFn: async () => {
      if (!userId) return 999;
      try {
        const rank = await supabaseQueries.leaderboard.getRank(userId);
        return Number.isFinite(rank) ? rank : 999;
      } catch (error) {
        console.error("[useUserRank] Error:", error);
        return 999;
      }
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });

  return { rank: rankQuery.data ?? 999, isLoading: rankQuery.isFetching };
}
