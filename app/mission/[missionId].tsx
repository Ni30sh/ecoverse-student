import { useQueryClient } from "@tanstack/react-query";
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
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { invalidateStudentCache } from "@/lib/query/invalidate-student-cache";
import { getSupabaseProjectDiagnostics } from "@/lib/supabase/client";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { debugMobileSupabaseTarget } from "@/mobile-debug/SupabaseProjectCheckSnippet";
import { useAuth } from "@/providers/auth-provider";

type GenericRecord = Record<string, unknown>;

export default function MissionDetailScreen() {
  const { missionId } = useLocalSearchParams<{ missionId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

  // Removed in_progress logic: always allow actions
  // (Buttons will be enabled as before)

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
          () => supabaseQueries.missionSubmissions.getUserSubmissions(user.id),
          {
            operationName:
              "missionDetail_missionSubmissions_getUserSubmissions",
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

    const allSubmissions = (submissionResponse.data ?? []) as GenericRecord[];
    const activeSubmission =
      allSubmissions.find(
        (item) => String(item.mission_id ?? "") === missionId,
      ) ?? null;

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
    setSubmission(activeSubmission);
    setMissionSteps((stepsResponse.data ?? []) as GenericRecord[]);
    setStepSubmissions(loadedStepSubmissions);
    setLoading(false);
  }, [missionId, user]);

  useEffect(() => {
    setLoading(true);
    void loadMissionData();
  }, [loadMissionData]);

  const startMission = async () => {
    if (!user || !missionId) {
      return;
    }

    setBusy(true);
    try {
      // Fetch school_id from student profile
      const profileResult = await supabaseQueries.profiles.getById(user.id);
      const school_id = profileResult.data?.school_id || "";

      const diagnostics = getSupabaseProjectDiagnostics();
      const payload = {
        user_id: user.id,
        mission_id: missionId,
        status: "in_progress" as const,
        school_id,
      };

      console.log("[mission-detail] startMission before create", {
        payload,
        authUserId: user.id,
        projectRef: diagnostics.urlRef,
        expectedRef: diagnostics.expectedRef,
        projectMatches: diagnostics.matchesExpected,
      });

      const response = await retryQuery(
        () => supabaseQueries.missionSubmissions.create(payload),
        {
          operationName: "missionDetail_startMission",
          context: { missionId, userId: user.id },
        },
      );

      console.log("[mission-detail] startMission after create", {
        error: response.error
          ? {
              message: String(
                (response.error as { message?: string }).message ?? "",
              ),
              name: String(
                (response.error as { name?: string }).name ?? "Error",
              ),
              stack: (response.error as Error).stack,
            }
          : null,
        row: response.data
          ? {
              id: response.data.id,
              mission_id: response.data.mission_id,
              user_id: response.data.user_id,
              status: response.data.status,
              submitted_at: response.data.submitted_at,
            }
          : null,
      });

      if (response.error || !response.data) {
        Alert.alert(
          "Start failed",
          getErrorMessage(response.error, "Could not start mission."),
        );
        return;
      }

      setSubmission(response.data as GenericRecord);
      await invalidateStudentCache(queryClient, user.id);
      if (__DEV__) {
        await debugMobileSupabaseTarget({
          reason: "after-start-mission",
          submissionId: String(response.data.id ?? "").trim() || undefined,
        });
      }
    } finally {
      setBusy(false);
    }
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

    const requiresLocation = Boolean(mission?.requires_location ?? false);
    if (requiresLocation && !location) {
      Alert.alert(
        "Location required",
        "This mission requires location proof before final submission.",
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

    const diagnostics = getSupabaseProjectDiagnostics();
    const submitPayload = {
      submissionId,
      missionId: String(missionId),
      authUserId: user.id,
      location: { lat: location?.lat ?? 0, lng: location?.lng ?? 0 },
    };

    console.log("[mission-detail] submitProof start", {
      ...submitPayload,
      projectRef: diagnostics.urlRef,
      expectedRef: diagnostics.expectedRef,
      projectMatches: diagnostics.matchesExpected,
    });

    setBusy(true);
    try {
      if (__DEV__) {
        await debugMobileSupabaseTarget({
          reason: "before-submit-proof",
          submissionId,
        });
      }

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
          getErrorMessage(
            uploadResponse.error,
            "Could not upload proof image.",
          ),
        );
        return;
      }

      const uploadedProof = uploadResponse.data;

      console.log("[mission-detail] submitProof before DB update", {
        submissionId,
        proofUrl: uploadedProof.publicUrl,
        notes: "Submitted from mission detail screen.",
        location: { lat: location?.lat ?? 0, lng: location?.lng ?? 0 },
      });

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

      console.log("[mission-detail] submitProof after DB update", {
        error: submitResponse.error
          ? {
              message: String(
                (submitResponse.error as { message?: string }).message ?? "",
              ),
              name: String(
                (submitResponse.error as { name?: string }).name ?? "Error",
              ),
              stack: (submitResponse.error as Error).stack,
            }
          : null,
        row: submitResponse.data
          ? {
              id: submitResponse.data.id,
              status: submitResponse.data.status,
              submitted_at: submitResponse.data.submitted_at,
              user_id: submitResponse.data.user_id,
              mission_id: submitResponse.data.mission_id,
            }
          : null,
      });

      if (submitResponse.error || !submitResponse.data) {
        Alert.alert(
          "Submission failed",
          getErrorMessage(submitResponse.error, "Could not submit proof."),
        );
        return;
      }

      const returnedId = String(submitResponse.data.id ?? "").trim();
      if (!returnedId || returnedId !== submissionId) {
        Alert.alert(
          "Submission failed",
          "Server returned mismatched submission id. Proof not accepted.",
        );
        return;
      }

      const status = String(submitResponse.data.status ?? "").toLowerCase();
      const submittedAt = String(submitResponse.data.submitted_at ?? "").trim();
      if ((status === "pending" || status === "approved") && !submittedAt) {
        Alert.alert(
          "Submission failed",
          "Server response missing submitted_at. Proof not accepted.",
        );
        return;
      }

      if (status !== "pending" && status !== "approved") {
        Alert.alert(
          "Submission failed",
          `Unexpected server status "${status || "unknown"}".`,
        );
        return;
      }

      if (__DEV__) {
        await debugMobileSupabaseTarget({
          reason: "after-submit-proof",
          submissionId,
        });
      }

      setSubmission((current) => ({
        ...(current ?? {}),
        ...(submitResponse.data as GenericRecord),
      }));

      if (status === "approved") {
        Alert.alert(
          "Approved",
          "Mission auto-approved. Points and streak updated.",
        );
      } else {
        Alert.alert("Submitted", "Mission proof submitted and pending review.");
      }

      await invalidateStudentCache(queryClient, user.id);
      await loadMissionData();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Mission Detail</ThemedText>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading mission detail...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
      ) : null}

      {mission ? (
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">
            {String(mission.title ?? mission.name ?? "Mission")}
          </ThemedText>
          <ThemedText>
            {String(
              mission.description ??
                mission.summary ??
                "No mission description.",
            )}
          </ThemedText>
          <ThemedText>
            Current status: {String(submission?.status ?? "available")}
          </ThemedText>
        </ThemedView>
      ) : null}

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void loadMissionData()}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          Refresh Mission
        </ThemedText>
      </Pressable>

      <Pressable
        style={styles.primaryButton}
        onPress={() => void startMission()}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <ThemedText style={styles.primaryButtonLabel}>
            Start Mission
          </ThemedText>
        )}
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void attachProof()}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          {proof ? "Proof Selected" : "Attach Proof Photo"}
        </ThemedText>
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void captureLocation()}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          {location ? "Location Captured" : "Attach Location"}
        </ThemedText>
      </Pressable>

      <Pressable
        style={styles.primaryButton}
        onPress={() => void submitProof()}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <ThemedText style={styles.primaryButtonLabel}>
            Submit Proof
          </ThemedText>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  errorText: {
    color: "#b00020",
  },
});
