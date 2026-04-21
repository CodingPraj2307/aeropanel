export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "POST only" } });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: "GEMINI_API_KEY not set" } });

  const body = req.body;
  if (!body || !body.messages) return res.status(400).json({ error: { message: "missing messages" } });

  // Convert from Claude format to Gemini format
  const systemText = body.system || "";
  const geminiContents = body.messages.map(msg => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }]
  }));

  const geminiBody = {
    system_instruction: { parts: [{ text: systemText }] },
    contents: geminiContents,
    generationConfig: {
      maxOutputTokens: body.max_tokens || 1000,
      temperature: 0.7
    }
  };

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiBody)
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.message || "Gemini API error";
    return res.status(response.status).json({ error: { message: errMsg } });
  }

  // Convert Gemini response back to Claude format so the frontend works unchanged
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  return res.status(200).json({
    content: [{ type: "text", text: text }]
  });
}