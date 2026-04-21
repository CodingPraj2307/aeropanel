// api/chat.js — Secure Vercel Serverless Function
// Proxies requests to Anthropic API with rate limiting and security.
//
// SETUP:
// 1. Place this file at: api/chat.js (project root, NOT inside src/)
// 2. In Vercel Dashboard → Settings → Environment Variables, add:
//    ANTHROPIC_API_KEY = sk-ant-...
// 3. Optionally add ALLOWED_ORIGIN = https://your-domain.vercel.app
// 4. Redeploy.

// Simple in-memory rate limiter (resets on cold start, good enough for abuse prevention)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 15; // max 15 requests per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

export default async function handler(req, res) {
  // CORS headers
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  // Rate limiting by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: { message: "Rate limited. Try again in a minute." } });
  }

  // Check API key exists
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: "ANTHROPIC_API_KEY not set. Add it in Vercel → Settings → Environment Variables, then redeploy." }
    });
  }

  // Validate request body
  const { model, max_tokens, system, messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "Invalid request: messages array required." } });
  }

  // Prevent abuse: limit message count and sizes
  if (messages.length > 20) {
    return res.status(400).json({ error: { message: "Too many messages. Max 20 per request." } });
  }

  const totalChars = JSON.stringify(messages).length + (system || "").length;
  if (totalChars > 50000) {
    return res.status(400).json({ error: { message: "Payload too large." } });
  }

  // Only allow specific models
  const allowedModels = ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"];
  const safeModel = allowedModels.includes(model) ? model : "claude-sonnet-4-20250514";

  // Cap max_tokens
  const safeMaxTokens = Math.min(Math.max(parseInt(max_tokens) || 1000, 1), 2000);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: safeMaxTokens,
        system: (system || "").slice(0, 4000), // cap system prompt length
        messages: messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Don't leak internal error details — sanitize
      const safeError = data?.error?.message || "Anthropic API error";
      return res.status(response.status).json({ error: { message: safeError } });
    }

    return res.status(200).json(data);
  } catch (err) {
    // Never leak stack traces or internal details
    console.error("API proxy error:", err.message);
    return res.status(500).json({ error: { message: "Internal server error. Try again." } });
  }
}