import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { lessonContent } = req.body;
  if (!lessonContent) {
    return res.status(400).json({ error: "Missing lessonContent" });
  }

  const prompt = `
Generate 10 multiple-choice quiz questions (with 4 options each, and the correct answer index) for the following lesson:
${lessonContent}
Return as JSON: [{question, options, correctAnswer}]
`;

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
      temperature: 0.7,
    }),
  });
  const data = await openaiRes.json();
  let questions = [];
  try {
    const text = data.choices[0].message.content;
    questions = JSON.parse(text);
  } catch (e) {
    return res.status(500).json({ error: "Failed to parse quiz questions." });
  }
  res.json({ questions });
}
