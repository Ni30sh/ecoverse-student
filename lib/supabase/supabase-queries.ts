import { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";
import { logTelemetry } from "@/lib/utils/telemetry";

type QueryResult<T> = {
  data: T | null;
  error: PostgrestError | Error | null;
};

type MissionProofLocation = {
  lat?: number;
  lng?: number;
};

type MissionSubmissionCreatePayload = {
  user_id: string;
  mission_id: string;
  status: "in_progress" | "submitted" | "approved" | "rejected";
};

type MissionProofRpcPayload = {
  submission_id: string;
  photo_url: string;
  notes: string;
  latitude?: number;
  longitude?: number;
};

type MissionStepSubmissionPayload = {
  user_id: string;
  mission_step_id: string;
  submission_id?: string;
  status?: string;
  notes?: string;
};

type NotificationCreatePayload = {
  user_id: string;
  title: string;
  body: string;
  type: string;
};

type QuizAttemptPayload = Record<string, unknown>;
type QuizGeneratePayload = Record<string, unknown>;
type LeaderboardPeriod = "all_time" | "this_week" | "this_month";
type LeaderboardScope = "global" | "my_school";
type ActivityFilter = "all" | "week" | "month";

type GenericRecord = Record<string, unknown>;

type RealtimeUnsubscribe = () => Promise<void>;

type MissionProofUploadPayload = {
  userId: string;
  missionId: string;
  localUri: string;
  mimeType?: string;
};

type MissionProofUploadResult = {
  bucket: string;
  path: string;
  publicUrl: string;
};

const MOCK_MISSIONS: GenericRecord[] = [
  {
    id: "mock-mission-1",
    title: "Campus Clean-up Drive",
    description:
      "Collect recyclable waste from your school campus and submit before/after proof.",
    category: "community",
    difficulty: "easy",
    eco_points_reward: 50,
    icon_url: null,
    requires_photo: true,
    requires_location: false,
    requires_teacher_approval: true,
  },
  {
    id: "mock-mission-2",
    title: "Water Conservation Audit",
    description:
      "Track and reduce water usage at home for one day and submit your findings.",
    category: "water",
    difficulty: "medium",
    eco_points_reward: 80,
    icon_url: null,
    requires_photo: true,
    requires_location: false,
    requires_teacher_approval: true,
  },
];

function extensionFromMimeType(mimeType?: string) {
  if (!mimeType || !mimeType.includes("/")) {
    return "jpg";
  }

  const ext = mimeType.split("/")[1]?.toLowerCase() ?? "jpg";
  if (ext === "jpeg") {
    return "jpg";
  }

  return ext;
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown error");
}

function getErrorMessage(error: PostgrestError | Error | null) {
  if (!error) {
    return "";
  }

  return String((error as { message?: string }).message ?? "").toLowerCase();
}

function isMissingRelationError(error: PostgrestError | Error | null) {
  const message = getErrorMessage(error);
  return (
    message.includes("could not find table") ||
    message.includes("relation") ||
    message.includes("schema cache")
  );
}

function normalizeProfileRecord(
  record: GenericRecord | null,
): GenericRecord | null {
  if (!record) {
    return null;
  }

  const ecoPoints = record.eco_points ?? record.points ?? 0;
  const streak =
    record.streak_days ?? record.streak ?? record.streak_count ?? 0;

  return {
    ...record,
    user_id: record.user_id ?? record.id,
    name: record.name ?? record.full_name ?? record.email ?? "Student",
    points: ecoPoints,
    eco_points: ecoPoints,
    streak,
    streak_count: streak,
  };
}

function normalizeMissionRecord(record: GenericRecord): GenericRecord {
  return {
    ...record,
    eco_points_reward: record.eco_points_reward ?? record.points ?? 0,
    points: record.points ?? record.eco_points_reward ?? 0,
    requires_photo: Boolean(record.requires_photo ?? true),
    requires_location: Boolean(record.requires_location ?? false),
    requires_teacher_approval: Boolean(
      record.requires_teacher_approval ?? true,
    ),
  };
}

function normalizeLearningTopicRecord(
  record: GenericRecord,
): GenericRecord | null {
  const id = String(record.id ?? "").trim();
  const title = String(record.title ?? "").trim();
  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    icon: record.icon ?? null,
    color: record.color ?? null,
    created_at: record.created_at ?? null,
  };
}

function normalizeLessonRecord(record: GenericRecord): GenericRecord | null {
  const id = String(record.id ?? "").trim();
  const title = String(record.title ?? record.name ?? "").trim();
  const topicId = String(record.topic_id ?? "").trim();

  if (!id || !title || !topicId) {
    return null;
  }

  let contentJson: GenericRecord | null = null;
  const rawContentJson = record.content_json ?? record.content ?? null;
  if (
    rawContentJson &&
    typeof rawContentJson === "object" &&
    !Array.isArray(rawContentJson)
  ) {
    contentJson = rawContentJson as GenericRecord;
  } else if (typeof rawContentJson === "string") {
    try {
      const parsed = JSON.parse(rawContentJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        contentJson = parsed as GenericRecord;
      }
    } catch {
      contentJson = null;
    }
  }

  const bodyCandidate =
    record.body ?? contentJson?.body ?? record.description ?? null;
  const summaryCandidate = record.summary ?? contentJson?.summary ?? null;
  const keyTakeawaysCandidate = record.key_takeaways;
  const factBoxes = record.fact_boxes ?? contentJson?.fact_boxes ?? null;

  return {
    ...record,
    id,
    title,
    topic_id: topicId,
    order_index: Number(record.order_index ?? 0),
    estimated_minutes: Number(record.estimated_minutes ?? 0),
    eco_points_reward: Number(record.eco_points_reward ?? 0),
    body: typeof bodyCandidate === "string" ? bodyCandidate : "",
    summary: typeof summaryCandidate === "string" ? summaryCandidate : null,
    content_json: contentJson,
    content:
      record.content ??
      (typeof bodyCandidate === "string" ? bodyCandidate : null),
    fact_boxes: factBoxes,
    key_takeaways: Array.isArray(keyTakeawaysCandidate)
      ? keyTakeawaysCandidate
          .map((item) => String(item))
          .filter((item) => item.length > 0)
      : [],
  };
}

function normalizeSubmissionRecord(record: GenericRecord): GenericRecord {
  const rawStatus = String(record.status ?? "in_progress").toLowerCase();
  const status = rawStatus === "submitted" ? "pending" : rawStatus;
  return {
    ...record,
    user_id: record.user_id ?? record.student_id,
    mission_id: record.mission_id,
    status,
    photo_url:
      record.photo_url ?? record.proof_photo_url ?? record.proof_url ?? null,
    proof_photo_url:
      record.proof_photo_url ?? record.photo_url ?? record.proof_url ?? null,
  };
}

function normalizeSubmissionRows(rows: GenericRecord[]) {
  return rows.map((row) => normalizeSubmissionRecord(row));
}

function normalizeLeaderboardRecord(record: GenericRecord): GenericRecord {
  const points = Number(record.eco_points ?? record.points ?? 0);
  const normalizedPoints = Number.isFinite(points) ? points : 0;

  return {
    ...record,
    user_id: record.user_id ?? record.id,
    eco_points: normalizedPoints,
    points: normalizedPoints,
    streak_days: Number(record.streak_days ?? 0),
    is_bot: Boolean(record.is_bot ?? false),
    level_title:
      String(record.level_title ?? "").trim() ||
      (normalizedPoints >= 5000
        ? "Eco Champion"
        : normalizedPoints >= 2500
          ? "Eco Leader"
          : normalizedPoints >= 1000
            ? "Eco Ranger"
            : normalizedPoints >= 300
              ? "Eco Starter"
              : "Eco Rookie"),
  };
}

function toInteger(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return fallback;
}

function normalizeTextInput(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveActorUserId(
  requestedUserId?: string,
  options?: { requireAuthenticatedUser?: boolean },
): Promise<QueryResult<string>> {
  try {
    const requireAuthenticatedUser = options?.requireAuthenticatedUser ?? false;
    const normalizedRequested = String(requestedUserId ?? "").trim();
    const authResult = await supabase.auth.getUser();
    const authUserId = String(authResult.data.user?.id ?? "").trim();

    if (authResult.error && requireAuthenticatedUser) {
      return { data: null, error: authResult.error };
    }

    if (authResult.error && !normalizedRequested) {
      return { data: null, error: authResult.error };
    }

    if (requireAuthenticatedUser && !authUserId) {
      return {
        data: null,
        error: new Error("No authenticated Supabase user in session."),
      };
    }

    if (
      authUserId &&
      normalizedRequested &&
      authUserId !== normalizedRequested
    ) {
      return {
        data: null,
        error: new Error(
          "Authenticated user does not match requested user_id.",
        ),
      };
    }

    const resolved = requireAuthenticatedUser
      ? authUserId
      : authUserId || normalizedRequested;
    if (!resolved) {
      return { data: null, error: new Error("Missing authenticated user id.") };
    }

    return { data: resolved, error: null };
  } catch (error) {
    return { data: null, error: asError(error) };
  }
}

async function incrementEcoPoints(
  userId: string,
  pointsToAdd: number,
): Promise<QueryResult<number>> {
  try {
    const points = Math.max(0, toInteger(pointsToAdd, 0));
    if (points <= 0) {
      return { data: 0, error: null };
    }

    const studentLookup = await supabase
      .from("students")
      .select("eco_points")
      .eq("id", userId)
      .maybeSingle();

    if (!studentLookup.error && studentLookup.data) {
      const current = toInteger(
        (studentLookup.data as GenericRecord).eco_points,
        0,
      );
      const nextPoints = Math.max(0, current + points);
      const update = await supabase
        .from("students")
        .update({
          eco_points: nextPoints,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select("eco_points")
        .maybeSingle();

      if (!update.error) {
        return { data: points, error: null };
      }
    }

    const profileLookup = await supabase
      .from("profiles")
      .select("id,user_id,eco_points,points")
      .or(`id.eq.${userId},user_id.eq.${userId}`)
      .limit(1)
      .maybeSingle();

    if (!profileLookup.error && profileLookup.data) {
      const profileRecord = profileLookup.data as GenericRecord;
      const profileId = String(
        profileRecord.id ?? profileRecord.user_id ?? "",
      ).trim();
      if (!profileId) {
        return { data: null, error: new Error("Profile id is missing.") };
      }

      const current = toInteger(
        profileRecord.eco_points ?? profileRecord.points,
        0,
      );
      const nextPoints = Math.max(0, current + points);

      const profileUpdate = await supabase
        .from("profiles")
        .update({
          eco_points: nextPoints,
          points: nextPoints,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profileId)
        .select("id")
        .maybeSingle();

      if (!profileUpdate.error) {
        return { data: points, error: null };
      }
    }

    return {
      data: null,
      error:
        studentLookup.error ??
        profileLookup.error ??
        new Error("Failed to increment eco points."),
    };
  } catch (error) {
    return { data: null, error: asError(error) };
  }
}

async function incrementDailyPoints(
  userId: string,
  pointsToAdd: number,
): Promise<QueryResult<number>> {
  try {
    const points = Math.max(0, toInteger(pointsToAdd, 0));
    if (points <= 0) {
      return { data: 0, error: null };
    }

    const today = new Date().toISOString().slice(0, 10);
    const dailyLookup = await supabase
      .from("daily_points")
      .select("id,points_earned")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();

    if (!dailyLookup.error) {
      if (dailyLookup.data) {
        const nextPoints =
          toInteger((dailyLookup.data as GenericRecord).points_earned, 0) +
          points;
        const update = await supabase
          .from("daily_points")
          .update({
            points_earned: Math.max(0, nextPoints),
            updated_at: new Date().toISOString(),
          })
          .eq("id", (dailyLookup.data as GenericRecord).id)
          .select("id")
          .maybeSingle();

        if (!update.error) {
          return { data: points, error: null };
        }
      } else {
        const insert = await supabase
          .from("daily_points")
          .insert({
            user_id: userId,
            date: today,
            points_earned: points,
            updated_at: new Date().toISOString(),
          })
          .select("id")
          .maybeSingle();

        if (!insert.error) {
          return { data: points, error: null };
        }
      }
    }

    const weeklyLookup = await supabase
      .from("weekly_points")
      .select("id,points_earned")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();

    if (!weeklyLookup.error) {
      if (weeklyLookup.data) {
        const nextPoints =
          toInteger((weeklyLookup.data as GenericRecord).points_earned, 0) +
          points;
        await supabase
          .from("weekly_points")
          .update({
            points_earned: Math.max(0, nextPoints),
            updated_at: new Date().toISOString(),
          })
          .eq("id", (weeklyLookup.data as GenericRecord).id);
      } else {
        await supabase.from("weekly_points").insert({
          user_id: userId,
          date: today,
          points_earned: points,
          updated_at: new Date().toISOString(),
        });
      }
    }

    return { data: points, error: null };
  } catch (error) {
    return { data: null, error: asError(error) };
  }
}

function getFilterStartDate(filter: ActivityFilter) {
  if (filter === "week") {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString();
  }

  if (filter === "month") {
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), 1);
    return date.toISOString();
  }

  return null;
}

const ALLOWED_AVATAR_EMOJIS = new Set([
  "🌱",
  "🌿",
  "🍀",
  "🌳",
  "🌲",
  "🪴",
  "🌻",
  "🌎",
  "♻️",
  "🐢",
  "🦋",
  "🌊",
  "☀️",
  "🍃",
  "🌼",
]);

function buildFallbackQuizQuestions(topicTitle: string): GenericRecord[] {
  const safeTopic = topicTitle.trim() || "Sustainability";
  return [
    {
      id: `${safeTopic}-q1`,
      question: `Which action best supports ${safeTopic.toLowerCase()} in daily life?`,
      options: [
        "Using reusable items",
        "Burning mixed waste",
        "Leaving lights on",
        "Ignoring water leaks",
      ],
      correctAnswer: 0,
      explanation:
        "Reusable habits reduce waste and long-term resource consumption.",
    },
    {
      id: `${safeTopic}-q2`,
      question:
        "What is the most climate-friendly transport option for short distances?",
      options: [
        "Walking or cycling",
        "Single-passenger car trips",
        "Idling in traffic",
        "Unnecessary ride-hailing",
      ],
      correctAnswer: 0,
      explanation:
        "Active transport lowers emissions and improves health outcomes.",
    },
    {
      id: `${safeTopic}-q3`,
      question: "Why should recyclable and wet waste be separated at source?",
      options: [
        "To reduce contamination and improve recovery",
        "To increase landfill usage",
        "To slow down collection",
        "It has no impact",
      ],
      correctAnswer: 0,
      explanation:
        "Segregation increases recycling efficiency and lowers processing loss.",
    },
    {
      id: `${safeTopic}-q4`,
      question: "Which habit saves the most water at home?",
      options: [
        "Fixing leaks promptly",
        "Running taps continuously",
        "Ignoring dripping faucets",
        "Overwatering plants",
      ],
      correctAnswer: 0,
      explanation:
        "Leak fixes prevent continuous water loss and reduce household demand.",
    },
    {
      id: `${safeTopic}-q5`,
      question: "What does a sustainable purchase decision prioritize?",
      options: [
        "Durability and lower lifecycle impact",
        "Single-use convenience only",
        "Excess packaging",
        "Frequent replacement",
      ],
      correctAnswer: 0,
      explanation:
        "Durable, repairable products reduce waste and embodied emissions.",
    },
  ];
}

function normalizeQuizQuestionRecord(
  record: GenericRecord,
  index: number,
  topicTitle: string,
): GenericRecord | null {
  const questionText = String(record.question ?? record.prompt ?? "").trim();
  const optionsRaw = Array.isArray(record.options) ? record.options : [];
  const options = optionsRaw
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);

  if (!questionText || options.length < 2) {
    return null;
  }

  const answerRaw =
    record.correctAnswer ??
    record.correct_answer ??
    record.answerIndex ??
    record.answer_index ??
    0;
  const answerIndex = Math.max(
    0,
    Math.min(options.length - 1, toInteger(answerRaw, 0)),
  );

  return {
    id: String(record.id ?? `${topicTitle}-q${index + 1}`),
    question: questionText,
    options,
    correctAnswer: answerIndex,
    explanation: String(record.explanation ?? "").trim(),
  };
}

function normalizeQuizQuestionsPayload(
  data: unknown,
  topicTitle: string,
): GenericRecord[] {
  const records = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { questions?: unknown[] }).questions)
      ? ((data as { questions?: unknown[] }).questions ?? [])
      : [];

  const normalized = records
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      return normalizeQuizQuestionRecord(
        item as GenericRecord,
        index,
        topicTitle,
      );
    })
    .filter((item): item is GenericRecord => Boolean(item));

  if (normalized.length > 0) {
    return normalized;
  }

  return buildFallbackQuizQuestions(topicTitle);
}

export const supabaseQueries = {
  learningTopics: {
    async getAll(): Promise<QueryResult<GenericRecord[]>> {
      try {
        const { data, error } = await supabase
          .from("learning_topics")
          .select("*")
          .order("created_at", { ascending: true });

        if (error) {
          if (isMissingRelationError(error)) {
            return { data: [], error: null };
          }
          return { data: null, error };
        }

        const normalized = (data ?? [])
          .map((row) => normalizeLearningTopicRecord(row as GenericRecord))
          .filter((row): row is GenericRecord => Boolean(row));

        return { data: normalized, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  profiles: {
    async getById(userId: string): Promise<QueryResult<GenericRecord>> {
      try {
        // Primary source is students table (aligned with auth-provider).
        const studentsResult = await supabase
          .from("students")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

        if (!studentsResult.error) {
          return {
            data: normalizeProfileRecord(
              (studentsResult.data as GenericRecord | null) ?? null,
            ),
            error: null,
          };
        }

        // Backward-compatible fallback for older deployments still using profiles.
        const profilesResult = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle();
        if (!profilesResult.error) {
          return {
            data: normalizeProfileRecord(
              (profilesResult.data as GenericRecord | null) ?? null,
            ),
            error: null,
          };
        }

        return {
          data: null,
          error: studentsResult.error ?? profilesResult.error,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async updateStreak(userId: string): Promise<QueryResult<GenericRecord>> {
      try {
        const rpcCandidates = [
          supabase.rpc("update_streak", { p_user_id: userId }),
          supabase.rpc("update_student_streak", { p_user_id: userId }),
          supabase.rpc("update_streak", { user_id: userId }),
          supabase.rpc("update_student_streak", { user_id: userId }),
        ];

        for (const rpcCall of rpcCandidates) {
          const { data, error } = await rpcCall;
          if (!error) {
            if (Array.isArray(data)) {
              return { data: (data[0] as GenericRecord) ?? null, error: null };
            }

            return { data: (data as GenericRecord) ?? null, error: null };
          }
        }

        return this.getById(userId);
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async ensureStudent(
      userId: string,
      email: string,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const existing = await this.getById(userId);
        if (!existing.error && existing.data) {
          const role = String(existing.data.role ?? "").toLowerCase();
          if (!role || role === "student") {
            if (!role) {
              const updateId = await supabase
                .from("profiles")
                .update({ role: "student" })
                .eq("id", userId)
                .select("*")
                .maybeSingle();

              if (!updateId.error && updateId.data) {
                return { data: updateId.data, error: null };
              }
            }

            return { data: existing.data, error: null };
          }

          return {
            data: null,
            error: new Error("Only student accounts can access this app."),
          };
        }

        const payloads: GenericRecord[] = [
          { id: userId, email, role: "student" },
          { id: userId, role: "student" },
        ];

        for (const payload of payloads) {
          const upsertId = await supabase
            .from("profiles")
            .upsert(payload, { onConflict: "id" })
            .select("*")
            .maybeSingle();

          if (!upsertId.error && upsertId.data) {
            return { data: upsertId.data, error: null };
          }

          const insertOne = await supabase
            .from("profiles")
            .insert(payload)
            .select("*")
            .maybeSingle();

          if (!insertOne.error && insertOne.data) {
            return { data: insertOne.data, error: null };
          }
        }

        return this.getById(userId);
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async updateProfile(
      userId: string,
      payload: { full_name?: unknown; school_name?: unknown; city?: unknown },
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const updatePayload: GenericRecord = {
          full_name: normalizeTextInput(payload.full_name),
          school_name: normalizeTextInput(payload.school_name),
          city: normalizeTextInput(payload.city),
          updated_at: new Date().toISOString(),
        };

        const studentUpdate = await supabase
          .from("students")
          .update(updatePayload)
          .eq("id", userId)
          .select("*")
          .maybeSingle();

        if (!studentUpdate.error && studentUpdate.data) {
          return {
            data: normalizeProfileRecord(studentUpdate.data as GenericRecord),
            error: null,
          };
        }

        const profileUpdate = await supabase
          .from("profiles")
          .update(updatePayload)
          .eq("id", userId)
          .select("*")
          .maybeSingle();

        if (!profileUpdate.error && profileUpdate.data) {
          return {
            data: normalizeProfileRecord(profileUpdate.data as GenericRecord),
            error: null,
          };
        }

        return {
          data: null,
          error: studentUpdate.error ?? profileUpdate.error,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async updateAvatar(
      userId: string,
      avatarEmoji: string,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const emoji = normalizeTextInput(avatarEmoji);
        if (!ALLOWED_AVATAR_EMOJIS.has(emoji)) {
          return {
            data: null,
            error: new Error("Invalid avatar emoji selection."),
          };
        }

        const updatePayload: GenericRecord = {
          avatar_emoji: emoji,
          updated_at: new Date().toISOString(),
        };

        const studentUpdate = await supabase
          .from("students")
          .update(updatePayload)
          .eq("id", userId)
          .select("*")
          .maybeSingle();

        if (!studentUpdate.error && studentUpdate.data) {
          return {
            data: normalizeProfileRecord(studentUpdate.data as GenericRecord),
            error: null,
          };
        }

        const profileUpdate = await supabase
          .from("profiles")
          .update(updatePayload)
          .eq("id", userId)
          .select("*")
          .maybeSingle();

        if (!profileUpdate.error && profileUpdate.data) {
          return {
            data: normalizeProfileRecord(profileUpdate.data as GenericRecord),
            error: null,
          };
        }

        return {
          data: null,
          error: studentUpdate.error ?? profileUpdate.error,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async getProfileSummary(
      userId: string,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const profileResult = await this.getById(userId);
        if (profileResult.error) {
          return { data: null, error: profileResult.error };
        }

        const profile = (profileResult.data ?? {}) as GenericRecord;

        const canonicalSubmissions = await supabase
          .from("submissions")
          .select("id,mission_id,status,submitted_at,created_at")
          .eq("user_id", userId)
          .eq("status", "approved");

        const fallbackSubmissions = canonicalSubmissions.error
          ? await supabase
              .from("mission_submissions")
              .select("id,mission_id,status,submitted_at,created_at")
              .or(`user_id.eq.${userId},student_id.eq.${userId}`)
              .eq("status", "approved")
          : { data: [], error: null };

        if (canonicalSubmissions.error && fallbackSubmissions.error) {
          return {
            data: null,
            error: canonicalSubmissions.error ?? fallbackSubmissions.error,
          };
        }

        const approvedSubmissions = (
          !canonicalSubmissions.error
            ? (canonicalSubmissions.data ?? [])
            : (fallbackSubmissions.data ?? [])
        ) as GenericRecord[];

        const missionIds = Array.from(
          new Set(
            approvedSubmissions
              .map((item) => String(item.mission_id ?? "").trim())
              .filter((item) => item.length > 0),
          ),
        );

        let missionMap = new Map<string, GenericRecord>();
        if (missionIds.length > 0) {
          const missionsResult = await supabase
            .from("missions")
            .select("id,title,category,eco_points_reward")
            .in("id", missionIds);

          if (!missionsResult.error) {
            missionMap = new Map(
              ((missionsResult.data ?? []) as GenericRecord[]).map(
                (mission) => [String(mission.id ?? ""), mission],
              ),
            );
          }
        }

        const approvedUniqueIds = new Set<string>();
        let waterMissions = 0;
        let wasteMissions = 0;
        let treesPlanted = 0;
        const categorySet = new Set<string>();

        for (const submission of approvedSubmissions) {
          const sid = String(submission.id ?? "").trim();
          if (!sid || approvedUniqueIds.has(sid)) {
            continue;
          }
          approvedUniqueIds.add(sid);

          const missionId = String(submission.mission_id ?? "").trim();
          const mission = missionMap.get(missionId);
          const category = normalizeTextInput(mission?.category).toLowerCase();

          if (category) {
            categorySet.add(category);
          }
          if (category === "water") {
            waterMissions += 1;
          }
          if (category === "waste") {
            wasteMissions += 1;
          }
          if (category === "planting") {
            treesPlanted += 1;
          }
        }

        const missionsCompleted = approvedUniqueIds.size;

        const weeklyPointsResult = await supabase
          .from("weekly_points")
          .select("points_earned,date")
          .eq("user_id", userId)
          .gte(
            "date",
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10),
          );

        const weeklyPoints = !weeklyPointsResult.error
          ? ((weeklyPointsResult.data ?? []) as GenericRecord[]).reduce(
              (sum, row) => {
                return sum + Math.max(0, toInteger(row.points_earned, 0));
              },
              0,
            )
          : 0;

        const monthStart = new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1,
        ).toISOString();
        const monthlyMissions = approvedSubmissions.filter((submission) => {
          const ts = String(
            submission.submitted_at ?? submission.created_at ?? "",
          ).trim();
          return ts.length > 0 && ts >= monthStart;
        }).length;

        const rankResult = await supabaseQueries.leaderboard.getRank(userId);
        const rank = toInteger(
          (rankResult.data as GenericRecord | null)?.rank,
          0,
        );

        const realUserCountResult = await supabase
          .from("leaderboard")
          .select("user_id,is_bot", { count: "exact" })
          .eq("is_bot", false);

        const realUserCount = Math.max(
          0,
          Number(realUserCountResult.count ?? 0),
        );

        const ecoPoints = Math.max(
          0,
          toInteger(profile.eco_points ?? profile.points, 0),
        );
        const co2Saved = Math.max(0, Math.round(ecoPoints * 0.02));
        const waterSaved = Math.max(0, waterMissions * 15);
        const wasteSorted = Math.max(0, wasteMissions * 2);

        return {
          data: {
            profile,
            missionsCompleted,
            waterMissions,
            wasteMissions,
            treesPlanted,
            categoriesCount: categorySet.size,
            weeklyPoints,
            monthlyMissions,
            rank,
            realUserCount,
            eco_points: ecoPoints,
            co2Saved,
            waterSaved,
            wasteSorted,
          },
          error: null,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async submissionsQuery(
      userId: string,
      offset = 0,
      limit = 20,
      filter: ActivityFilter = "all",
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const startDate = getFilterStartDate(filter);
        const safeOffset = Math.max(0, toInteger(offset, 0));
        const safeLimit = Math.max(1, Math.min(100, toInteger(limit, 20)));

        let canonical = supabase
          .from("submissions")
          .select(
            "id,user_id,mission_id,status,submitted_at,created_at,missions(id,title,category,eco_points_reward)",
            {
              count: "exact",
            },
          )
          .eq("user_id", userId)
          .order("submitted_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(safeOffset, safeOffset + safeLimit - 1);

        if (startDate) {
          canonical = canonical.gte("submitted_at", startDate);
        }

        const canonicalResult = await canonical;

        if (!canonicalResult.error) {
          return {
            data: {
              rows: (canonicalResult.data ?? []) as GenericRecord[],
              totalCount: Number(canonicalResult.count ?? 0),
              offset: safeOffset,
              limit: safeLimit,
              filter,
            },
            error: null,
          };
        }

        let fallback = supabase
          .from("mission_submissions")
          .select(
            "id,user_id,student_id,mission_id,status,submitted_at,created_at",
            { count: "exact" },
          )
          .or(`user_id.eq.${userId},student_id.eq.${userId}`)
          .order("submitted_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(safeOffset, safeOffset + safeLimit - 1);

        if (startDate) {
          fallback = fallback.gte("submitted_at", startDate);
        }

        const fallbackResult = await fallback;
        if (fallbackResult.error) {
          return { data: null, error: fallbackResult.error };
        }

        const rows = (fallbackResult.data ?? []) as GenericRecord[];
        const missionIds = Array.from(
          new Set(
            rows
              .map((row) => String(row.mission_id ?? "").trim())
              .filter((id) => id.length > 0),
          ),
        );

        let missionMap = new Map<string, GenericRecord>();
        if (missionIds.length > 0) {
          const missions = await supabase
            .from("missions")
            .select("id,title,category,eco_points_reward")
            .in("id", missionIds);

          if (!missions.error) {
            missionMap = new Map(
              ((missions.data ?? []) as GenericRecord[]).map((mission) => [
                String(mission.id ?? ""),
                mission,
              ]),
            );
          }
        }

        const joinedRows = rows.map((row) => {
          const mission = missionMap.get(String(row.mission_id ?? "")) ?? null;
          return {
            ...row,
            missions: mission,
          };
        });

        return {
          data: {
            rows: joinedRows,
            totalCount: Number(fallbackResult.count ?? 0),
            offset: safeOffset,
            limit: safeLimit,
            filter,
          },
          error: null,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  missions: {
    async getAll(): Promise<QueryResult<GenericRecord[]>> {
      try {
        const { data, error } = await supabase
          .from("missions")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) {
          return { data: null, error };
        }

        const normalized = (data ?? []).map((row) =>
          normalizeMissionRecord(row as GenericRecord),
        );
        if (normalized.length === 0) {
          // Strict requirement: use mock only when DB returns empty.
          return { data: MOCK_MISSIONS, error: null };
        }

        return { data: normalized, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async getById(missionId: string): Promise<QueryResult<GenericRecord>> {
      try {
        const { data, error } = await supabase
          .from("missions")
          .select("*")
          .eq("id", missionId)
          .maybeSingle();

        return { data, error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  missionSubmissions: {
    async getSubmissionForMission(
      userId: string,
      missionId: string,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const canonical = await supabase
          .from("submissions")
          .select("*")
          .eq("user_id", userId)
          .eq("mission_id", missionId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!canonical.error) {
          return {
            data: canonical.data
              ? normalizeSubmissionRecord(canonical.data as GenericRecord)
              : null,
            error: null,
          };
        }

        const missionTable = await supabase
          .from("mission_submissions")
          .select("*")
          .eq("user_id", userId)
          .eq("mission_id", missionId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!missionTable.error) {
          return {
            data: missionTable.data
              ? normalizeSubmissionRecord(missionTable.data as GenericRecord)
              : null,
            error: null,
          };
        }

        const studentFallback = await supabase
          .from("mission_submissions")
          .select("*")
          .eq("student_id", userId)
          .eq("mission_id", missionId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!studentFallback.error) {
          return {
            data: studentFallback.data
              ? normalizeSubmissionRecord(studentFallback.data as GenericRecord)
              : null,
            error: null,
          };
        }

        if (
          isMissingRelationError(canonical.error) &&
          isMissingRelationError(missionTable.error) &&
          isMissingRelationError(studentFallback.error)
        ) {
          return { data: null, error: null };
        }

        return {
          data: null,
          error: canonical.error ?? missionTable.error ?? studentFallback.error,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async getUserSubmissions(
      userId: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const canonical = await supabase
          .from("submissions")
          .select("*")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });

        if (!canonical.error) {
          return {
            data: normalizeSubmissionRows(
              (canonical.data ?? []) as GenericRecord[],
            ),
            error: null,
          };
        }

        const primary = await supabase
          .from("mission_submissions")
          .select("*")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });

        if (!primary.error) {
          return {
            data: normalizeSubmissionRows(
              (primary.data ?? []) as GenericRecord[],
            ),
            error: null,
          };
        }

        const studentIdFallback = await supabase
          .from("mission_submissions")
          .select("*")
          .eq("student_id", userId)
          .order("created_at", { ascending: false });

        if (!studentIdFallback.error) {
          return {
            data: normalizeSubmissionRows(
              (studentIdFallback.data ?? []) as GenericRecord[],
            ),
            error: null,
          };
        }

        if (
          isMissingRelationError(canonical.error) &&
          isMissingRelationError(primary.error) &&
          isMissingRelationError(studentIdFallback.error)
        ) {
          logTelemetry(
            "warn",
            "mission_submissions_table_missing",
            "No submissions relation found",
            {
              userId,
            },
          );
          return { data: [], error: null };
        }

        return {
          data: null,
          error: canonical.error ?? primary.error ?? studentIdFallback.error,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async create(
      payload: MissionSubmissionCreatePayload,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const actor = await resolveActorUserId(payload.user_id, {
          requireAuthenticatedUser: true,
        });
        if (actor.error || !actor.data) {
          return {
            data: null,
            error: actor.error ?? new Error("Missing user id"),
          };
        }

        const effectiveUserId = actor.data;

        // Prevent duplicates by reusing existing submission for this user+mission.
        const existing = await this.getSubmissionForMission(
          effectiveUserId,
          payload.mission_id,
        );
        if (!existing.error && existing.data) {
          return { data: existing.data, error: null };
        }

        const insertPayload = {
          user_id: effectiveUserId,
          mission_id: payload.mission_id,
          status: "in_progress",
        };

        const canonical = await supabase
          .from("submissions")
          .insert(insertPayload)
          .select("*")
          .maybeSingle();

        if (!canonical.error) {
          return {
            data: canonical.data
              ? normalizeSubmissionRecord(canonical.data as GenericRecord)
              : null,
            error: null,
          };
        }

        const primary = await supabase
          .from("mission_submissions")
          .insert(insertPayload)
          .select("*")
          .maybeSingle();

        if (!primary.error) {
          return { data: primary.data, error: null };
        }

        const fallback = await supabase
          .from("mission_submissions")
          .insert({ ...insertPayload, student_id: insertPayload.user_id })
          .select("*")
          .maybeSingle();

        if (!fallback.error) {
          return {
            data: fallback.data
              ? normalizeSubmissionRecord(fallback.data as GenericRecord)
              : null,
            error: null,
          };
        }

        return {
          data: null,
          error: canonical.error ?? primary.error ?? fallback.error,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async submitProof(
      submissionId: string,
      photoUrl: string,
      notes: string,
      location: MissionProofLocation,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        if (!submissionId || !photoUrl) {
          return {
            data: null,
            error: new Error("submissionId and photoUrl are required"),
          };
        }

        // Try new atomic RPC first (includes auth checks + atomic update)
        const rpcResult = await supabase.rpc("submit_proof_for_submission", {
          p_submission_id: submissionId,
          p_photo_url: photoUrl,
          p_notes: normalizeTextInput(notes),
          p_latitude: location?.lat ?? null,
          p_longitude: location?.lng ?? null,
        });

        if (!rpcResult.error) {
          if (Array.isArray(rpcResult.data) && rpcResult.data.length > 0) {
            return {
              data: (rpcResult.data[0] as GenericRecord) ?? null,
              error: null,
            };
          }
          if (rpcResult.data) {
            return {
              data: (rpcResult.data as GenericRecord) ?? null,
              error: null,
            };
          }
        }

        // Fallback to legacy RPC endpoints (backward compatibility)
        const legacyRpcPayloads: MissionProofRpcPayload[] = [
          {
            submission_id: submissionId,
            photo_url: photoUrl,
            notes,
            latitude: location?.lat,
            longitude: location?.lng,
          },
          {
            submission_id: submissionId,
            photo_url: photoUrl,
            notes,
          },
        ];

        for (const payload of legacyRpcPayloads) {
          const rpcCandidates = [
            supabase.rpc("submit_mission_proof", payload),
            supabase.rpc("submit_student_mission_proof", payload),
            supabase.rpc("submit_mission_proof", {
              p_submission_id: payload.submission_id,
              p_photo_url: payload.photo_url,
              p_notes: payload.notes,
              p_latitude: payload.latitude,
              p_longitude: payload.longitude,
            }),
          ];

          for (const rpcCall of rpcCandidates) {
            const { data, error } = await rpcCall;
            if (!error && data) {
              if (Array.isArray(data)) {
                return {
                  data: (data[0] as GenericRecord) ?? null,
                  error: null,
                };
              }
              return { data: (data as GenericRecord) ?? null, error: null };
            }
          }
        }

        // Final fallback: direct table update
        const updatePayload: GenericRecord = {
          status: "pending",
          notes: normalizeTextInput(notes),
          submitted_at: new Date().toISOString(),
          proof_photo_url: photoUrl,
          photo_url: photoUrl,
          proof_url: photoUrl,
          proof_metadata: {
            notes,
            latitude: location?.lat,
            longitude: location?.lng,
            source: "student-app",
          },
          latitude: location?.lat,
          longitude: location?.lng,
          updated_at: new Date().toISOString(),
        };

        const canonical = await supabase
          .from("submissions")
          .update(updatePayload)
          .eq("id", submissionId)
          .select("*")
          .maybeSingle();

        if (!canonical.error && canonical.data) {
          return {
            data: normalizeSubmissionRecord(canonical.data as GenericRecord),
            error: null,
          };
        }

        const primary = await supabase
          .from("mission_submissions")
          .update(updatePayload)
          .eq("id", submissionId)
          .select("*")
          .maybeSingle();

        if (!primary.error && primary.data) {
          return {
            data: normalizeSubmissionRecord(primary.data as GenericRecord),
            error: null,
          };
        }

        logTelemetry(
          "error",
          "missionsubmissions_submitproof_failed",
          "All proof submission paths failed",
          {
            submissionId,
          },
        );

        return {
          data: null,
          error: canonical.error ?? primary.error ?? rpcResult.error,
        };
      } catch (error) {
        logTelemetry(
          "error",
          "missionsubmissions_submitproof_exception",
          getErrorMessage(asError(error)),
          {
            submissionId,
          },
        );
        return { data: null, error: asError(error) };
      }
    },
  },

  missionSteps: {
    async getByMissionId(
      missionId: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const { data, error } = await supabase
          .from("mission_steps")
          .select("*")
          .eq("mission_id", missionId)
          .order("step_order", { ascending: true });

        return { data: data ?? [], error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  missionStepSubmissions: {
    async submitStep(
      payload: MissionStepSubmissionPayload,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const record = {
          ...payload,
          submitted_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from("mission_step_submissions")
          .upsert(record)
          .select("*")
          .maybeSingle();

        return { data, error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  lessons: {
    async getAll(): Promise<QueryResult<GenericRecord[]>> {
      try {
        const joined = await supabase
          .from("lessons")
          .select("*, learning_topics!inner(id)")
          .order("order_index", { ascending: true })
          .order("created_at", { ascending: true });

        if (!joined.error) {
          const normalized = (joined.data ?? [])
            .map((row) => normalizeLessonRecord(row as GenericRecord))
            .filter((row): row is GenericRecord => Boolean(row));
          return { data: normalized, error: null };
        }

        const { data, error } = await supabase
          .from("lessons")
          .select("*")
          .not("topic_id", "is", null)
          .order("order_index", { ascending: true })
          .order("created_at", { ascending: true });

        if (error) {
          if (isMissingRelationError(error)) {
            return { data: [], error: null };
          }
          return { data: null, error };
        }

        const normalized = (data ?? [])
          .map((row) => normalizeLessonRecord(row as GenericRecord))
          .filter((row): row is GenericRecord => Boolean(row));

        return { data: normalized, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async getByTopic(topic: string): Promise<QueryResult<GenericRecord[]>> {
      try {
        const { data, error } = await supabase
          .from("lessons")
          .select("*")
          .eq("topic_id", topic)
          .order("order_index", { ascending: true })
          .order("created_at", { ascending: true });

        if (!error) {
          const normalized = (data ?? [])
            .map((row) => normalizeLessonRecord(row as GenericRecord))
            .filter((row): row is GenericRecord => Boolean(row));
          return { data: normalized, error: null };
        }

        const legacy = await supabase
          .from("lessons")
          .select("*")
          .or(`topic.eq.${topic},category.eq.${topic}`)
          .order("created_at", { ascending: true });

        if (legacy.error) {
          if (isMissingRelationError(legacy.error)) {
            return { data: [], error: null };
          }
          return { data: null, error: legacy.error };
        }

        const normalized = (legacy.data ?? [])
          .map((row) => normalizeLessonRecord(row as GenericRecord))
          .filter((row): row is GenericRecord => Boolean(row));

        return { data: normalized, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async getById(lessonId: string): Promise<QueryResult<GenericRecord>> {
      try {
        const joined = await supabase
          .from("lessons")
          .select("*, learning_topics!inner(id)")
          .eq("id", lessonId)
          .maybeSingle();

        if (!joined.error) {
          const normalized = joined.data
            ? normalizeLessonRecord(joined.data as GenericRecord)
            : null;
          return { data: normalized, error: null };
        }

        const { data, error } = await supabase
          .from("lessons")
          .select("*")
          .eq("id", lessonId)
          .maybeSingle();

        if (error) {
          if (isMissingRelationError(error)) {
            return { data: null, error: null };
          }
          return { data: null, error };
        }

        const normalized = data
          ? normalizeLessonRecord(data as GenericRecord)
          : null;
        return { data: normalized, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  dailyPoints: {
    async getUserDailyPoints(
      userId: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const daily = await supabase
          .from("daily_points")
          .select("*")
          .eq("user_id", userId)
          .order("date", { ascending: true })
          .limit(7);

        if (!daily.error) {
          return { data: daily.data ?? [], error: null };
        }

        const weekly = await supabase
          .from("weekly_points")
          .select("*")
          .eq("user_id", userId)
          .order("week_start", { ascending: true })
          .limit(7);

        if (!weekly.error) {
          return { data: weekly.data ?? [], error: null };
        }

        if (
          isMissingRelationError(daily.error) &&
          isMissingRelationError(weekly.error)
        ) {
          return { data: [], error: null };
        }

        return { data: null, error: daily.error ?? weekly.error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  lessonCompletions: {
    async getUserCompletions(
      userId: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const { data, error } = await supabase
          .from("lesson_completions")
          .select("id,user_id,lesson_id,completed_at")
          .eq("user_id", userId)
          .order("completed_at", { ascending: false });

        if (error) {
          if (isMissingRelationError(error)) {
            return { data: [], error: null };
          }
          return { data: null, error };
        }

        const deduped = new Map<string, GenericRecord>();
        for (const row of (data ?? []) as GenericRecord[]) {
          const lessonId = String(row.lesson_id ?? "").trim();
          if (!lessonId) {
            continue;
          }
          if (!deduped.has(lessonId)) {
            deduped.set(lessonId, {
              ...row,
              lesson_id: lessonId,
              user_id: row.user_id ?? userId,
            });
          }
        }

        return { data: Array.from(deduped.values()), error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async markComplete(
      userId: string,
      lessonId: string,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const actor = await resolveActorUserId(userId, {
          requireAuthenticatedUser: true,
        });
        if (actor.error || !actor.data) {
          return {
            data: null,
            error: actor.error ?? new Error("Missing user id"),
          };
        }
        const effectiveUserId = actor.data;

        const existing = await supabase
          .from("lesson_completions")
          .select("id,user_id,lesson_id,completed_at")
          .eq("user_id", effectiveUserId)
          .eq("lesson_id", lessonId)
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!existing.error && existing.data) {
          return {
            data: {
              ...existing.data,
              alreadyCompleted: true,
              awardedPoints: 0,
            },
            error: null,
          };
        }

        const rpc = await supabase.rpc("complete_lesson", {
          p_lesson_id: lessonId,
        });
        if (!rpc.error) {
          const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
          if (row) {
            return {
              data: row as GenericRecord,
              error: null,
            };
          }
        }

        const payload = {
          user_id: effectiveUserId,
          lesson_id: lessonId,
          completed_at: new Date().toISOString(),
        };

        const inserted = await supabase
          .from("lesson_completions")
          .insert(payload)
          .select("*")
          .maybeSingle();

        if (inserted.error) {
          if (inserted.error.code === "23505") {
            return {
              data: {
                user_id: effectiveUserId,
                lesson_id: lessonId,
                alreadyCompleted: true,
                awardedPoints: 0,
              },
              error: null,
            };
          }
          return { data: null, error: inserted.error };
        }

        let awardedPoints = 0;
        const lesson = await supabase
          .from("lessons")
          .select("eco_points_reward")
          .eq("id", lessonId)
          .maybeSingle();

        if (!lesson.error && lesson.data) {
          const reward = Number(
            (lesson.data as GenericRecord).eco_points_reward ?? 0,
          );
          if (Number.isFinite(reward) && reward > 0) {
            let rewardApplied = false;
            const ecoUpdate = await incrementEcoPoints(effectiveUserId, reward);
            if (!ecoUpdate.error) {
              awardedPoints = reward;
              rewardApplied = true;
            }

            if (rewardApplied) {
              await incrementDailyPoints(effectiveUserId, reward);
            }
          }
        }

        return {
          data: {
            ...(inserted.data ?? {}),
            alreadyCompleted: false,
            awardedPoints,
          },
          error: null,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  quizAttempts: {
    async generateQuiz(
      payload: QuizGeneratePayload,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const topic =
          String(
            payload.topic ?? payload.topicTitle ?? "Sustainability",
          ).trim() || "Sustainability";
        const candidates = [
          "generate-quiz",
          "quiz-generate",
          "quiz-experience",
        ];
        let lastError: PostgrestError | Error | null = null;
        const sessionResponse = await supabase.auth.getSession();
        const accessToken = sessionResponse.data.session?.access_token ?? null;

        for (const fnName of candidates) {
          const response = await Promise.race([
            supabase.functions.invoke(fnName, {
              body: {
                topic,
              },
              headers: accessToken
                ? { Authorization: `Bearer ${accessToken}` }
                : undefined,
            }),
            new Promise<{ data: null; error: Error }>((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    data: null,
                    error: new Error(`Quiz generation timeout for ${fnName}`),
                  }),
                8500,
              );
            }),
          ]);

          if (!response.error) {
            const questions = normalizeQuizQuestionsPayload(
              response.data,
              topic,
            );
            return {
              data: {
                topic,
                questions,
                source: "edge",
              },
              error: null,
            };
          }

          lastError = response.error;
        }

        logTelemetry(
          "warn",
          "quiz_generate_fallback_used",
          "Edge quiz generation unavailable; using fallback quiz.",
          {
            topic,
            error: String(
              (lastError as { message?: string } | null)?.message ?? "",
            ),
          },
        );

        return {
          data: {
            topic,
            questions: buildFallbackQuizQuestions(topic),
            source: "fallback",
          },
          error: null,
        };
      } catch (error) {
        const topic =
          String(
            payload.topic ?? payload.topicTitle ?? "Sustainability",
          ).trim() || "Sustainability";
        logTelemetry(
          "warn",
          "quiz_generate_exception_fallback",
          "Quiz generation failed; using fallback quiz.",
          {
            topic,
            error: String(error),
          },
        );

        return {
          data: {
            topic,
            questions: buildFallbackQuizQuestions(topic),
            source: "fallback",
          },
          error: null,
        };
      }
    },

    async getUserAttempts(
      userId: string,
      topicId?: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        let query = supabase
          .from("quiz_attempts")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (topicId) {
          query = query.eq("topic_id", topicId);
        }

        const { data, error } = await query;
        if (error) {
          if (isMissingRelationError(error)) {
            return { data: [], error: null };
          }
          return { data: null, error };
        }

        return { data: (data ?? []) as GenericRecord[], error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async create(
      payload: QuizAttemptPayload,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const requestedUserId = String(payload.user_id ?? "").trim();
        const actor = await resolveActorUserId(requestedUserId, {
          requireAuthenticatedUser: true,
        });
        if (actor.error || !actor.data) {
          return {
            data: null,
            error: actor.error ?? new Error("Missing user id"),
          };
        }

        const userId = actor.data;
        const lessonId = String(payload.lesson_id ?? "").trim();
        let topicId = String(payload.topic_id ?? "").trim();
        const rawScore = Math.max(0, toInteger(payload.score, 0));
        const totalQuestions = Math.max(
          0,
          toInteger(payload.total_questions ?? payload.total, 0),
        );
        const score =
          totalQuestions > 0 ? Math.min(rawScore, totalQuestions) : rawScore;
        let pointsEarned = toInteger(payload.points_earned, 0);
        const clientAttemptId =
          String(
            payload.client_attempt_id ?? payload.attempt_id ?? "",
          ).trim() || null;

        if (!topicId && lessonId) {
          const lessonLookup = await supabase
            .from("lessons")
            .select("topic_id")
            .eq("id", lessonId)
            .maybeSingle();

          if (!lessonLookup.error && lessonLookup.data) {
            topicId = String(
              (lessonLookup.data as GenericRecord).topic_id ?? "",
            ).trim();
          }
        }

        if (pointsEarned <= 0) {
          if (totalQuestions > 0) {
            pointsEarned = Math.max(
              0,
              Math.round((score / totalQuestions) * 10),
            );
          } else {
            pointsEarned = Math.max(0, Math.round(score / 10));
          }
        }

        if (!userId) {
          return {
            data: null,
            error: new Error("Missing user_id for quiz attempt."),
          };
        }

        if (!topicId) {
          return {
            data: null,
            error: new Error(
              "Missing topic_id for quiz attempt. Pass topic_id or lesson_id with a linked topic.",
            ),
          };
        }

        if (lessonId) {
          const existingLessonAttempt = await supabase
            .from("quiz_attempts")
            .select(
              "id,user_id,lesson_id,topic_id,score,total_questions,points_earned",
            )
            .eq("user_id", userId)
            .eq("lesson_id", lessonId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!existingLessonAttempt.error && existingLessonAttempt.data) {
            return {
              data: {
                ...(existingLessonAttempt.data as GenericRecord),
                deduped: true,
                points_earned: toInteger(
                  (existingLessonAttempt.data as GenericRecord).points_earned,
                  0,
                ),
              },
              error: null,
            };
          }
        }

        if (clientAttemptId) {
          const existing = await supabase
            .from("quiz_attempts")
            .select("*")
            .eq("user_id", userId)
            .eq("client_attempt_id", clientAttemptId)
            .limit(1)
            .maybeSingle();

          if (!existing.error && existing.data) {
            return {
              data: {
                ...(existing.data as GenericRecord),
                deduped: true,
              },
              error: null,
            };
          }
        }

        if (topicId && userId) {
          const rpc = await supabase.rpc("submit_quiz_attempt", {
            p_topic_id: topicId,
            p_score: score,
            p_total_questions: totalQuestions,
            p_points_earned: pointsEarned,
            p_client_attempt_id: clientAttemptId,
          });

          if (!rpc.error) {
            const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
            if (row) {
              return { data: row as GenericRecord, error: null };
            }
          }
        }

        const normalizedPayload: GenericRecord = {
          ...payload,
          score,
          total_questions: totalQuestions,
          points_earned: pointsEarned,
          user_id: userId,
        };

        if (topicId) {
          normalizedPayload.topic_id = topicId;
        }

        if (
          payload.total !== undefined &&
          normalizedPayload.total === undefined
        ) {
          normalizedPayload.total = totalQuestions;
        }

        if (clientAttemptId) {
          normalizedPayload.client_attempt_id = clientAttemptId;
        }

        const { data, error } = await supabase
          .from("quiz_attempts")
          .insert(normalizedPayload)
          .select("*")
          .maybeSingle();

        if (error) {
          return { data: null, error };
        }

        if (userId && pointsEarned > 0) {
          await incrementEcoPoints(userId, pointsEarned);
          await incrementDailyPoints(userId, pointsEarned);
        }

        return {
          data: {
            ...(data ?? {}),
            points_earned: pointsEarned,
            total_questions: totalQuestions,
            score,
          },
          error: null,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async getHighestScore(
      userId: string,
      topicId: string,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const { data, error } = await supabase
          .from("quiz_attempts")
          .select("*")
          .eq("user_id", userId)
          .eq("topic_id", topicId)
          .order("score", { ascending: false })
          .order("total_questions", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          if (isMissingRelationError(error)) {
            return { data: null, error: null };
          }
          return { data: null, error };
        }

        return { data: (data ?? null) as GenericRecord | null, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  leaderboard: {
    async getTopUsers(
      limit = 10,
      period: LeaderboardPeriod = "all_time",
      scope: LeaderboardScope = "global",
      userId?: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const rpcCandidates = [
          supabase.rpc("get_leaderboard", {
            p_period: period,
            p_scope: scope,
            p_limit: limit,
            p_user_id: userId ?? null,
          }),
          supabase.rpc("get_leaderboard", {
            period,
            scope,
            limit,
            user_id: userId ?? null,
          }),
        ];

        for (const rpcCall of rpcCandidates) {
          const { data, error } = await rpcCall;
          if (!error) {
            const rows = ((data ?? []) as GenericRecord[]).map((row) =>
              normalizeLeaderboardRecord(row),
            );
            return { data: rows, error: null };
          }
        }

        const { data, error } = await supabase
          .from("leaderboard")
          .select("*")
          .order("eco_points", { ascending: false })
          .limit(limit);

        // Handle missing schema relation gracefully so dashboard still loads.
        if (error && isMissingRelationError(error)) {
          logTelemetry(
            "warn",
            "leaderboard_relation_missing",
            "Leaderboard relation unavailable",
            {
              code: error.code,
            },
          );
          return { data: [], error: null };
        }

        let rows = ((data ?? []) as GenericRecord[]).map((row) =>
          normalizeLeaderboardRecord(row),
        );

        if (scope === "my_school" && userId) {
          const requester = await supabase
            .from("students")
            .select("school_id")
            .eq("id", userId)
            .maybeSingle();

          const requesterSchool = String(
            (requester.data as GenericRecord | null)?.school_id ?? "",
          ).trim();
          if (requesterSchool) {
            rows = rows.filter(
              (row) => String(row.school_id ?? "") === requesterSchool,
            );
          }
        }

        if (period !== "all_time") {
          const fromDate =
            period === "this_week"
              ? new Date(
                  new Date().setDate(
                    new Date().getDate() - ((new Date().getDay() + 6) % 7),
                  ),
                )
              : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

          const weekly = await supabase
            .from("weekly_points")
            .select("user_id,points_earned,date")
            .gte("date", fromDate.toISOString().slice(0, 10));

          if (!weekly.error) {
            const sums = new Map<string, number>();
            for (const record of (weekly.data ?? []) as GenericRecord[]) {
              const uid = String(record.user_id ?? "").trim();
              if (!uid) {
                continue;
              }
              const prev = sums.get(uid) ?? 0;
              sums.set(uid, prev + Number(record.points_earned ?? 0));
            }

            rows = rows
              .map((row) => ({
                ...row,
                eco_points: sums.get(String(row.user_id ?? "")) ?? 0,
                points: sums.get(String(row.user_id ?? "")) ?? 0,
              }))
              .sort(
                (a, b) => Number(b.eco_points ?? 0) - Number(a.eco_points ?? 0),
              )
              .map((row, index, arr) => {
                const sameScoreAsPrev =
                  index > 0 &&
                  Number(row.eco_points ?? 0) ===
                    Number(arr[index - 1].eco_points ?? 0);
                const previousRank = sameScoreAsPrev ? index : index + 1;
                return {
                  ...row,
                  rank: previousRank,
                };
              })
              .slice(0, limit);
          }
        }

        return { data: rows, error };
      } catch (error) {
        logTelemetry(
          "error",
          "leaderboard_getTopUsers_error",
          "Failed to load top users",
          {
            error: String(error),
          },
        );
        return { data: [], error: asError(error) };
      }
    },

    async getRank(
      userId: string,
      period: LeaderboardPeriod = "all_time",
      scope: LeaderboardScope = "global",
    ): Promise<QueryResult<GenericRecord>> {
      try {
        // Try RPC functions first (if they exist)
        const rpcCandidates = [
          supabase.rpc("get_leaderboard_rank", {
            p_user_id: userId,
            p_period: period,
            p_scope: scope,
          }),
          supabase.rpc("get_leaderboard_rank", {
            user_id: userId,
            period,
            scope,
          }),
          supabase.rpc("get_user_rank", { p_user_id: userId }),
          supabase.rpc("get_user_rank", { user_id: userId }),
        ];

        for (const rpcCall of rpcCandidates) {
          const { data, error } = await rpcCall;
          if (!error) {
            if (Array.isArray(data)) {
              return { data: (data[0] as GenericRecord) ?? null, error: null };
            }

            return { data: (data as GenericRecord) ?? null, error: null };
          }
        }

        // Fallback: query leaderboard view directly
        const byId = await supabase
          .from("leaderboard")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

        if (!byId.error) {
          return { data: byId.data, error: null };
        }

        const byUserId = await supabase
          .from("leaderboard")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (!byUserId.error) {
          return { data: byUserId.data, error: null };
        }

        if (period !== "all_time" || scope !== "global") {
          const ranked = await this.getTopUsers(5000, period, scope, userId);
          if (!ranked.error && Array.isArray(ranked.data)) {
            const row =
              ranked.data.find(
                (entry) => String(entry.user_id ?? entry.id ?? "") === userId,
              ) ?? null;
            return { data: row, error: null };
          }
        }

        if (
          isMissingRelationError(byId.error) &&
          isMissingRelationError(byUserId.error)
        ) {
          logTelemetry(
            "warn",
            "leaderboard_getRank_relation_missing",
            "Leaderboard relation unavailable",
            {
              userId,
            },
          );
          return { data: null, error: null };
        }

        return { data: null, error: byId.error ?? byUserId.error };
      } catch (error) {
        logTelemetry(
          "error",
          "leaderboard_getRank_error",
          "Failed to resolve leaderboard rank",
          {
            error: String(error),
            userId,
          },
        );
        return { data: null, error: asError(error) };
      }
    },
  },

  notifications: {
    async getUserNotifications(
      userId: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const actor = await resolveActorUserId(userId);
        if (actor.error || !actor.data) {
          return { data: [], error: null };
        }

        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", actor.data)
          .order("created_at", { ascending: false });

        if (error && isMissingRelationError(error)) {
          return { data: [], error: null };
        }

        return { data: data ?? [], error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async create(
      payload: NotificationCreatePayload,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const { data, error } = await supabase
          .from("notifications")
          .insert(payload)
          .select("*")
          .maybeSingle();

        return { data, error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async markAsRead(
      notificationId: string,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const actor = await resolveActorUserId(undefined, {
          requireAuthenticatedUser: true,
        });
        if (actor.error || !actor.data) {
          return {
            data: null,
            error: actor.error ?? new Error("Missing user"),
          };
        }

        const { data, error } = await supabase
          .from("notifications")
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq("id", notificationId)
          .eq("user_id", actor.data)
          .select("*")
          .maybeSingle();

        return { data, error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  badges: {
    async getAll(): Promise<QueryResult<GenericRecord[]>> {
      try {
        const { data, error } = await supabase
          .from("badges")
          .select("*")
          .order("name", { ascending: true });

        return { data: data ?? [], error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async awardBadge(
      userId: string,
      badgeId: string,
    ): Promise<QueryResult<GenericRecord>> {
      try {
        const payload = {
          user_id: userId,
          badge_id: badgeId,
          awarded_at: new Date().toISOString(),
        };

        const primary = await supabase
          .from("user_badges")
          .insert(payload)
          .select("*")
          .maybeSingle();

        if (!primary.error) {
          return { data: primary.data, error: null };
        }

        const fallback = await supabase
          .from("student_badges")
          .insert(payload)
          .select("*")
          .maybeSingle();

        return { data: fallback.data, error: fallback.error };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  realtime: {
    subscribeDashboard(
      userId: string,
      onChange: () => void,
    ): RealtimeUnsubscribe {
      const channel = supabase
        .channel(`student-dashboard-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "students",
            filter: `id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_submissions",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "submissions",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .subscribe();

      return async () => {
        await supabase.removeChannel(channel as RealtimeChannel);
      };
    },

    subscribeProfile(
      userId: string,
      onChange: () => void,
    ): RealtimeUnsubscribe {
      const channel = supabase
        .channel(`student-profile-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "leaderboard" },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_badges",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "student_badges",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .subscribe();

      return async () => {
        await supabase.removeChannel(channel as RealtimeChannel);
      };
    },

    subscribeMissions(
      userId: string,
      onChange: () => void,
    ): RealtimeUnsubscribe {
      const channel = supabase
        .channel(`student-missions-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_submissions",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_submissions",
            filter: `student_id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "submissions",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "mission_step_submissions",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .subscribe();

      return async () => {
        await supabase.removeChannel(channel as RealtimeChannel);
      };
    },

    subscribeNotifications(
      userId: string,
      onChange: () => void,
    ): RealtimeUnsubscribe {
      const channel = supabase
        .channel(`student-notifications-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          onChange,
        )
        .subscribe();

      return async () => {
        await supabase.removeChannel(channel as RealtimeChannel);
      };
    },
  },

  storage: {
    async verifyBucket(): Promise<QueryResult<GenericRecord>> {
      try {
        const { data, error } = await supabase.rpc(
          "verify_mission_photos_bucket",
        );

        if (error) {
          logTelemetry(
            "warn",
            "storage_bucket_verification_failed",
            error.message,
          );
          return { data: null, error };
        }

        if (!data || data.length === 0) {
          return {
            data: null,
            error: new Error(
              "mission-photos bucket not found or not accessible",
            ),
          };
        }

        return { data: (data[0] as GenericRecord) ?? null, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async uploadMissionProof(
      payload: MissionProofUploadPayload,
      retries: number = 2,
    ): Promise<QueryResult<MissionProofUploadResult>> {
      try {
        const extension = extensionFromMimeType(payload.mimeType);
        const timestamp = Date.now();
        const filename = payload.missionId
          ? `${timestamp}`
          : `${timestamp}_${payload.missionId}`;
        const path = `${payload.userId}/${filename}.${extension}`;

        const fileResponse = await fetch(payload.localUri);
        const fileBuffer = await fileResponse.arrayBuffer();

        let lastError: PostgrestError | Error | null = null;
        let attempt = 0;

        while (attempt <= retries) {
          try {
            const uploadResponse = await Promise.race([
              supabase.storage.from("mission-photos").upload(path, fileBuffer, {
                contentType: payload.mimeType ?? "image/jpeg",
                upsert: true,
              }),
              new Promise<{ error: Error; data: null }>((resolve) => {
                setTimeout(
                  () =>
                    resolve({ error: new Error("Upload timeout"), data: null }),
                  8000 + attempt * 2000,
                );
              }),
            ]);

            if (uploadResponse.error) {
              lastError = uploadResponse.error;
              attempt += 1;

              if (attempt <= retries) {
                logTelemetry(
                  "warn",
                  "storage_upload_retry",
                  uploadResponse.error.message,
                  {
                    attempt,
                    retries,
                    path,
                  },
                );
                await new Promise((resolve) =>
                  setTimeout(resolve, 800 * attempt),
                );
                continue;
              }
            } else {
              const urlResponse = supabase.storage
                .from("mission-photos")
                .getPublicUrl(path);
              return {
                data: {
                  bucket: "mission-photos",
                  path,
                  publicUrl: urlResponse.data.publicUrl,
                },
                error: null,
              };
            }
          } catch (error) {
            lastError = asError(error);
            attempt += 1;

            if (attempt <= retries) {
              logTelemetry(
                "warn",
                "storage_upload_exception_retry",
                getErrorMessage(lastError),
                {
                  attempt,
                  retries,
                },
              );
              await new Promise((resolve) =>
                setTimeout(resolve, 800 * attempt),
              );
              continue;
            }
          }
        }

        logTelemetry(
          "error",
          "storage_upload_failed_after_retries",
          getErrorMessage(lastError),
          {
            retries,
            path,
          },
        );

        return {
          data: null,
          error:
            lastError ??
            new Error("Failed to upload mission proof after retries."),
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async submitProof(
      submissionId: string,
      photoUrl: string,
      notes?: string,
      coords?: { lat: number; lng: number },
    ): Promise<QueryResult<GenericRecord>> {
      try {
        if (!submissionId || !photoUrl) {
          return {
            data: null,
            error: new Error("submissionId and photoUrl are required"),
          };
        }

        const rpc = await supabase.rpc("submit_proof_for_submission", {
          p_submission_id: submissionId,
          p_photo_url: photoUrl,
          p_notes: normalizeTextInput(notes),
          p_latitude: coords?.lat ?? null,
          p_longitude: coords?.lng ?? null,
        });

        if (rpc.error) {
          logTelemetry(
            "error",
            "storage_submitproof_rpc_failed",
            rpc.error.message,
            {
              submissionId,
            },
          );
          return { data: null, error: rpc.error };
        }

        if (!rpc.data || rpc.data.length === 0) {
          return {
            data: null,
            error: new Error("No submission returned from RPC"),
          };
        }

        return {
          data: (rpc.data[0] as GenericRecord) ?? null,
          error: null,
        };
      } catch (error) {
        logTelemetry(
          "error",
          "storage_submitproof_exception",
          getErrorMessage(asError(error)),
          {
            submissionId,
          },
        );
        return { data: null, error: asError(error) };
      }
    },
  },
};
