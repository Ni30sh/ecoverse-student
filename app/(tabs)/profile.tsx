import { useFocusEffect } from "@react-navigation/native";
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
import { GlassCard } from "@/components/ui/glass-card";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";
import { useAppTheme } from "@/providers/theme-provider";

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

export default function ProfileScreen() {
  const { user, profile, signOut } = useAuth();
  const { themeMode, setThemeMode } = useAppTheme();
  const [loading, setLoading] = useState(true);
  const [topUsers, setTopUsers] = useState<GenericRecord[]>([]);
  const [notifications, setNotifications] = useState<GenericRecord[]>([]);
  const [badges, setBadges] = useState<GenericRecord[]>([]);
  const [rank, setRank] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const unreadNotifications = notifications.filter(
    (entry) => !Boolean(entry.is_read),
  ).length;

  const loadProfileData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setErrorMessage("");

    const [topResponse, rankResponse, notificationsResponse, badgesResponse] =
      await Promise.all([
        retryQuery(() => supabaseQueries.leaderboard.getTopUsers(10), {
          operationName: "profile_leaderboard_getTopUsers",
          context: { screen: "profile" },
        }),
        retryQuery(() => supabaseQueries.leaderboard.getRank(user.id), {
          operationName: "profile_leaderboard_getRank",
          context: { screen: "profile" },
        }),
        retryQuery(
          () => supabaseQueries.notifications.getUserNotifications(user.id),
          {
            operationName: "profile_notifications_getUserNotifications",
            context: { screen: "profile" },
          },
        ),
        retryQuery(() => supabaseQueries.badges.getAll(), {
          operationName: "profile_badges_getAll",
          context: { screen: "profile" },
        }),
      ]);

    const firstError =
      topResponse.error ??
      rankResponse.error ??
      notificationsResponse.error ??
      badgesResponse.error;

    if (firstError) {
      setErrorMessage(
        getErrorMessage(firstError, "Failed to load profile data."),
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
    setNotifications((notificationsResponse.data ?? []) as GenericRecord[]);
    setBadges((badgesResponse.data ?? []) as GenericRecord[]);
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void loadProfileData();
    }, [loadProfileData]),
  );

  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribe = supabaseQueries.realtime.subscribeProfile(
      user.id,
      () => {
        void loadProfileData();
      },
    );

    return () => {
      void unsubscribe();
    };
  }, [loadProfileData, user]);

  const markRead = async (notificationId: string) => {
    const response = await retryQuery(() =>
      supabaseQueries.notifications.markAsRead(notificationId),
    );
    if (response.error) {
      Alert.alert(
        "Mark read failed",
        getErrorMessage(response.error, "Failed to mark notification as read."),
      );
      return;
    }

    void loadProfileData();
  };

  const awardFirstBadge = async () => {
    if (!user || badges.length === 0) {
      return;
    }

    const firstBadgeId = String(badges[0].id ?? "");
    if (!firstBadgeId) {
      Alert.alert("Cannot award badge", "Badge id missing.");
      return;
    }

    const response = await retryQuery(() =>
      supabaseQueries.badges.awardBadge(user.id, firstBadgeId),
    );
    if (response.error) {
      Alert.alert(
        "Badge award failed",
        getErrorMessage(response.error, "Failed to award badge."),
      );
    } else {
      Alert.alert("Success", "Badge awarded successfully.");
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter((entry) => !Boolean(entry.is_read));
    if (unread.length === 0) {
      Alert.alert(
        "No unread notifications",
        "All notifications are already read.",
      );
      return;
    }

    for (const item of unread) {
      const id = String(item.id ?? "");
      if (!id) {
        continue;
      }

      const response = await retryQuery(() =>
        supabaseQueries.notifications.markAsRead(id),
      );
      if (response.error) {
        Alert.alert(
          "Mark all failed",
          getErrorMessage(
            response.error,
            "Failed to mark notifications as read.",
          ),
        );
        return;
      }
    }

    void loadProfileData();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Animated.View entering={FadeInDown.duration(350)}>
        <GlassCard style={styles.profileHeader}>
          <View style={styles.profileTop}>
            <View>
              <ThemedText type="title" style={styles.profileName}>
                {String(
                  profile?.full_name ?? profile?.name ?? user?.email ?? "Student",
                )}
              </ThemedText>
              <ThemedText style={styles.profileEmail}>
                {user?.email}
              </ThemedText>
            </View>
            <LinearGradient
              colors={["#8b5cf6", "#d946ef"]}
              style={styles.profileAvatar}
            >
              <ThemedText style={styles.profileAvatarText}>
                {String(
                  profile?.full_name ?? profile?.name ?? user?.email ?? "S",
                )[0]?.toUpperCase()}
              </ThemedText>
            </LinearGradient>
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(350)}>
        <Pressable
          style={styles.reloadButton}
          onPress={() => void loadProfileData()}
        >
          <ThemedText style={styles.reloadButtonLabel}>
            ↻ Reload Profile
          </ThemedText>
        </Pressable>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(105).duration(350)}>
        <GlassCard style={styles.appearanceCard}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            🎨 Appearance
          </ThemedText>
          <View style={styles.themeRow}>
            <Pressable
              style={[
                styles.themeButton,
                themeMode === "system" ? styles.activeThemeButton : null,
              ]}
              onPress={() => void setThemeMode("system")}
            >
              <ThemedText style={styles.themeButtonLabel}>System</ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.themeButton,
                themeMode === "light" ? styles.activeThemeButton : null,
              ]}
              onPress={() => void setThemeMode("light")}
            >
              <ThemedText style={styles.themeButtonLabel}>Light</ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.themeButton,
                themeMode === "dark" ? styles.activeThemeButton : null,
              ]}
              onPress={() => void setThemeMode("dark")}
            >
              <ThemedText style={styles.themeButtonLabel}>Dark</ThemedText>
            </Pressable>
          </View>
        </GlassCard>
      </Animated.View>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading profile...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <GlassCard style={styles.errorCard}>
          <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        </GlassCard>
      ) : null}

      <Animated.View entering={FadeInDown.delay(150).duration(360)}>
        <LinearGradient
          colors={["#06b6d4", "#06d6d4"]}
          style={styles.rankCard}
        >
          <ThemedText style={styles.rankLabel}>Your Rank</ThemedText>
          <ThemedText style={styles.rankValue}>#{rank || 0}</ThemedText>
        </LinearGradient>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(195).duration(360)}>
        <GlassCard style={styles.topStudentsCard}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            🏆 Top Students
          </ThemedText>
          {topUsers.length === 0 ? (
            <ThemedText style={styles.emptyText}>No leaderboard data.</ThemedText>
          ) : (
            <View style={styles.studentList}>
              {topUsers.slice(0, 5).map((entry, index) => (
                <View key={`${String(entry.user_id ?? entry.id ?? index)}-${index}`} style={styles.studentRow}>
                  <ThemedText style={styles.studentRank}>
                    {index + 1}.
                  </ThemedText>
                  <ThemedText style={styles.studentName}>
                    {String(
                      entry.name ?? entry.full_name ?? entry.email ?? "Student"
                    )}
                  </ThemedText>
                  <ThemedText style={styles.studentPoints}>
                    {toNumber(entry, ["eco_points", "points", "total_points"])}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(240).duration(360)}>
        <GlassCard style={styles.notificationsCard}>
          <View style={styles.notificationHeader}>
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              🔔 Notifications
            </ThemedText>
            <View style={styles.unreadBadge}>
              <ThemedText style={styles.unreadBadgeText}>
                {unreadNotifications}
              </ThemedText>
            </View>
          </View>
          <Pressable
            style={styles.markAllButton}
            onPress={() => void markAllRead()}
          >
            <ThemedText style={styles.markAllButtonLabel}>
              Mark All Read
            </ThemedText>
          </Pressable>
          {notifications.length === 0 ? (
            <ThemedText style={styles.emptyText}>No notifications.</ThemedText>
          ) : (
            <View style={styles.notificationsList}>
              {notifications.slice(0, 5).map((item, index) => {
                const id = String(item.id ?? index);
                const isRead = Boolean(item.is_read);
                return (
                  <View
                    key={`${id}-${index}`}
                    style={[
                      styles.notificationItem,
                      isRead ? styles.notificationRead : styles.notificationUnread,
                    ]}
                  >
                    <View style={styles.notificationContent}>
                      <ThemedText style={styles.notificationTitle}>
                        {String(item.title ?? "Notification")}
                      </ThemedText>
                      <ThemedText style={styles.notificationBody}>
                        {String(item.body ?? "")}
                      </ThemedText>
                    </View>
                    {!isRead ? (
                      <Pressable onPress={() => void markRead(id)}>
                        <ThemedText style={styles.markReadAction}>
                          Mark
                        </ThemedText>
                      </Pressable>
                    ) : (
                      <ThemedText style={styles.readIndicator}>✓</ThemedText>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(285).duration(360)}>
        <GlassCard style={styles.badgesCard}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            🏅 Badges
          </ThemedText>
          <ThemedText style={styles.badgeCount}>
            {badges.length} badge template{badges.length !== 1 ? "s" : ""} available
          </ThemedText>
          <Pressable
            style={styles.primaryButton}
            onPress={() => void awardFirstBadge()}
          >
            <LinearGradient
              colors={["#f59e0b", "#fbbf24"]}
              style={styles.primaryButtonGradient}
            >
              <ThemedText style={styles.primaryButtonLabel}>
                🎁 Award First Badge
              </ThemedText>
            </LinearGradient>
          </Pressable>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(330).duration(360)}>
        <Pressable onPress={() => void signOut()} style={styles.logoutButton}>
          <LinearGradient
            colors={["#ef4444", "#f87171"]}
            style={styles.logoutGradient}
          >
            <ThemedText style={styles.logoutLabel}>🚪 Logout</ThemedText>
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
  profileHeader: {
    gap: 0,
  },
  profileTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
  },
  profileName: {
    fontSize: 24,
    fontWeight: "700",
  },
  profileEmail: {
    fontSize: 13,
    opacity: 0.7,
    marginTop: 4,
  },
  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#ffffff",
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
  appearanceCard: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  themeRow: {
    flexDirection: "row",
    gap: 8,
  },
  themeButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(107, 114, 128, 0.1)",
    borderWidth: 1,
    borderColor: "transparent",
  },
  activeThemeButton: {
    borderWidth: 1,
    borderColor: "#22C55E",
    backgroundColor: "rgba(34, 197, 94, 0.15)",
  },
  themeButtonLabel: {
    fontWeight: "600",
    fontSize: 13,
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
  topStudentsCard: {
    gap: 12,
  },
  studentList: {
    gap: 8,
  },
  studentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(106, 17, 203, 0.03)",
    gap: 12,
  },
  studentRank: {
    fontWeight: "700",
    minWidth: 30,
  },
  studentName: {
    flex: 1,
    fontWeight: "500",
  },
  studentPoints: {
    fontWeight: "700",
    color: "#a855f7",
  },
  emptyText: {
    opacity: 0.6,
  },
  notificationsCard: {
    gap: 12,
  },
  notificationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  unreadBadge: {
    backgroundColor: "#ef4444",
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadBadgeText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12,
  },
  markAllButton: {
    minHeight: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(59, 130, 246, 0.12)",
  },
  markAllButtonLabel: {
    color: "#3b82f6",
    fontWeight: "600",
    fontSize: 12,
  },
  notificationsList: {
    gap: 10,
  },
  notificationItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(156, 163, 175, 0.2)",
  },
  notificationRead: {
    backgroundColor: "rgba(16, 185, 129, 0.03)",
    borderColor: "rgba(16, 185, 129, 0.1)",
  },
  notificationUnread: {
    backgroundColor: "rgba(239, 68, 68, 0.03)",
    borderColor: "rgba(239, 68, 68, 0.1)",
  },
  notificationContent: {
    flex: 1,
    gap: 4,
  },
  notificationTitle: {
    fontWeight: "600",
    fontSize: 13,
  },
  notificationBody: {
    fontSize: 12,
    opacity: 0.7,
  },
  markReadAction: {
    color: "#3b82f6",
    fontWeight: "600",
    fontSize: 12,
  },
  readIndicator: {
    color: "#10b981",
    fontWeight: "700",
  },
  badgesCard: {
    gap: 12,
  },
  badgeCount: {
    fontSize: 13,
    opacity: 0.7,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    overflow: "hidden",
  },
  primaryButtonGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  logoutButton: {
    minHeight: 50,
    borderRadius: 12,
    overflow: "hidden",
  },
  logoutGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutLabel: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
});
