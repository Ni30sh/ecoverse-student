import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { GlassCard } from "@/components/ui/glass-card";
import { useLearningTopics } from "@/lib/hooks/use-learning-hub-data";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";

type LessonRecord = Record<string, unknown>;
type TopicOption = { id: string; title: string };

function lessonId(lesson: LessonRecord) {
  return String(lesson.id ?? "").trim();
}

function lessonTitle(lesson: LessonRecord) {
  return String(lesson.title ?? lesson.name ?? "Untitled Lesson").trim();
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
  const { topics: learningTopics } = useLearningTopics();
  const [loading, setLoading] = useState(true);
  const [allLessons, setAllLessons] = useState<LessonRecord[]>([]);
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [topicFilter, setTopicFilter] = useState("all");
  const [errorMessage, setErrorMessage] = useState("");

  const loadLessons = useCallback(async () => {
    setErrorMessage("");

    const response = await retryQuery(() => supabaseQueries.lessons.getAll(), {
      operationName: "learning_lessons_getAll",
      context: { screen: "learning" },
    });

    if (response.error) {
      setErrorMessage(getErrorMessage(response.error, "Failed to load lessons."));
      setAllLessons([]);
      setLessons([]);
      setLoading(false);
      return;
    }

    const fetchedLessons = (response.data ?? []) as LessonRecord[];
    setAllLessons(fetchedLessons);
    setLoading(false);
  }, []);

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

    return [{ id: "all", title: "All" }, ...fromLessonSlugs, ...fromDb];
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Animated.View entering={FadeInDown.duration(350)}>
        <GlassCard style={styles.headerCard}>
          <ThemedText type="title" style={styles.headerTitle}>
            Learning
          </ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            First open lesson, then read in detail page and mark complete.
          </ThemedText>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(350)}>
        <View style={styles.topicRow}>
          {topicOptions.map((topic) => (
            <Pressable
              key={topic.id}
              onPress={() => {
                setTopicFilter(topic.id);
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
                    : styles.topicChipLabel
                }
              >
                {topic.title}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(105).duration(350)}>
        <Pressable style={styles.reloadButton} onPress={() => void loadLessons()}>
          <ThemedText style={styles.reloadButtonLabel}>Reload Lessons</ThemedText>
        </Pressable>
      </Animated.View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading lessons...</ThemedText>
        </View>
      ) : null}

      {errorMessage ? (
        <GlassCard style={styles.errorCard}>
          <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        </GlassCard>
      ) : null}

      {!loading && lessons.length === 0 ? (
        <GlassCard>
          <ThemedText>No lessons found.</ThemedText>
        </GlassCard>
      ) : null}

      {lessons.map((lesson, lessonIndex) => {
        const id = lessonId(lesson);
        const topicKey = topicKeyForLesson(lesson);
        const topicLabel = topicKey.startsWith("slug:")
          ? normalizeTopicLabel(topicKey.slice(5))
          : topicTitleById.get(topicKey.replace(/^id:/, "")) ?? "Uncategorized";

        return (
          <Animated.View
            key={id || lessonTitle(lesson)}
            entering={FadeInDown.delay(150 + lessonIndex * 45).duration(350)}
          >
            <GlassCard style={styles.lessonCard}>
              <View style={styles.lessonHeader}>
                <ThemedText type="subtitle" style={styles.lessonTitle}>
                  {lessonTitle(lesson)}
                </ThemedText>
                <ThemedText style={styles.lessonTopic}>Topic: {topicLabel}</ThemedText>
              </View>

              <Pressable
                style={styles.openButton}
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
                <ThemedText style={styles.openButtonLabel}>Open Lesson Detail</ThemedText>
              </Pressable>
            </GlassCard>
          </Animated.View>
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
  topicRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  topicChip: {
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  topicChipActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  topicChipLabel: {
    fontWeight: "500",
    fontSize: 12,
  },
  topicChipLabelActive: {
    color: "#ffffff",
    fontWeight: "600",
  },
  reloadButton: {
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  reloadButtonLabel: {
    color: "#10b981",
    fontWeight: "600",
    fontSize: 13,
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
  lessonCard: {
    gap: 12,
  },
  lessonHeader: {
    gap: 6,
  },
  lessonTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  lessonTopic: {
    fontSize: 12,
    opacity: 0.7,
  },
  openButton: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3b82f6",
  },
  openButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 13,
  },
});
