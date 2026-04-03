import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient as SvgGradient,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";
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

type EcosystemBand = {
  label: string;
  min: number;
  maxExclusive: number | null;
};

const ECOSYSTEM_BANDS: EcosystemBand[] = [
  { label: "Barren", min: 0, maxExclusive: 200 },
  { label: "Sprouting", min: 200, maxExclusive: 600 },
  { label: "Growing", min: 600, maxExclusive: 1200 },
  { label: "Thriving", min: 1200, maxExclusive: 2500 },
  { label: "Flourishing", min: 2500, maxExclusive: 10000 },
  { label: "Eco Utopia", min: 10000, maxExclusive: null },
];

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

function getWeeklyChartData(pointsRows: Record<string, unknown>[]) {
  const fallbackLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const rows = pointsRows.slice(0, 7);

  const normalized = rows.map((entry, index) => {
    const dateRaw = String(entry.date ?? "").trim();
    const date = dateRaw ? new Date(dateRaw) : null;
    const label =
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString("en-US", { weekday: "short" })
        : fallbackLabels[index] ?? `D${index + 1}`;

    return {
      label,
      value: extractNumber(entry.points ?? entry.points_earned ?? 0, 0),
    };
  });

  if (normalized.length === 0) {
    return fallbackLabels.map((label) => ({ label, value: 0 }));
  }

  if (normalized.length < 7) {
    const remaining = 7 - normalized.length;
    for (let i = 0; i < remaining; i += 1) {
      normalized.push({
        label: fallbackLabels[normalized.length] ?? `D${normalized.length + 1}`,
        value: 0,
      });
    }
  }

  return normalized;
}

function getEcosystemBand(ecoPoints: number) {
  const safePoints = Math.max(0, ecoPoints);
  const band =
    ECOSYSTEM_BANDS.find(
      (item) =>
        safePoints >= item.min &&
        (item.maxExclusive === null || safePoints < item.maxExclusive),
    ) ?? ECOSYSTEM_BANDS[0];

  const nextTarget = band.maxExclusive;
  const segmentTotal =
    nextTarget === null ? 1 : Math.max(1, nextTarget - band.min);
  const segmentValue =
    nextTarget === null
      ? segmentTotal
      : Math.max(0, Math.min(segmentTotal, safePoints - band.min));
  const progressPercent = Math.round((segmentValue / segmentTotal) * 100);

  return {
    ...band,
    nextTarget,
    progressPercent,
  };
}

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const { resolvedScheme } = useAppTheme();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [acceptingMissionId, setAcceptingMissionId] = useState<string | null>(
    null,
  );
  const palette = Colors[resolvedScheme];
  const {
    profile,
    rank,
    leaderboard,
    missions,
    submissions,
    weeklyPoints,
    isLoading,
    acceptMission,
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
  const ecosystemBand = getEcosystemBand(stats.ecoPoints);
  const weeklyChartData = getWeeklyChartData(dailyPoints);
  const weeklyMax = Math.max(10, ...weeklyChartData.map((item) => item.value));

  const chartWidth = 280;
  const chartPaddingX = 16;
  const chartTop = 14;
  const chartBottom = 86;
  const chartUsableHeight = chartBottom - chartTop;
  const chartStepX =
    (chartWidth - chartPaddingX * 2) /
    Math.max(1, weeklyChartData.length - 1);

  const chartPoints = weeklyChartData.map((item, index) => {
    const x = chartPaddingX + index * chartStepX;
    const y = chartBottom - (item.value / weeklyMax) * chartUsableHeight;
    return { x, y, label: item.label, value: item.value };
  });

  const linePath = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L${chartPoints[chartPoints.length - 1]?.x ?? chartWidth - chartPaddingX},${chartBottom} L${chartPoints[0]?.x ?? chartPaddingX},${chartBottom} Z`;
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
                  {getGreeting()}, {userName} 🌿
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
                  <View style={styles.ecosystemStageBadge}>
                    <ThemedText style={styles.ecosystemStageText}>
                      {ecosystemBand.label}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.ecosystemFrame}>
                  <EcosystemViewer
                    ecoPoints={stats.ecoPoints}
                    darkWrapper={resolvedScheme === "dark"}
                  />
                </View>
                <View style={styles.ecosystemMetaRow}>
                  <View style={styles.ecosystemMetaItem}>
                    <ThemedText style={styles.ecosystemMetaLabel}>Points</ThemedText>
                    <ThemedText style={styles.ecosystemMetaValue}>
                      {stats.ecoPoints}
                    </ThemedText>
                  </View>
                  <View style={styles.ecosystemMetaItem}>
                    <ThemedText style={styles.ecosystemMetaLabel}>Next Milestone</ThemedText>
                    <ThemedText style={styles.ecosystemMetaValue}>
                      {ecosystemBand.nextTarget === null
                        ? "Max reached"
                        : `${ecosystemBand.nextTarget} pts`}
                    </ThemedText>
                  </View>
                  <View style={styles.ecosystemMetaItem}>
                    <ThemedText style={styles.ecosystemMetaLabel}>Completion</ThemedText>
                    <ThemedText style={styles.ecosystemMetaValue}>
                      {ecosystemBand.progressPercent}%
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.ecosystemProgressTrack}>
                  <View
                    style={[
                      styles.ecosystemProgressFill,
                      { width: `${ecosystemBand.progressPercent}%` },
                    ]}
                  />
                </View>
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
                  const missionId = String(mission.id ?? "").trim();
                  const isAccepting = acceptingMissionId === missionId;

                  return (
                    <GlassCard
                      key={`${String(mission.id ?? index)}-${index}`}
                      style={[
                        styles.questCard,
                        acceptingMissionId && !isAccepting
                          ? styles.questCardDimmed
                          : null,
                      ]}
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
                        label={isAccepting ? "Accepting..." : "Accept"}
                        onPress={async () => {
                          void Haptics.impactAsync(
                            Haptics.ImpactFeedbackStyle.Medium,
                          );
                          if (!missionId) {
                            showToast("Mission is missing an id.", "error");
                            return;
                          }
                          setAcceptingMissionId(missionId);
                          try {
                            await acceptMission.mutateAsync(missionId);
                          } finally {
                            setAcceptingMissionId((current) =>
                              current === missionId ? null : current,
                            );
                          }
                        }}
                        disabled={isAccepting}
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
                      {index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}
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
                <View style={styles.weeklyChartWrap}>
                  <Svg viewBox="0 0 280 120" width="100%" height={120}>
                    <Defs>
                      <SvgGradient id="weeklyArea" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0%" stopColor="#22C55E" stopOpacity="0.35" />
                        <Stop offset="100%" stopColor="#22C55E" stopOpacity="0.03" />
                      </SvgGradient>
                    </Defs>

                    {[0, 1, 2].map((row) => {
                      const y = chartTop + (chartUsableHeight / 2) * row;
                      return (
                        <Line
                          key={`grid-${row}`}
                          x1={chartPaddingX}
                          y1={y}
                          x2={chartWidth - chartPaddingX}
                          y2={y}
                          stroke="rgba(148,163,184,0.25)"
                          strokeWidth={1}
                          strokeDasharray="3 4"
                        />
                      );
                    })}

                    <Path d={areaPath} fill="url(#weeklyArea)" />
                    <Path
                      d={linePath}
                      fill="none"
                      stroke="#16A34A"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {chartPoints.map((point, index) => (
                      <Circle
                        key={`dot-${index}`}
                        cx={point.x}
                        cy={point.y}
                        r={4}
                        fill="#16A34A"
                      />
                    ))}

                    {chartPoints.map((point, index) => (
                      <SvgText
                        key={`label-${index}`}
                        x={point.x}
                        y={106}
                        fontSize={10}
                        fill="#64748B"
                        textAnchor="middle"
                      >
                        {point.label}
                      </SvgText>
                    ))}
                  </Svg>
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
                  activities.map((item, index) => {
                    const statusMap: Record<string, string> = {
                      "in_progress": "Started (not submitted)",
                      "pending": "Submitted for teacher review",
                      "approved": "Completed ✓",
                      "rejected": "Needs revision",
                    };
                    const statusLabel = statusMap[String(item.status ?? "").toLowerCase()] ?? String(item.status ?? "progress").toUpperCase();
                    return (
                      <View key={`activity-${index}`} style={styles.activityRow}>
                        <View style={styles.activityDot} />
                        <ThemedText style={styles.activityText}>
                          {statusLabel}{" "}
                          {String(item.updated_at ?? "").slice(0, 10)}
                        </ThemedText>
                      </View>
                    );
                  })
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
                    <ThemedText>🌱 First Steps</ThemedText>
                  </View>
                  <View style={styles.badgePill}>
                    <ThemedText>🔥 On Fire</ThemedText>
                  </View>
                  <View style={styles.badgePill}>
                    <ThemedText>💧 Water Guard</ThemedText>
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
    padding: 12,
    gap: 12,
  },
  ecosystemStageBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(22,163,74,0.14)",
  },
  ecosystemStageText: {
    color: "#166534",
    fontSize: 12,
    fontWeight: "800",
  },
  ecosystemFrame: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  ecosystemMetaRow: {
    flexDirection: "row",
    gap: 8,
  },
  ecosystemMetaItem: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(22,163,74,0.08)",
    borderWidth: 1,
    borderColor: "rgba(22,163,74,0.14)",
  },
  ecosystemMetaLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#166534",
  },
  ecosystemMetaValue: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "800",
    color: "#0f172a",
  },
  ecosystemProgressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.25)",
    overflow: "hidden",
  },
  ecosystemProgressFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#16A34A",
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
  questCardDimmed: {
    opacity: 0.55,
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
  weeklyChartWrap: {
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 2,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    backgroundColor: "rgba(248,250,252,0.7)",
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
