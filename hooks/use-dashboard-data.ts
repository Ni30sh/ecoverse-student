import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useToast } from "@/components/ui/toast-provider";
import { queryKeys } from "@/lib/query/query-keys";
import { supabase } from "@/lib/supabase/client";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { logTelemetry } from "@/lib/utils/telemetry";
import { useAuth } from "@/providers/auth-provider";

type GenericRecord = Record<string, unknown>;

type ProofPayload = {
  submissionId: string;
  photoUrl?: string;
  notes?: string;
  coords?: { lat: number; lng: number };
};

type ProofResult = {
  autoApproved: boolean;
  pointsAwarded: number;
};

type RecommendationMetrics = {
  impressions: number;
  clicks: number;
  starts: number;
  submits: number;
  ctr: number;
  startRate: number;
  submitRate: number;
};

type CategoryMetrics = {
  water: RecommendationMetrics;
  waste: RecommendationMetrics;
  planting: RecommendationMetrics;
};

type RecommendationVariant = "control" | "explore_diversity" | "unknown";

type VariantMetrics = {
  control: RecommendationMetrics;
  explore_diversity: RecommendationMetrics;
  unknown: RecommendationMetrics;
};

function emptyRecommendationMetrics(): RecommendationMetrics {
  return {
    impressions: 0,
    clicks: 0,
    starts: 0,
    submits: 0,
    ctr: 0,
    startRate: 0,
    submitRate: 0,
  };
}

function emptyMetricsByCategory(): CategoryMetrics {
  return {
    water: emptyRecommendationMetrics(),
    waste: emptyRecommendationMetrics(),
    planting: emptyRecommendationMetrics(),
  };
}

function emptyMetricsByVariant(): VariantMetrics {
  return {
    control: emptyRecommendationMetrics(),
    explore_diversity: emptyRecommendationMetrics(),
    unknown: emptyRecommendationMetrics(),
  };
}

function toInt(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
}

function toText(value: unknown, fallback = "") {
  const str = String(value ?? "").trim();
  return str || fallback;
}

function calculateCurrentStreak(rows: GenericRecord[]) {
  const activeDates = new Set<string>();

  for (const row of rows) {
    const dateValue = toText((row as GenericRecord).date, "");
    if (!dateValue) continue;

    const points = toInt(
      (row as GenericRecord).points_earned ?? (row as GenericRecord).points,
      0,
    );
    if (points > 0) {
      activeDates.add(dateValue.slice(0, 10));
    }
  }

  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (streak < 365) {
    const dateKey = cursor.toISOString().slice(0, 10);
    if (!activeDates.has(dateKey)) {
      break;
    }

    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

async function updateEcoPoints(userId: string, addPoints: number) {
  const safePoints = Math.max(0, toInt(addPoints, 0));
  if (safePoints <= 0) return;

  const studentRow = await supabase
    .from("students")
    .select("id,eco_points")
    .eq("id", userId)
    .maybeSingle();

  if (!studentRow.error && studentRow.data) {
    const nextPoints = Math.max(
      0,
      toInt((studentRow.data as GenericRecord).eco_points, 0) + safePoints,
    );
    await supabase
      .from("students")
      .update({ eco_points: nextPoints, updated_at: new Date().toISOString() })
      .eq("id", userId);
    return;
  }

  const profileRow = await supabase
    .from("profiles")
    .select("id,eco_points,points")
    .eq("id", userId)
    .maybeSingle();

  if (!profileRow.error && profileRow.data) {
    const current = toInt(
      (profileRow.data as GenericRecord).eco_points ??
        (profileRow.data as GenericRecord).points,
      0,
    );
    const nextPoints = Math.max(0, current + safePoints);

    await supabase
      .from("profiles")
      .update({
        eco_points: nextPoints,
        points: nextPoints,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
  }
}

async function recordDailyPoints(userId: string, addPoints: number) {
  const safePoints = Math.max(0, toInt(addPoints, 0));
  if (safePoints <= 0) return;

  const today = new Date().toISOString().slice(0, 10);

  const daily = await supabase
    .from("daily_points")
    .select("id,points_earned")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (!daily.error) {
    if (daily.data) {
      const nextPoints =
        toInt((daily.data as GenericRecord).points_earned, 0) + safePoints;
      await supabase
        .from("daily_points")
        .update({ points_earned: nextPoints })
        .eq("id", (daily.data as GenericRecord).id);
    } else {
      await supabase
        .from("daily_points")
        .insert({ user_id: userId, date: today, points_earned: safePoints });
    }
    return;
  }

  const weekly = await supabase
    .from("weekly_points")
    .select("id,points_earned")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (!weekly.error) {
    if (weekly.data) {
      const nextPoints =
        toInt((weekly.data as GenericRecord).points_earned, 0) + safePoints;
      await supabase
        .from("weekly_points")
        .update({ points_earned: nextPoints })
        .eq("id", (weekly.data as GenericRecord).id);
    } else {
      await supabase
        .from("weekly_points")
        .insert({ user_id: userId, date: today, points_earned: safePoints });
    }
  }
}

async function markAllNotificationsRead(userId: string) {
  const result = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_read", false)
    .select("id");

  return !result.error;
}

async function getSubmissionWithMission(submissionId: string) {
  const canonical = await supabase
    .from("submissions")
    .select(
      "id,user_id,mission_id,status,missions(id,title,eco_points_reward,requires_photo,requires_location)",
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (!canonical.error && canonical.data) {
    return canonical.data as GenericRecord;
  }

  const fallback = await supabase
    .from("mission_submissions")
    .select(
      "id,user_id,student_id,mission_id,status,missions(id,title,eco_points_reward,requires_photo,requires_location)",
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (!fallback.error && fallback.data) {
    return fallback.data as GenericRecord;
  }

  return null;
}

async function updateSubmissionStatus(
  submissionId: string,
  payload: {
    status: "in_progress" | "pending" | "approved" | "rejected" | "submitted";
    photoUrl?: string;
    notes?: string;
    coords?: { lat: number; lng: number };
    reviewedAt?: string | null;
  },
) {
  const updatePayload: GenericRecord = {
    status: payload.status,
    photo_url: payload.photoUrl ?? null,
    proof_url: payload.photoUrl ?? null,
    proof_photo_url: payload.photoUrl ?? null,
    notes: payload.notes ?? null,
    latitude: payload.coords?.lat ?? null,
    longitude: payload.coords?.lng ?? null,
    submitted_at: new Date().toISOString(),
    reviewed_at: payload.reviewedAt ?? null,
    updated_at: new Date().toISOString(),
  };

  const canonical = await supabase
    .from("submissions")
    .update(updatePayload)
    .eq("id", submissionId)
    .select("*")
    .maybeSingle();

  if (!canonical.error && canonical.data) {
    return canonical.data as GenericRecord;
  }

  const fallback = await supabase
    .from("mission_submissions")
    .update(updatePayload)
    .eq("id", submissionId)
    .select("*")
    .maybeSingle();

  if (!fallback.error && fallback.data) {
    return fallback.data as GenericRecord;
  }

  throw (
    canonical.error ??
    fallback.error ??
    new Error("Failed to update submission")
  );
}

export function useDashboardData() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const userId = user?.id;
  const authProfile = (profile as GenericRecord | null) ?? null;

  const profileQuery = useQuery({
    queryKey: userId ? queryKeys.profile(userId) : ["profile", "anonymous"],
    queryFn: async () => {
      if (!userId) {
        return null;
      }

      const result = await supabaseQueries.profiles.getById(userId);
      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_profile_query_failed",
          String(result.error),
          { userId },
        );
        return authProfile;
      }

      return (result.data ?? null) as GenericRecord | null;
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
  });

  const effectiveProfile =
    (profileQuery.data as GenericRecord | null | undefined) ?? authProfile;

  const currentSchoolName = toText(
    effectiveProfile?.school_name,
    "",
  );
  const previousSubmissionStatusRef = useRef<Record<string, string>>({});
  const loggedMissionImpressionsRef = useRef<Set<string>>(new Set());

  const invalidateLiveStudentViews = useCallback(
    async (reason: string) => {
      if (!userId) return;

      if (__DEV__) {
        console.log("[student-realtime] invalidating student caches", {
          userId,
          reason,
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.submissions(userId),
        }),
        queryClient.invalidateQueries({ queryKey: ["activity", userId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) }),
        queryClient.invalidateQueries({ queryKey: ["rank", userId] }),
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-points", userId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dailyPoints(userId) }),
      ]);
    },
    [queryClient, userId],
  );

  const refreshProfile = useCallback(async () => {
    if (!userId) return;

    await invalidateLiveStudentViews("refresh_profile");

    // Trigger direct profile read and write into cache so UI updates immediately.
    const latestProfile = await supabaseQueries.profiles.getById(userId);
    if (!latestProfile.error && latestProfile.data) {
      queryClient.setQueryData(queryKeys.profile(userId), latestProfile.data);
    }
  }, [invalidateLiveStudentViews, queryClient, userId]);

  useEffect(() => {
    if (!userId) return;

    let unsubscribed = false;
    let liveChannel: ReturnType<typeof supabase.channel> | null = null;

    const subscribeToRealtime = async () => {
      try {
        let channel = supabase.channel(`student-live-${userId}`);
        liveChannel = channel;

        // Subscribe to mission_submissions changes (canonical + legacy fallback)
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_submissions",
            filter: `user_id=eq.${userId}`,
          },
          async (payload) => {
            if (unsubscribed) return;
            logTelemetry(
              "info",
              "realtime_mission_submissions_change",
              "Change detected in mission_submissions",
            );
            if (__DEV__) {
              console.log("[student-realtime] mission_submissions event", {
                eventType: payload.eventType,
                table: payload.table,
                userId,
              });
            }
            await invalidateLiveStudentViews("mission_submissions_change");
          },
        );

        // Subscribe to canonical submissions table (primary source)
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "submissions",
            filter: `user_id=eq.${userId}`,
          },
          async (payload) => {
            if (unsubscribed) return;
            logTelemetry(
              "info",
              "realtime_submissions_change",
              "Change detected in submissions",
            );
            if (__DEV__) {
              console.log("[student-realtime] submissions event", {
                eventType: payload.eventType,
                table: payload.table,
                userId,
              });
            }
            await invalidateLiveStudentViews("submissions_change");
          },
        );

        // Subscribe to notifications
        channel = channel.on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            if (unsubscribed) return;
            logTelemetry(
              "info",
              "realtime_notification_insert",
              "New notification received",
            );
            queryClient.invalidateQueries({
              queryKey: ["notifications", userId],
            });
          },
        );

        // Subscribe to daily/weekly points changes
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "daily_points",
            filter: `user_id=eq.${userId}`,
          },
          async (payload) => {
            if (unsubscribed) return;
            logTelemetry(
              "info",
              "realtime_daily_points_change",
              "Daily points updated",
            );
            if (__DEV__) {
              console.log("[student-realtime] daily_points event", {
                eventType: payload.eventType,
                table: payload.table,
                userId,
              });
            }
            await invalidateLiveStudentViews("daily_points_change");
          },
        );

        // Fallback: subscribe to weekly_points if daily_points fails
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "weekly_points",
            filter: `user_id=eq.${userId}`,
          },
          async (payload) => {
            if (unsubscribed) return;
            logTelemetry(
              "info",
              "realtime_weekly_points_change",
              "Weekly points updated",
            );
            await invalidateLiveStudentViews("weekly_points_change");
          },
        );

        // Subscribe to profile changes
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          async (payload) => {
            if (unsubscribed) return;
            logTelemetry("info", "realtime_profile_change", "Profile updated");
            if (__DEV__) {
              console.log("[student-realtime] profiles event", {
                eventType: payload.eventType,
                table: payload.table,
                userId,
              });
            }
            await invalidateLiveStudentViews("profiles_change");
          },
        );

        // Subscribe to students table (canonical profile table)
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "students",
            filter: `id=eq.${userId}`,
          },
          async (payload) => {
            if (unsubscribed) return;
            logTelemetry(
              "info",
              "realtime_student_change",
              "Student profile updated",
            );
            if (__DEV__) {
              console.log("[student-realtime] students event", {
                eventType: payload.eventType,
                table: payload.table,
                userId,
              });
            }
            await invalidateLiveStudentViews("students_change");
          },
        );

        // Subscribe to leaderboard changes (for rank updates)
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "leaderboard",
          },
          async (payload) => {
            if (unsubscribed) return;
            logTelemetry(
              "info",
              "realtime_leaderboard_change",
              "Leaderboard updated",
            );
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
              queryClient.invalidateQueries({ queryKey: ["rank", userId] }),
              queryClient.invalidateQueries({ queryKey: ["real-user-count"] }),
            ]);
          },
        );

        await channel.subscribe((status, err) => {
          if (err) {
            logTelemetry("error", "realtime_subscription_error", String(err), {
              userId,
            });
          } else {
            logTelemetry("info", "realtime_subscription_status", status, {
              userId,
            });
          }
        });

        if (!unsubscribed) {
          logTelemetry(
            "info",
            "realtime_subscribed",
            "Realtime subscription established",
            { userId },
          );
        }
      } catch (error) {
        if (!unsubscribed) {
          logTelemetry(
            "error",
            "realtime_subscription_exception",
            String(error),
            { userId },
          );
        }
      }
    };

    void subscribeToRealtime();

    return () => {
      unsubscribed = true;
      if (liveChannel) {
        void supabase.removeChannel(liveChannel);
      }
    };
  }, [invalidateLiveStudentViews, queryClient, userId]);

  const rankQuery = useQuery({
    queryKey: ["rank", userId],
    queryFn: async () => {
      if (!userId) return 999;
      const result = await supabaseQueries.leaderboard.getRank(userId);
      if (result.error || !result.data) {
        logTelemetry(
          "warn",
          "dashboard_rank_query_failed",
          String(result.error),
          { userId },
        );
        return 999;
      }
      return Math.max(1, toInt((result.data as GenericRecord).rank, 999));
    },
    enabled: Boolean(userId),
    staleTime: 60 * 1000, // Cache for 60s to reduce API calls
  });

  const leaderboardQuery = useQuery({
    queryKey: ["leaderboard", userId],
    queryFn: async () => {
      if (!userId) return [];
      const scope = currentSchoolName ? "my_school" : "global";
      const result = await supabaseQueries.leaderboard.getTopUsers(
        5,
        "all_time",
        scope,
        userId,
      );
      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_leaderboard_query_failed",
          String(result.error),
          { userId },
        );
      }
      const rows = result.data ?? [];

      return rows.map((p) => ({
        id: String(
          (p as GenericRecord).id ?? (p as GenericRecord).user_id ?? "",
        ),
        full_name: toText((p as GenericRecord).full_name, "Student"),
        avatar_emoji: toText((p as GenericRecord).avatar_emoji, "🌱"),
        eco_points: toInt((p as GenericRecord).eco_points, 0),
        school_name: toText((p as GenericRecord).school_name, ""),
      }));
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000, // Cache for 30s
  });

  const missionsQuery = useQuery({
    queryKey: ["dashboard-missions", userId],
    queryFn: async () => {
      if (!userId) return [];
      const result = await supabaseQueries.missions.getRecommendations(userId, 3);
      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_recommended_missions_query_failed",
          String(result.error),
          { userId },
        );
      }
      return (result.data ?? []).slice(0, 3);
    },
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000, // Cache missions for 5 minutes
  });

  useEffect(() => {
    loggedMissionImpressionsRef.current = new Set();
  }, [userId]);

  const trackMissionEvent = useCallback(
    async (
      eventType:
        | "mission_impression"
        | "mission_click"
        | "mission_start"
        | "mission_submit"
        | "mission_approved",
      missionId: string,
      metadata?: GenericRecord,
    ) => {
      if (!userId || !missionId) {
        return;
      }

      const result = await supabaseQueries.activityEvents.log({
        userId,
        eventType,
        missionId,
        metadata,
      });

      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_activity_event_log_failed",
          String(result.error),
          { userId, missionId, eventType },
        );
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) {
      return;
    }

    const rows = (missionsQuery.data ?? []) as GenericRecord[];
    for (let index = 0; index < rows.length; index += 1) {
      const mission = rows[index] as GenericRecord;
      const missionId = toText(mission.id);
      if (!missionId || loggedMissionImpressionsRef.current.has(missionId)) {
        continue;
      }

      loggedMissionImpressionsRef.current.add(missionId);
      const recommendationVariant = toText(mission.recommendation_variant, "");
      void trackMissionEvent("mission_impression", missionId, {
        rank: index + 1,
        source: "dashboard_recommendations",
        recommendationVariant,
      });
    }
  }, [missionsQuery.data, trackMissionEvent, userId]);

  const submissionsQuery = useQuery({
    queryKey: ["submissions", userId],
    queryFn: async () => {
      if (!userId) return [];
      const result =
        await supabaseQueries.missionSubmissions.getUserSubmissions(userId);
      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_submissions_query_failed",
          String(result.error),
          { userId },
        );
        return [];
      }
      return result.data ?? [];
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000, // Cache for 30s
  });

  useEffect(() => {
    if (!userId) return;

    const rows = (submissionsQuery.data ?? []) as GenericRecord[];
    const currentStatusMap: Record<string, string> = {};

    for (const row of rows) {
      const id = toText(row.id);
      if (!id) continue;
      currentStatusMap[id] = toText(row.status, "available");
    }

    const previousMap = previousSubmissionStatusRef.current;
    const isFirstSync = Object.keys(previousMap).length === 0;

    if (!isFirstSync) {
      for (const row of rows) {
        const id = toText(row.id);
        const previous = previousMap[id];
        const current = toText(row.status, "available");

        if (previous && previous !== current) {
          const title = toText(
            (row.missions as GenericRecord | null)?.title,
            "mission",
          );

          if (current === "approved") {
            showToast(`Mission approved: ${title}`, "success");
          } else if (current === "rejected") {
            showToast(`Submission needs revision: ${title}`, "error");
          }
        }
      }
    }

    previousSubmissionStatusRef.current = currentStatusMap;
  }, [showToast, submissionsQuery.data, userId]);

  const weeklyQuery = useQuery({
    queryKey: ["weekly-points", userId],
    queryFn: async () => {
      if (!userId) return [];
      const result =
        await supabaseQueries.dailyPoints.getUserDailyPoints(userId);
      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_weekly_points_query_failed",
          String(result.error),
          { userId },
        );
        return [];
      }
      return result.data ?? [];
    },
    enabled: Boolean(userId),
    staleTime: 60 * 1000, // Cache for 60s
  });

  const recommendationMetricsQuery = useQuery({
    queryKey: ["recommendation-metrics", userId],
    queryFn: async () => {
      if (!userId) {
        return emptyRecommendationMetrics();
      }

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const events = await supabase
        .from("student_activity_events")
        .select("event_type")
        .eq("user_id", userId)
        .in("event_type", [
          "mission_impression",
          "mission_click",
          "mission_start",
          "mission_submit",
        ])
        .gte("created_at", since);

      if (events.error) {
        const message = toText(events.error.message).toLowerCase();
        const missingTable =
          message.includes("student_activity_events") &&
          (message.includes("schema cache") ||
            message.includes("does not exist") ||
            message.includes("could not find"));

        if (!missingTable) {
          logTelemetry(
            "warn",
            "dashboard_recommendation_metrics_query_failed",
            String(events.error),
            { userId },
          );
        }

        return emptyRecommendationMetrics();
      }

      const rows = (events.data ?? []) as GenericRecord[];
      let impressions = 0;
      let clicks = 0;
      let starts = 0;
      let submits = 0;

      for (const row of rows) {
        const eventType = toText(row.event_type).toLowerCase();
        if (eventType === "mission_impression") {
          impressions += 1;
        } else if (eventType === "mission_click") {
          clicks += 1;
        } else if (eventType === "mission_start") {
          starts += 1;
        } else if (eventType === "mission_submit") {
          submits += 1;
        }
      }

      const ctr = Math.round((clicks / Math.max(1, impressions)) * 100);
      const startRate = Math.round((starts / Math.max(1, clicks)) * 100);
      const submitRate = Math.round((submits / Math.max(1, starts)) * 100);

      return {
        impressions,
        clicks,
        starts,
        submits,
        ctr,
        startRate,
        submitRate,
      } as RecommendationMetrics;
    },
    enabled: Boolean(userId),
    staleTime: 60 * 1000,
  });

  const recommendationMetricsByCategoryQuery = useQuery({
    queryKey: ["recommendation-metrics-by-category", userId],
    queryFn: async () => {
      if (!userId) {
        return emptyMetricsByCategory();
      }

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      // Fetch events with mission_id
      const eventsRes = await supabase
        .from("student_activity_events")
        .select("event_type, mission_id")
        .eq("user_id", userId)
        .in("event_type", [
          "mission_impression",
          "mission_click",
          "mission_start",
          "mission_submit",
        ])
        .gte("created_at", since);

      if (eventsRes.error) {
        return emptyMetricsByCategory();
      }

      // Fetch missions to get categories
      const missionsRes = await supabase
        .from("missions")
        .select("id, category");

      if (missionsRes.error) {
        return emptyMetricsByCategory();
      }

      const events = (eventsRes.data ?? []) as GenericRecord[];
      const missions = (missionsRes.data ?? []) as GenericRecord[];
      
      // Build mission_id -> category map
      const categoryMap = new Map<string, string>();
      for (const mission of missions) {
        const missionId = toText(mission.id);
        const category = toText(mission.category).toLowerCase();
        if (missionId) {
          categoryMap.set(missionId, category);
        }
      }

      // Aggregate metrics by category
      const metrics: CategoryMetrics = emptyMetricsByCategory();
      const categories = ["water", "waste", "planting"] as const;

      for (const row of events) {
        const eventType = toText(row.event_type).toLowerCase();
        const missionId = toText(row.mission_id);
        const category = missionId ? categoryMap.get(missionId) : "";

        if (!category || !categories.includes(category as typeof categories[number])) {
          continue;
        }

        const cat = category as "water" | "waste" | "planting";

        if (eventType === "mission_impression") {
          metrics[cat].impressions += 1;
        } else if (eventType === "mission_click") {
          metrics[cat].clicks += 1;
        } else if (eventType === "mission_start") {
          metrics[cat].starts += 1;
        } else if (eventType === "mission_submit") {
          metrics[cat].submits += 1;
        }
      }

      // Calculate rates for each category
      for (const cat of categories) {
        const m = metrics[cat];
        m.ctr = Math.round((m.clicks / Math.max(1, m.impressions)) * 100);
        m.startRate = Math.round((m.starts / Math.max(1, m.clicks)) * 100);
        m.submitRate = Math.round((m.submits / Math.max(1, m.starts)) * 100);
      }

      return metrics;
    },
    enabled: Boolean(userId),
    staleTime: 60 * 1000,
  });

  const recommendationMetricsByVariantQuery = useQuery({
    queryKey: ["recommendation-metrics-by-variant", userId],
    queryFn: async () => {
      if (!userId) {
        return emptyMetricsByVariant();
      }

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const events = await supabase
        .from("student_activity_events")
        .select("event_type,metadata")
        .eq("user_id", userId)
        .in("event_type", [
          "mission_impression",
          "mission_click",
          "mission_start",
          "mission_submit",
        ])
        .gte("created_at", since);

      if (events.error) {
        const message = toText(events.error.message).toLowerCase();
        const missingTable =
          message.includes("student_activity_events") &&
          (message.includes("schema cache") ||
            message.includes("does not exist") ||
            message.includes("could not find"));

        if (!missingTable) {
          logTelemetry(
            "warn",
            "dashboard_recommendation_variant_metrics_query_failed",
            String(events.error),
            { userId },
          );
        }

        return emptyMetricsByVariant();
      }

      const rows = (events.data ?? []) as GenericRecord[];
      const metrics = emptyMetricsByVariant();

      for (const row of rows) {
        const eventType = toText(row.event_type).toLowerCase();
        const metadata = (row.metadata as GenericRecord | null) ?? null;
        const rawVariant = toText(
          metadata?.recommendationVariant ?? metadata?.recommendation_variant,
        ).toLowerCase();

        let variant: RecommendationVariant = "unknown";
        if (rawVariant === "control" || rawVariant === "explore_diversity") {
          variant = rawVariant;
        }

        if (eventType === "mission_impression") {
          metrics[variant].impressions += 1;
        } else if (eventType === "mission_click") {
          metrics[variant].clicks += 1;
        } else if (eventType === "mission_start") {
          metrics[variant].starts += 1;
        } else if (eventType === "mission_submit") {
          metrics[variant].submits += 1;
        }
      }

      const variants: RecommendationVariant[] = [
        "control",
        "explore_diversity",
        "unknown",
      ];

      for (const variant of variants) {
        const metric = metrics[variant];
        metric.ctr = Math.round(
          (metric.clicks / Math.max(1, metric.impressions)) * 100,
        );
        metric.startRate = Math.round(
          (metric.starts / Math.max(1, metric.clicks)) * 100,
        );
        metric.submitRate = Math.round(
          (metric.submits / Math.max(1, metric.starts)) * 100,
        );
      }

      return metrics;
    },
    enabled: Boolean(userId),
    staleTime: 60 * 1000,
  });

  const streakDays = useMemo(() => {
    const rows = (weeklyQuery.data ?? []) as GenericRecord[];
    return calculateCurrentStreak(rows);
  }, [weeklyQuery.data]);

  const activityQuery = useQuery({
    queryKey: ["activity", userId],
    queryFn: async () => {
      if (!userId) return [];
      const result =
        await supabaseQueries.missionSubmissions.getUserSubmissions(userId);
      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_activity_query_failed",
          String(result.error),
          { userId },
        );
        return [];
      }
      const submissions = result.data ?? [];

      return submissions
        .filter((s) =>
          [
            "approved",
            "pending",
            "in_progress",
            "submitted",
            "rejected",
          ].includes(toText((s as GenericRecord).status)),
        )
        .sort((a, b) => {
          const aTime = Date.parse(
            toText(
              (a as GenericRecord).submitted_at ||
                (a as GenericRecord).created_at,
            ),
          );
          const bTime = Date.parse(
            toText(
              (b as GenericRecord).submitted_at ||
                (b as GenericRecord).created_at,
            ),
          );
          return (
            (Number.isFinite(bTime) ? bTime : 0) -
            (Number.isFinite(aTime) ? aTime : 0)
          );
        })
        .slice(0, 4);
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      if (!userId) return [];
      const result =
        await supabaseQueries.notifications.getUserNotifications(userId);
      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_notifications_query_failed",
          String(result.error),
          { userId },
        );
        return [];
      }
      return (result.data ?? []).slice(0, 10);
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
  });

  const unreadCount = useMemo(() => {
    return ((notificationsQuery.data ?? []) as GenericRecord[]).filter(
      (n) => !Boolean((n as GenericRecord).is_read),
    ).length;
  }, [notificationsQuery.data]);

  const acceptMission = useMutation({
    mutationFn: async (missionId: string) => {
      if (!userId) throw new Error("Not authenticated");

      const missionResponse = await supabaseQueries.missions.getById(missionId);
      const mission = (missionResponse.data ?? null) as GenericRecord | null;
      const missionReward = Math.max(
        0,
        toInt(mission?.eco_points_reward ?? mission?.points ?? 0),
      );

      // Check if already accepted before attempting to create
      const existing =
        await supabaseQueries.missionSubmissions.getSubmissionForMission(
          userId,
          missionId,
        );
      let submission = !existing.error ? (existing.data ?? null) : null;
      let submissionId = toText((submission as GenericRecord | null)?.id);

      if (submission) {
        const currentStatus = toText((submission as GenericRecord).status).toLowerCase();
        if (currentStatus === "approved") {
          logTelemetry(
            "info",
            "dashboard_mission_already_completed",
            "Mission already completed",
            { userId, missionId },
          );
          return {
            submission,
            autoCompleted: true,
            pointsAwarded: 0,
            alreadyAccepted: true,
          };
        }
      }

      if (!submissionId) {
        const created = await supabaseQueries.missionSubmissions.create({
          user_id: userId,
          mission_id: missionId,
          status: "in_progress",
        });

        if (created.error) {
          logTelemetry(
            "error",
            "dashboard_mission_create_failed",
            String(created.error),
            { userId, missionId },
          );
          throw created.error;
        }

        if (!created.data) {
          throw new Error("Failed to create mission submission");
        }

        submission = created.data;
        submissionId = toText((created.data as GenericRecord).id);
      }

      if (!submissionId) {
        throw new Error("Mission submission id missing");
      }

      // Student submits proof -> submitProof mutation handles auto-approve logic
      // or sets to pending for teacher review. Never auto-approve at Accept step.
      logTelemetry(
        "info",
        "dashboard_mission_accepted",
        "Mission accepted, student can now submit proof",
        { userId, missionId, submissionId },
      );

      if (!existing.data) {
        const recommendedMission = ((missionsQuery.data ?? []) as GenericRecord[]).find(
          (row) => toText((row as GenericRecord).id) === missionId,
        ) as GenericRecord | undefined;
        const recommendationVariant = toText(
          recommendedMission?.recommendation_variant,
          "",
        );

        await trackMissionEvent("mission_start", missionId, {
          source: "dashboard_accept_button",
          submissionId,
          recommendationVariant,
        });
      }

      return {
        submission,
        autoCompleted: false,
        pointsAwarded: 0,
        alreadyAccepted: Boolean(existing.data),
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["submissions", userId] });
      queryClient.invalidateQueries({ queryKey: ["activity", userId] });
      queryClient.invalidateQueries({ queryKey: ["weekly-points", userId] });
      queryClient.invalidateQueries({ queryKey: ["rank", userId] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", userId] });

      if (result?.alreadyAccepted) {
        showToast("Quest already started.", "info");
        return;
      }

      showToast(
        "Quest accepted. Now submit your proof for teacher review.",
        "success",
      );
    },
    onError: (err: Error) => {
      showToast(err.message, "error");
    },
  });

  const submitProof = useMutation({
    mutationFn: async ({
      submissionId,
      photoUrl,
      notes,
      coords,
    }: ProofPayload): Promise<ProofResult> => {
      if (!userId) throw new Error("Not authenticated");

      const submission = await getSubmissionWithMission(submissionId);
      if (!submission) {
        logTelemetry(
          "error",
          "dashboard_submission_not_found",
          "Submission could not be retrieved",
          { userId, submissionId },
        );
        throw new Error("Submission not found");
      }

      const mission = (submission.missions as GenericRecord | null) ?? null;
      if (!mission) {
        logTelemetry(
          "error",
          "dashboard_mission_not_found",
          "Mission not found on submission",
          { userId, submissionId },
        );
        throw new Error("Mission not found");
      }

      const requiresPhoto = Boolean(mission.requires_photo ?? false);
      const requiresLocation = Boolean(mission.requires_location ?? false);
      const requiresTeacherApproval = Boolean(
        mission.requires_teacher_approval ?? true,
      );

      if (requiresPhoto && !photoUrl) {
        throw new Error("Photo proof is required for this mission");
      }

      if (requiresLocation && !coords) {
        throw new Error("Location is required for this mission");
      }

      const shouldAutoApprove =
        !requiresTeacherApproval && !requiresPhoto && !requiresLocation;

      if (shouldAutoApprove) {
        await updateSubmissionStatus(submissionId, {
          status: "approved",
          photoUrl,
          notes,
          coords,
          reviewedAt: new Date().toISOString(),
        });

        const points = Math.max(0, toInt(mission.eco_points_reward, 0));
        await updateEcoPoints(userId, points);
        await recordDailyPoints(userId, points);

        await supabaseQueries.notifications.create({
          user_id: userId,
          title: `Mission completed! +${points} EcoPoints 🌿`,
          body: `Great work on "${toText(mission.title, "mission")}". Your reward was added instantly.`,
          type: "mission",
        });

        logTelemetry(
          "info",
          "dashboard_proof_auto_approved",
          "Proof auto-approved",
          { userId, submissionId, pointsAwarded: points },
        );

        const missionId = toText(mission.id);
        const recommendedMission = ((missionsQuery.data ?? []) as GenericRecord[]).find(
          (row) => toText((row as GenericRecord).id) === missionId,
        ) as GenericRecord | undefined;
        const recommendationVariant = toText(
          recommendedMission?.recommendation_variant,
          "",
        );
        if (missionId) {
          await trackMissionEvent("mission_submit", missionId, {
            source: "dashboard_proof_submit",
            submissionId,
            autoApproved: true,
            pointsAwarded: points,
            recommendationVariant,
          });
          await trackMissionEvent("mission_approved", missionId, {
            source: "dashboard_proof_submit",
            submissionId,
            pointsAwarded: points,
            recommendationVariant,
          });
        }
        return { autoApproved: true, pointsAwarded: points };
      }

      const proofResult = await supabaseQueries.missionSubmissions.submitProof(
        submissionId,
        toText(photoUrl),
        toText(notes),
        {
          lat: coords?.lat,
          lng: coords?.lng,
        },
      );

      if (proofResult.error) {
        logTelemetry(
          "error",
          "dashboard_proof_submit_failed",
          String(proofResult.error),
          { userId, submissionId },
        );
        throw proofResult.error;
      }

      await supabaseQueries.notifications.create({
        user_id: userId,
        title: "Proof submitted! 📸",
        body: `Your proof for "${toText(mission.title, "mission")}" is pending teacher review.`,
        type: "mission",
      });

      logTelemetry(
        "info",
        "dashboard_proof_submitted",
        "Proof submitted for review",
        { userId, submissionId },
      );

      const missionId = toText(mission.id);
      const recommendedMission = ((missionsQuery.data ?? []) as GenericRecord[]).find(
        (row) => toText((row as GenericRecord).id) === missionId,
      ) as GenericRecord | undefined;
      const recommendationVariant = toText(
        recommendedMission?.recommendation_variant,
        "",
      );
      if (missionId) {
        await trackMissionEvent("mission_submit", missionId, {
          source: "dashboard_proof_submit",
          submissionId,
          autoApproved: false,
          recommendationVariant,
        });
      }
      return { autoApproved: false, pointsAwarded: 0 };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["submissions", userId] }),
        queryClient.invalidateQueries({ queryKey: ["activity", userId] }),
        queryClient.invalidateQueries({ queryKey: ["weekly-points", userId] }),
        queryClient.invalidateQueries({ queryKey: ["rank", userId] }),
        queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", userId] }),
      ]);

      await refreshProfile();

      if (result.autoApproved) {
        showToast(
          `Mission completed. +${result.pointsAwarded} EcoPoints`,
          "success",
        );
      } else {
        showToast("Proof submitted. Your teacher will review it soon.", "info");
      }
    },
    onError: (err: Error) => {
      logTelemetry("error", "dashboard_proof_mutation_error", err.message, {
        userId,
      });
      showToast(err.message, "error");
    },
  });

  const checkAutoApprove = async () => {
    // No background job required for Supabase flow.
  };

  const treesPlantedQuery = useQuery({
    queryKey: ["trees-planted", userId],
    queryFn: async () => {
      if (!userId) return 0;
      const result =
        await supabaseQueries.missionSubmissions.getUserSubmissions(userId);
      const rows = result.data ?? [];
      return rows.filter(
        (s) =>
          toText((s as GenericRecord).status) === "approved" &&
          toText(
            ((s as GenericRecord).missions as GenericRecord | null)?.category,
          ) === "planting",
      ).length;
    },
    enabled: Boolean(userId),
  });

  const realUserCountQuery = useQuery({
    queryKey: ["real-user-count"],
    queryFn: async () => {
      const leaderboard = await supabase
        .from("leaderboard")
        .select("user_id,is_bot", { count: "exact" })
        .eq("is_bot", false);

      return Math.max(0, Number(leaderboard.count ?? 0));
    },
    enabled: Boolean(userId),
  });

  const markAllRead = async () => {
    if (!userId) return;
    await markAllNotificationsRead(userId);
    queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
  };

  return {
    profile: effectiveProfile,
    rank: rankQuery.data ?? 999,
    leaderboard: leaderboardQuery.data ?? [],
    missions: missionsQuery.data ?? [],
    submissions: submissionsQuery.data ?? [],
    weeklyPoints: weeklyQuery.data ?? [],
    activity: activityQuery.data ?? [],
    notifications: notificationsQuery.data ?? [],
    unreadCount,
    treesPlanted: treesPlantedQuery.data ?? 0,
    realUserCount: realUserCountQuery.data ?? 0,
    recommendationMetrics:
      recommendationMetricsQuery.data ?? emptyRecommendationMetrics(),
    recommendationMetricsByCategory:
      recommendationMetricsByCategoryQuery.data ?? emptyMetricsByCategory(),
    recommendationMetricsByVariant:
      recommendationMetricsByVariantQuery.data ?? emptyMetricsByVariant(),
    streakDays,
    isLoading: !effectiveProfile || missionsQuery.isLoading || profileQuery.isLoading,
    acceptMission,
    trackMissionEvent,
    submitProof,
    checkAutoApprove,
    markAllRead,
    refreshProfile,
  };
}
