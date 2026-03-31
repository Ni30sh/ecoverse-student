import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";

type GenericRecord = Record<string, unknown>;

function toNumber(record: GenericRecord | null | undefined, keys: string[]) {
  if (!record) {
    return 0;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }

    if (
      typeof value === "string" &&
      value.trim() !== "" &&
      !Number.isNaN(Number(value))
    ) {
      return Number(value);
    }
  }

  return 0;
}

function toText(record: GenericRecord | null | undefined, keys: string[]) {
  if (!record) {
    return "";
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return "";
}

export default function LeaderboardScreen() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [topUsers, setTopUsers] = useState<GenericRecord[]>([]);
  const [rank, setRank] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const viewerClass = useMemo(
    () =>
      toText(profile as GenericRecord | null, [
        "class_id",
        "class_name",
        "class",
      ]),
    [profile],
  );

  const loadLeaderboard = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setErrorMessage("");

    const [topResponse, rankResponse] = await Promise.all([
      retryQuery(() => supabaseQueries.leaderboard.getTopUsers(50), {
        operationName: "leaderboard_getTopUsers",
        context: { screen: "leaderboard" },
      }),
      retryQuery(() => supabaseQueries.leaderboard.getRank(user.id), {
        operationName: "leaderboard_getRank",
        context: { screen: "leaderboard" },
      }),
    ]);

    const firstError = topResponse.error ?? rankResponse.error;
    if (firstError) {
      setErrorMessage(
        getErrorMessage(firstError, "Failed to load leaderboard."),
      );
      setLoading(false);
      return;
    }

    setTopUsers((topResponse.data ?? []) as GenericRecord[]);
    setRank(
      toNumber(rankResponse.data as GenericRecord | null, [
        "rank",
        "position",
        "user_rank",
      ]),
    );
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void loadLeaderboard();
    }, [loadLeaderboard]),
  );

  const rankingRows = useMemo(() => {
    const sorted = [...topUsers].sort((a, b) => {
      return (
        toNumber(b, ["eco_points", "points", "total_points"]) -
        toNumber(a, ["eco_points", "points", "total_points"])
      );
    });

    if (!viewerClass) {
      return sorted.slice(0, 20);
    }

    const classRows = sorted.filter((entry) => {
      const rowClass = toText(entry, ["class_id", "class_name", "class"]);
      return (
        rowClass !== "" && rowClass.toLowerCase() === viewerClass.toLowerCase()
      );
    });

    return (classRows.length > 0 ? classRows : sorted).slice(0, 20);
  }, [topUsers, viewerClass]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Leaderboard</ThemedText>
      <ThemedText>
        {viewerClass ? `Class: ${viewerClass}` : "Class ranking view"}
      </ThemedText>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading class ranking...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
      ) : null}

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Your Rank</ThemedText>
        <ThemedText type="title">#{rank || 0}</ThemedText>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Top Students</ThemedText>
        {rankingRows.length === 0 ? (
          <ThemedText>No leaderboard data found.</ThemedText>
        ) : null}
        {rankingRows.map((entry, index) => (
          <ThemedText
            key={`${String(entry.user_id ?? entry.id ?? index)}-${index}`}
          >
            {index + 1}.{" "}
            {String(entry.name ?? entry.full_name ?? entry.email ?? "Student")}{" "}
            - {toNumber(entry, ["eco_points", "points", "total_points"])}
          </ThemedText>
        ))}
      </ThemedView>

      <Pressable
        style={styles.refreshButton}
        onPress={() => void loadLeaderboard()}
      >
        <ThemedText style={styles.refreshButtonLabel}>
          Refresh Ranking
        </ThemedText>
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
  refreshButton: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,126,164,0.12)",
  },
  refreshButtonLabel: {
    color: "#0a7ea4",
    fontWeight: "700",
  },
  errorText: {
    color: "#b00020",
  },
});
