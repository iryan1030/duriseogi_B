function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("request_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("missing_supabase_config");
  }

  return {
    url: url.replace(/\/$/, ""),
    serviceRoleKey
  };
}

function normalizeEventName(value) {
  const eventName = String(value || "").trim();
  const allowedEvents = new Set(["page_view", "cta_click", "lead_submit", "stay_duration"]);
  return allowedEvents.has(eventName) ? eventName : "";
}

function normalizeDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < 0) return null;
  return Math.min(Math.round(duration), 60 * 60 * 6);
}

async function saveEventToSupabase(event) {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/events`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(event)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`supabase_event_save_failed:${response.status}:${errorText.slice(0, 160)}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    send(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readBody(req);
    const data = body ? JSON.parse(body) : {};
    const eventName = normalizeEventName(data.eventName || data.event_name);
    const sessionId = String(data.sessionId || data.session_id || "").trim();

    if (!eventName || !sessionId) {
      send(res, 400, { ok: false, error: "invalid_input" });
      return;
    }

    await saveEventToSupabase({
      session_id: sessionId.slice(0, 128),
      event_name: eventName,
      variant: String(data.variant || "A").slice(0, 24),
      page: String(data.page || "").slice(0, 240),
      duration_seconds: normalizeDuration(data.durationSeconds || data.duration_seconds),
      referrer: String(data.referrer || "").slice(0, 500),
      user_agent: String(req.headers["user-agent"] || "").slice(0, 500),
      created_at: data.createdAt || new Date().toISOString()
    });

    send(res, 201, { ok: true });
  } catch (error) {
    send(res, 500, { ok: false, error: error.message || "save_failed" });
  }
};
