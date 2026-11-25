// Bunki HQ on your PC: the same engine, saved in SQLite, with a heartbeat that keeps the team
// working while the app is closed. No dependencies beyond Node 22.18+.
//
//   npm run pc          then open http://localhost:4317 and install it as an app
//
// Model and GitHub settings come from the Settings screen (saved to ~/.bunki-hq/settings.json,
// readable only by you) or from environment variables.

import { mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hq } from "../core/hq.ts";
import { DEFAULT_SETTINGS, modelFrom, type ModelSettings } from "../core/llm.ts";
import type { Company } from "../core/types.ts";

const PORT = Number(process.env.PORT ?? 4317);
const HOST = process.env.HOST ?? "127.0.0.1"; // this machine only
const DIR = process.env.BUNKI_HQ_HOME ?? join(homedir(), ".bunki-hq");
const DIST = resolve(process.env.BUNKI_HQ_DIST ?? "dist");
const HEARTBEAT_MIN = Number(process.env.HEARTBEAT_MINUTES ?? 15);

mkdirSync(DIR, { recursive: true });
const SETTINGS_FILE = join(DIR, "settings.json");

function loadSettings(): ModelSettings {
  let fromFile: Partial<ModelSettings> = {};
  try {
    fromFile = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    /* first run */
  }
  const env: Partial<ModelSettings> = {};
  if (process.env.ANTHROPIC_API_KEY) Object.assign(env, { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY });
  if (process.env.AZURE_OPENAI_API_KEY)
    Object.assign(env, {
      provider: "azure",
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? "",
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? "",
    });
  if (process.env.BUNKI_MODEL) env.model = process.env.BUNKI_MODEL;
  if (process.env.GITHUB_TOKEN) env.githubToken = process.env.GITHUB_TOKEN;
  return { ...DEFAULT_SETTINGS, ...fromFile, ...env };
}

let settings = loadSettings();

// ---------- storage ----------

const db = new DatabaseSync(join(DIR, "hq.db"));
db.exec("CREATE TABLE IF NOT EXISTS company (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER, json TEXT)");
const row = db.prepare("SELECT json FROM company WHERE id = 1").get() as { json: string } | undefined;
const upsert = db.prepare(
  "INSERT INTO company (id, version, json) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, json = excluded.json",
);

const hq = new Hq(row ? (JSON.parse(row.json) as Company) : null, {
  save: (c) => void upsert.run(c.version, JSON.stringify(c)),
}, {
  model: () => modelFrom(settings, false),
  githubToken: () => settings.githubToken,
});
if (!row) upsert.run(hq.company.version, JSON.stringify(hq.company));

// ---------- API ----------

// Methods the UI may call. Everything else on Hq stays internal.
const METHODS = new Set(["chat", "addTask", "editTask", "runTask", "decide", "setPaused", "setBudget", "refreshHealth", "reset"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200_000) throw new Error("Request too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

const publicSettings = () => ({
  provider: settings.provider,
  model: settings.model,
  endpoint: settings.endpoint,
  deployment: settings.deployment,
  hasApiKey: !!settings.apiKey,
  hasGithubToken: !!settings.githubToken,
});

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  // Only pages served from this machine may call the API.
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: "Forbidden origin." });

  if (path === "/api/info" && req.method === "GET") {
    return send(res, 200, { mode: "pc", model: modelFrom(settings, false)?.label ?? "", settings: publicSettings(), heartbeatMinutes: HEARTBEAT_MIN });
  }
  if (path === "/api/company" && req.method === "GET") return send(res, 200, hq.company);
  if (path === "/api/settings" && req.method === "POST") {
    const body = await readBody(req);
    const next = { ...settings };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof ModelSettings)[]) {
      // Blank secret fields mean "keep what's saved".
      if (typeof body[k] === "string" && !((k === "apiKey" || k === "githubToken") && body[k] === "")) (next as any)[k] = body[k];
    }
    if (body.clearApiKey) next.apiKey = "";
    if (body.clearGithubToken) next.githubToken = "";
    settings = next;
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    try {
      chmodSync(SETTINGS_FILE, 0o600);
    } catch {
      /* Windows: the file sits in your user folder */
    }
    return send(res, 200, publicSettings());
  }
  if (path === "/api/call" && req.method === "POST") {
    const { method, args } = await readBody(req);
    if (!METHODS.has(method)) return send(res, 400, { error: `Unknown method ${method}.` });
    try {
      const result = await (hq as any)[method](...(Array.isArray(args) ? args : []));
      return send(res, 200, { result: result ?? null, company: hq.company });
    } catch (e) {
      return send(res, 400, { error: (e as Error).message, company: hq.company });
    }
  }
  send(res, 404, { error: "Not found." });
}

function serveStatic(res: ServerResponse, path: string) {
  const file = normalize(join(DIST, path === "/" ? "index.html" : decodeURIComponent(path)));
  const safe = file.startsWith(DIST);
  let target = join(DIST, "index.html");
  try {
    if (safe && statSync(file).isFile()) target = file;
  } catch {
    /* SPA fallback */
  }
  try {
    const body = readFileSync(target);
    res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("The app isn't built yet. Run: npm run build");
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    if (path.startsWith("/api/")) return await api(req, res, path);
    serveStatic(res, path);
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, HOST, () => {
  console.log(`Bunki HQ is running at http://localhost:${PORT} (data in ${DIR})`);
});

// ---------- heartbeat ----------

if (HEARTBEAT_MIN > 0) {
  setInterval(async () => {
    try {
      const did = await hq.heartbeat();
      if (did.length) console.log(new Date().toLocaleTimeString(), "heartbeat:", did.join("; "));
    } catch (e) {
      console.error("heartbeat failed:", (e as Error).message);
    }
  }, HEARTBEAT_MIN * 60 * 1000);
}
