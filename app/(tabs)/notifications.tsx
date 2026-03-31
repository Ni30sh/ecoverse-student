import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
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

type NotificationRecord = Record<string, unknown>;

export default function NotificationsScreen() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [busyId, setBusyId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const unreadCount = useMemo(
    () => items.filter((entry) => !Boolean(entry.is_read)).length,
    [items],
  );

  const loadNotifications = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setErrorMessage("");

    const response = await retryQuery(
      () => supabaseQueries.notifications.getUserNotifications(user.id),
      {
        operationName: "notifications_getUserNotifications",
        context: { screen: "notifications" },
      },
    );

    if (response.error) {
      setErrorMessage(
        getErrorMessage(response.error, "Failed to load notifications."),
      );
      setLoading(false);
      return;
    }

    setItems((response.data ?? []) as NotificationRecord[]);
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void loadNotifications();
    }, [loadNotifications]),
  );

  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribe = supabaseQueries.realtime.subscribeNotifications(
      user.id,
      () => {
        void loadNotifications();
      },
    );

    return () => {
      void unsubscribe();
    };
  }, [loadNotifications, user]);

  const markRead = async (notificationId: string) => {
    if (!user || !notificationId) {
      return;
    }

    setBusyId(notificationId);
    const response = await retryQuery(
      () => supabaseQueries.notifications.markAsRead(notificationId),
      {
        operationName: "notifications_markAsRead",
        context: { screen: "notifications", notificationId },
      },
    );

    if (response.error) {
      Alert.alert(
        "Mark read failed",
        getErrorMessage(response.error, "Could not mark notification as read."),
      );
      setBusyId("");
      return;
    }

    await invalidateStudentCache(queryClient, user.id);
    await loadNotifications();
    setBusyId("");
  };

  const markAllRead = async () => {
    if (!user) {
      return;
    }

    const unread = items.filter((entry) => !Boolean(entry.is_read));
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

      const response = await retryQuery(
        () => supabaseQueries.notifications.markAsRead(id),
        {
          operationName: "notifications_markAllRead",
          context: { screen: "notifications", notificationId: id },
        },
      );

      if (response.error) {
        Alert.alert(
          "Mark all failed",
          getErrorMessage(response.error, "Could not mark all notifications."),
        );
        return;
      }
    }

    await invalidateStudentCache(queryClient, user.id);
    await loadNotifications();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Notifications</ThemedText>
      <ThemedText>Unread: {unreadCount}</ThemedText>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void loadNotifications()}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          Refresh Notifications
        </ThemedText>
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void markAllRead()}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          Mark All Read
        </ThemedText>
      </Pressable>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading notifications...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
      ) : null}

      {!loading && items.length === 0 ? (
        <ThemedText>No notifications yet.</ThemedText>
      ) : null}

      {items.map((item, index) => {
        const id = String(item.id ?? index);
        const isRead = Boolean(item.is_read);
        const busy = busyId === id;

        return (
          <ThemedView key={`${id}-${index}`} style={styles.card}>
            <ThemedText type="defaultSemiBold">
              {String(item.title ?? "Notification")}
            </ThemedText>
            <ThemedText>{String(item.body ?? "")}</ThemedText>
            <ThemedText style={styles.metaText}>
              Type: {String(item.type ?? "general")}
            </ThemedText>
            <ThemedText style={styles.metaText}>
              Time: {String(item.created_at ?? item.updated_at ?? "N/A")}
            </ThemedText>
            {!isRead ? (
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed ? styles.pressed : null,
                ]}
                onPress={() => void markRead(id)}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.primaryButtonLabel}>
                    Mark Read
                  </ThemedText>
                )}
              </Pressable>
            ) : (
              <ThemedText style={styles.readLabel}>Read</ThemedText>
            )}
          </ThemedView>
        );
      })}
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
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a7ea4",
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,126,164,0.12)",
  },
  secondaryButtonLabel: {
    color: "#0a7ea4",
    fontWeight: "700",
  },
  readLabel: {
    color: "#2e7d32",
    fontWeight: "700",
  },
  metaText: {
    fontSize: 12,
    opacity: 0.8,
  },
  pressed: {
    opacity: 0.86,
  },
  errorText: {
    color: "#b00020",
  },
});
