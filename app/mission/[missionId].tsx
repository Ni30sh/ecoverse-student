import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { invalidateStudentCache } from "@/lib/query/invalidate-student-cache";
import { supabase } from "@/lib/supabase/client";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";

type GenericRecord = Record<string, unknown>;
type BusyAction = "start" | "submit" | "withdraw" | null;

const formatStatusLabel = (status: string): string => {
  const statusMap: Record<string, string> = {
    "in_progress": "Started (not submitted)",
    "pending": "Submitted for teacher review",
    "approved": "Completed ✓",
    "rejected": "Needs revision",
    "available": "Not started",
  };
  return statusMap[status.toLowerCase()] ?? status;
};

export default function MissionDetailScreen() {
  const { missionId } = useLocalSearchParams<{ missionId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [mission, setMission] = useState<GenericRecord | null>(null);
  const [submission, setSubmission] = useState<GenericRecord | null>(null);
  const [missionSteps, setMissionSteps] = useState<GenericRecord[]>([]);
  const [stepSubmissions, setStepSubmissions] = useState<GenericRecord[]>([]);
  const [proof, setProof] = useState<{ uri: string; mimeType?: string } | null>(
    null,
  );
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");

  const beginBusy = (action: Exclude<BusyAction, null>) => {
    setBusy(true);
    setBusyAction(action);
  };

  const endBusy = () => {
    setBusy(false);
    setBusyAction(null);
  };

  const loadMissionData = useCallback(async () => {
    if (!user || !missionId) {
      setLoading(false);
      return;
    }

    setErrorMessage("");

    const [missionResponse, submissionResponse, stepsResponse] =
      await Promise.all([
        retryQuery(() => supabaseQueries.missions.getById(missionId), {
          operationName: "missionDetail_missions_getById",
          context: { missionId },
        }),
        retryQuery(
          () =>
            supabaseQueries.missionSubmissions.getSubmissionForMission(
              user.id,
              missionId,
            ),
          {
            operationName: "missionDetail_missionSubmissions_getSubmissionForMission",
            context: { missionId, userId: user.id },
          },
        ),
        retryQuery(
          () => supabaseQueries.missionSteps.getByMissionId(missionId),
          {
            operationName: "missionDetail_missionSteps_getByMissionId",
            context: { missionId, userId: user.id },
          },
        ),
      ]);

    if (missionResponse.error) {
      setErrorMessage(
        getErrorMessage(
          missionResponse.error,
          "Failed to load mission detail.",
        ),
      );
      setLoading(false);
      return;
    }

    if (submissionResponse.error) {
      setErrorMessage(
        getErrorMessage(
          submissionResponse.error,
          "Failed to load mission submissions.",
        ),
      );
      setLoading(false);
      return;
    }

    if (stepsResponse.error) {
      setErrorMessage(
        getErrorMessage(
          stepsResponse.error,
          "Failed to load mission requirements.",
        ),
      );
      setLoading(false);
      return;
    }

    const activeSubmission =
      (submissionResponse.data as GenericRecord | null) ?? null;

    if (__DEV__) {
      console.log("[mission-detail] server submission refresh", {
        missionId,
        userId: user.id,
        submissionId: String(activeSubmission?.id ?? ""),
        status: String(activeSubmission?.status ?? "available"),
      });
    }

    let loadedStepSubmissions: GenericRecord[] = [];
    const activeSubmissionId = String(activeSubmission?.id ?? "").trim();
    if (activeSubmissionId) {
      const stepSubmissionResponse = await retryQuery(
        () =>
          supabaseQueries.missionStepSubmissions.getBySubmissionId(
            activeSubmissionId,
          ),
        {
          operationName:
            "missionDetail_missionStepSubmissions_getBySubmissionId",
          context: {
            missionId,
            submissionId: activeSubmissionId,
            userId: user.id,
          },
        },
      );

      if (stepSubmissionResponse.error) {
        setErrorMessage(
          getErrorMessage(
            stepSubmissionResponse.error,
            "Failed to load mission step progress.",
          ),
        );
        setLoading(false);
        return;
      }

      loadedStepSubmissions = (stepSubmissionResponse.data ??
        []) as GenericRecord[];
    }

    setMission((missionResponse.data ?? null) as GenericRecord | null);
    
    // VALIDATION: Check if submission is marked as pending/approved but missing proof/location
    if (activeSubmission) {
      const submissionStatus = String(activeSubmission.status ?? "").toLowerCase();
      const photoUrl = String(activeSubmission.photo_url ?? "").trim();
      const latitude = activeSubmission.latitude;
      const longitude = activeSubmission.longitude;
      
      if ((submissionStatus === "pending" || submissionStatus === "approved") && 
          (!photoUrl || latitude === null || latitude === undefined || longitude === null || longitude === undefined)) {
        console.warn("[mission-detail] WARNING: Submission marked as submitted but missing proof/location", {
          submissionId: activeSubmission.id,
          status: submissionStatus,
          hasPhoto: Boolean(photoUrl),
          hasLocation: latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined,
        });
        
        setErrorMessage(
          "⚠️ Submission data incomplete: Photo proof or location is missing. " +
          "Please re-submit with complete information."
        );
      }
    }
    
    setSubmission(activeSubmission);
    setMissionSteps((stepsResponse.data ?? []) as GenericRecord[]);
    setStepSubmissions(loadedStepSubmissions);
    setLoading(false);
  }, [missionId, user]);

  useEffect(() => {
    setLoading(true);
    void loadMissionData();
  }, [loadMissionData]);

  useFocusEffect(
    useCallback(() => {
      if (!user || !missionId) {
        return;
      }

      if (__DEV__) {
        console.log("[mission-detail] focus refresh requested", {
          missionId,
          userId: user.id,
          activeSubmissionId: String(submission?.id ?? ""),
        });
      }

      setLoading(true);
      void loadMissionData();
    }, [loadMissionData, missionId, submission?.id, user]),
  );

  useEffect(() => {
    if (!user || !missionId) {
      return;
    }

    const channel = supabase.channel(`mission-detail-live-${user.id}-${missionId}`);

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mission_submissions",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          if (__DEV__) {
            console.log("[mission-detail] realtime mission_submissions change", {
              missionId,
              userId: user.id,
            });
          }
          void loadMissionData();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submissions",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          if (__DEV__) {
            console.log("[mission-detail] realtime submissions change", {
              missionId,
              userId: user.id,
            });
          }
          void loadMissionData();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMissionData, missionId, user]);

  const startMission = async () => {
    if (!user || !missionId) {
      return;
    }

    beginBusy("start");
    const response = await retryQuery(
      () =>
        supabaseQueries.missionSubmissions.create({
          user_id: user.id,
          mission_id: missionId,
          status: "in_progress",
        }),
      {
        operationName: "missionDetail_startMission",
        context: { missionId, userId: user.id },
      },
    );

    if (response.error || !response.data) {
      Alert.alert(
        "Start failed",
        getErrorMessage(response.error, "Could not start mission."),
      );
      endBusy();
      return;
    }

    if (__DEV__) {
      console.log("[mission-ui] startMission server row:", {
        id: (response.data as GenericRecord).id,
        status: (response.data as GenericRecord).status,
        submitted_at: (response.data as GenericRecord).submitted_at,
      });
    }

    setSubmission(response.data as GenericRecord);
    await invalidateStudentCache(queryClient, user.id);
    endBusy();
  };

  const attachProof = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access to upload proof.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    setProof({ uri: asset.uri, mimeType: asset.mimeType });
  };

  const captureLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permission needed",
        "Allow location access for mission proof.",
      );
      return;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    setLocation({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    });
  };

  const submitProof = async () => {
    if (!user) {
      return;
    }

    const submissionId = String(submission?.id ?? "");
    if (!submissionId) {
      Alert.alert("Not started", "Start the mission first.");
      return;
    }

    if (!proof?.uri) {
      Alert.alert("Proof required", "Attach a proof photo first.");
      return;
    }

    if (!location) {
      Alert.alert(
        "Location required",
        "Capture current location before final submission.",
      );
      return;
    }

    if (missionSteps.length > 0) {
      const completedStatuses = new Set([
        "completed",
        "submitted",
        "verified",
        "approved",
      ]);
      const completedStepIds = new Set(
        stepSubmissions
          .filter((row) =>
            completedStatuses.has(String(row.status ?? "").toLowerCase()),
          )
          .map((row) => String(row.mission_step_id ?? row.step_id ?? "").trim())
          .filter((value) => value.length > 0),
      );

      const missingSteps = missionSteps.filter((step) => {
        const stepId = String(step.id ?? "").trim();
        return stepId.length > 0 && !completedStepIds.has(stepId);
      });

      if (missingSteps.length > 0) {
        Alert.alert(
          "Requirements pending",
          "Complete all mission steps before final submission.",
        );
        return;
      }
    }

    beginBusy("submit");

    const uploadResponse = await retryQuery(
      () =>
        supabaseQueries.storage.uploadMissionProof({
          userId: user.id,
          missionId: String(missionId),
          localUri: proof.uri,
          mimeType: proof.mimeType,
        }),
      {
        operationName: "missionDetail_uploadMissionProof",
        context: { missionId: String(missionId), userId: user.id },
      },
    );

    if (uploadResponse.error || !uploadResponse.data) {
      Alert.alert(
        "Upload failed",
        getErrorMessage(uploadResponse.error, "Could not upload proof image."),
      );
      endBusy();
      return;
    }

    const uploadedProof = uploadResponse.data;

    const submitResponse = await retryQuery(
      () =>
        supabaseQueries.missionSubmissions.submitProof(
          submissionId,
          uploadedProof.publicUrl,
          "Submitted from mission detail screen.",
          { lat: location?.lat ?? 0, lng: location?.lng ?? 0 },
        ),
      {
        operationName: "missionDetail_submitProof",
        context: {
          missionId: String(missionId),
          submissionId,
          userId: user.id,
        },
      },
    );

    if (submitResponse.error) {
      console.error(
        "[missionDetail] submitProof error:",
        submitResponse.error,
      );
      Alert.alert(
        "Submission failed",
        getErrorMessage(submitResponse.error, "Could not submit proof."),
      );
      endBusy();
      return;
    }

    if (!submitResponse.data) {
      console.error(
        "[missionDetail] submitProof returned no data",
      );
      Alert.alert(
        "Submission failed",
        "No data returned from submission update.",
      );
      endBusy();
      return;
    }


    if (__DEV__) {
      console.log("[mission-ui] submitProof server row:", {
        requestedSubmissionId: submissionId,
        returnedId: (submitResponse.data as GenericRecord).id,
        returnedStatus: (submitResponse.data as GenericRecord).status,
        returnedSubmittedAt: (submitResponse.data as GenericRecord).submitted_at,
        idsMatch:
          String((submitResponse.data as GenericRecord).id ?? "") ===
          submissionId,
      });
    }
    const oldStatus = String(
      submission?.status ?? "in_progress",
    ).toLowerCase();
    const newStatus = String(
      submitResponse.data?.status ?? "pending",
    ).toLowerCase();
    const submittedAt = submitResponse.data?.submitted_at;

    console.log(
      `[missionDetail] submitProof successful: status ${oldStatus} → ${newStatus}, submitted_at=${submittedAt}`,
      {
        submissionId,
        oldStatus,
        newStatus,
        submittedAt,
        idempotent: submitResponse.data?.idempotent,
      },
    );

    // Verify status actually changed
    if (
      oldStatus === "in_progress" &&
      newStatus !== "pending" &&
      newStatus !== "approved"
    ) {
      console.warn(
        `[missionDetail] WARNING: Status should be pending or approved but got ${newStatus}`,
        {
          submissionId,
          newStatus,
        },
      );
    }

    // Verify submitted_at was set
    if (!submittedAt) {
      console.warn(
        `[missionDetail] WARNING: submitted_at not set in response`,
        { submissionId },
      );
    }

    if (newStatus === "approved") {
      Alert.alert(
        "Approved",
        "Mission auto-approved. Points and streak updated.",
      );
    } else {
      Alert.alert(
        "Submitted",
        `Mission proof submitted and pending review.${oldStatus !== "in_progress" ? " (Note: you had already started this mission.)" : ""}`,
      );
    }

    // CRITICAL: Update local submission state immediately so UI reflects status change instantly
    // This prevents students from seeing stale "in_progress" status during server refresh
    console.log(
      "[missionDetail] Immediately updating local submission state to reflect server response",
      { oldStatus, newStatus, submittedAt },
    );
    setSubmission((prevSubmission) => ({
      ...(prevSubmission ?? {}),
      ...submitResponse.data,
      status: newStatus,
      submitted_at: submittedAt,
      updated_at: new Date().toISOString(),
    }));

    // Then refresh from server in the background to confirm and sync any other changes
    console.log(
      "[missionDetail] Starting async data refresh from server",
      { submissionId, newStatus },
    );
    await invalidateStudentCache(queryClient, user.id);
    await loadMissionData();

    // Confirm UI state updated before clearing busy
    console.log(
      "[missionDetail] Proof submission flow complete - status: in_progress → pending, UI confirmed refreshed",
      { submissionId, finalStatus: newStatus },
    );
    endBusy();
  };

  const withdrawSubmission = async () => {
    if (!user) {
      return;
    }

    const submissionId = String(submission?.id ?? "").trim();
    if (!submissionId) {
      Alert.alert("No submission", "Start the mission first.");
      return;
    }

    const currentStatus = String(submission?.status ?? "").toLowerCase();
    if (currentStatus !== "pending" && currentStatus !== "in_progress") {
      Alert.alert(
        "Cannot withdraw",
        "Only in-progress or pending submissions can be withdrawn.",
      );
      return;
    }

    Alert.alert(
      "Withdraw submission",
      "This will move mission back to in-progress and remove submitted proof. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () => {
            void (async () => {
              beginBusy("withdraw");

              const response = await retryQuery(
                () =>
                  supabaseQueries.missionSubmissions.withdrawSubmission(
                    submissionId,
                    {
                      clearProof: true,
                    },
                  ),
                {
                  operationName: "missionDetail_withdrawSubmission",
                  context: {
                    missionId: String(missionId),
                    submissionId,
                    userId: user.id,
                  },
                },
              );

              if (response.error || !response.data) {
                Alert.alert(
                  "Withdraw failed",
                  getErrorMessage(
                    response.error,
                    "Could not withdraw submission.",
                  ),
                );
                endBusy();
                return;
              }

              setSubmission((response.data ?? null) as GenericRecord | null);
              setProof(null);
              setLocation(null);

              await invalidateStudentCache(queryClient, user.id);
              await loadMissionData();

              Alert.alert(
                "Withdrawn",
                "Submission reverted to in-progress. You can submit again.",
              );
              endBusy();
            })();
          },
        },
      ],
    );
  };

  const missionStatus = String(submission?.status ?? "available").toLowerCase();
  const missionStarted = missionStatus !== "available";
  const proofReady = Boolean(proof?.uri);
  const locationReady = Boolean(location);
  const readyForSubmission =
    missionStarted &&
    proofReady &&
    locationReady &&
    (missionStatus === "in_progress" || missionStatus === "rejected");
  const canSubmitProof =
    readyForSubmission && !busy;
  const isPendingReview = missionStatus === "pending";
  const isApproved = missionStatus === "approved";



  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Animated.View entering={FadeInDown.duration(320)}>
        <LinearGradient colors={["#0f766e", "#14b8a6"]} style={styles.heroCard}>
          <ThemedText style={styles.heroTitle}>Mission Run</ThemedText>
          <ThemedText style={styles.heroSubtitle}>
            {String(mission?.title ?? mission?.name ?? "Mission")}
          </ThemedText>
          <View style={styles.statusPill}>
            <ThemedText style={styles.statusPillText}>
              {formatStatusLabel(missionStatus)}
            </ThemedText>
          </View>
        </LinearGradient>
      </Animated.View>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading mission detail...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <ThemedView style={styles.errorCard}>
          <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        </ThemedView>
      ) : null}

      {mission ? (
        <ThemedView style={styles.card}>
          <ThemedText style={styles.descriptionText}>
            {String(
              mission.description ?? mission.summary ?? "No mission description.",
            )}
          </ThemedText>
          {missionStatus === "rejected" &&
          String(submission?.feedback ?? "").trim() ? (
            <ThemedText style={styles.errorText}>
              Teacher feedback: {String(submission?.feedback ?? "")}
            </ThemedText>
          ) : null}
        </ThemedView>
      ) : null}

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Mission Checklist</ThemedText>
        <ThemedText style={styles.checkRow}>
          {missionStarted ? "✅" : "⬜"} Start mission
        </ThemedText>
        <ThemedText style={styles.checkRow}>
          {proofReady ? "✅" : "⬜"} Capture photo proof
        </ThemedText>
        <ThemedText style={styles.checkRow}>
          {locationReady ? "✅" : "⬜"} Capture current location
        </ThemedText>
        <ThemedText style={styles.checkRow}>
          {isPendingReview ? "✅" : "⬜"} Submit for review
        </ThemedText>
        {isApproved ? (
          <ThemedText style={styles.approvedText}>
            🎉 Mission approved and points credited.
          </ThemedText>
        ) : null}
      </ThemedView>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void loadMissionData()}
        disabled={busy}
      >
        <ThemedText style={styles.secondaryButtonLabel}>Refresh Mission</ThemedText>
      </Pressable>

      {!missionStarted ? (
        <Pressable
          style={styles.primaryButton}
          onPress={() => void startMission()}
          disabled={busy}
        >
          {busyAction === "start" ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText style={styles.primaryButtonLabel}>Start Mission</ThemedText>
          )}
        </Pressable>
      ) : null}

      <Pressable
        style={[styles.secondaryButton, !missionStarted ? styles.disabledButton : null]}
        onPress={() => void attachProof()}
        disabled={busy || !missionStarted}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          {proof ? "Photo Proof Captured ✅" : "Capture Photo Proof"}
        </ThemedText>
      </Pressable>

      <Pressable
        style={[styles.secondaryButton, !missionStarted ? styles.disabledButton : null]}
        onPress={() => void captureLocation()}
        disabled={busy || !missionStarted}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          {location ? "Current Location Captured ✅" : "Capture Current Location"}
        </ThemedText>
      </Pressable>

      <Pressable
        style={[styles.primaryButton, canSubmitProof ? styles.highlightButton : styles.disabledButton]}
        onPress={() => void submitProof()}
        disabled={!canSubmitProof}
      >
        {busyAction === "submit" ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <ThemedText style={styles.primaryButtonLabel}>Submit Mission</ThemedText>
        )}
      </Pressable>

      {isPendingReview ? (
        <ThemedView style={styles.reviewCard}>
          <ThemedText style={styles.reviewTitle}>Under Review</ThemedText>
          <ThemedText style={styles.reviewText}>
            Your mission has been submitted to teacher review.
          </ThemedText>
        </ThemedView>
      ) : null}

      {submission ? (
        <Pressable
          style={styles.dangerButton}
          onPress={() => void withdrawSubmission()}
          disabled={busy}
        >
          {busyAction === "withdraw" ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText style={styles.dangerButtonLabel}>Withdraw Submission</ThemedText>
          )}
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  heroCard: {
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  heroTitle: {
    color: "#ccfbf1",
    fontWeight: "700",
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroSubtitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
  },
  statusPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12,
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
  descriptionText: {
    lineHeight: 20,
    opacity: 0.9,
  },
  checkRow: {
    fontWeight: "600",
    fontSize: 14,
  },
  approvedText: {
    marginTop: 6,
    color: "#16a34a",
    fontWeight: "700",
  },
  primaryButton: {
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
  highlightButton: {
    backgroundColor: "#16a34a",
  },
  disabledButton: {
    opacity: 0.45,
  },
  reviewCard: {
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    gap: 4,
  },
  reviewTitle: {
    color: "#b45309",
    fontWeight: "800",
  },
  reviewText: {
    color: "#92400e",
    fontWeight: "500",
  },
  errorCard: {
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.35)",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(239, 68, 68, 0.06)",
  },
  dangerButton: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#b00020",
  },
  dangerButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
  },
  errorText: {
    color: "#b00020",
  },
});
