// Two ways to run: entirely in this browser (GitHub Pages), or talking to the server on your PC.

import { Hq } from "../core/hq.ts";
import { DEFAULT_SETTINGS, modelFrom, type ModelSettings } from "../core/llm.ts";
import type { Company } from "../core/types.ts";

export type Method =
  | "chat"
  | "addTask"
  | "editTask"
  | "runTask"
  | "decide"
  | "setPaused"
  | "setBudget"
  | "refreshHealth"
  | "reset";

export interface PublicSettings {
  provider: ModelSettings["provider"];
  model: string;
  endpoint: string;
  deployment: string;
  hasApiKey: boolean;
  hasGithubToken: boolean;
}

export interface Backend {
  mode: "browser" | "pc";
  company: Company;
  modelLabel(): string;
  settings(): PublicSettings;
  saveSettings(s: Partial<ModelSettings> & { clearApiKey?: boolean; clearGithubToken?: boolean }): Promise<void>;
  call<T = unknown>(method: Method, ...args: unknown[]): Promise<T>;
  /** Picks up changes made elsewhere (the PC heartbeat). */
  refresh(): Promise<void>;
}

const COMPANY_KEY = "bunki-hq.company";
const SETTINGS_KEY = "bunki-hq.settings";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: lasts for this visit */
  }
}

const toPublic = (s: ModelSettings): PublicSettings => ({
  provider: s.provider,
  model: s.model,
  endpoint: s.endpoint,
  deployment: s.deployment,
  hasApiKey: !!s.apiKey,
  hasGithubToken: !!s.githubToken,
});

function browserBackend(): Backend {
  let settings: ModelSettings = { ...DEFAULT_SETTINGS, ...(read<ModelSettings>(SETTINGS_KEY) ?? {}) };
  const hq = new Hq(read<Company>(COMPANY_KEY), { save: (c) => write(COMPANY_KEY, c) }, {
    model: () => modelFrom(settings, true),
    githubToken: () => settings.githubToken,
  });
  return {
    mode: "browser",
    get company() {
      return hq.company;
    },
    modelLabel: () => modelFrom(settings, true)?.label ?? "",
    settings: () => toPublic(settings),
    async saveSettings(s) {
      const next = { ...settings };
      for (const [k, v] of Object.entries(s)) {
        if (k === "clearApiKey" || k === "clearGithubToken") continue;
        if ((k === "apiKey" || k === "githubToken") && v === "") continue;
        (next as any)[k] = v;
      }
      if (s.clearApiKey) next.apiKey = "";
      if (s.clearGithubToken) next.githubToken = "";
      settings = next;
      write(SETTINGS_KEY, settings);
    },
    async call(method, ...args) {
      return (hq as any)[method](...args);
    },
    async refresh() {},
  };
}

async function pcBackend(): Promise<Backend | null> {
  try {
    const res = await fetch("api/info", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    let info = await res.json();
    if (info.mode !== "pc") return null;
    let company: Company = await (await fetch("api/company", { cache: "no-store" })).json();
    const backend: Backend = {
      mode: "pc",
      get company() {
        return company;
      },
      modelLabel: () => info.model,
      settings: () => info.settings,
      async saveSettings(s) {
        const r = await fetch("api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
        if (!r.ok) throw new Error("Couldn't save settings.");
        info = await (await fetch("api/info", { cache: "no-store" })).json();
      },
      async call(method, ...args) {
        const r = await fetch("api/call", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method, args }),
        });
        const body = await r.json();
        if (body.company) company = body.company;
        if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status}).`);
        return body.result;
      },
      async refresh() {
        const r = await fetch("api/company", { cache: "no-store" });
        if (r.ok) company = await r.json();
      },
    };
    return backend;
  } catch {
    return null;
  }
}

export async function connect(): Promise<Backend> {
  return (await pcBackend()) ?? browserBackend();
}
