// api/chat.js — Secure Vercel Serverless Function

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 15;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Helper: read and parse the request body manually
function parseBody(req) {
  return new Promise((resolve, reject) => {
    // If Vercel already parsed it
    if (req.body && typeof req.body === "object") {
      return resolve(req.body);
    }
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  // CORS
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" } });

  // Rate limit
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) return res.status(429).json({ error: { message: "Rate limited. Try again in a minute." } });

  // API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY not set. Add it in Vercel Settings → Environment Variables." } });

  // Parse body
  let body;
  try {
    body = await parseBody(req);
  } catch (e) {
    return res.status(400).json({ error: { message: "Invalid JSON body." } });
  }

  const { model, max_tokens, system, messages } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages array required." } });
  }
  if (messages.length > 20) return res.status(400).json({ error: { message: "Too many messages." } });

  const allowedModels = ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"];
  const safeModel = allowedModels.includes(model) ? model : "claude-sonnet-4-20250514";
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
        system: (system || "").slice(0, 4000),
        messages: messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: { message: data?.error?.message || "API error" } });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: { message: "Internal server error." } });
  }
}