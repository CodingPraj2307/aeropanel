// api/chat.js

const rateLimits = {};

module.exports = async function handler(req, res) {
  // CORS headers — always set these
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // POST only
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "POST only" } });
    return;
  }

  // Rate limit: 15/min per IP
  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  if (!rateLimits[ip] || now - rateLimits[ip].t > 60000) {
    rateLimits[ip] = { t: now, c: 1 };
  } else {
    rateLimits[ip].c++;
    if (rateLimits[ip].c > 15) {
      res.status(429).json({ error: { message: "Rate limited." } });
      return;
    }
  }

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: "ANTHROPIC_API_KEY not configured on server." } });
    return;
  }

  // Get body — handle both pre-parsed and raw
  let body = req.body;
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      body = JSON.parse(raw);
    } catch (e) {
      res.status(400).json({ error: { message: "Could not parse request body as JSON." } });
      return;
    }
  }

  const { model, max_tokens, system, messages } = body;

  // Validate
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { message: "messages array is required. Received: " + JSON.stringify(Object.keys(body)) } });
    return;
  }

  // Safe defaults
  const allowedModels = ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"];
  const safeModel = allowedModels.includes(model) ? model : "claude-sonnet-4-20250514";
  const safeTokens = Math.min(Math.max(parseInt(max_tokens) || 1000, 1), 2000);

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: safeTokens,
        system: String(system || "").slice(0, 4000),
        messages: messages.slice(0, 20),
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json({
        error: { message: data?.error?.message || "Anthropic API returned " + anthropicRes.status }
      });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("API proxy error:", err);
    res.status(500).json({ error: { message: "Server error contacting Anthropic." } });
  }
};