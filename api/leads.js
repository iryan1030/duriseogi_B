function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isValidEmail(email) {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

async function saveLeadToSupabase(lead) {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/leads`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(lead)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`supabase_save_failed:${response.status}:${errorText.slice(0, 160)}`);
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
    const phone = String(data.phone || "").trim();
    const email = String(data.email || "").trim();

    if (!phone || !isValidEmail(email)) {
      send(res, 400, { ok: false, error: "invalid_input" });
      return;
    }

    await saveLeadToSupabase({
      phone,
      email: email || null,
      page: String(data.page || "두리서기 랜딩페이지"),
      variant: String(data.variant || "A"),
      user_agent: String(req.headers["user-agent"] || ""),
      created_at: data.createdAt || new Date().toISOString()
    });

    send(res, 201, { ok: true });
  } catch (error) {
    send(res, 500, { ok: false, error: error.message || "save_failed" });
  }
};
