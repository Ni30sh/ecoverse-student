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
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
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
  const [proof, setProof] = useState<{ uri: string; mimeType?: string } | null>(
    null,
  );
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");

  const loadMissionData = useCallback(async () => {
    if (!user || !missionId) {
      setLoading(false);
      return;
    }

    setErrorMessage("");

    const [missionResponse, submissionResponse] = await Promise.all([
      retryQuery(() => supabaseQueries.missions.getById(missionId), {
        operationName: "missionDetail_missions_getById",
        context: { missionId },
      }),
      retryQuery(
        () => supabaseQueries.missionSubmissions.getUserSubmissions(user.id),
        {
          operationName: "missionDetail_missionSubmissions_getUserSubmissions",
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

    const allSubmissions = (submissionResponse.data ?? []) as GenericRecord[];
    const activeSubmission =
      allSubmissions.find(
        (item) => String(item.mission_id ?? "") === missionId,
      ) ?? null;

    setMission((missionResponse.data ?? null) as GenericRecord | null);
    setSubmission(activeSubmission);
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
      setBusy(false);
      return;
    }

    setSubmission(response.data as GenericRecord);
    await invalidateStudentCache(queryClient, user.id);
    setBusy(false);
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

    setBusy(true);

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
      setBusy(false);
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
      Alert.alert(
        "Submission failed",
        getErrorMessage(submitResponse.error, "Could not submit proof."),
      );
      setBusy(false);
      return;
    }

    const status = String(
      submitResponse.data?.status ?? "pending",
    ).toLowerCase();
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
    setBusy(false);
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
