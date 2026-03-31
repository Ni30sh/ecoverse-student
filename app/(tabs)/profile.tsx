import { useFocusEffect } from "@react-navigation/native";
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
      <ThemedText type="title">Profile</ThemedText>
      <ThemedText>
        {String(
          profile?.full_name ?? profile?.name ?? user?.email ?? "Student",
        )}
      </ThemedText>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void loadProfileData()}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          Reload Profile Data
        </ThemedText>
      </Pressable>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Appearance</ThemedText>
        <ThemedText>Theme mode: {themeMode}</ThemedText>
        <ThemedView style={styles.themeRow}>
          <Pressable
            style={[
              styles.smallButton,
              themeMode === "system" ? styles.activeThemeButton : null,
            ]}
            onPress={() => void setThemeMode("system")}
          >
            <ThemedText style={styles.smallButtonLabel}>System</ThemedText>
          </Pressable>
          <Pressable
            style={[
              styles.smallButton,
              themeMode === "light" ? styles.activeThemeButton : null,
            ]}
            onPress={() => void setThemeMode("light")}
          >
            <ThemedText style={styles.smallButtonLabel}>Light</ThemedText>
          </Pressable>
          <Pressable
            style={[
              styles.smallButton,
              themeMode === "dark" ? styles.activeThemeButton : null,
            ]}
            onPress={() => void setThemeMode("dark")}
          >
            <ThemedText style={styles.smallButtonLabel}>Dark</ThemedText>
          </Pressable>
        </ThemedView>
      </ThemedView>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading profile...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
      ) : null}

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Leaderboard Rank</ThemedText>
        <ThemedText type="title">#{rank || 0}</ThemedText>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Top 10 Students</ThemedText>
        {topUsers.length === 0 ? (
          <ThemedText>No leaderboard data.</ThemedText>
        ) : null}
        {topUsers.slice(0, 5).map((entry, index) => (
          <ThemedText
            key={`${String(entry.user_id ?? entry.id ?? index)}-${index}`}
          >
            {index + 1}.{" "}
            {String(entry.name ?? entry.full_name ?? entry.email ?? "Student")}{" "}
            - {toNumber(entry, ["eco_points", "points", "total_points"])}
          </ThemedText>
        ))}
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Notifications</ThemedText>
        <ThemedText>Unread: {unreadNotifications}</ThemedText>
        <Pressable
          style={styles.smallButton}
          onPress={() => void markAllRead()}
        >
          <ThemedText style={styles.smallButtonLabel}>Mark All Read</ThemedText>
        </Pressable>
        {notifications.length === 0 ? (
          <ThemedText>No notifications.</ThemedText>
        ) : null}
        {notifications.slice(0, 5).map((item, index) => {
          const id = String(item.id ?? index);
          const isRead = Boolean(item.is_read);
          return (
            <ThemedView key={`${id}-${index}`} style={styles.notificationRow}>
              <ThemedText>
                {String(item.title ?? "Notification")}:{" "}
                {String(item.body ?? "")}
              </ThemedText>
              {!isRead ? (
                <Pressable
                  style={styles.smallButton}
                  onPress={() => void markRead(id)}
                >
                  <ThemedText style={styles.smallButtonLabel}>
                    Mark Read
                  </ThemedText>
                </Pressable>
              ) : (
                <ThemedText>Read</ThemedText>
              )}
            </ThemedView>
          );
        })}
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Badges</ThemedText>
        <ThemedText>Total badge templates: {badges.length}</ThemedText>
        <Pressable
          style={styles.primaryButton}
          onPress={() => void awardFirstBadge()}
        >
          <ThemedText style={styles.primaryButtonLabel}>
            Award First Badge
          </ThemedText>
        </Pressable>
      </ThemedView>

      <Pressable onPress={() => void signOut()} style={styles.logoutButton}>
        <ThemedText style={styles.primaryButtonLabel}>Logout</ThemedText>
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
  notificationRow: {
    borderWidth: 1,
    borderColor: "rgba(10,126,164,0.18)",
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a7ea4",
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
  logoutButton: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a7ea4",
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
  },
  smallButton: {
    minHeight: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,126,164,0.12)",
  },
  smallButtonLabel: {
    color: "#0a7ea4",
    fontWeight: "700",
    fontSize: 12,
  },
  themeRow: {
    flexDirection: "row",
    gap: 8,
  },
  activeThemeButton: {
    borderWidth: 1,
    borderColor: "#22C55E",
    backgroundColor: "rgba(34,197,94,0.15)",
  },
  errorText: {
    color: "#b00020",
  },
});
