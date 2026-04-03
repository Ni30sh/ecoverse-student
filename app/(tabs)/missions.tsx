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
import { ThemedView } from "@/components/themed-view";
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
        <ThemedText type="title">Missions</ThemedText>
        <ThemedText>
          Start missions and submit proof for teacher review.
        </ThemedText>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => void loadMissions()}
        >
          <ThemedText style={styles.secondaryButtonLabel}>
            Reload Missions
          </ThemedText>
        </Pressable>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" />
            <ThemedText>Loading missions...</ThemedText>
          </View>
        ) : null}

        {errorMessage ? (
          <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        ) : null}

        {!loading && missions.length === 0 ? (
          <ThemedText>No missions found.</ThemedText>
        ) : null}

        {missions.map((mission) => {
          const id = missionId(mission);
          const busyStart = submittingId === id;

          return (
            <ThemedView key={id || missionTitle(mission)} style={styles.card}>
              <ThemedText type="subtitle">{missionTitle(mission)}</ThemedText>
              <ThemedText>{missionDescription(mission)}</ThemedText>

              <Pressable
                style={({ pressed }) => [
                  styles.secondarySubmitButton,
                  pressed ? styles.pressed : null,
                ]}
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
                <ThemedText style={styles.secondaryButtonLabel}>
                  Open Mission Detail
                </ThemedText>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed ? styles.pressed : null,
                ]}
                onPress={() => void startMission(mission)}
                disabled={busyStart || !id}
              >
                {busyStart ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.primaryButtonLabel}>
                    Start Mission
                  </ThemedText>
                )}
              </Pressable>

              <ThemedText style={styles.metaText}>
                Complete steps, upload proof, and final submission from Mission
                Detail.
              </ThemedText>
            </ThemedView>
          );
        })}

        <ThemedView style={styles.historyCard}>
          <ThemedText type="subtitle">My Submissions</ThemedText>
          {recentSubmissions.length === 0 ? (
            <ThemedText>No submissions yet.</ThemedText>
          ) : null}
          {recentSubmissions.slice(0, 8).map((entry, index) => {
            const status = submissionStatus(entry);
            const missionRef = String(entry.mission_id ?? "N/A");
            const resolvedMissionTitle =
              missionTitleById[missionRef] ?? `Mission ${missionRef}`;
            return (
              <ThemedView
                key={`${String(entry.id ?? index)}-${index}`}
                style={styles.historyItem}
              >
                <ThemedText>Mission: {resolvedMissionTitle}</ThemedText>
                <View style={styles.statusRow}>
                  <ThemedText>Status:</ThemedText>
                  <View
                    style={[
                      styles.statusChip,
                      status === "approved" ? styles.statusApproved : null,
                      status === "rejected" ? styles.statusRejected : null,
                      status === "submitted" ? styles.statusSubmitted : null,
                      status === "in_progress" ? styles.statusInProgress : null,
                    ]}
                  >
                    <ThemedText style={styles.statusChipText}>
                      {status}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText>
                  Updated:{" "}
                  {String(
                    entry.updated_at ??
                      entry.submitted_at ??
                      entry.created_at ??
                      "N/A",
                  )}
                </ThemedText>
              </ThemedView>
            );
          })}
        </ThemedView>
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
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 20,
  },
  card: {
    borderWidth: 1,
    borderColor: "rgba(10,126,164,0.22)",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  primaryButton: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a7ea4",
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,126,164,0.12)",
  },
  secondaryButtonLabel: {
    color: "#0a7ea4",
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.86,
  },
  metaText: {
    fontSize: 12,
    opacity: 0.8,
  },
  secondarySubmitButton: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#136f8f",
  },
  historyCard: {
    borderWidth: 1,
    borderColor: "rgba(10,126,164,0.2)",
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  historyItem: {
    borderWidth: 1,
    borderColor: "rgba(10,126,164,0.14)",
    borderRadius: 10,
    padding: 8,
    gap: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(110,110,110,0.16)",
  },
  statusApproved: {
    backgroundColor: "rgba(46,125,50,0.22)",
  },
  statusRejected: {
    backgroundColor: "rgba(176,0,32,0.22)",
  },
  statusSubmitted: {
    backgroundColor: "rgba(19,111,143,0.22)",
  },
  statusInProgress: {
    backgroundColor: "rgba(245,124,0,0.22)",
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  errorText: {
    color: "#b00020",
  },
});
