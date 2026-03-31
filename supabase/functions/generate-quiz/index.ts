// @ts-nocheck
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
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
      explanation:
        "Long-lasting products reduce lifecycle waste and emissions.",
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

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as { topic?: unknown };
    const topic = String(body?.topic ?? "").trim() || "Sustainability";

    const questions = fallbackQuestions(topic)
      .map((item, index) => normalizeQuestion(item, index, topic))
      .filter((item): item is QuizQuestion => Boolean(item));

    return new Response(JSON.stringify({ topic, questions }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const questions = fallbackQuestions("Sustainability");
    return new Response(
      JSON.stringify({ topic: "Sustainability", questions }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }
});
