import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useToast } from "@/components/ui/toast-provider";
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
    location_lat: payload.coords?.lat ?? null,
    location_lng: payload.coords?.lng ?? null,
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
  const currentSchoolName = toText(
    (profile as GenericRecord | null)?.school_name,
    "",
  );
  const previousSubmissionStatusRef = useRef<Record<string, string>>({});

  const refreshProfile = useCallback(async () => {
    if (!userId) return;

    // Refresh dependent dashboard caches and profile-backed queries.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rank", userId] }),
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
      queryClient.invalidateQueries({ queryKey: ["weekly-points", userId] }),
    ]);

    // Trigger a direct profile read to surface RLS/data errors early.
    await supabaseQueries.profiles.getById(userId);
  }, [queryClient, userId]);

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
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["submissions", userId],
              }),
              queryClient.invalidateQueries({ queryKey: ["activity", userId] }),
            ]);
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
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["submissions", userId],
              }),
              queryClient.invalidateQueries({ queryKey: ["activity", userId] }),
              queryClient.invalidateQueries({
                queryKey: ["dashboard-missions"],
              }),
            ]);
            await refreshProfile();
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
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["weekly-points", userId],
              }),
              queryClient.invalidateQueries({ queryKey: ["rank", userId] }),
              queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
            ]);
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
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["weekly-points", userId],
              }),
              queryClient.invalidateQueries({ queryKey: ["rank", userId] }),
              queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
            ]);
          },
        );

        // Subscribe to profile changes
        channel = channel.on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          async (payload) => {
            if (unsubscribed) return;
            logTelemetry("info", "realtime_profile_change", "Profile updated");
            await refreshProfile();
          },
        );

        // Subscribe to students table (canonical profile table)
        channel = channel.on(
          "postgres_changes",
          {
            event: "UPDATE",
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
            await refreshProfile();
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
  }, [queryClient, refreshProfile, userId]);

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
    queryKey: ["dashboard-missions"],
    queryFn: async () => {
      const result = await supabaseQueries.missions.getAll();
      if (result.error) {
        logTelemetry(
          "warn",
          "dashboard_missions_query_failed",
          String(result.error),
        );
      }
      return (result.data ?? []).slice(0, 3);
    },
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000, // Cache missions for 5 minutes
  });

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

      // Check if already accepted before attempting to create
      const existing =
        await supabaseQueries.missionSubmissions.getSubmissionForMission(
          userId,
          missionId,
        );
      if (!existing.error && existing.data) {
        logTelemetry(
          "info",
          "dashboard_mission_already_accepted",
          "Mission already in progress",
          { userId, missionId },
        );
        return existing.data;
      }

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

      return created.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions", userId] });
      queryClient.invalidateQueries({ queryKey: ["activity", userId] });
      showToast(
        "Quest accepted. Complete and submit proof for points.",
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
    profile,
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
    isLoading: !profile || missionsQuery.isLoading,
    acceptMission,
    submitProof,
    checkAutoApprove,
    markAllRead,
    refreshProfile,
  };
}
