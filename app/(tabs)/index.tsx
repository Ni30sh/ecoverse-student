import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import EcosystemViewer from "@/components/game/EcosystemViewer";
import { ThemedText } from "@/components/themed-text";
import { GlassCard } from "@/components/ui/glass-card";
import { PremiumButton } from "@/components/ui/premium-button";
import { SkeletonBlock } from "@/components/ui/skeleton-block";
import { useToast } from "@/components/ui/toast-provider";
import { Colors, Spacing } from "@/constants/theme";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { useAuth } from "@/providers/auth-provider";
import { useAppTheme } from "@/providers/theme-provider";

type ProfileRecord = Record<string, unknown>;
type MissionRecord = Record<string, unknown>;

type DashboardStats = {
  ecoPoints: number;
  streak: number;
  level: number;
  rank: number;
};

function extractNumber(value: unknown, defaultVal = 0): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const num = Number(value);
    return Number.isNaN(num) ? defaultVal : num;
  }

  return defaultVal;
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

function getDifficultyBadge(mission: MissionRecord, index: number) {
  const raw = String(mission.difficulty ?? "").toLowerCase();

  if (raw === "easy" || raw === "medium" || raw === "hard") {
    return raw;
  }

  return index === 0 ? "easy" : index === 1 ? "medium" : "hard";
}

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const { resolvedScheme } = useAppTheme();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const palette = Colors[resolvedScheme];
  const {
    profile,
    rank,
    leaderboard,
    missions,
    submissions,
    weeklyPoints,
    isLoading,
    refreshProfile,
  } = useDashboardData();

  const stats: DashboardStats = {
    ecoPoints: extractNumber(
      (profile as ProfileRecord | null)?.eco_points ??
        (profile as ProfileRecord | null)?.points ??
        0,
    ),
    streak: extractNumber(
      (profile as ProfileRecord | null)?.streak ??
        (profile as ProfileRecord | null)?.streak_count ??
        0,
    ),
    level: Math.max(
      1,
      extractNumber((profile as ProfileRecord | null)?.level ?? 1, 1),
    ),
    rank: extractNumber(rank),
  };

  const loading = isLoading;
  const dailyPoints = (weeklyPoints ?? []) as Record<string, unknown>[];
  const errorMessage = "";

  const onRefresh = useCallback(async () => {
    void Haptics.selectionAsync();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["submissions", user?.id] }),
      queryClient.invalidateQueries({ queryKey: ["activity", user?.id] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-missions"] }),
      queryClient.invalidateQueries({ queryKey: ["weekly-points", user?.id] }),
      queryClient.invalidateQueries({ queryKey: ["rank", user?.id] }),
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] }),
    ]);
    await refreshProfile();
    showToast("Dashboard refreshed", "success");
  }, [queryClient, refreshProfile, showToast, user?.id]);

  const userName = String(
    profile?.name ?? user?.email?.split("@")[0] ?? "Raj",
  ).split(" ")[0];
  const quests = missions.slice(0, 3);
  const activities = submissions.slice(0, 4);

  return (
    <LinearGradient
      colors={
        resolvedScheme === "dark"
          ? ["#0F172A", "#111827", "#0b1120"]
          : ["#F6F8F7", "#ecfdf5", "#f8fafc"]
      }
      style={styles.root}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(350)}>
          <GlassCard style={styles.heroCard}>
            <View style={styles.heroTop}>
              <View>
                <ThemedText style={styles.heroTitle}>
                  {getGreeting()}, {userName} ??
                </ThemedText>
                <ThemedText
                  style={[styles.heroSubtitle, { color: palette.muted }]}
                >
                  Grow your impact with one mission today.
                </ThemedText>
              </View>
              <LinearGradient
                colors={["#16A34A", "#4ADE80"]}
                style={styles.avatarBubble}
              >
                <ThemedText style={styles.avatarText}>E</ThemedText>
              </LinearGradient>
            </View>
          </GlassCard>
        </Animated.View>

        {loading ? (
          <GlassCard style={styles.loadingCard}>
            <SkeletonBlock height={22} width="60%" />
            <SkeletonBlock height={14} width="90%" />
            <SkeletonBlock height={90} />
            <SkeletonBlock height={90} />
          </GlassCard>
        ) : (
          <>
            <Animated.View
              entering={FadeInDown.delay(60).duration(350)}
              style={styles.statsRow}
            >
              <LinearGradient
                colors={["#16A34A", "#4ADE80"]}
                style={styles.statCard}
              >
                <ThemedText style={styles.statLabel}>EcoPoints</ThemedText>
                <ThemedText style={styles.statValue}>
                  {stats.ecoPoints}
                </ThemedText>
              </LinearGradient>
              <LinearGradient
                colors={["#0ea5e9", "#38bdf8"]}
                style={styles.statCard}
              >
                <ThemedText style={styles.statLabel}>Streak</ThemedText>
                <ThemedText style={styles.statValue}>
                  {stats.streak}d
                </ThemedText>
              </LinearGradient>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.delay(90).duration(350)}
              style={styles.statsRow}
            >
              <LinearGradient
                colors={["#1d4ed8", "#60a5fa"]}
                style={styles.statCard}
              >
                <ThemedText style={styles.statLabel}>Level</ThemedText>
                <ThemedText style={styles.statValue}>
                  Lv {stats.level}
                </ThemedText>
              </LinearGradient>
              <LinearGradient
                colors={["#7c3aed", "#a78bfa"]}
                style={styles.statCard}
              >
                <ThemedText style={styles.statLabel}>Rank</ThemedText>
                <ThemedText style={styles.statValue}>
                  #{stats.rank || 0}
                </ThemedText>
              </LinearGradient>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(105).duration(360)}>
              <GlassCard style={styles.ecosystemCard}>
                <View style={styles.sectionHeader}>
                  <ThemedText type="subtitle" style={styles.sectionTitle}>
                    Ecosystem Growth
                  </ThemedText>
                  <ThemedText
                    style={[styles.viewAll, { color: palette.primary }]}
                  >
                    {stats.ecoPoints} pts
                  </ThemedText>
                </View>
                <EcosystemViewer
                  ecoPoints={stats.ecoPoints}
                  darkWrapper={resolvedScheme === "dark"}
                />
              </GlassCard>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(120).duration(360)}>
              <GlassCard style={styles.challengeCard}>
                <LinearGradient
                  colors={["#14532d", "#16a34a"]}
                  style={styles.challengeHeader}
                >
                  <ThemedText style={styles.challengeKicker}>
                    ACTIVE CHALLENGE
                  </ThemedText>
                  <ThemedText style={styles.challengeTitle}>
                    {String(quests[0]?.title ?? "Monsoon Water Save Challenge")}
                  </ThemedText>
                  <ThemedText style={styles.challengeText}>
                    {String(
                      quests[0]?.description ??
                        "Complete eco actions and unlock reward points.",
                    ).slice(0, 90)}
                  </ThemedText>
                </LinearGradient>
                <View style={styles.progressTrack}>
                  <View style={styles.progressFill} />
                </View>
              </GlassCard>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(150).duration(360)}>
              <View style={styles.sectionHeader}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Today&apos;s Quests
                </ThemedText>
                <Pressable onPress={() => void onRefresh()}>
                  <ThemedText
                    style={[styles.viewAll, { color: palette.accent }]}
                  >
                    Refresh
                  </ThemedText>
                </Pressable>
              </View>
              <View style={styles.questList}>
                {quests.map((mission, index) => {
                  const difficulty = getDifficultyBadge(mission, index);

                  return (
                    <GlassCard
                      key={`${String(mission.id ?? index)}-${index}`}
                      style={styles.questCard}
                    >
                      <LinearGradient
                        colors={["#f0fdf4", "#dcfce7"]}
                        style={styles.questHeader}
                      >
                        <ThemedText style={styles.questBadge}>
                          {difficulty.toUpperCase()}
                        </ThemedText>
                        <ThemedText style={styles.questPoints}>
                          +{extractNumber(mission.points, 50)} pts
                        </ThemedText>
                      </LinearGradient>
                      <ThemedText style={styles.questTitle}>
                        {String(mission.title ?? "Mission")}
                      </ThemedText>
                      <ThemedText
                        style={[styles.questText, { color: palette.muted }]}
                      >
                        {String(
                          mission.description ??
                            "Take one practical eco action today.",
                        ).slice(0, 72)}
                      </ThemedText>
                      <PremiumButton
                        label="Accept"
                        onPress={() => {
                          void Haptics.impactAsync(
                            Haptics.ImpactFeedbackStyle.Medium,
                          );
                          showToast("Mission accepted", "success");
                        }}
                        style={styles.questButton}
                      />
                    </GlassCard>
                  );
                })}
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(190).duration(360)}>
              <View style={styles.sectionHeader}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Leaderboard
                </ThemedText>
              </View>
              <GlassCard style={styles.leaderboardCard}>
                {leaderboard.slice(0, 3).map((entry, index) => (
                  <View
                    key={`${String(entry.id ?? index)}-${index}`}
                    style={styles.rankRow}
                  >
                    <ThemedText style={styles.rankIcon}>
                      {index === 0 ? "??" : index === 1 ? "??" : "??"}
                    </ThemedText>
                    <ThemedText style={styles.rankName}>
                      {String(entry.full_name ?? "Student")}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.rankPoints,
                        { color: index === 0 ? "#16A34A" : palette.text },
                      ]}
                    >
                      {extractNumber(entry.eco_points ?? 0)}
                    </ThemedText>
                  </View>
                ))}
              </GlassCard>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.delay(230).duration(360)}
              style={styles.splitRow}
            >
              <GlassCard style={styles.halfCard}>
                <ThemedText type="subtitle" style={styles.miniTitle}>
                  Weekly Chart
                </ThemedText>
                <View style={styles.chartRow}>
                  {(dailyPoints.length > 0
                    ? dailyPoints.slice(0, 7)
                    : Array.from({ length: 7 })
                  ).map((entry, i) => {
                    const value = entry
                      ? extractNumber(
                          (entry as Record<string, unknown>).points,
                          0,
                        )
                      : 0;
                    const height = Math.max(10, Math.min(48, value / 2 || 12));
                    return (
                      <View
                        key={`bar-${i}`}
                        style={[styles.chartBar, { height }]}
                      />
                    );
                  })}
                </View>
              </GlassCard>

              <GlassCard style={styles.halfCard}>
                <ThemedText type="subtitle" style={styles.miniTitle}>
                  Activity
                </ThemedText>
                {activities.length === 0 ? (
                  <ThemedText
                    style={[styles.activityText, { color: palette.muted }]}
                  >
                    Complete a mission to start timeline.
                  </ThemedText>
                ) : (
                  activities.map((item, index) => (
                    <View key={`activity-${index}`} style={styles.activityRow}>
                      <View style={styles.activityDot} />
                      <ThemedText style={styles.activityText}>
                        {String(item.status ?? "progress").toUpperCase()}{" "}
                        {String(item.updated_at ?? "").slice(0, 10)}
                      </ThemedText>
                    </View>
                  ))
                )}
              </GlassCard>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(260).duration(360)}>
              <GlassCard style={styles.badgesCard}>
                <View style={styles.sectionHeader}>
                  <ThemedText type="subtitle" style={styles.sectionTitle}>
                    Badges
                  </ThemedText>
                  <ThemedText
                    style={[styles.viewAll, { color: palette.primary }]}
                  >
                    6 to unlock
                  </ThemedText>
                </View>
                <View style={styles.badgesRow}>
                  <View style={styles.badgePill}>
                    <ThemedText>?? First Steps</ThemedText>
                  </View>
                  <View style={styles.badgePill}>
                    <ThemedText>?? On Fire</ThemedText>
                  </View>
                  <View style={styles.badgePill}>
                    <ThemedText>?? Water Guard</ThemedText>
                  </View>
                </View>
              </GlassCard>
            </Animated.View>

            <View style={styles.actionRow}>
              <PremiumButton
                label="Refresh"
                onPress={() => void onRefresh()}
                style={styles.actionButton}
              />
              <PremiumButton
                label="Logout"
                onPress={() => {
                  showToast("Signed out", "info");
                  void signOut();
                }}
                style={styles.actionButton}
              />
            </View>

            {errorMessage ? (
              <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
            ) : null}
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    padding: Spacing.screen,
    gap: Spacing.gap,
    paddingBottom: 28,
  },
  heroCard: {
    padding: 18,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 28,
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
  },
  avatarBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 20,
  },
  loadingCard: {
    gap: 12,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 20,
    padding: 14,
    minHeight: 94,
    justifyContent: "space-between",
  },
  statLabel: {
    color: "#ecfdf5",
    fontSize: 12,
    fontWeight: "700",
  },
  statValue: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "800",
  },
  challengeCard: {
    padding: 10,
  },
  ecosystemCard: {
    padding: 10,
    gap: 8,
  },
  challengeHeader: {
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  challengeKicker: {
    color: "#d1fae5",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  challengeTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  challengeText: {
    color: "#dcfce7",
    fontSize: 13,
  },
  progressTrack: {
    marginTop: 10,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#d1fae5",
    overflow: "hidden",
  },
  progressFill: {
    height: 8,
    width: "52%",
    backgroundColor: "#16A34A",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  viewAll: {
    fontSize: 13,
    fontWeight: "700",
  },
  questList: {
    gap: 12,
  },
  questCard: {
    gap: 10,
  },
  questHeader: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  questBadge: {
    color: "#166534",
    fontSize: 11,
    fontWeight: "900",
  },
  questPoints: {
    color: "#166534",
    fontSize: 12,
    fontWeight: "800",
  },
  questTitle: {
    fontSize: 17,
    fontWeight: "800",
  },
  questText: {
    fontSize: 14,
    lineHeight: 20,
  },
  questButton: {
    marginTop: 6,
  },
  leaderboardCard: {
    gap: 8,
  },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.2)",
    gap: 10,
  },
  rankIcon: {
    width: 32,
    textAlign: "center",
    fontSize: 18,
  },
  rankName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  rankPoints: {
    fontSize: 15,
    fontWeight: "900",
  },
  splitRow: {
    flexDirection: "row",
    gap: 12,
  },
  halfCard: {
    flex: 1,
    gap: 10,
  },
  miniTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 56,
  },
  chartBar: {
    width: 12,
    borderRadius: 8,
    backgroundColor: "#22C55E",
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22C55E",
  },
  activityText: {
    fontSize: 12,
    lineHeight: 16,
  },
  badgesCard: {
    gap: 8,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  badgePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
    fontWeight: "700",
  },
});
