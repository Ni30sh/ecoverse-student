import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
} from "react-native";

export default function QuizScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [lesson, setLesson] = useState<any>(null);
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizPassed, setQuizPassed] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [awardResult, setAwardResult] = useState<string | null>(null);

  useEffect(() => {
    const loadLessonAndQuiz = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("lessons")
        .select("*")
        .eq("id", lessonId)
        .maybeSingle();
      if (error || !data) {
        setLesson(null);
        setLoading(false);
        return;
      }
      setLesson(data);
      // Fetch quiz questions (reuse logic from lesson detail)
      let questions: any[] = [];
      try {
        const response = await fetch("/api/generate-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lessonContent: data.content || data.description || "",
          }),
        });
        const json = await response.json();
        if (Array.isArray(json.questions) && json.questions.length >= 5) {
          questions = json.questions.slice(0, 10);
        }
      } catch {}
      if (!questions.length) {
        try {
          const mod = await import("@/lib/supabase/supabase-queries");
          questions = mod.buildFallbackQuizQuestions(
            String(data.topic ?? data.topic_id ?? "General"),
          );
        } catch {
          questions = [];
        }
      }
      setQuizQuestions(questions);
      setQuizAnswers(Array(questions.length).fill(-1));
      setLoading(false);
    };
    if (lessonId) loadLessonAndQuiz();
  }, [lessonId]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedText type="title">Quiz</ThemedText>
      {loading && (
        <ThemedView style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading quiz...</ThemedText>
        </ThemedView>
      )}
      {!loading && lesson && quizQuestions.length > 0 && (
        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">
            {String(lesson.title ?? lesson.name ?? "Lesson Quiz")}
          </ThemedText>
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
                let score = 0;
                quizQuestions.forEach((q, idx) => {
                  if (quizAnswers[idx] === q.correctAnswer) score += 1;
                });
                setQuizScore(score);
                setQuizSubmitted(true);
                if (score >= 7) {
                  setQuizPassed(true);
                  setAwarding(true);
                  if (user) {
                    await import("@/lib/supabase/supabase-queries").then(
                      async (mod) => {
                        await mod.incrementEcoPoints(user.id, 50);
                      },
                    );
                  }
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
    flexGrow: 1,
    padding: 16,
    backgroundColor: "#fff",
  },
  card: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 48,
  },
  primaryButton: {
    backgroundColor: "#0a7ea4",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 16,
  },
  primaryButtonLabel: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: "#e0e0e0",
    padding: 10,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 8,
  },
  secondaryButtonLabel: {
    color: "#333",
    fontSize: 15,
  },
  errorText: {
    color: "red",
    marginTop: 12,
    marginBottom: 8,
  },
});
