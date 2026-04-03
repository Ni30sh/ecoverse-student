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

type SchoolContext = {
  schoolId: string;
  schoolName: string;
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

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const TEACHER_FALLBACK_LABEL = "your teacher";
const MISSION_SUBMISSION_DEBUG = Boolean(
  (globalThis as { __DEV__?: boolean }).__DEV__,
);

function debugMissionSubmission(
  stage: string,
  details?: Record<string, unknown>,
) {
  if (!MISSION_SUBMISSION_DEBUG) {
    return;
  }

  console.log(`[mission-submission-debug] ${stage}`, details ?? {});
}

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

function normalizeSchoolNameForMatch(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function extractUuidTokens(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return [] as string[];
  }

  const matches = value.match(UUID_PATTERN) ?? [];
  return matches.map((id) => id.toLowerCase());
}

function replaceReviewerIdsInText(
  value: unknown,
  nameById: Map<string, string>,
) {
  if (typeof value !== "string" || !value.trim()) {
    return value;
  }

  return value.replace(UUID_PATTERN, (rawId) => {
    const key = rawId.toLowerCase();
    return nameById.get(key) ?? TEACHER_FALLBACK_LABEL;
  });
}

async function resolveSchoolContextForUser(
  userId: string,
): Promise<QueryResult<SchoolContext>> {
  try {
    const normalizedUserId = String(userId ?? "").trim();
    if (!normalizedUserId) {
      return {
        data: { schoolId: "", schoolName: "" },
        error: null,
      };
    }

    const studentLookup = await supabase
      .from("students")
      .select("school_id,school_name")
      .eq("id", normalizedUserId)
      .maybeSingle();

    if (!studentLookup.error && studentLookup.data) {
      const row = studentLookup.data as GenericRecord;
      return {
        data: {
          schoolId: String(row.school_id ?? "").trim(),
          schoolName: String(row.school_name ?? "").trim(),
        },
        error: null,
      };
    }

    const profileLookup = await supabase
      .from("profiles")
      .select("school_id,school_name")
      .or(`id.eq.${normalizedUserId},user_id.eq.${normalizedUserId}`)
      .limit(1)
      .maybeSingle();

    if (!profileLookup.error && profileLookup.data) {
      const row = profileLookup.data as GenericRecord;
      return {
        data: {
          schoolId: String(row.school_id ?? "").trim(),
          schoolName: String(row.school_name ?? "").trim(),
        },
        error: null,
      };
    }

    return {
      data: { schoolId: "", schoolName: "" },
      error: studentLookup.error ?? profileLookup.error,
    };
  } catch (error) {
    return { data: null, error: asError(error) };
  }
}

async function resolveReviewerNameMapForStudent(
  userId: string,
  reviewerIds: string[],
): Promise<QueryResult<Map<string, string>>> {
  try {
    const uniqueIds = Array.from(
      new Set(
        reviewerIds
          .map((id) =>
            String(id ?? "")
              .trim()
              .toLowerCase(),
          )
          .filter((id) => id.length > 0),
      ),
    );

    if (uniqueIds.length === 0) {
      return { data: new Map<string, string>(), error: null };
    }

    const schoolContext = await resolveSchoolContextForUser(userId);
    if (schoolContext.error || !schoolContext.data) {
      return {
        data: new Map<string, string>(),
        error: schoolContext.error,
      };
    }

    const requesterSchoolId = String(schoolContext.data.schoolId ?? "").trim();
    const requesterSchoolName = normalizeSchoolNameForMatch(
      schoolContext.data.schoolName,
    );

    const profileLookup = await supabase
      .from("profiles")
      .select("id,full_name,name,email,role,school_id,school_name")
      .in("id", uniqueIds);

    if (profileLookup.error) {
      return { data: new Map<string, string>(), error: profileLookup.error };
    }

    const names = new Map<string, string>();
    for (const row of (profileLookup.data ?? []) as GenericRecord[]) {
      const id = String(row.id ?? "")
        .trim()
        .toLowerCase();
      if (!id) {
        continue;
      }

      const role = String(row.role ?? "")
        .trim()
        .toLowerCase();
      if (role && role !== "teacher" && role !== "admin") {
        continue;
      }

      const teacherSchoolId = String(row.school_id ?? "").trim();
      const teacherSchoolName = normalizeSchoolNameForMatch(row.school_name);

      const sameSchoolById =
        Boolean(requesterSchoolId) &&
        Boolean(teacherSchoolId) &&
        requesterSchoolId === teacherSchoolId;
      const sameSchoolByName =
        Boolean(requesterSchoolName) &&
        Boolean(teacherSchoolName) &&
        requesterSchoolName === teacherSchoolName;

      if (!sameSchoolById && !sameSchoolByName) {
        continue;
      }

      const displayName =
        String(row.full_name ?? "").trim() ||
        String(row.name ?? "").trim() ||
        String(row.email ?? "").trim();
      if (!displayName) {
        continue;
      }

      names.set(id, displayName);
    }

    return { data: names, error: null };
  } catch (error) {
    return { data: null, error: asError(error) };
  }
}

async function sanitizeNotificationsForStudent(
  userId: string,
  rows: GenericRecord[],
): Promise<QueryResult<GenericRecord[]>> {
  try {
    if (rows.length === 0) {
      return { data: [], error: null };
    }

    const reviewerIds = new Set<string>();
    for (const row of rows) {
      for (const token of extractUuidTokens(row.title)) {
        reviewerIds.add(token);
      }
      for (const token of extractUuidTokens(row.body)) {
        reviewerIds.add(token);
      }
      for (const token of extractUuidTokens(row.reviewed_by)) {
        reviewerIds.add(token);
      }
    }

    if (reviewerIds.size === 0) {
      return { data: rows, error: null };
    }

    const nameMapResult = await resolveReviewerNameMapForStudent(
      userId,
      Array.from(reviewerIds),
    );
    if (nameMapResult.error || !nameMapResult.data) {
      return { data: rows, error: null };
    }
    const nameMap = nameMapResult.data;

    const sanitized = rows.map((row) => {
      const reviewedByValue = String(row.reviewed_by ?? "").trim();
      const reviewedByName = reviewedByValue
        ? (nameMap.get(reviewedByValue.toLowerCase()) ?? TEACHER_FALLBACK_LABEL)
        : "";

      return {
        ...row,
        title: replaceReviewerIdsInText(row.title, nameMap),
        body: replaceReviewerIdsInText(row.body, nameMap),
        reviewed_by_name: reviewedByName || row.reviewed_by_name,
      };
    });

    return { data: sanitized, error: null };
  } catch (error) {
    return { data: rows, error: null };
  }
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
          isMissingRelationError(missionTable.error) &&
          isMissingRelationError(studentFallback.error) &&
          isMissingRelationError(canonical.error)
        ) {
          return { data: null, error: null };
        }

        return {
          data: null,
          error: missionTable.error ?? studentFallback.error ?? canonical.error,
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

    async getUserSubmissions(
      userId: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const primary = await supabase
          .from("mission_submissions")
          .select("*")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });

        const studentIdFallback = await supabase
          .from("mission_submissions")
          .select("*")
          .eq("student_id", userId)
          .order("created_at", { ascending: false });

        const canonical = await supabase
          .from("submissions")
          .select("*")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });

        const primaryRows = !primary.error
          ? ((primary.data ?? []) as GenericRecord[])
          : [];
        const studentFallbackRows = !studentIdFallback.error
          ? ((studentIdFallback.data ?? []) as GenericRecord[])
          : [];
        const canonicalRows = !canonical.error
          ? ((canonical.data ?? []) as GenericRecord[])
          : [];

        if (!primary.error || !studentIdFallback.error || !canonical.error) {
          const byKey = new Map<string, GenericRecord>();

          const pushRows = (rows: GenericRecord[], priority: "canonical" | "mission") => {
            for (const row of rows) {
              const missionKey = String(row.mission_id ?? "").trim();
              const idKey = String(row.id ?? "").trim();
              const key = missionKey ? `mission:${missionKey}` : `id:${idKey}`;
              if (!key || key === "id:") {
                continue;
              }

              if (priority === "mission" || !byKey.has(key)) {
                byKey.set(key, row);
              }
            }
          };

          // Keep canonical rows for compatibility, but let mission_submissions win when both exist.
          pushRows(canonicalRows, "canonical");
          pushRows(primaryRows, "mission");
          pushRows(studentFallbackRows, "mission");

          const merged = Array.from(byKey.values()).sort((a, b) => {
            const aTime = Date.parse(
              String(a.updated_at ?? a.submitted_at ?? a.created_at ?? ""),
            );
            const bTime = Date.parse(
              String(b.updated_at ?? b.submitted_at ?? b.created_at ?? ""),
            );
            return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
          });

          return {
            data: normalizeSubmissionRows(merged),
            error: null,
          };
        }

        if (
          isMissingRelationError(primary.error) &&
          isMissingRelationError(studentIdFallback.error) &&
          isMissingRelationError(canonical.error)
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
          error: primary.error ?? studentIdFallback.error ?? canonical.error,
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
          debugMissionSubmission("create_auth_resolution_failed", {
            payload,
            error: String(actor.error?.message ?? "Missing user id"),
          });
          return {
            data: null,
            error: actor.error ?? new Error("Missing user id"),
          };
        }

        const effectiveUserId = actor.data;
        debugMissionSubmission("create_start", {
          payload,
          effectiveUserId,
          targetTable: "public.mission_submissions",
        });

        // Prevent duplicates by reusing existing submission for this user+mission.
        const existing = await this.getSubmissionForMission(
          effectiveUserId,
          payload.mission_id,
        );
        if (!existing.error && existing.data) {
          debugMissionSubmission("create_existing_found", {
            submissionId: existing.data.id,
            status: existing.data.status,
            missionId: existing.data.mission_id,
            userId: existing.data.user_id,
          });

          const currentStatus = String(
            existing.data.status ?? "",
          ).toLowerCase();

          // Rejected submissions can be retried by moving back to in_progress.
          if (currentStatus === "rejected") {
            const reactivatePayload: GenericRecord = {
              status: "in_progress",
              updated_at: new Date().toISOString(),
            };

            debugMissionSubmission("create_reactivate_mission_submissions_request", {
              submissionId: String(existing.data.id ?? ""),
              payload: reactivatePayload,
            });

            const missionTableReactivation = await supabase
              .from("mission_submissions")
              .update(reactivatePayload)
              .eq("id", String(existing.data.id ?? ""))
              .eq("user_id", effectiveUserId)
              .select("*")
              .maybeSingle();

            debugMissionSubmission("create_reactivate_mission_submissions_response", {
              submissionId: String(existing.data.id ?? ""),
              error: missionTableReactivation.error
                ? {
                    message: missionTableReactivation.error.message,
                    code: missionTableReactivation.error.code,
                    details: missionTableReactivation.error.details,
                    hint: missionTableReactivation.error.hint,
                  }
                : null,
              row: missionTableReactivation.data
                ? {
                    id: (missionTableReactivation.data as GenericRecord).id,
                    status: (missionTableReactivation.data as GenericRecord)
                      .status,
                    submitted_at: (missionTableReactivation.data as GenericRecord)
                      .submitted_at,
                  }
                : null,
            });

            if (
              !missionTableReactivation.error &&
              missionTableReactivation.data
            ) {
              return {
                data: normalizeSubmissionRecord(
                  missionTableReactivation.data as GenericRecord,
                ),
                error: null,
              };
            }

            const canonicalReactivation = await supabase
              .from("submissions")
              .update(reactivatePayload)
              .eq("id", String(existing.data.id ?? ""))
              .eq("user_id", effectiveUserId)
              .select("*")
              .maybeSingle();

            debugMissionSubmission("create_reactivate_submissions_fallback_response", {
              submissionId: String(existing.data.id ?? ""),
              error: canonicalReactivation.error
                ? {
                    message: canonicalReactivation.error.message,
                    code: canonicalReactivation.error.code,
                    details: canonicalReactivation.error.details,
                    hint: canonicalReactivation.error.hint,
                  }
                : null,
              row: canonicalReactivation.data
                ? {
                    id: (canonicalReactivation.data as GenericRecord).id,
                    status: (canonicalReactivation.data as GenericRecord).status,
                    submitted_at: (canonicalReactivation.data as GenericRecord)
                      .submitted_at,
                  }
                : null,
            });

            if (!canonicalReactivation.error && canonicalReactivation.data) {
              return {
                data: normalizeSubmissionRecord(
                  canonicalReactivation.data as GenericRecord,
                ),
                error: null,
              };
            }
          }

          return { data: existing.data, error: null };
        }

        const insertPayload = {
          user_id: effectiveUserId,
          mission_id: payload.mission_id,
          status: "in_progress",
          updated_at: new Date().toISOString(),
        };

        debugMissionSubmission("create_mission_submissions_upsert_request", {
          payload: insertPayload,
          onConflict: "user_id,mission_id",
        });

        const primary = await supabase
          .from("mission_submissions")
          .upsert(insertPayload, { onConflict: "user_id,mission_id" })
          .select("*")
          .maybeSingle();

        debugMissionSubmission("create_mission_submissions_upsert_response", {
          error: primary.error
            ? {
                message: primary.error.message,
                code: primary.error.code,
                details: primary.error.details,
                hint: primary.error.hint,
              }
            : null,
          row: primary.data
            ? {
                id: (primary.data as GenericRecord).id,
                status: (primary.data as GenericRecord).status,
                submitted_at: (primary.data as GenericRecord).submitted_at,
                user_id: (primary.data as GenericRecord).user_id,
              }
            : null,
        });

        const primaryNotNullSubmittedAt =
          !!primary.error &&
          /submitted_at/i.test(String(primary.error.message ?? "")) &&
          /not-null|null value/i.test(String(primary.error.message ?? ""));

        const primaryInvalidStatus =
          !!primary.error &&
          /status/i.test(String(primary.error.message ?? "")) &&
          /(constraint|check)/i.test(String(primary.error.message ?? ""));

        if (primaryNotNullSubmittedAt) {
          const primaryCompat = await supabase
            .from("mission_submissions")
            .upsert(
              {
                ...insertPayload,
                submitted_at: new Date().toISOString(),
              },
              { onConflict: "user_id,mission_id" },
            )
            .select("*")
            .maybeSingle();

          debugMissionSubmission(
            "create_mission_submissions_not_null_submitted_at_compat_response",
            {
              error: primaryCompat.error
                ? {
                    message: primaryCompat.error.message,
                    code: primaryCompat.error.code,
                    details: primaryCompat.error.details,
                    hint: primaryCompat.error.hint,
                  }
                : null,
              row: primaryCompat.data
                ? {
                    id: (primaryCompat.data as GenericRecord).id,
                    status: (primaryCompat.data as GenericRecord).status,
                    submitted_at: (primaryCompat.data as GenericRecord)
                      .submitted_at,
                  }
                : null,
            },
          );

          if (!primaryCompat.error) {
            return {
              data: primaryCompat.data
                ? normalizeSubmissionRecord(primaryCompat.data as GenericRecord)
                : null,
              error: null,
            };
          }
        }

        if (primaryInvalidStatus) {
          const primaryCompat = await supabase
            .from("mission_submissions")
            .upsert(
              {
                ...insertPayload,
                status: "pending",
                submitted_at: new Date().toISOString(),
              },
              { onConflict: "user_id,mission_id" },
            )
            .select("*")
            .maybeSingle();

          debugMissionSubmission(
            "create_mission_submissions_status_compat_response",
            {
              error: primaryCompat.error
                ? {
                    message: primaryCompat.error.message,
                    code: primaryCompat.error.code,
                    details: primaryCompat.error.details,
                    hint: primaryCompat.error.hint,
                  }
                : null,
              row: primaryCompat.data
                ? {
                    id: (primaryCompat.data as GenericRecord).id,
                    status: (primaryCompat.data as GenericRecord).status,
                    submitted_at: (primaryCompat.data as GenericRecord)
                      .submitted_at,
                  }
                : null,
            },
          );

          if (!primaryCompat.error) {
            return {
              data: primaryCompat.data
                ? normalizeSubmissionRecord(primaryCompat.data as GenericRecord)
                : null,
              error: null,
            };
          }
        }

        if (!primary.error) {
          return {
            data: primary.data
              ? normalizeSubmissionRecord(primary.data as GenericRecord)
              : null,
            error: null,
          };
        }

        debugMissionSubmission("create_mission_submissions_insert_student_id_request", {
          payload: { ...insertPayload, student_id: insertPayload.user_id },
        });

        const fallback = await supabase
          .from("mission_submissions")
          .insert({ ...insertPayload, student_id: insertPayload.user_id })
          .select("*")
          .maybeSingle();

        debugMissionSubmission("create_mission_submissions_insert_student_id_response", {
          error: fallback.error
            ? {
                message: fallback.error.message,
                code: fallback.error.code,
                details: fallback.error.details,
                hint: fallback.error.hint,
              }
            : null,
          row: fallback.data
            ? {
                id: (fallback.data as GenericRecord).id,
                status: (fallback.data as GenericRecord).status,
                submitted_at: (fallback.data as GenericRecord).submitted_at,
              }
            : null,
        });

        if (!fallback.error) {
          return {
            data: fallback.data
              ? normalizeSubmissionRecord(fallback.data as GenericRecord)
              : null,
            error: null,
          };
        }

        const canonicalDiagnostic = await supabase
          .from("submissions")
          .upsert(insertPayload, { onConflict: "user_id,mission_id" })
          .select("id,status,submitted_at,user_id,mission_id")
          .maybeSingle();

        debugMissionSubmission("create_submissions_diagnostic_response", {
          error: canonicalDiagnostic.error
            ? {
                message: canonicalDiagnostic.error.message,
                code: canonicalDiagnostic.error.code,
                details: canonicalDiagnostic.error.details,
                hint: canonicalDiagnostic.error.hint,
              }
            : null,
          row: canonicalDiagnostic.data ?? null,
        });

        logTelemetry(
          "error",
          "mission_submissions_create_failed",
          "Failed to write mission submission to public.mission_submissions",
          {
            userId: effectiveUserId,
            missionId: payload.mission_id,
            primaryError: primary.error?.message,
            fallbackError: fallback.error?.message,
            canonicalDiagnosticError: canonicalDiagnostic.error?.message,
          },
        );

        return {
          data: null,
          error:
            primary.error ??
            fallback.error ??
            canonicalDiagnostic.error ??
            new Error("Failed to write mission submission to mission_submissions"),
        };
      } catch (error) {
        debugMissionSubmission("create_exception", {
          error: {
            message: asError(error).message,
            stack: asError(error).stack,
          },
        });
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

        const authSnapshot = await supabase.auth.getUser();
        const authUserId = String(authSnapshot.data.user?.id ?? "").trim();
        debugMissionSubmission("submit_start", {
          submissionId,
          authUserId,
          payload: {
            photoUrl,
            notes,
            location,
          },
          targetTable: "public.mission_submissions",
        });

        // Fetch current submission so repeated submits are idempotent
        const missionCurrentLookup = await supabase
          .from("mission_submissions")
          .select("*")
          .eq("id", submissionId)
          .maybeSingle();

        const canonicalFallbackLookup =
          missionCurrentLookup.error || !missionCurrentLookup.data
            ? await supabase
                .from("submissions")
                .select("*")
                .eq("id", submissionId)
                .maybeSingle()
            : null;

        debugMissionSubmission("submit_current_lookup_response", {
          missionSubmissions: {
            error: missionCurrentLookup.error
              ? {
                  message: missionCurrentLookup.error.message,
                  code: missionCurrentLookup.error.code,
                  details: missionCurrentLookup.error.details,
                  hint: missionCurrentLookup.error.hint,
                }
              : null,
            row: missionCurrentLookup.data
              ? {
                  id: (missionCurrentLookup.data as GenericRecord).id,
                  status: (missionCurrentLookup.data as GenericRecord).status,
                  submitted_at: (missionCurrentLookup.data as GenericRecord)
                    .submitted_at,
                }
              : null,
          },
          submissions: {
            error: canonicalFallbackLookup?.error
              ? {
                  message: canonicalFallbackLookup.error.message,
                  code: canonicalFallbackLookup.error.code,
                  details: canonicalFallbackLookup.error.details,
                  hint: canonicalFallbackLookup.error.hint,
                }
              : null,
            row: canonicalFallbackLookup?.data
              ? {
                  id: (canonicalFallbackLookup.data as GenericRecord).id,
                  status: (canonicalFallbackLookup.data as GenericRecord).status,
                  submitted_at: (canonicalFallbackLookup.data as GenericRecord)
                    .submitted_at,
                }
              : null,
          },
        });

        const current = normalizeSubmissionRecord(
          (missionCurrentLookup.data ??
            canonicalFallbackLookup?.data ??
            {}) as GenericRecord,
        );
        const currentStatus = String(current?.status ?? "").toLowerCase();
        const currentMissionId = String(current?.mission_id ?? "").trim();

        if (
          current &&
          (currentStatus === "pending" || currentStatus === "approved") &&
          String(current.photo_url ?? "").trim()
        ) {
          return {
            data: {
              ...current,
              idempotent: true,
            },
            error: null,
          };
        }

        // Try RPC paths first (source of truth for status/rewards)
        const rpcCandidates = [
          {
            name: "submit_mission_proof_p_params",
            run: () =>
            supabase.rpc("submit_mission_proof", {
              p_submission_id: submissionId,
              p_mission_id: currentMissionId || null,
              p_photo_url: photoUrl,
              p_notes: normalizeTextInput(notes),
              p_latitude: location?.lat ?? null,
              p_longitude: location?.lng ?? null,
            }),
          },
          {
            name: "submit_mission_proof_plain_params",
            run: () =>
            supabase.rpc("submit_mission_proof", {
              submission_id: submissionId,
              mission_id: currentMissionId || null,
              photo_url: photoUrl,
              notes: normalizeTextInput(notes),
              latitude: location?.lat ?? null,
              longitude: location?.lng ?? null,
            }),
          },
          {
            name: "submit_proof_for_submission",
            run: () =>
            supabase.rpc("submit_proof_for_submission", {
              p_submission_id: submissionId,
              p_photo_url: photoUrl,
              p_notes: normalizeTextInput(notes),
              p_latitude: location?.lat ?? null,
              p_longitude: location?.lng ?? null,
            }),
          },
        ];

        for (const rpcCandidate of rpcCandidates) {
          debugMissionSubmission("submit_rpc_request", {
            submissionId,
            rpc: rpcCandidate.name,
          });

          const rpcResult = await rpcCandidate.run();

          debugMissionSubmission("submit_rpc_response", {
            submissionId,
            rpc: rpcCandidate.name,
            error: rpcResult.error
              ? {
                  message: rpcResult.error.message,
                  code: rpcResult.error.code,
                  details: rpcResult.error.details,
                  hint: rpcResult.error.hint,
                }
              : null,
            dataType: Array.isArray(rpcResult.data)
              ? "array"
              : typeof rpcResult.data,
          });

          if (rpcResult.error) {
            continue;
          }

          // Explicitly verify row in mission_submissions before trusting RPC response.
          const rpcMissionRow = await supabase
            .from("mission_submissions")
            .select("*")
            .eq("id", submissionId)
            .maybeSingle();

          debugMissionSubmission("submit_rpc_postcheck_mission_submissions", {
            submissionId,
            rpc: rpcCandidate.name,
            error: rpcMissionRow.error
              ? {
                  message: rpcMissionRow.error.message,
                  code: rpcMissionRow.error.code,
                  details: rpcMissionRow.error.details,
                  hint: rpcMissionRow.error.hint,
                }
              : null,
            row: rpcMissionRow.data
              ? {
                  id: (rpcMissionRow.data as GenericRecord).id,
                  status: (rpcMissionRow.data as GenericRecord).status,
                  submitted_at: (rpcMissionRow.data as GenericRecord)
                    .submitted_at,
                }
              : null,
          });

          if (!rpcMissionRow.error && rpcMissionRow.data) {
            return {
              data: normalizeSubmissionRecord(
                rpcMissionRow.data as GenericRecord,
              ),
              error: null,
            };
          }
        }

        // Fallback: Direct table update (only use columns that definitely exist: photo_url)
        const updatePayload: GenericRecord = {
          photo_url: photoUrl,
          status: "pending",
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (notes && normalizeTextInput(notes)) {
          updatePayload.notes = normalizeTextInput(notes);
        }

        if (location?.lat !== undefined && location?.lat !== null) {
          updatePayload.latitude = location.lat;
        }

        if (location?.lng !== undefined && location?.lng !== null) {
          updatePayload.longitude = location.lng;
        }

        debugMissionSubmission("submit_mission_submissions_update_request", {
          submissionId,
          payload: updatePayload,
        });

        const missionUpdate = await supabase
          .from("mission_submissions")
          .update(updatePayload)
          .eq("id", submissionId)
          .select("*")
          .maybeSingle();

        debugMissionSubmission("submit_mission_submissions_update_response", {
          submissionId,
          error: missionUpdate.error
            ? {
                message: missionUpdate.error.message,
                code: missionUpdate.error.code,
                details: missionUpdate.error.details,
                hint: missionUpdate.error.hint,
              }
            : null,
          row: missionUpdate.data
            ? {
                id: (missionUpdate.data as GenericRecord).id,
                status: (missionUpdate.data as GenericRecord).status,
                submitted_at: (missionUpdate.data as GenericRecord).submitted_at,
              }
            : null,
        });

        if (!missionUpdate.error && missionUpdate.data) {
          const normalized = normalizeSubmissionRecord(
            missionUpdate.data as GenericRecord,
          );
          logTelemetry(
            "info",
            "submitproof_mission_submissions_update_success",
            `Submission ${submissionId} updated in mission_submissions: status=${normalized.status}, submitted_at=${normalized.submitted_at}`,
            {
              submissionId,
              updatedStatus: normalized.status,
              submittedAt: normalized.submitted_at,
              table: "mission_submissions",
            },
          );
          return {
            data: normalized,
            error: null,
          };
        }

        const canonicalUpdate = await supabase
          .from("submissions")
          .update(updatePayload)
          .eq("id", submissionId)
          .select("*")
          .maybeSingle();

        debugMissionSubmission("submit_submissions_fallback_update_response", {
          submissionId,
          error: canonicalUpdate.error
            ? {
                message: canonicalUpdate.error.message,
                code: canonicalUpdate.error.code,
                details: canonicalUpdate.error.details,
                hint: canonicalUpdate.error.hint,
              }
            : null,
          row: canonicalUpdate.data
            ? {
                id: (canonicalUpdate.data as GenericRecord).id,
                status: (canonicalUpdate.data as GenericRecord).status,
                submitted_at: (canonicalUpdate.data as GenericRecord)
                  .submitted_at,
              }
            : null,
        });

        if (!canonicalUpdate.error && canonicalUpdate.data) {
          const canonicalNormalized = normalizeSubmissionRecord(
            canonicalUpdate.data as GenericRecord,
          );

          const mirrorPayload: GenericRecord = {
            id: canonicalNormalized.id,
            user_id: canonicalNormalized.user_id,
            student_id:
              canonicalNormalized.student_id ?? canonicalNormalized.user_id,
            mission_id: canonicalNormalized.mission_id,
            status: canonicalNormalized.status ?? "pending",
            photo_url: canonicalNormalized.photo_url ?? photoUrl,
            notes:
              canonicalNormalized.notes ?? normalizeTextInput(notes) ?? null,
            latitude: canonicalNormalized.latitude ?? location?.lat ?? null,
            longitude: canonicalNormalized.longitude ?? location?.lng ?? null,
            submitted_at:
              canonicalNormalized.submitted_at ?? updatePayload.submitted_at,
            updated_at: new Date().toISOString(),
          };

          debugMissionSubmission("submit_mission_submissions_mirror_request", {
            submissionId,
            payload: mirrorPayload,
          });

          const mirrorToMissionTable = await supabase
            .from("mission_submissions")
            .upsert(mirrorPayload, { onConflict: "id" })
            .select("*")
            .maybeSingle();

          debugMissionSubmission("submit_mission_submissions_mirror_response", {
            submissionId,
            error: mirrorToMissionTable.error
              ? {
                  message: mirrorToMissionTable.error.message,
                  code: mirrorToMissionTable.error.code,
                  details: mirrorToMissionTable.error.details,
                  hint: mirrorToMissionTable.error.hint,
                }
              : null,
            row: mirrorToMissionTable.data
              ? {
                  id: (mirrorToMissionTable.data as GenericRecord).id,
                  status: (mirrorToMissionTable.data as GenericRecord).status,
                  submitted_at: (mirrorToMissionTable.data as GenericRecord)
                    .submitted_at,
                }
              : null,
          });

          if (!mirrorToMissionTable.error && mirrorToMissionTable.data) {
            return {
              data: normalizeSubmissionRecord(
                mirrorToMissionTable.data as GenericRecord,
              ),
              error: null,
            };
          }

          return {
            data: null,
            error:
              mirrorToMissionTable.error ??
              new Error(
                "Proof submitted to submissions but failed to mirror into mission_submissions.",
              ),
          };
        }

        logTelemetry(
          "error",
          "submitproof_mission_submissions_update_failed",
          `Mission_submissions update failed for ${submissionId}`,
          {
            submissionId,
            missionSubmissionsError: missionUpdate.error?.message,
            canonicalFallbackError: canonicalUpdate.error?.message,
          },
        );

        logTelemetry(
          "error",
          "missionsubmissions_submitproof_failed",
          "All proof submission paths exhausted (RPC + mission_submissions update + submissions fallback)",
          {
            submissionId,
            canonicalError: canonicalUpdate.error?.message,
            missionSubmissionsError: missionUpdate.error?.message,
          },
        );

        return {
          data: null,
          error: new Error(
            "Proof submission failed: mission_submissions update did not persist pending state.",
          ),
        };
      } catch (error) {
        debugMissionSubmission("submit_exception", {
          submissionId,
          error: {
            message: asError(error).message,
            stack: asError(error).stack,
          },
        });
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

    async withdrawSubmission(
      submissionId: string,
      options?: { clearProof?: boolean },
    ): Promise<QueryResult<GenericRecord>> {
      try {
        if (!submissionId) {
          return {
            data: null,
            error: new Error("submissionId is required"),
          };
        }

        const actor = await resolveActorUserId(undefined, {
          requireAuthenticatedUser: true,
        });
        if (actor.error || !actor.data) {
          return {
            data: null,
            error: actor.error ?? new Error("Missing authenticated user id"),
          };
        }

        const clearProof = options?.clearProof ?? true;
        const updatePayload: GenericRecord = {
          status: "in_progress",
          submitted_at: null,
          reviewed_at: null,
          reviewed_by: null,
          updated_at: new Date().toISOString(),
        };

        if (clearProof) {
          updatePayload.photo_url = null;
          updatePayload.proof_url = null;
          updatePayload.proof_photo_url = null;
          updatePayload.proof_metadata = null;
        }

        const canonical = await supabase
          .from("submissions")
          .update(updatePayload)
          .eq("id", submissionId)
          .eq("user_id", actor.data)
          .select("*")
          .maybeSingle();

        if (!canonical.error && canonical.data) {
          return {
            data: normalizeSubmissionRecord(canonical.data as GenericRecord),
            error: null,
          };
        }

        const legacy = await supabase
          .from("mission_submissions")
          .update(updatePayload)
          .eq("id", submissionId)
          .or(`user_id.eq.${actor.data},student_id.eq.${actor.data}`)
          .select("*")
          .maybeSingle();

        if (!legacy.error && legacy.data) {
          return {
            data: normalizeSubmissionRecord(legacy.data as GenericRecord),
            error: null,
          };
        }

        return {
          data: null,
          error: canonical.error ?? legacy.error ?? new Error("Withdraw failed"),
        };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  missionSteps: {
    async getByMissionId(
      missionId: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const orderCandidates = ["step_order", "step_number", "order_index"];
        let lastError: PostgrestError | Error | null = null;

        for (const column of orderCandidates) {
          const response = await supabase
            .from("mission_steps")
            .select("*")
            .eq("mission_id", missionId)
            .order(column, { ascending: true });

          if (!response.error) {
            return {
              data: (response.data ?? []) as GenericRecord[],
              error: null,
            };
          }

          lastError = response.error;
        }

        // Final fallback: load rows without server-side ordering and sort client-side.
        const fallback = await supabase
          .from("mission_steps")
          .select("*")
          .eq("mission_id", missionId);

        if (!fallback.error) {
          const rows = ((fallback.data ?? []) as GenericRecord[]).sort(
            (a, b) => {
              const aOrder = Number(
                a.step_order ?? a.step_number ?? a.order_index ?? 0,
              );
              const bOrder = Number(
                b.step_order ?? b.step_number ?? b.order_index ?? 0,
              );
              return aOrder - bOrder;
            },
          );
          return { data: rows, error: null };
        }

        return { data: null, error: fallback.error ?? lastError };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },
  },

  missionStepSubmissions: {
    async getBySubmissionId(
      submissionId: string,
    ): Promise<QueryResult<GenericRecord[]>> {
      try {
        const candidates = [
          supabase
            .from("mission_step_submissions")
            .select("*")
            .eq("submission_id", submissionId)
            .order("updated_at", { ascending: false }),
          supabase
            .from("mission_step_submissions")
            .select("*")
            .eq("mission_submission_id", submissionId)
            .order("updated_at", { ascending: false }),
        ];

        let lastError: PostgrestError | Error | null = null;
        for (const call of candidates) {
          const { data, error } = await call;
          if (!error) {
            return { data: (data ?? []) as GenericRecord[], error: null };
          }
          lastError = error;
        }

        if (isMissingRelationError(lastError)) {
          return { data: [], error: null };
        }

        return { data: null, error: lastError };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    },

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

        const rawRows = (data ?? []) as GenericRecord[];
        const sanitized = await sanitizeNotificationsForStudent(
          actor.data,
          rawRows,
        );

        return {
          data: sanitized.data ?? rawRows,
          error,
        };
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
          .upsert(payload, { onConflict: "user_id,badge_id" })
          .select("*")
          .maybeSingle();

        if (!primary.error) {
          return { data: primary.data, error: null };
        }

        const primaryMessage = String(primary.error.message ?? "").toLowerCase();
        const shouldFallbackToStudentBadges =
          primaryMessage.includes("user_badges") &&
          (primaryMessage.includes("could not find") ||
            primaryMessage.includes("does not exist") ||
            primaryMessage.includes("schema cache"));

        if (!shouldFallbackToStudentBadges) {
          return { data: null, error: primary.error };
        }

        const fallback = await supabase
          .from("student_badges")
          .upsert(payload, { onConflict: "user_id,badge_id" })
          .select("*")
          .maybeSingle();

        const fallbackMessage = String(fallback.error?.message ?? "").toLowerCase();
        const fallbackMissingTable =
          fallbackMessage.includes("student_badges") &&
          (fallbackMessage.includes("could not find") ||
            fallbackMessage.includes("does not exist") ||
            fallbackMessage.includes("schema cache"));

        if (fallbackMissingTable) {
          return { data: null, error: primary.error };
        }

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
        const actor = await resolveActorUserId(payload.userId, {
          requireAuthenticatedUser: true,
        });

        if (actor.error || !actor.data) {
          return {
            data: null,
            error: actor.error ?? new Error("Missing authenticated user id."),
          };
        }

        const extension = extensionFromMimeType(payload.mimeType);
        const timestamp = Date.now();
        const filename = payload.missionId
          ? `${timestamp}`
          : `${timestamp}_${payload.missionId}`;
        const path = `${actor.data}/${filename}.${extension}`;

        const fileResponse = await fetch(payload.localUri);
        const fileBuffer = await fileResponse.arrayBuffer();

        const uploadTimeoutMsByAttempt = (attemptIndex: number) =>
          20000 + attemptIndex * 5000;

        let lastError: PostgrestError | Error | null = null;
        let attempt = 0;

        while (attempt <= retries) {
          try {
            const timeoutMs = uploadTimeoutMsByAttempt(attempt);
            const uploadResponse = await Promise.race([
              supabase.storage.from("mission-photos").upload(path, fileBuffer, {
                contentType: payload.mimeType ?? "image/jpeg",
                upsert: true,
              }),
              new Promise<{ error: Error; data: null }>((resolve) => {
                setTimeout(
                  () =>
                    resolve({ error: new Error("Upload timeout"), data: null }),
                  timeoutMs,
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
                    timeoutMs,
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
