import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  const [showQuiz, setShowQuiz] = useState(false);
  const router = useRouter();
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizPassed, setQuizPassed] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [awardResult, setAwardResult] = useState<string | null>(null);

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

  // Helper to fetch/generate quiz questions (AI or fallback)
  const fetchQuizQuestions = async (lesson: GenericRecord) => {
    // Try AI-generated quiz first
    try {
      const response = await fetch("/api/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonContent: lesson.content || lesson.description || "",
        }),
      });
      const { questions } = await response.json();
      if (Array.isArray(questions) && questions.length >= 5) {
        return questions.slice(0, 10);
      }
    } catch (e) {
      // fallback below
    }
    // Fallback quiz generator from supabase-queries
    const topic = String(lesson.topic ?? lesson.topic_id ?? "General");
    let fallback: any[] = [];
    try {
      const mod = await import("@/lib/supabase/supabase-queries");
      fallback = mod.buildFallbackQuizQuestions(topic);
    } catch {
      fallback = [];
    }
    let questions: any[] = [];
    while (questions.length < 10) {
      questions = questions.concat(fallback);
    }
    return questions.slice(0, 10);
  };

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

    // Navigate to quiz tab after marking complete
    if (lesson) {
      router.push({ pathname: "/quiz/[lessonId]", params: { lessonId } });
    }
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
            Topic: {String(lesson.topic ?? lesson.topic_id ?? "general")}
          </ThemedText>
          <ThemedText>
            {String(
              lesson.description ?? lesson.content ?? "No lesson content.",
            )}
          </ThemedText>
        </ThemedView>
      ) : null}

      {!showQuiz && (
        <>
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
            onPress={() => {
              if (!lesson?.completed) {
                void completeLesson();
                // Mark as completed in local state for UI
                setLesson({ ...lesson, completed: true });
              } else {
                router.push({
                  pathname: "/quiz/[lessonId]",
                  params: { lessonId },
                });
              }
            }}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText style={styles.primaryButtonLabel}>
                {lesson?.completed ? "Start Quiz" : "Mark Complete"}
              </ThemedText>
            )}
          </Pressable>
        </>
      )}

      {showQuiz && (
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">Quiz</ThemedText>
          {quizQuestions.map((q, idx) => (
            <ThemedView key={q.id + "-" + idx} style={{ marginBottom: 12 }}>
              <ThemedText>
                {idx + 1}. {q.question}
              </ThemedText>
              {q.options.map((opt: string, oidx: number) => (
                <Pressable
                  key={oidx}
                  style={[
                    styles.secondaryButton,
                    quizAnswers[idx] === oidx && {
                      borderColor: "#0a7ea4",
                      borderWidth: 2,
                    },
                  ]}
                  disabled={quizSubmitted}
                  onPress={() => {
                    if (quizSubmitted) return;
                    const next = [...quizAnswers];
                    next[idx] = oidx;
                    setQuizAnswers(next);
                  }}
                >
                  <ThemedText style={styles.secondaryButtonLabel}>
                    {opt}
                  </ThemedText>
                </Pressable>
              ))}
              {quizSubmitted && quizAnswers[idx] === q.correctAnswer && (
                <ThemedText style={{ color: "green" }}>Correct</ThemedText>
              )}
              {quizSubmitted &&
                quizAnswers[idx] !== q.correctAnswer &&
                quizAnswers[idx] !== -1 && (
                  <>
                    <ThemedText style={{ color: "red" }}>Incorrect</ThemedText>
                    <ThemedText style={{ color: "#0a7ea4", marginLeft: 8 }}>
                      Correct: {q.options[q.correctAnswer]}
                    </ThemedText>
                  </>
                )}
            </ThemedView>
          ))}
          {!quizSubmitted && (
            <Pressable
              style={styles.primaryButton}
              onPress={async () => {
                // Calculate score
                let score = 0;
                quizQuestions.forEach((q, idx) => {
                  if (quizAnswers[idx] === q.correctAnswer) score += 1;
                });
                setQuizScore(score);
                setQuizSubmitted(true);
                // Passing criteria: 7/10
                if (score >= 7) {
                  setQuizPassed(true);
                  setAwarding(true);
                  // Award eco points (e.g., 50)
                  if (user) {
                    await import("@/lib/supabase/supabase-queries").then(
                      async (mod) => {
                        await mod.incrementEcoPoints(user.id, 50);
                      },
                    );
                  }
                  // Award badge (e.g., Quick Learner)
                  // Find badge id for "Quick Learner"
                  let badgeId = null;
                  const { data: badgeRows } = await supabase
                    .from("badges")
                    .select("id,name")
                    .eq("name", "Quick Learner")
                    .maybeSingle();
                  if (badgeRows && badgeRows.id) badgeId = badgeRows.id;
                  if (badgeId && user) {
                    await supabase.from("student_badges").insert({
                      user_id: user.id,
                      badge_id: badgeId,
                      awarded_at: new Date().toISOString(),
                    });
                    setAwardResult(
                      'You passed! 50 eco points and "Quick Learner" badge awarded.',
                    );
                  } else {
                    setAwardResult("You passed! 50 eco points awarded.");
                  }
                  setAwarding(false);
                } else {
                  setQuizPassed(false);
                  setAwardResult("You did not pass. Try again!");
                }
              }}
            >
              <ThemedText style={styles.primaryButtonLabel}>
                Submit Quiz
              </ThemedText>
            </Pressable>
          )}
          {quizSubmitted && (
            <ThemedText
              style={{ color: quizPassed ? "green" : "red", marginTop: 12 }}
            >
              {awardResult ||
                (quizPassed ? "You passed!" : "You did not pass.")}
            </ThemedText>
          )}
          {awardResult && quizPassed && (
            <ThemedText style={{ color: "#0a7ea4", marginTop: 8 }}>
              🎉 Congratulations!
            </ThemedText>
          )}
        </ThemedView>
      )}
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
