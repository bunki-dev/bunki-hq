import type { ProjectHealth } from "./types.ts";

// Reads project health from the public GitHub REST API. A token is optional for public repos
// (it raises the rate limit) and required for anything that writes.

export type Fetch = typeof fetch;

const API = "https://api.github.com";

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function getJson(f: Fetch, url: string, token?: string): Promise<{ status: number; body: any }> {
  const res = await f(url, { headers: headers(token) });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body };
}

export async function projectHealth(repo: string, opts: { token?: string; fetch?: Fetch; now?: Date } = {}): Promise<ProjectHealth> {
  const f = opts.fetch ?? fetch;
  const checkedAt = (opts.now ?? new Date()).toISOString();
  try {
    const [info, commits, runs] = await Promise.all([
      getJson(f, `${API}/repos/${repo}`, opts.token),
      getJson(f, `${API}/repos/${repo}/commits?per_page=1`, opts.token),
      getJson(f, `${API}/repos/${repo}/actions/runs?per_page=5`, opts.token),
    ]);
    if (info.status === 404) return { checkedAt, ci: "unknown", error: "Repo not found (or private without a token)." };
    if (info.status === 403 || info.status === 429)
      return { checkedAt, ci: "unknown", error: "GitHub rate limit reached. Add a token in Settings or try later." };
    if (info.status >= 400) return { checkedAt, ci: "unknown", error: `GitHub returned ${info.status}.` };

    const c = Array.isArray(commits.body) ? commits.body[0] : undefined;
    const latest = (runs.body?.workflow_runs ?? []) as any[];
    const run = latest[0];
    let ci: ProjectHealth["ci"] = "none";
    if (run) {
      if (run.status !== "completed") ci = "running";
      else ci = run.conclusion === "success" ? "passing" : run.conclusion === "skipped" ? "none" : "failing";
    }
    return {
      checkedAt,
      ci,
      ciWorkflow: run?.name,
      lastCommit: c
        ? { message: String(c.commit?.message ?? "").split("\n")[0], at: c.commit?.author?.date ?? "", sha: String(c.sha).slice(0, 7) }
        : undefined,
      openIssues: typeof info.body?.open_issues_count === "number" ? info.body.open_issues_count : undefined,
    };
  } catch (e) {
    return { checkedAt, ci: "unknown", error: `Couldn't reach GitHub: ${(e as Error).message}` };
  }
}

export async function createIssue(
  repo: string,
  title: string,
  body: string,
  opts: { token?: string; fetch?: Fetch },
): Promise<string> {
  if (!opts.token) throw new Error("Add a GitHub token in Settings to create issues.");
  const f = opts.fetch ?? fetch;
  const res = await f(`${API}/repos/${repo}/issues`, {
    method: "POST",
    headers: { ...headers(opts.token), "content-type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub refused the issue (${res.status}): ${data?.message ?? "unknown error"}`);
  return data.html_url as string;
}
