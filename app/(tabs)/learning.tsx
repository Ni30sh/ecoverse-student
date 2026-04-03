import { useFocusEffect } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
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
import { useLearningTopics } from "@/lib/hooks/use-learning-hub-data";
import { invalidateStudentCache } from "@/lib/query/invalidate-student-cache";
import { supabase } from "@/lib/supabase/client";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";

type LessonRecord = Record<string, unknown>;
type TopicOption = { id: string; title: string };

function lessonId(lesson: LessonRecord) {
  return String(lesson.id ?? "");
}

function lessonTitle(lesson: LessonRecord) {
  return String(lesson.title ?? lesson.name ?? "Untitled Lesson");
}

function lessonTopicId(lesson: LessonRecord) {
  return String(lesson.topic_id ?? "").trim();
}

function lessonTopicSlug(lesson: LessonRecord) {
  return String(lesson.topic ?? lesson.category ?? "").trim();
}

function normalizeTopicLabel(topicKey: string) {
  const slug = String(topicKey ?? "").trim().toLowerCase();
  if (!slug) {
    return "Uncategorized";
  }

  const preset: Record<string, string> = {
    biodiversity: "Biodiversity",
    climate_change: "Climate Change",
    energy: "Renewable Energy",
    pollution: "Pollution & Waste",
    waste: "Waste Management",
    water: "Water Conservation",
  };

  if (preset[slug]) {
    return preset[slug];
  }

  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function topicKeyForLesson(lesson: LessonRecord) {
  const slug = lessonTopicSlug(lesson);
  if (slug) {
    return `slug:${slug}`;
  }

  const topicId = lessonTopicId(lesson);
  if (topicId) {
    return `id:${topicId}`;
  }

  return "uncategorized";
}

export default function LearningScreen() {
  const { user } = useAuth();
  const { topics: learningTopics } = useLearningTopics();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [allLessons, setAllLessons] = useState<LessonRecord[]>([]);
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [topicFilter, setTopicFilter] = useState("all");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyLessonId, setBusyLessonId] = useState("");

  const loadLessons = useCallback(async () => {
    setErrorMessage("");
    const response = await retryQuery(() => supabaseQueries.lessons.getAll(), {
      operationName: "learning_lessons_getAll",
      context: { screen: "learning" },
    });

    if (response.error) {
      setErrorMessage(
        getErrorMessage(response.error, "Failed to load lessons."),
      );
      setAllLessons([]);
      setLessons([]);
      setLoading(false);
      return;
    }

    const fetchedLessons = (response.data ?? []) as LessonRecord[];
    setAllLessons(fetchedLessons);

    const filteredLessons =
      topicFilter === "all"
        ? fetchedLessons
        : fetchedLessons.filter(
            (lesson) => topicKeyForLesson(lesson) === topicFilter,
          );

    setLessons(filteredLessons);
    setLoading(false);
  }, [topicFilter]);

  useEffect(() => {
    if (topicFilter === "all") {
      setLessons(allLessons);
      return;
    }

    setLessons(allLessons.filter((lesson) => topicKeyForLesson(lesson) === topicFilter));
  }, [allLessons, topicFilter]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void loadLessons();
    }, [loadLessons]),
  );

  const topicOptions = useMemo<TopicOption[]>(() => {
    const seen = new Set<string>();

    const fromLessonSlugs = (allLessons ?? [])
      .map((lesson) => {
        const key = topicKeyForLesson(lesson);
        if (key === "uncategorized" || seen.has(key)) {
          return null;
        }
        seen.add(key);

        if (key.startsWith("slug:")) {
          return {
            id: key,
            title: normalizeTopicLabel(key.slice(5)),
          };
        }

        return null;
      })
      .filter((topic): topic is TopicOption => Boolean(topic));

    const fromDb = (learningTopics ?? [])
      .map((topic) => {
        const id = String(topic.id ?? "").trim();
        const title = String(topic.title ?? "").trim();
        if (!id || !title) {
          return null;
        }
        const key = `id:${id}`;
        if (seen.has(key)) {
          return null;
        }
        seen.add(key);
        return { id: key, title };
      })
      .filter((topic): topic is TopicOption => Boolean(topic));

    return [{ id: "all", title: "all" }, ...fromLessonSlugs, ...fromDb];
  }, [allLessons, learningTopics]);

  const topicTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const topic of learningTopics ?? []) {
      const id = String(topic.id ?? "").trim();
      const title = String(topic.title ?? "").trim();
      if (id && title) {
        map.set(id, title);
      }
    }
    return map;
  }, [learningTopics]);

  const completeLesson = async (lesson: LessonRecord) => {
    if (!user) {
      return;
    }

    const authUser = (await supabase.auth.getUser()).data.user;
    const authUserId = String(authUser?.id ?? "").trim();
    if (!authUserId) {
      Alert.alert(
        "Completion failed",
        "Authentication expired. Please sign in again.",
      );
      return;
    }

    const selectedLessonId = lessonId(lesson);
    if (!selectedLessonId) {
      Alert.alert("Cannot complete lesson", "Lesson id is missing.");
      return;
    }

    setBusyLessonId(selectedLessonId);

    const completionResponse = await retryQuery(
      () =>
        supabaseQueries.lessonCompletions.markComplete(
          authUserId,
          selectedLessonId,
        ),
      {
        operationName: "learning_lessonCompletions_markComplete",
        context: {
          screen: "learning",
          lessonId: selectedLessonId,
          userId: authUserId,
        },
      },
    );

    if (completionResponse.error) {
      Alert.alert(
        "Completion failed",
        getErrorMessage(completionResponse.error, "Failed to complete lesson."),
      );
      setBusyLessonId("");
      return;
    }

    const quizPayload = {
      user_id: authUserId,
      lesson_id: selectedLessonId,
      score: 100,
      total: 100,
      is_perfect: true,
      created_at: new Date().toISOString(),
    };

    const quizResponse = await retryQuery(
      () => supabaseQueries.quizAttempts.create(quizPayload),
      {
        operationName: "learning_quizAttempts_create",
        context: { screen: "learning", lessonId: selectedLessonId },
      },
    );

    if (quizResponse.error) {
      Alert.alert(
        "Lesson completed",
        `Quiz save failed: ${getErrorMessage(quizResponse.error, "Unknown error")}`,
      );
    } else {
      Alert.alert("Success", "Lesson marked complete and quiz attempt saved.");
    }

    await invalidateStudentCache(queryClient, user.id);
    setBusyLessonId("");
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Learning</ThemedText>
      <ThemedText>
        Read lessons, complete them, and auto-save quiz attempts.
      </ThemedText>

      <ThemedView style={styles.topicRow}>
        {topicOptions.map((topic) => (
          <Pressable
            key={topic.id}
            onPress={() => {
              setTopicFilter(topic.id);
              setLoading(true);
            }}
            style={[
              styles.topicChip,
              topicFilter === topic.id ? styles.topicChipActive : null,
            ]}
          >
            <ThemedText
              style={
                topicFilter === topic.id
                  ? styles.topicChipLabelActive
                  : undefined
              }
            >
              {topic.title}
            </ThemedText>
          </Pressable>
        ))}
      </ThemedView>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void loadLessons()}
      >
        <ThemedText style={styles.secondaryButtonLabel}>
          Reload Lessons
        </ThemedText>
      </Pressable>

      {loading ? (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading lessons...</ThemedText>
        </ThemedView>
      ) : null}

      {errorMessage ? (
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
      ) : null}

      {!loading && lessons.length === 0 ? (
        <ThemedText>No lessons found.</ThemedText>
      ) : null}

      {lessons.map((lesson) => {
        const id = lessonId(lesson);
        const isBusy = busyLessonId === id;
        const topicKey = topicKeyForLesson(lesson);
        const topicLabel = topicKey.startsWith("slug:")
          ? normalizeTopicLabel(topicKey.slice(5))
          : topicTitleById.get(topicKey.replace(/^id:/, "")) ?? "Uncategorized";

        return (
          <ThemedView key={id || lessonTitle(lesson)} style={styles.card}>
            <ThemedText type="subtitle">{lessonTitle(lesson)}</ThemedText>
            <ThemedText>Topic: {topicLabel}</ThemedText>
            <ThemedText>
              {String(
                lesson.description ?? lesson.content ?? "No lesson text.",
              )}
            </ThemedText>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed ? styles.pressed : null,
              ]}
              onPress={() => {
                if (!id) {
                  return;
                }
                router.push({
                  pathname: "/lesson/[lessonId]",
                  params: { lessonId: id },
                });
              }}
            >
              <ThemedText style={styles.secondaryButtonLabel}>
                Open Lesson Detail
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed ? styles.pressed : null,
              ]}
              onPress={() => void completeLesson(lesson)}
              disabled={isBusy || !id}
            >
              {isBusy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText style={styles.primaryButtonLabel}>
                  Mark Complete + Save Quiz
                </ThemedText>
              )}
            </Pressable>
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
  topicRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  topicChip: {
    borderWidth: 1,
    borderColor: "rgba(10,126,164,0.4)",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  topicChipActive: {
    backgroundColor: "#0a7ea4",
    borderColor: "#0a7ea4",
  },
  topicChipLabelActive: {
    color: "#ffffff",
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
    marginTop: 8,
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
  pressed: {
    opacity: 0.86,
  },
  errorText: {
    color: "#b00020",
  },
});
