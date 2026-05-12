function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
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

function getDashboardTokenState(req) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return "missing";

  const headerToken = String(req.headers["x-dashboard-token"] || "");
  const queryToken = new URL(req.url, "https://duriseogi.local").searchParams.get("token") || "";
  return headerToken === token || queryToken === token ? "valid" : "invalid";
}

async function supabaseSelect(path) {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`supabase_select_failed:${response.status}:${errorText.slice(0, 160)}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    send(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const tokenState = getDashboardTokenState(req);
  if (tokenState === "missing") {
    send(res, 403, { ok: false, error: "dashboard_token_required" });
    return;
  }
  if (tokenState === "invalid") {
    send(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  try {
    const leads = await supabaseSelect(
      "leads?select=id,phone,email,page,variant,created_at&order=created_at.desc&limit=200"
    );

    send(res, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      leads
    });
  } catch (error) {
    send(res, 500, { ok: false, error: error.message || "leads_failed" });
  }
};
