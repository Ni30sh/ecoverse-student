import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
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
import { useToast } from "@/components/ui/toast-provider";
import { invalidateStudentCache } from "@/lib/query/invalidate-student-cache";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";

type MissionRecord = Record<string, unknown>;
type StepRecord = Record<string, unknown>;
type ProofAsset = { uri: string; mimeType?: string };
type ProofLocation = { lat: number; lng: number };

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
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState("");
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [submissions, setSubmissions] = useState<MissionRecord[]>([]);
  const [stepsByMission, setStepsByMission] = useState<
    Record<string, StepRecord[]>
  >({});
  const [submissionIdByMission, setSubmissionIdByMission] = useState<
    Record<string, string>
  >({});
  const [stepProgressByMission, setStepProgressByMission] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [proofByMission, setProofByMission] = useState<
    Record<string, ProofAsset>
  >({});
  const [locationByMission, setLocationByMission] = useState<
    Record<string, ProofLocation>
  >({});
  const [errorMessage, setErrorMessage] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);

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
      return (
        missionMatch && (status === "in_progress" || status === "submitted")
      );
    });

    if (existingSubmission) {
      const existingSubmissionId = String(existingSubmission.id ?? "");
      if (existingSubmissionId) {
        setSubmissionIdByMission((prev) => ({
          ...prev,
          [selectedMissionId]: existingSubmissionId,
        }));

        const existingSteps = await retryQuery(() =>
          supabaseQueries.missionSteps.getByMissionId(selectedMissionId),
        );
        if (!existingSteps.error) {
          setStepsByMission((prev) => ({
            ...prev,
            [selectedMissionId]: (existingSteps.data ?? []) as StepRecord[],
          }));
        }

        Alert.alert(
          "Already active",
          "You already have an active submission for this mission.",
        );
        return;
      }
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

    const submissionId = String(startResponse.data.id ?? "");
    if (!submissionId) {
      Alert.alert("Started", "Mission started, but submission id is missing.");
      setSubmittingId("");
      return;
    }

    setSubmissionIdByMission((prev) => ({
      ...prev,
      [selectedMissionId]: submissionId,
    }));

    const stepResponse = await retryQuery(() =>
      supabaseQueries.missionSteps.getByMissionId(selectedMissionId),
    );
    if (stepResponse.error) {
      Alert.alert(
        "Mission started",
        `Failed to load steps: ${getErrorMessage(stepResponse.error, "Unknown error")}`,
      );
    } else {
      setStepsByMission((prev) => ({
        ...prev,
        [selectedMissionId]: (stepResponse.data ?? []) as StepRecord[],
      }));
    }

    Alert.alert("Mission started", "Now submit mission steps and final proof.");
    await invalidateStudentCache(queryClient, user.id);
    setSubmittingId("");
  };

  const submitStep = async (mission: MissionRecord, step: StepRecord) => {
    if (!user) {
      return;
    }

    const selectedMissionId = missionId(mission);
    const selectedStepId = String(step.id ?? "");
    const submissionId = submissionIdByMission[selectedMissionId];

    if (!selectedMissionId || !selectedStepId) {
      Alert.alert("Cannot submit step", "Mission or step id is missing.");
      return;
    }

    if (!submissionId) {
      Alert.alert("Cannot submit step", "Start this mission first.");
      return;
    }

    setSubmittingId(`${selectedMissionId}:${selectedStepId}`);

    const response = await retryQuery(() =>
      supabaseQueries.missionStepSubmissions.submitStep({
        user_id: user.id,
        mission_step_id: selectedStepId,
        submission_id: submissionId,
        status: "completed",
        notes: "Completed from student app.",
      }),
    );

    if (response.error) {
      Alert.alert(
        "Step submission failed",
        getErrorMessage(response.error, "Could not submit this step."),
      );
      setSubmittingId("");
      return;
    }

    setStepProgressByMission((prev) => ({
      ...prev,
      [selectedMissionId]: {
        ...(prev[selectedMissionId] ?? {}),
        [selectedStepId]: true,
      },
    }));

    await invalidateStudentCache(queryClient, user.id);
    setSubmittingId("");
  };

  const submitMissionProof = async (mission: MissionRecord) => {
    if (!user) {
      return;
    }

    const selectedMissionId = missionId(mission);
    const submissionId = submissionIdByMission[selectedMissionId];

    if (!submissionId) {
      Alert.alert("Cannot submit proof", "Start this mission first.");
      return;
    }

    const missionProof = proofByMission[selectedMissionId];
    if (!missionProof?.uri) {
      Alert.alert(
        "Proof required",
        "Please upload a mission photo before final submit.",
      );
      return;
    }

    const missionSteps = stepsByMission[selectedMissionId] ?? [];
    if (missionSteps.length > 0) {
      const progressMap = stepProgressByMission[selectedMissionId] ?? {};
      const incomplete = missionSteps.some((step, index) => {
        const stepId = String(step.id ?? index);
        return !Boolean(progressMap[stepId]);
      });

      if (incomplete) {
        Alert.alert(
          "Steps pending",
          "Please complete all mission steps before final proof submission.",
        );
        return;
      }
    }

    setSubmittingId(`${selectedMissionId}:proof`);

    const uploadResponse = await retryQuery(() =>
      supabaseQueries.storage.uploadMissionProof({
        userId: user.id,
        missionId: selectedMissionId,
        localUri: missionProof.uri,
        mimeType: missionProof.mimeType,
      }),
    );

    if (uploadResponse.error || !uploadResponse.data) {
      Alert.alert(
        "Upload failed",
        getErrorMessage(
          uploadResponse.error,
          "Failed to upload mission proof image.",
        ),
      );
      setSubmittingId("");
      return;
    }

    const uploadedProof = uploadResponse.data;

    const selectedLocation = locationByMission[selectedMissionId] ?? {
      lat: 0,
      lng: 0,
    };

    const proofResponse = await retryQuery(() =>
      supabaseQueries.missionSubmissions.submitProof(
        submissionId,
        uploadedProof.publicUrl,
        "Submitted from student mobile app.",
        { lat: selectedLocation.lat, lng: selectedLocation.lng },
      ),
    );

    if (proofResponse.error) {
      Alert.alert(
        "Proof not submitted",
        getErrorMessage(proofResponse.error, "Could not submit proof."),
      );
      setSubmittingId("");
      return;
    }

    const finalStatus = String(
      proofResponse.data?.status ?? "pending",
    ).toLowerCase();
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 1200);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    if (finalStatus === "approved") {
      Alert.alert(
        "Mission approved",
        "Great work. Points and streak were updated.",
      );
      showToast("Mission approved. Amazing work.", "success");
    } else {
      Alert.alert(
        "Mission submitted",
        "Your mission is pending teacher review.",
      );
      showToast("Mission submitted for review.", "info");
    }

    await invalidateStudentCache(queryClient, user.id);
    void loadMissions();

    setSubmittingId("");
  };

  const pickProofPhoto = async (mission: MissionRecord) => {
    const selectedMissionId = missionId(mission);
    if (!selectedMissionId) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access to upload mission proof.",
      );
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });

    if (pickerResult.canceled || pickerResult.assets.length === 0) {
      return;
    }

    const asset = pickerResult.assets[0];

    setProofByMission((prev) => ({
      ...prev,
      [selectedMissionId]: {
        uri: asset.uri,
        mimeType: asset.mimeType,
      },
    }));

    Alert.alert("Proof selected", "Photo attached to this mission.");
  };

  const captureProofPhoto = async (mission: MissionRecord) => {
    const selectedMissionId = missionId(mission);
    if (!selectedMissionId) {
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Allow camera access to capture mission proof.",
      );
      return;
    }

    const cameraResult = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });

    if (cameraResult.canceled || cameraResult.assets.length === 0) {
      return;
    }

    const asset = cameraResult.assets[0];

    setProofByMission((prev) => ({
      ...prev,
      [selectedMissionId]: {
        uri: asset.uri,
        mimeType: asset.mimeType,
      },
    }));

    Alert.alert("Photo captured", "Camera photo attached to this mission.");
  };

  const captureLocation = async (mission: MissionRecord) => {
    const selectedMissionId = missionId(mission);
    if (!selectedMissionId) {
      return;
    }

    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Allow location access for mission proof submission.",
      );
      return;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    setLocationByMission((prev) => ({
      ...prev,
      [selectedMissionId]: {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      },
    }));

    Alert.alert(
      "Location captured",
      "Current location added to this mission proof.",
    );
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
          const busyProof = submittingId === `${id}:proof`;
          const missionSteps = stepsByMission[id] ?? [];
          const stepProgress = stepProgressByMission[id] ?? {};
          const hasPhoto = Boolean(proofByMission[id]?.uri);
          const hasLocation = Boolean(locationByMission[id]);
          const location = locationByMission[id];

          return (
            <ThemedView key={id || missionTitle(mission)} style={styles.card}>
              <ThemedText type="subtitle">{missionTitle(mission)}</ThemedText>
              <ThemedText>{missionDescription(mission)}</ThemedText>

              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
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

              {missionSteps.length > 0 ? (
                <ThemedView style={styles.stepsBox}>
                  <ThemedText type="defaultSemiBold">Mission Steps</ThemedText>
                  {missionSteps.map((step, index) => {
                    const stepId = String(step.id ?? index);
                    const stepBusy = submittingId === `${id}:${stepId}`;
                    const completed = Boolean(stepProgress[stepId]);

                    return (
                      <ThemedView
                        key={`${stepId}-${index}`}
                        style={styles.stepCard}
                      >
                        <ThemedText>
                          {index + 1}.{" "}
                          {String(step.title ?? step.name ?? "Step")}
                        </ThemedText>
                        <Pressable
                          style={({ pressed }) => [
                            styles.smallButton,
                            completed ? styles.successButton : null,
                            pressed ? styles.pressed : null,
                          ]}
                          onPress={() => void submitStep(mission, step)}
                          disabled={stepBusy || completed}
                        >
                          {stepBusy ? (
                            <ActivityIndicator color="#ffffff" />
                          ) : (
                            <ThemedText style={styles.smallButtonLabel}>
                              {completed ? "Completed" : "Submit Step"}
                            </ThemedText>
                          )}
                        </Pressable>
                      </ThemedView>
                    );
                  })}
                </ThemedView>
              ) : null}

              <ThemedView style={styles.assetRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.smallActionButton,
                    pressed ? styles.pressed : null,
                  ]}
                  onPress={() => void pickProofPhoto(mission)}
                >
                  <ThemedText style={styles.smallButtonLabel}>
                    {hasPhoto ? "Gallery Updated" : "Upload Photo"}
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.smallActionButton,
                    pressed ? styles.pressed : null,
                  ]}
                  onPress={() => void captureProofPhoto(mission)}
                >
                  <ThemedText style={styles.smallButtonLabel}>
                    Use Camera
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.smallActionButton,
                    pressed ? styles.pressed : null,
                  ]}
                  onPress={() => void captureLocation(mission)}
                >
                  <ThemedText style={styles.smallButtonLabel}>
                    {hasLocation ? "Location Updated" : "Add Location"}
                  </ThemedText>
                </Pressable>
              </ThemedView>

              {hasPhoto ? (
                <ThemedView style={styles.previewBox}>
                  <Image
                    source={{ uri: proofByMission[id].uri }}
                    style={styles.previewImage}
                    contentFit="cover"
                  />
                  <ThemedText style={styles.metaText}>
                    Photo ready for upload.
                  </ThemedText>
                </ThemedView>
              ) : null}

              {hasLocation && location ? (
                <ThemedText style={styles.metaText}>
                  Location: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                </ThemedText>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.secondarySubmitButton,
                  pressed ? styles.pressed : null,
                ]}
                onPress={() => void submitMissionProof(mission)}
                disabled={busyProof || !id}
              >
                {busyProof ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.primaryButtonLabel}>
                    Submit Final Proof
                  </ThemedText>
                )}
              </Pressable>
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
  stepsBox: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "rgba(10,126,164,0.18)",
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  stepCard: {
    borderWidth: 1,
    borderColor: "rgba(10,126,164,0.14)",
    borderRadius: 8,
    padding: 8,
    gap: 8,
  },
  smallButton: {
    minHeight: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a7ea4",
  },
  assetRow: {
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  smallActionButton: {
    minWidth: 104,
    paddingHorizontal: 8,
    minHeight: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,126,164,0.22)",
  },
  previewBox: {
    marginTop: 8,
    gap: 6,
  },
  previewImage: {
    width: "100%",
    height: 150,
    borderRadius: 10,
  },
  metaText: {
    fontSize: 12,
    opacity: 0.8,
  },
  smallButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12,
  },
  secondarySubmitButton: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#136f8f",
  },
  successButton: {
    backgroundColor: "#2e7d32",
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
