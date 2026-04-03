import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { GlassCard } from "@/components/ui/glass-card";
import { invalidateStudentCache } from "@/lib/query/invalidate-student-cache";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";

type MissionRecord = Record<string, unknown>;

function missionTitle(mission: MissionRecord) {
  return String(mission.title ?? mission.name ?? "Untitled Mission");
}

function missionDescription(mission: MissionRecord) {
  return String(
    mission.description ?? mission.summary ?? "No description available.",
  );
}

function missionId(mission: MissionRecord) {
  return String(mission.id ?? "");
}

function submissionStatus(submission: MissionRecord) {
  return String(submission.status ?? "unknown").toLowerCase();
}

export default function MissionsScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState("");
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [submissions, setSubmissions] = useState<MissionRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [showConfetti] = useState(false);

  const missionTitleById = useMemo(() => {
    return missions.reduce<Record<string, string>>((acc, mission) => {
      const id = missionId(mission);
      if (id) {
        acc[id] = missionTitle(mission);
      }

      return acc;
    }, {});
  }, [missions]);

  const recentSubmissions = useMemo(() => {
    return [...submissions].sort((a, b) => {
      const aValue = Date.parse(
        String(a.updated_at ?? a.submitted_at ?? a.created_at ?? ""),
      );
      const bValue = Date.parse(
        String(b.updated_at ?? b.submitted_at ?? b.created_at ?? ""),
      );
      return (
        (Number.isNaN(bValue) ? 0 : bValue) -
        (Number.isNaN(aValue) ? 0 : aValue)
      );
    });
  }, [submissions]);

  const loadMissions = useCallback(async () => {
    setErrorMessage("");

    const [missionsResponse, submissionsResponse] = await Promise.all([
      retryQuery(() => supabaseQueries.missions.getAll()),
      user
        ? retryQuery(() =>
            supabaseQueries.missionSubmissions.getUserSubmissions(user.id),
          )
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (missionsResponse.error) {
      setErrorMessage(
        getErrorMessage(missionsResponse.error, "Failed to load missions."),
      );
      setLoading(false);
      return;
    }

    if (submissionsResponse.error) {
      setErrorMessage(
        getErrorMessage(
          submissionsResponse.error,
          "Failed to load submissions.",
        ),
      );
      setLoading(false);
      return;
    }

    setMissions((missionsResponse.data ?? []) as MissionRecord[]);
    setSubmissions((submissionsResponse.data ?? []) as MissionRecord[]);
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void loadMissions();
    }, [loadMissions]),
  );

  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribe = supabaseQueries.realtime.subscribeMissions(
      user.id,
      () => {
        void loadMissions();
      },
    );

    return () => {
      void unsubscribe();
    };
  }, [loadMissions, user]);

  const startMission = async (mission: MissionRecord) => {
    if (!user) {
      return;
    }

    const selectedMissionId = missionId(mission);
    if (!selectedMissionId) {
      Alert.alert("Unable to start mission", "Mission id is missing.");
      return;
    }

    const existingSubmission = submissions.find((entry) => {
      const missionMatch = String(entry.mission_id ?? "") === selectedMissionId;
      const status = String(entry.status ?? "").toLowerCase();
      return missionMatch && status !== "approved";
    });

    if (existingSubmission) {
      router.push({
        pathname: "/mission/[missionId]",
        params: { missionId: selectedMissionId },
      });
      return;
    }

    setSubmittingId(selectedMissionId);

    const startResponse = await retryQuery(() =>
      supabaseQueries.missionSubmissions.create({
        user_id: user.id,
        mission_id: selectedMissionId,
        status: "in_progress",
      }),
    );

    if (startResponse.error || !startResponse.data) {
      Alert.alert(
        "Start failed",
        getErrorMessage(startResponse.error, "Could not start mission."),
      );
      setSubmittingId("");
      return;
    }

    Alert.alert(
      "Mission started",
      "Mission workspace opened. Complete requirements there and submit final proof from detail screen.",
    );
    await invalidateStudentCache(queryClient, user.id);
    void loadMissions();
    router.push({
      pathname: "/mission/[missionId]",
      params: { missionId: selectedMissionId },
    });
    setSubmittingId("");
  };

  return (
    <View style={{ flex: 1 }}>
      {showConfetti ? (
        <Animated.View
          entering={FadeInDown.duration(160)}
          exiting={FadeOutUp.duration(220)}
          style={styles.confettiWrap}
        >
          <ThemedText style={styles.confettiText}>🎉 🎉 🎉</ThemedText>
        </Animated.View>
      ) : null}
      <ScrollView contentContainerStyle={styles.container}>
        <Animated.View entering={FadeInDown.duration(350)}>
          <GlassCard style={styles.headerCard}>
            <ThemedText type="title" style={styles.headerTitle}>
              🎯 Missions
            </ThemedText>
            <ThemedText style={styles.headerSubtitle}>
              Complete missions and submit proof for teacher review
            </ThemedText>
          </GlassCard>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(60).duration(350)}>
          <Pressable
            style={styles.reloadButton}
            onPress={() => void loadMissions()}
          >
            <ThemedText style={styles.reloadButtonLabel}>
              ↻ Reload Missions
            </ThemedText>
          </Pressable>
        </Animated.View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" />
            <ThemedText>Loading missions...</ThemedText>
          </View>
        ) : null}

        {errorMessage ? (
          <GlassCard style={styles.errorCard}>
            <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
          </GlassCard>
        ) : null}

        {!loading && missions.length === 0 ? (
          <GlassCard>
            <ThemedText>No missions found.</ThemedText>
          </GlassCard>
        ) : null}

        {missions.map((mission, missionIndex) => {
          const id = missionId(mission);
          const busyStart = submittingId === id;

          return (
            <Animated.View
              key={id || missionTitle(mission)}
              entering={FadeInDown.delay(105 + missionIndex * 45).duration(350)}
            >
              <GlassCard style={styles.missionCard}>
                <View style={styles.missionHeader}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="subtitle" style={styles.missionTitle}>
                      {missionTitle(mission)}
                    </ThemedText>
                    <ThemedText style={styles.missionDescription}>
                      {missionDescription(mission)}
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.missionActions}>
                  <Pressable
                    style={styles.secondaryAction}
                    onPress={() => {
                      if (!id) {
                        return;
                      }
                      router.push({
                        pathname: "/mission/[missionId]",
                        params: { missionId: id },
                      });
                    }}
                  >
                    <ThemedText style={styles.secondaryActionLabel}>
                      📋 View Details
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    style={styles.primaryAction}
                    onPress={() => void startMission(mission)}
                    disabled={busyStart || !id}
                  >
                    {busyStart ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <ThemedText style={styles.primaryActionLabel}>
                        ▶ Start
                      </ThemedText>
                    )}
                  </Pressable>
                </View>

                <ThemedText style={styles.metaText}>
                  Complete steps → upload proof → submit from detail page
                </ThemedText>
              </GlassCard>
            </Animated.View>
          );
        })}

        <Animated.View entering={FadeInDown.delay(600).duration(360)}>
          <GlassCard style={styles.historyCard}>
            <ThemedText type="subtitle" style={styles.historyTitle}>
              📊 My Submissions
            </ThemedText>
            {recentSubmissions.length === 0 ? (
              <ThemedText style={styles.emptyText}>No submissions yet.</ThemedText>
            ) : (
              <View style={styles.historyList}>
                {recentSubmissions.slice(0, 8).map((entry, index) => {
                  const status = submissionStatus(entry);
                  const missionRef = String(entry.mission_id ?? "N/A");
                  const resolvedMissionTitle =
                    missionTitleById[missionRef] ?? `Mission ${missionRef}`;
                  return (
                    <View
                      key={`${String(entry.id ?? index)}-${index}`}
                      style={styles.historyItem}
                    >
                      <View style={styles.historyItemTop}>
                        <ThemedText style={styles.historyMissionName}>
                          {resolvedMissionTitle}
                        </ThemedText>
                        <View
                          style={[
                            styles.statusChip,
                            status === "approved" ? styles.statusApproved : null,
                            status === "rejected" ? styles.statusRejected : null,
                            status === "pending"
                              ? styles.statusPending
                              : null,
                            status === "in_progress"
                              ? styles.statusInProgress
                              : null,
                          ]}
                        >
                          <ThemedText style={styles.statusChipText}>
                            {status}
                          </ThemedText>
                        </View>
                      </View>
                      <ThemedText style={styles.historyTimestamp}>
                        {String(
                          entry.updated_at ??
                            entry.submitted_at ??
                            entry.created_at ??
                            "N/A",
                        )}
                      </ThemedText>
                    </View>
                  );
                })}
              </View>
            )}
          </GlassCard>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  confettiWrap: {
    position: "absolute",
    top: 22,
    left: 0,
    right: 0,
    zIndex: 4,
    alignItems: "center",
  },
  confettiText: {
    fontSize: 28,
    fontWeight: "900",
  },
  container: {
    padding: 16,
    gap: 12,
  },
  headerCard: {
    gap: 6,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
  },
  headerSubtitle: {
    fontSize: 13,
    opacity: 0.7,
  },
  reloadButton: {
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59, 130, 246, 0.12)",
  },
  reloadButtonLabel: {
    color: "#3b82f6",
    fontWeight: "600",
    fontSize: 13,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 20,
  },
  errorCard: {
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  errorText: {
    color: "#ef4444",
  },
  missionCard: {
    gap: 12,
  },
  missionHeader: {
    gap: 8,
  },
  missionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  missionDescription: {
    fontSize: 13,
    opacity: 0.7,
    marginTop: 4,
  },
  missionActions: {
    flexDirection: "row",
    gap: 10,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59, 130, 246, 0.12)",
  },
  secondaryActionLabel: {
    color: "#3b82f6",
    fontWeight: "600",
    fontSize: 13,
  },
  primaryAction: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#10b981",
  },
  primaryActionLabel: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
  },
  metaText: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 4,
  },
  emptyText: {
    opacity: 0.6,
  },
  historyCard: {
    gap: 12,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  historyList: {
    gap: 8,
  },
  historyItem: {
    borderWidth: 1,
    borderColor: "rgba(156, 163, 175, 0.2)",
    borderRadius: 10,
    padding: 10,
    gap: 6,
    backgroundColor: "rgba(16, 185, 129, 0.02)",
  },
  historyItemTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyMissionName: {
    fontWeight: "600",
    fontSize: 14,
    flex: 1,
  },
  historyTimestamp: {
    fontSize: 12,
    opacity: 0.6,
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(107, 114, 128, 0.2)",
  },
  statusApproved: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
  },
  statusRejected: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
  },
  statusPending: {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
  },
  statusInProgress: {
    backgroundColor: "rgba(245, 158, 11, 0.2)",
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
