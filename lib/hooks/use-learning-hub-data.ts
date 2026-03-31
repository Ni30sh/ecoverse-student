import { useEffect, useMemo, useState } from "react";

import { supabaseQueries } from "@/lib/supabase/supabase-queries";
import { useAuth } from "@/providers/auth-provider";

type GenericRecord = Record<string, unknown>;

type TopicProgress = {
  completed: number;
  total: number;
  percentage: number;
};

type ProgressByTopic = Record<string, TopicProgress>;

const EMPTY_PROGRESS: TopicProgress = {
  completed: 0,
  total: 0,
  percentage: 0,
};

function toTopicId(topic: GenericRecord) {
  return String(topic.id ?? "").trim();
}

function toLessonTopicId(lesson: GenericRecord) {
  return String(lesson.topic_id ?? "").trim();
}

function toLessonId(lesson: GenericRecord) {
  return String(lesson.id ?? "").trim();
}

function toCompletionLessonId(completion: GenericRecord) {
  return String(completion.lesson_id ?? "").trim();
}

export function useLearningTopics() {
  const [topics, setTopics] = useState<GenericRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      const result = await supabaseQueries.learningTopics.getAll();

      if (!active) {
        return;
      }

      if (result.error) {
        setError(result.error as Error);
        setTopics([]);
      } else {
        setError(null);
        setTopics((result.data ?? []) as GenericRecord[]);
      }
      setLoading(false);
    };

    void run();

    return () => {
      active = false;
    };
  }, []);

  return { topics, loading, error };
}

export function useLessons() {
  const [lessons, setLessons] = useState<GenericRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      const result = await supabaseQueries.lessons.getAll();

      if (!active) {
        return;
      }

      if (result.error) {
        setError(result.error as Error);
        setLessons([]);
      } else {
        setError(null);
        setLessons((result.data ?? []) as GenericRecord[]);
      }
      setLoading(false);
    };

    void run();

    return () => {
      active = false;
    };
  }, []);

  return { lessons, loading, error };
}

export function useLesson(lessonId?: string) {
  const [lesson, setLesson] = useState<GenericRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!lessonId) {
        if (active) {
          setLesson(null);
          setError(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const result = await supabaseQueries.lessons.getById(lessonId);

      if (!active) {
        return;
      }

      if (result.error) {
        setError(result.error as Error);
        setLesson(null);
      } else {
        setError(null);
        setLesson((result.data ?? null) as GenericRecord | null);
      }

      setLoading(false);
    };

    void run();

    return () => {
      active = false;
    };
  }, [lessonId]);

  return { lesson, loading, error };
}

export function useUserCompletions() {
  const { user } = useAuth();
  const [completions, setCompletions] = useState<GenericRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!user) {
        if (active) {
          setCompletions([]);
          setError(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const result = await supabaseQueries.lessonCompletions.getUserCompletions(
        user.id,
      );

      if (!active) {
        return;
      }

      if (result.error) {
        setError(result.error as Error);
        setCompletions([]);
      } else {
        setError(null);
        setCompletions((result.data ?? []) as GenericRecord[]);
      }
      setLoading(false);
    };

    void run();

    return () => {
      active = false;
    };
  }, [user]);

  return { completions, loading, error };
}

export function useTopicProgress(
  topics: GenericRecord[],
  lessons: GenericRecord[],
  completions: GenericRecord[],
) {
  const progressByTopic = useMemo<ProgressByTopic>(() => {
    if (!Array.isArray(topics) || topics.length === 0) {
      return {};
    }

    const lessonIdsByTopic = new Map<string, Set<string>>();
    for (const lesson of lessons ?? []) {
      const topicId = toLessonTopicId(lesson);
      const lessonId = toLessonId(lesson);
      if (!topicId || !lessonId) {
        continue;
      }

      if (!lessonIdsByTopic.has(topicId)) {
        lessonIdsByTopic.set(topicId, new Set());
      }
      lessonIdsByTopic.get(topicId)?.add(lessonId);
    }

    const completedLessonIds = new Set<string>();
    for (const completion of completions ?? []) {
      const lessonId = toCompletionLessonId(completion);
      if (lessonId) {
        completedLessonIds.add(lessonId);
      }
    }

    const result: ProgressByTopic = {};
    for (const topic of topics) {
      const topicId = toTopicId(topic);
      if (!topicId) {
        continue;
      }

      const lessonSet = lessonIdsByTopic.get(topicId) ?? new Set<string>();
      const total = lessonSet.size;
      let completed = 0;

      for (const lessonId of lessonSet) {
        if (completedLessonIds.has(lessonId)) {
          completed += 1;
        }
      }

      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
      result[topicId] = {
        completed,
        total,
        percentage,
      };
    }

    return result;
  }, [topics, lessons, completions]);

  const totals = useMemo(() => {
    let totalLessons = 0;
    let totalCompleted = 0;

    for (const value of Object.values(progressByTopic)) {
      totalLessons += value.total;
      totalCompleted += value.completed;
    }

    return {
      completed: totalCompleted,
      total: totalLessons,
      percentage:
        totalLessons > 0
          ? Math.round((totalCompleted / totalLessons) * 100)
          : 0,
    };
  }, [progressByTopic]);

  return {
    progressByTopic,
    totals,
    fallback: EMPTY_PROGRESS,
  };
}

export function useCompleteLesson() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const completeLesson = async (lessonId: string) => {
    if (!user || !lessonId) {
      return {
        data: null,
        error: new Error("Missing user or lesson id."),
      };
    }

    setLoading(true);
    const result = await supabaseQueries.lessonCompletions.markComplete(
      user.id,
      lessonId,
    );
    setLoading(false);

    if (result.error) {
      setError(result.error as Error);
    } else {
      setError(null);
    }

    return {
      data: (result.data ?? null) as GenericRecord | null,
      error: result.error ? (result.error as Error) : null,
    };
  };

  return { completeLesson, loading, error };
}
