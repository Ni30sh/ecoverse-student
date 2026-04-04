import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { GlassCard } from "@/components/ui/glass-card";
import { invalidateStudentCache } from "@/lib/query/invalidate-student-cache";
import { supabase } from "@/lib/supabase/client";
import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { getErrorMessage, retryQuery } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";

type GenericRecord = Record<string, unknown>;
type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
};

function asText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  return fallback;
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeQuizQuestions(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as GenericRecord;
      const question = asText(record.question, "");
      const optionsRaw = Array.isArray(record.options) ? record.options : [];
      const options = optionsRaw
        .map((opt) => asText(opt, ""))
        .filter((opt) => opt.length > 0);
      const correctAnswer = Math.max(
        0,
        Math.min(options.length - 1, Math.trunc(toNumber(record.correctAnswer, 0))),
      );

      if (!question || options.length < 2) {
        return null;
      }

      return {
        id: asText(record.id, `q-${index + 1}`),
        question,
        options,
        correctAnswer,
        explanation: asText(record.explanation, ""),
      };
    })
    .filter((q): q is QuizQuestion => Boolean(q));
}

export default function LessonDetailScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lesson, setLesson] = useState<GenericRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [showCelebration, setShowCelebration] = useState(false);
  const [rewardPoints, setRewardPoints] = useState(0);
  const [awardedBadges, setAwardedBadges] = useState<string[]>([]);

  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [showQuiz, setShowQuiz] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [lessonMarkedComplete, setLessonMarkedComplete] = useState(false);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizPassed, setQuizPassed] = useState<boolean | null>(null);

  const lessonTitle = useMemo(
    () => asText(lesson?.title ?? lesson?.name, "Lesson"),
    [lesson],
  );
  const lessonTopic = useMemo(
    () => asText(lesson?.topic ?? lesson?.category, "general"),
    [lesson],
  );
  const lessonTopicId = useMemo(() => asText(lesson?.topic_id), [lesson]);
  const lessonBody = useMemo(() => {
    return asText(
      lesson?.body ?? lesson?.description ?? lesson?.content,
      "No lesson content available.",
    );
  }, [lesson]);

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

  const markLessonComplete = async () => {
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

    const completionResponse = await retryQuery(
      () =>
        supabaseQueries.lessonCompletions.markComplete(authUserId, lessonId, {
          skipReward: true,
        }),
      {
        operationName: "lessonDetail_markComplete_withoutReward",
        context: { lessonId, userId: authUserId },
      },
    );

    if (completionResponse.error) {
      Alert.alert(
        "Complete failed",
        getErrorMessage(completionResponse.error, "Could not mark lesson complete."),
      );
      setBusy(false);
      return;
    }

    setLessonMarkedComplete(true);
    setBusy(false);
    Alert.alert("Lesson Completed", "Now start AI quiz to earn points.");
  };

  const startQuizFlow = async () => {
    if (!user || !lessonId) {
      return;
    }

    setBusy(true);

    const aiQuiz = await retryQuery(
      () =>
        supabaseQueries.quizAttempts.generateQuiz({
          topic: lessonTopic,
          topicTitle: lessonTopic,
          lessonTitle,
          lessonBody,
        }),
      {
        operationName: "lessonDetail_generateQuiz_forLesson",
        context: { lessonId, topic: lessonTopic },
      },
    );

    if (aiQuiz.error) {
      Alert.alert(
        "Quiz generation failed",
        getErrorMessage(aiQuiz.error, "Could not generate quiz for this lesson."),
      );
      setBusy(false);
      return;
    }

    const normalized = normalizeQuizQuestions(aiQuiz.data?.questions ?? []);
    if (normalized.length === 0) {
      Alert.alert("No quiz", "No quiz questions available for this lesson yet.");
      setBusy(false);
      return;
    }

    setQuizQuestions(normalized);
    setSelectedAnswers({});
    setShowQuiz(true);
    setBusy(false);
  };

  const submitQuizForRewards = async () => {
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

    const unanswered = quizQuestions.some((_, index) => selectedAnswers[index] === undefined);
    if (unanswered) {
      Alert.alert("Quiz pending", "Please answer all quiz questions before submit.");
      return;
    }

    setBusy(true);

    const totalQuestions = quizQuestions.length;
    const score = quizQuestions.reduce((acc, question, index) => {
      return acc + (selectedAnswers[index] === question.correctAnswer ? 1 : 0);
    }, 0);
    const passedHalf = score > totalQuestions / 2;
    const passedMinimumThree = score >= 3;
    const passedQuiz = passedHalf && passedMinimumThree;
    const quizPoints = passedQuiz
      ? Math.max(10, Math.round((score / Math.max(1, totalQuestions)) * 20))
      : 0;

    const quizAttempt = await retryQuery(
      () =>
        supabaseQueries.quizAttempts.create({
          user_id: authUserId,
          lesson_id: lessonId,
          topic_id: lessonTopicId || undefined,
          score,
          total_questions: totalQuestions,
          points_earned: quizPoints,
          generated_questions: quizQuestions,
          created_at: new Date().toISOString(),
        }),
      {
        operationName: "lessonDetail_quizAttempts_create_afterQuiz",
        context: { lessonId, userId: authUserId },
      },
    );

    if (quizAttempt.error) {
      Alert.alert(
        "Quiz save failed",
        getErrorMessage(quizAttempt.error, "Could not save quiz attempt."),
      );
      setBusy(false);
      return;
    }

    let bonusPoints = 0;
    const newBadges: string[] = [];

    if (passedQuiz && lessonTopicId) {
      const [allLessonsRes, completionsRes] = await Promise.all([
        retryQuery(() => supabaseQueries.lessons.getAll(), {
          operationName: "lessonDetail_allLessons_getAll",
          context: { topicId: lessonTopicId },
        }),
        retryQuery(() => supabaseQueries.lessonCompletions.getUserCompletions(authUserId), {
          operationName: "lessonDetail_userCompletions_getUserCompletions",
          context: { userId: authUserId },
        }),
      ]);

      const allLessons = (allLessonsRes.data ?? []) as GenericRecord[];
      const userCompletions = (completionsRes.data ?? []) as GenericRecord[];

      const topicLessons = allLessons.filter(
        (item) => String(item.topic_id ?? "").trim() === lessonTopicId,
      );

      const completionSet = new Set(
        userCompletions
          .map((entry) => String(entry.lesson_id ?? "").trim())
          .filter(Boolean),
      );

      const allTopicCompleted =
        topicLessons.length > 0 &&
        topicLessons.every((item) => completionSet.has(String(item.id ?? "").trim()));

      if (allTopicCompleted) {
        bonusPoints = 30;

        const badgesRes = await retryQuery(() => supabaseQueries.badges.getAll(), {
          operationName: "lessonDetail_badges_getAll",
          context: { userId: authUserId },
        });

        if (!badgesRes.error && (badgesRes.data ?? []).length > 0) {
          const syncRes = await retryQuery(
            () => supabaseQueries.badges.syncUnlockedBadges(authUserId),
            {
              operationName: "lessonDetail_syncUnlockedBadges",
              context: { userId: authUserId },
            },
          );

          if (!syncRes.error) {
            const syncData = (syncRes.data ?? {}) as GenericRecord;
            const awarded = (syncData.awardedBadges ?? []) as GenericRecord[];
            const awardedNames = awarded
              .map((badge) => asText(badge.name, "Topic Master"))
              .filter((name) => name.length > 0);

            newBadges.push(...awardedNames);
          }
        }
      }
    }

    const totalReward = quizPoints + bonusPoints;

    setRewardPoints(totalReward);
    setAwardedBadges(newBadges);
    setQuizSubmitted(true);
    setQuizPassed(passedQuiz);
    setShowQuiz(false);
    if (totalReward > 0) {
      setShowCelebration(true);
    }

    setTimeout(() => {
      setShowCelebration(false);
    }, 3000);

    await invalidateStudentCache(queryClient, user.id);
    setBusy(false);

    if (passedQuiz) {
      const badgeMsg = newBadges.length > 0 ? `\nBadge: ${newBadges.join(", ")}` : "";
      Alert.alert(
        "Quiz Passed",
        `Quiz submitted (${score}/${totalQuestions}). +${totalReward} Eco Points earned.${badgeMsg}`,
      );
    } else {
      Alert.alert(
        "Quiz Submitted",
        `Score: ${score}/${totalQuestions}. Points not awarded because you need more than half correct and at least 3 correct answers.`,
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {showCelebration ? (
        <Animated.View
          entering={FadeInDown.duration(180)}
          exiting={FadeOutUp.duration(200)}
          style={styles.celebrationWrap}
        >
          <ThemedText style={styles.celebrationText}>
            Level Up! +{rewardPoints} Eco Points
          </ThemedText>
        </Animated.View>
      ) : null}

      <Animated.View entering={FadeInDown.duration(320)}>
        <GlassCard>
          <ThemedText type="title">{lessonTitle}</ThemedText>
          <ThemedText style={styles.topicText}>Topic: {lessonTopic}</ThemedText>
          {lessonMarkedComplete ? (
            <ThemedText style={styles.completedText}>Status: Completed</ThemedText>
          ) : null}
          {quizSubmitted ? (
            <ThemedText
              style={quizPassed ? styles.quizPassText : styles.quizFailText}
            >
              {quizPassed
                ? "Quiz Result: Passed (Rewards unlocked)"
                : "Quiz Result: Submitted (No rewards this time)"}
            </ThemedText>
          ) : null}
        </GlassCard>
      </Animated.View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <ThemedText>Loading lesson...</ThemedText>
        </View>
      ) : null}

      {errorMessage ? (
        <GlassCard style={styles.errorCard}>
          <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        </GlassCard>
      ) : null}

      {lesson ? (
        <Animated.View entering={FadeInDown.delay(70).duration(330)}>
          <GlassCard style={styles.contentCard}>
            <ThemedText type="subtitle">Read Lesson</ThemedText>
            <ThemedText style={styles.bodyText}>{lessonBody}</ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {showQuiz ? (
        <Animated.View entering={FadeInDown.delay(110).duration(330)}>
          <GlassCard style={styles.quizCard}>
            <ThemedText type="subtitle">AI Generated Quiz</ThemedText>
            {quizQuestions.map((question, questionIndex) => (
              <View key={question.id} style={styles.questionBlock}>
                <ThemedText style={styles.questionText}>
                  {questionIndex + 1}. {question.question}
                </ThemedText>
                {question.options.map((option, optionIndex) => {
                  const selected = selectedAnswers[questionIndex] === optionIndex;
                  return (
                    <Pressable
                      key={`${question.id}-${optionIndex}`}
                      onPress={() =>
                        setSelectedAnswers((prev) => ({
                          ...prev,
                          [questionIndex]: optionIndex,
                        }))
                      }
                      style={[
                        styles.optionButton,
                        selected ? styles.optionButtonSelected : null,
                      ]}
                    >
                      <ThemedText
                        style={selected ? styles.optionTextSelected : styles.optionText}
                      >
                        {option}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <Pressable
              style={styles.primaryButton}
              onPress={() => void submitQuizForRewards()}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText style={styles.primaryButtonLabel}>
                  Submit Quiz
                </ThemedText>
              )}
            </Pressable>
          </GlassCard>
        </Animated.View>
      ) : null}

      {awardedBadges.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(140).duration(330)}>
          <GlassCard style={styles.badgeCard}>
            <ThemedText type="subtitle">New Badge</ThemedText>
            <ThemedText>{awardedBadges.join(", ")}</ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      <Pressable style={styles.secondaryButton} onPress={() => void loadLesson()}>
        <ThemedText style={styles.secondaryButtonLabel}>Refresh Lesson</ThemedText>
      </Pressable>

      {!showQuiz && !lessonMarkedComplete ? (
        <Pressable
          style={styles.primaryButton}
          onPress={() => void markLessonComplete()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText style={styles.primaryButtonLabel}>Mark Lesson Complete</ThemedText>
          )}
        </Pressable>
      ) : null}

      {!showQuiz && lessonMarkedComplete && !quizSubmitted ? (
        <Pressable
          style={styles.primaryButton}
          onPress={() => void startQuizFlow()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText style={styles.primaryButtonLabel}>Start AI Quiz</ThemedText>
          )}
        </Pressable>
      ) : null}
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
  celebrationWrap: {
    alignItems: "center",
  },
  celebrationText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#059669",
  },
  topicText: {
    opacity: 0.7,
    marginTop: 4,
  },
  completedText: {
    marginTop: 6,
    color: "#16a34a",
    fontWeight: "700",
  },
  quizPassText: {
    marginTop: 6,
    color: "#16a34a",
    fontWeight: "700",
  },
  quizFailText: {
    marginTop: 6,
    color: "#b45309",
    fontWeight: "700",
  },
  contentCard: {
    gap: 10,
  },
  bodyText: {
    lineHeight: 22,
    opacity: 0.9,
  },
  quizCard: {
    gap: 12,
  },
  questionBlock: {
    gap: 8,
    paddingVertical: 4,
  },
  questionText: {
    fontWeight: "600",
  },
  optionButton: {
    minHeight: 38,
    borderRadius: 8,
    paddingHorizontal: 10,
    justifyContent: "center",
    backgroundColor: "rgba(10,126,164,0.10)",
  },
  optionButtonSelected: {
    backgroundColor: "#0a7ea4",
  },
  optionText: {
    color: "#0a7ea4",
    fontWeight: "600",
  },
  optionTextSelected: {
    color: "#ffffff",
    fontWeight: "700",
  },
  badgeCard: {
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.4)",
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a7ea4",
    paddingHorizontal: 12,
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontWeight: "700",
    textAlign: "center",
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
  errorCard: {
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  errorText: {
    color: "#b00020",
  },
});
