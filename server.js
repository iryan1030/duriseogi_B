const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const leadsPath = path.join(root, "leads.json");
const port = process.env.PORT || 3000;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
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

function readLeads() {
  if (!fs.existsSync(leadsPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(leadsPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLead(lead) {
  const leads = readLeads();
  leads.push(lead);
  fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2), "utf8");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/leads") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const phone = String(data.phone || "").trim();
      const email = String(data.email || "").trim();

      if (!phone || (email && !email.includes("@"))) {
        send(res, 400, JSON.stringify({ ok: false, error: "invalid_input" }));
        return;
      }

      saveLead({
        phone,
        email,
        page: String(data.page || "두리서기 랜딩페이지"),
        createdAt: data.createdAt || new Date().toISOString()
      });

      send(res, 201, JSON.stringify({ ok: true }));
    } catch {
      send(res, 500, JSON.stringify({ ok: false, error: "save_failed" }));
    }
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, "Method Not Allowed", "text/plain; charset=utf-8");
    return;
  }

  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.normalize(path.join(root, urlPath === "/" ? "index.html" : urlPath));

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      send(res, 404, "Not Found", "text/plain; charset=utf-8");
      return;
    }

    send(res, 200, file, types[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(port, () => {
  console.log(`두리서기 랜딩페이지 서버: http://localhost:${port}`);
});
