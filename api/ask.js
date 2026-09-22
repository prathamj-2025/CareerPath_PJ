/* Server-side proxy for the study assistant.
 *
 * The API key lives here, in a Vercel environment variable, and never reaches the
 * browser. The page posts {rules, messages} and gets back a stream of text.
 *
 * Environment variables (set these in Vercel, not in the repo):
 *   OPENAI_API_KEY    required
 *   OPENAI_MODEL      optional, defaults to gpt-4o-mini
 *   OPENAI_BASE_URL   optional, defaults to https://api.openai.com/v1
 *                     Point it at any OpenAI-compatible endpoint to switch provider.
 */

const MAX_TOTAL_CHARS = 60000;   // roughly the model's input budget for this use
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 20000;

function fail(res, status, code, message) {
  res.status(status).json({ error: { code: code, message: message } });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") return fail(res, 405, "method_not_allowed", "Use POST.");

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return fail(res, 500, "no_key",
      "OPENAI_API_KEY is not set. Add it in Vercel under Settings, Environment Variables, then redeploy.");
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || !Array.isArray(body.messages) || !body.messages.length) {
    return fail(res, 400, "bad_request", "Expected a JSON body with a non-empty messages array.");
  }

  // Only the roles the page is allowed to send, trimmed and length-capped.
  const turns = body.messages
    .slice(-MAX_TURNS)
    .map(function (m) {
      const role = m && m.role === "assistant" ? "assistant" : "user";
      return { role: role, content: String((m && m.content) || "").slice(0, MAX_TURN_CHARS) };
    })
    .filter(function (m) { return m.content.trim().length > 0; });

  if (!turns.length) return fail(res, 400, "bad_request", "Every message was empty.");

  const messages = [];
  if (body.rules) {
    messages.push({ role: "system", content: String(body.rules).slice(0, MAX_TURN_CHARS) });
  }
  for (const t of turns) messages.push(t);

  const total = messages.reduce(function (a, m) { return a + m.content.length; }, 0);
  if (total > MAX_TOTAL_CHARS) {
    return fail(res, 413, "too_large", "That is too much text to send at once. Select a smaller piece.");
  }

  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

  let upstream;
  try {
    upstream = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: messages,
        stream: true,
        temperature: 0.3,
        max_tokens: 700
      })
    });
  } catch (e) {
    return fail(res, 502, "upstream_unreachable", "Could not reach the model provider.");
  }

  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try { detail = (await upstream.text()).slice(0, 400); } catch (e) { /* ignore */ }
    const code = upstream.status === 401 ? "bad_key"
               : upstream.status === 429 ? "rate_limited"
               : "upstream_error";
    const message = code === "bad_key"
      ? "The API key was rejected. Check OPENAI_API_KEY in Vercel."
      : code === "rate_limited"
        ? "The model provider is rate limiting or the account is out of quota."
        : "The model provider returned an error. " + detail;
    return fail(res, upstream.status, code, message);
  }

  // Re-emit as a simple {delta} event stream so the page does not depend on the
  // provider's wire format.
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("x-accel-buffering", "no");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const choice = parsed.choices && parsed.choices[0];
          const delta = choice && choice.delta && choice.delta.content;
          if (delta) res.write("data: " + JSON.stringify({ delta: delta }) + "\n\n");
        } catch (e) { /* partial frame: ignore and keep reading */ }
      }
    }
    res.write("data: [DONE]\n\n");
  } catch (e) {
    res.write("data: " + JSON.stringify({ error: "interrupted" }) + "\n\n");
  }
  res.end();
}
