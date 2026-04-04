import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { GlassCard } from "@/components/ui/glass-card";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";

type GenericRecord = Record<string, unknown>;

function getMedalEmoji(index: number) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return "";
}

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
  const [globalTopUsers, setGlobalTopUsers] = useState<GenericRecord[]>([]);
  const [globalRank, setGlobalRank] = useState(0);
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

    const [topResponse, rankResponse, globalTopResponse, globalRankResponse] =
      await Promise.all([
      retryQuery(
        () =>
          supabaseQueries.leaderboard.getTopUsers(
            50,
            "all_time",
            "my_school",
            user.id,
          ),
        {
        operationName: "leaderboard_getTopUsers",
        context: { screen: "leaderboard" },
        },
      ),
      retryQuery(
        () =>
          supabaseQueries.leaderboard.getRank(
            user.id,
            "all_time",
            "my_school",
          ),
        {
        operationName: "leaderboard_getRank",
        context: { screen: "leaderboard" },
        },
      ),
      retryQuery(
        () =>
          supabaseQueries.leaderboard.getTopUsers(
            50,
            "all_time",
            "global",
            user.id,
          ),
        {
          operationName: "leaderboard_getTopUsers_global",
          context: { screen: "leaderboard" },
        },
      ),
      retryQuery(
        () =>
          supabaseQueries.leaderboard.getRank(
            user.id,
            "all_time",
            "global",
          ),
        {
          operationName: "leaderboard_getRank_global",
          context: { screen: "leaderboard" },
        },
      ),
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
    setGlobalTopUsers((globalTopResponse.data ?? []) as GenericRecord[]);
    setGlobalRank(
      toNumber(globalRankResponse.data as GenericRecord | null, [
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

  const globalRankingRows = useMemo(() => {
    return [...globalTopUsers]
      .sort((a, b) => {
        return (
          toNumber(b, ["eco_points", "points", "total_points"]) -
          toNumber(a, ["eco_points", "points", "total_points"])
        );
      })
      .slice(0, 50);
  }, [globalTopUsers]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Animated.View entering={FadeInDown.duration(350)}>
        <GlassCard style={styles.headerCard}>
          <ThemedText type="title" style={styles.headerTitle}>
            🏆 Leaderboard
          </ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            {viewerClass ? `Class: ${viewerClass}` : "Global Rankings"}
          </ThemedText>
        </GlassCard>
      </Animated.View>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading rankings...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <GlassCard style={styles.errorCard}>
          <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        </GlassCard>
      ) : null}

      <Animated.View entering={FadeInDown.delay(60).duration(350)}>
        <LinearGradient
          colors={["#f59e0b", "#fbbf24"]}
          style={styles.rankCard}
        >
          <ThemedText style={styles.rankLabel}>Your School Rank</ThemedText>
          <ThemedText style={styles.rankValue}>#{rank || 0}</ThemedText>
        </LinearGradient>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(82).duration(350)}>
        <GlassCard style={styles.globalCard}>
          <View style={styles.globalHeaderRow}>
            <ThemedText type="subtitle" style={styles.leaderboardTitle}>
              Global Ranking (All Students)
            </ThemedText>
            <ThemedText style={styles.globalRankText}>
              Your Global Rank: #{globalRank || 0}
            </ThemedText>
          </View>

          {globalRankingRows.length === 0 ? (
            <ThemedText style={styles.emptyText}>No global ranking data found.</ThemedText>
          ) : (
            <View style={styles.rankingList}>
              {globalRankingRows.map((entry, index) => (
                <View
                  key={`global-${String(entry.user_id ?? entry.id ?? index)}-${index}`}
                  style={styles.globalRankingRow}
                >
                  <View style={styles.rankingLeft}>
                    <ThemedText style={styles.rankMedal}>
                      {getMedalEmoji(index) || `${index + 1}`}
                    </ThemedText>
                    <View style={styles.rankingInfo}>
                      <ThemedText style={styles.rankingName}>
                        {String(entry.name ?? entry.full_name ?? entry.email ?? "Student")}
                      </ThemedText>
                      <ThemedText style={styles.globalSchoolName}>
                        {toText(entry, ["school_name", "college_name"]) || "School"}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.rankingPoints}>
                    {toNumber(entry, ["eco_points", "points", "total_points"])}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(105).duration(350)}>
        <GlassCard style={styles.leaderboardCard}>
          <ThemedText type="subtitle" style={styles.leaderboardTitle}>
            Top Students
          </ThemedText>
          {rankingRows.length === 0 ? (
            <ThemedText style={styles.emptyText}>
              No leaderboard data found.
            </ThemedText>
          ) : (
            <View style={styles.rankingList}>
              {rankingRows.map((entry, index) => (
                <View
                  key={`${String(entry.user_id ?? entry.id ?? index)}-${index}`}
                  style={styles.rankingRow}
                >
                  <View style={styles.rankingLeft}>
                    <ThemedText style={styles.rankMedal}>
                      {getMedalEmoji(index) || `${index + 1}`}
                    </ThemedText>
                    <View style={styles.rankingInfo}>
                      <ThemedText style={styles.rankingName}>
                        {String(
                          entry.name ?? entry.full_name ?? entry.email ?? "Student"
                        )}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.rankingPoints}>
                    {toNumber(entry, ["eco_points", "points", "total_points"])}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(150).duration(350)}>
        <Pressable
          style={styles.refreshButton}
          onPress={() => void loadLeaderboard()}
        >
          <LinearGradient
            colors={["#10b981", "#34d399"]}
            style={styles.refreshGradient}
          >
            <ThemedText style={styles.refreshButtonLabel}>
              ↻ Refresh Ranking
            </ThemedText>
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  rankCard: {
    borderRadius: 14,
    padding: 20,
    gap: 8,
  },
  rankLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.8)",
  },
  rankValue: {
    fontSize: 32,
    fontWeight: "700",
    color: "#ffffff",
  },
  leaderboardCard: {
    gap: 16,
  },
  globalCard: {
    gap: 12,
  },
  globalHeaderRow: {
    gap: 4,
  },
  globalRankText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0f766e",
  },
  globalRankingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "rgba(15, 118, 110, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(15, 118, 110, 0.16)",
  },
  globalSchoolName: {
    fontSize: 12,
    opacity: 0.65,
  },
  leaderboardTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  emptyText: {
    opacity: 0.6,
  },
  rankingList: {
    gap: 10,
  },
  rankingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(16, 185, 129, 0.03)",
  },
  rankingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  rankMedal: {
    fontSize: 20,
    fontWeight: "700",
    minWidth: 32,
    textAlign: "center",
  },
  rankingInfo: {
    flex: 1,
  },
  rankingName: {
    fontSize: 15,
    fontWeight: "500",
  },
  rankingPoints: {
    fontSize: 16,
    fontWeight: "700",
    color: "#16A34A",
  },
  refreshButton: {
    minHeight: 48,
    borderRadius: 12,
    overflow: "hidden",
  },
  refreshGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
});
