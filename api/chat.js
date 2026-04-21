// api/chat.js — Vercel Serverless Function
// Proxies requests to the Anthropic API with your server-side API key.
//
// SETUP:
// 1. Place this file at: api/chat.js (root of your Vercel project)
// 2. In Vercel Dashboard → Settings → Environment Variables, add:
//    ANTHROPIC_API_KEY = sk-ant-api03-...  (your Anthropic API key)
// 3. Redeploy. The AI Advisor will now work.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: {
        message: "ANTHROPIC_API_KEY not configured. Add it in Vercel Dashboard → Settings → Environment Variables."
      }
    });
  }

  try {
    const { model, max_tokens, system, messages } = req.body;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: max_tokens || 1000,
        system: system || "",
        messages: messages || [],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: { message: "Server error: " + (err.message || "Unknown error") }
    });
  }
}