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

function requireDashboardToken(req) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return true;

  const headerToken = String(req.headers["x-dashboard-token"] || "");
  const queryToken = new URL(req.url, "https://duriseogi.local").searchParams.get("token") || "";
  return headerToken === token || queryToken === token;
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

function toDateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function getLastDateKeys(days) {
  const keys = [];
  const now = new Date();

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    keys.push(toDateKey(date));
  }

  return keys;
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function average(values) {
  const validValues = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!validValues.length) return 0;
  return Math.round(validValues.reduce((sum, value) => sum + value, 0) / validValues.length);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    send(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  if (!requireDashboardToken(req)) {
    send(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  try {
    const [events, leads] = await Promise.all([
      supabaseSelect("events?select=session_id,event_name,duration_seconds,variant,created_at&order=created_at.desc&limit=10000"),
      supabaseSelect("leads?select=id,variant,created_at&order=created_at.desc&limit=10000")
    ]);

    const productionEvents = events.filter((event) => event.page !== "/debug");
    const pageViews = productionEvents.filter((event) => event.event_name === "page_view");
    const ctaClicks = productionEvents.filter((event) => event.event_name === "cta_click");
    const leadSubmitEvents = productionEvents.filter((event) => event.event_name === "lead_submit");
    const stayDurations = productionEvents
      .filter((event) => event.event_name === "stay_duration")
      .map((event) => Number(event.duration_seconds));
    const visitorIds = new Set(pageViews.map((event) => event.session_id).filter(Boolean));
    const visitorCount = visitorIds.size || pageViews.length;
    const submitCount = leads.length;
    const trackedSubmitCount = leadSubmitEvents.length;
    const dateKeys = getLastDateKeys(7);
    const daily = dateKeys.map((date) => {
      const dailyPageViews = pageViews.filter((event) => toDateKey(event.created_at) === date);
      const dailyLeads = leads.filter((lead) => toDateKey(lead.created_at) === date);
      const dailyVisitorIds = new Set(dailyPageViews.map((event) => event.session_id).filter(Boolean));

      return {
        date,
        visitors: dailyVisitorIds.size || dailyPageViews.length,
        ctaClicks: ctaClicks.filter((event) => toDateKey(event.created_at) === date).length,
        submits: dailyLeads.length
      };
    });

    send(res, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      totals: {
        visitors: visitorCount,
        pageViews: pageViews.length,
        averageStaySeconds: average(stayDurations),
        ctaClicks: ctaClicks.length,
        submits: submitCount,
        trackedSubmits: trackedSubmitCount,
        ctaClickRate: percent(ctaClicks.length, visitorCount),
        conversionRate: percent(trackedSubmitCount, visitorCount),
        submitRateAfterClick: percent(trackedSubmitCount, ctaClicks.length)
      },
      daily
    });
  } catch (error) {
    send(res, 500, { ok: false, error: error.message || "analytics_failed" });
  }
};
