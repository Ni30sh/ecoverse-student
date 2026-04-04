// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function fallbackQuestions(topic: string): QuizQuestion[] {
  const safeTopic = topic.trim() || "Sustainability";
  return [
    {
      id: `${safeTopic}-q1`,
      question: `Which action most improves ${safeTopic.toLowerCase()} outcomes in school?`,
      options: [
        "Reuse supplies",
        "Increase waste",
        "Ignore leaks",
        "Leave lights on",
      ],
      correctAnswer: 0,
      explanation: "Reusing resources directly lowers waste and footprint.",
    },
    {
      id: `${safeTopic}-q2`,
      question: "Why should recyclable material be separated?",
      options: [
        "To avoid contamination",
        "To increase landfill load",
        "To delay sorting",
        "No reason",
      ],
      correctAnswer: 0,
      explanation: "Segregation improves recovery and recycling efficiency.",
    },
    {
      id: `${safeTopic}-q3`,
      question: "Which behavior saves water at home?",
      options: [
        "Fixing leaks quickly",
        "Running taps while idle",
        "Overwatering daily",
        "Ignoring dripping taps",
      ],
      correctAnswer: 0,
      explanation: "Leak fixes stop continuous loss and reduce total demand.",
    },
    {
      id: `${safeTopic}-q4`,
      question: "What is a sustainable transport choice for short trips?",
      options: [
        "Walking or cycling",
        "Single-passenger car use",
        "Idling vehicle",
        "Frequent short rides by car",
      ],
      correctAnswer: 0,
      explanation: "Active transport reduces emissions and improves health.",
    },
    {
      id: `${safeTopic}-q5`,
      question: "What defines a low-impact product?",
      options: [
        "Durable and repairable",
        "Single-use and fragile",
        "Overpackaged items",
        "Frequent replacement needs",
      ],
      correctAnswer: 0,
      explanation: "Long-lasting products reduce lifecycle waste and emissions.",
    },
  ];
}

function normalizeQuestion(
  item: unknown,
  index: number,
  topic: string,
): QuizQuestion | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const record = item as Record<string, unknown>;
  const question = String(record.question ?? record.prompt ?? "").trim();
  const options = Array.isArray(record.options)
    ? record.options
        .map((opt) => String(opt ?? "").trim())
        .filter((opt) => opt.length > 0)
    : [];

  if (!question || options.length < 2) {
    return null;
  }

  const rawAnswer = Number(record.correctAnswer ?? record.correct_answer ?? 0);
  const boundedAnswer = Number.isFinite(rawAnswer)
    ? Math.max(0, Math.min(options.length - 1, Math.trunc(rawAnswer)))
    : 0;

  return {
    id: String(record.id ?? `${topic}-q${index + 1}`),
    question,
    options,
    correctAnswer: boundedAnswer,
    explanation: String(record.explanation ?? "").trim(),
  };
}

function normalizeQuestions(raw: unknown, topic: string): QuizQuestion[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => normalizeQuestion(item, index, topic))
    .filter((item): item is QuizQuestion => Boolean(item));
}

async function generateWithOpenAI(input: {
  topic: string;
  lessonTitle: string;
  lessonBody: string;
}): Promise<QuizQuestion[] | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!apiKey) {
    return null;
  }

  const bodyExcerpt = input.lessonBody.slice(0, 1800);
  const prompt = [
    "Create exactly 5 multiple-choice quiz questions in JSON.",
    "Use this schema:",
    '{"questions":[{"id":"q1","question":"...","options":["A","B","C","D"],"correctAnswer":0,"explanation":"..."}]}',
    "Rules:",
    "- 4 options each",
    "- exactly one correct answer index (0-3)",
    "- questions should be easy-to-medium for school students",
    "- no markdown, only JSON",
    `Topic: ${input.topic}`,
    `Lesson title: ${input.lessonTitle || "N/A"}`,
    `Lesson content summary: ${bodyExcerpt || "N/A"}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a quiz generation assistant. Return strict JSON only with a top-level questions array.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error("[generate-quiz] OpenAI error status", response.status);
    return null;
  }

  const data = await response.json();
  const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
  if (!content) {
    return null;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const questionsRaw =
    parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).questions)
      ? (parsed as Record<string, unknown>).questions
      : [];

  const normalized = normalizeQuestions(questionsRaw, input.topic);
  if (normalized.length < 3) {
    return null;
  }

  return normalized.slice(0, 5);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const body = (await req.json()) as {
      topic?: unknown;
      lessonTitle?: unknown;
      lessonBody?: unknown;
    };

    const topic = String(body?.topic ?? "").trim() || "Sustainability";
    const lessonTitle = String(body?.lessonTitle ?? "").trim();
    const lessonBody = String(body?.lessonBody ?? "").trim();

    const aiQuestions = await generateWithOpenAI({
      topic,
      lessonTitle,
      lessonBody,
    });

    const questions =
      aiQuestions && aiQuestions.length > 0
        ? aiQuestions
        : fallbackQuestions(topic)
            .map((item, index) => normalizeQuestion(item, index, topic))
            .filter((item): item is QuizQuestion => Boolean(item));

    return new Response(
      JSON.stringify({
        topic,
        questions,
        source: aiQuestions ? "openai" : "fallback",
      }),
      {
        status: 200,
        headers: CORS_HEADERS,
      },
    );
  } catch (error) {
    console.error("[generate-quiz] failed", error);
    const questions = fallbackQuestions("Sustainability");
    return new Response(
      JSON.stringify({
        topic: "Sustainability",
        questions,
        source: "fallback",
      }),
      {
        status: 200,
        headers: CORS_HEADERS,
      },
    );
  }
});
