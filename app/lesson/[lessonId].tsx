import { useQueryClient } from "@tanstack/react-query";
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
import { supabase } from "@/lib/supabase/client";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";

type GenericRecord = Record<string, unknown>;

export default function LessonDetailScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lesson, setLesson] = useState<GenericRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const loadLesson = useCallback(async () => {
    if (!lessonId) {
      setLoading(false);
      return;
    }

    setErrorMessage("");

    const response = await retryQuery(
      () => supabaseQueries.lessons.getById(lessonId),
      {
        operationName: "lessonDetail_lessons_getById",
        context: { lessonId },
      },
    );

    if (response.error) {
      setErrorMessage(
        getErrorMessage(response.error, "Failed to load lesson detail."),
      );
      setLoading(false);
      return;
    }

    setLesson((response.data ?? null) as GenericRecord | null);
    setLoading(false);
  }, [lessonId]);

  useEffect(() => {
    setLoading(true);
    void loadLesson();
  }, [loadLesson]);

  const completeLesson = async () => {
    if (!user || !lessonId) {
      return;
    }

    const authUser = (await supabase.auth.getUser()).data.user;
    const authUserId = String(authUser?.id ?? "").trim();
    if (!authUserId) {
      Alert.alert(
        "Complete failed",
        "Authentication expired. Please sign in again.",
      );
      return;
    }

    setBusy(true);

    const completeResponse = await retryQuery(
      () =>
        supabaseQueries.lessonCompletions.markComplete(authUserId, lessonId),
      {
        operationName: "lessonDetail_markComplete",
        context: { lessonId, userId: authUserId },
      },
    );

    if (completeResponse.error) {
      Alert.alert(
        "Complete failed",
        getErrorMessage(completeResponse.error, "Could not complete lesson."),
      );
      setBusy(false);
      return;
    }

    const quizResponse = await retryQuery(
      () =>
        supabaseQueries.quizAttempts.create({
          user_id: authUserId,
          lesson_id: lessonId,
          score: 100,
          total: 100,
          is_perfect: true,
          created_at: new Date().toISOString(),
        }),
      {
        operationName: "lessonDetail_quizAttempts_create",
        context: { lessonId, userId: user.id },
      },
    );

    if (quizResponse.error) {
      Alert.alert(
        "Lesson completed",
        `Quiz save failed: ${getErrorMessage(quizResponse.error, "Unknown error")}`,
      );
    } else {
      Alert.alert("Success", "Lesson completed and quiz attempt saved.");
    }

    await invalidateStudentCache(queryClient, user.id);
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Lesson Detail</ThemedText>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading lesson...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
      ) : null}

      {lesson ? (
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">
            {String(lesson.title ?? lesson.name ?? "Lesson")}
          </ThemedText>
          <ThemedText>
            Topic: {String(lesson.topic ?? lesson.category ?? "general")}
          </ThemedText>
          <ThemedText>
            {String(
              lesson.description ?? lesson.content ?? "No lesson content.",
            )}
          </ThemedText>
        </ThemedView>
      ) : null}

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void loadLesson()}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          Refresh Lesson
        </ThemedText>
      </Pressable>

      <Pressable
        style={styles.primaryButton}
        onPress={() => void completeLesson()}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <ThemedText style={styles.primaryButtonLabel}>
            Complete Lesson + Quiz
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
