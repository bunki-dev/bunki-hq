import assert from "node:assert/strict";
import { test } from "node:test";
import { Hq } from "./hq.ts";
import type { Model, Msg, Reply } from "./llm.ts";
import type { Company } from "./types.ts";

const NOW = new Date("2026-11-25T09:00:00Z");

/** Replays scripted replies and records what it was sent. */
function scripted(replies: Reply[], price = { input: 3, output: 15 }) {
  const seen: { system: string; messages: Msg[]; tools: string[] }[] = [];
  const model: Model = {
    label: "scripted",
    price,
    async complete(system, messages, tools) {
      seen.push({ system, messages: structuredClone(messages), tools: tools.map((t) => t.name) });
      const r = replies.shift();
      if (!r) throw new Error("script ran out");
      return r;
    },
  };
  return { model, seen };
}

const say = (text: string, calls: Reply["calls"] = [], tokens = 1000): Reply => ({
  text,
  calls,
  inputTokens: tokens,
  outputTokens: 100,
});

/** A fake GitHub: green builds everywhere, one issue endpoint. */
function fakeGithub(log: string[] = []) {
  return (async (url: string, init?: RequestInit) => {
    log.push(`${init?.method ?? "GET"} ${url}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.endsWith("/issues") && init?.method === "POST") return json({ html_url: "https://github.com/x/y/issues/1" }, 201);
    if (url.includes("/actions/runs")) return json({ workflow_runs: [{ name: "CI", status: "completed", conclusion: "success" }] });
    if (url.includes("/commits")) return json([{ sha: "abc1234def", commit: { message: "Ship it\n\nbody", author: { date: "2026-11-25T00:00:00Z" } } }]);
    return json({ open_issues_count: 2 });
  }) as typeof fetch;
}

function make(model: Model | null, opts: { token?: string; ghLog?: string[] } = {}) {
  const saved: Company[] = [];
  const hq = new Hq(null, { save: (c) => void saved.push(structuredClone(c)) }, {
    model: () => model,
    githubToken: () => opts.token ?? "",
    fetch: fakeGithub(opts.ghLog),
    now: () => NOW,
  });
  return { hq, saved };
}

test("Bunki creates a task and delegates it; the specialist finishes it", async () => {
  const { model, seen } = scripted([
    say("", [{ id: "1", name: "create_task", args: { title: "Draft a Game Night post", assignee: "writer", project_id: "game-night" } }]),
    // Bunki reads the new task id from the tool result, then delegates.
    say("", [{ id: "2", name: "delegate_task", args: { task_id: "__TASK__" } }]),
    // Writer works on it...
    say("", [{ id: "3", name: "update_task", args: { task_id: "__TASK__", status: "done", result: "Post draft" } }]),
    say("Draft is in the task."),
    // ...and Bunki reports back.
    say("Quill drafted the post. It's in the task."),
  ]);
  const { hq } = make(model);
  // Patch the placeholder once the task exists.
  const orig = model.complete.bind(model);
  model.complete = async (s, m, t) => {
    const r = await orig(s, m, t);
    const id = hq.company.tasks[0]?.id;
    for (const c of r.calls) if (c.args.task_id === "__TASK__") c.args.task_id = id;
    return r;
  };
  const res = await hq.chat("Get Quill to write a LinkedIn post about Game Night");
  assert.equal(res.reply, "Quill drafted the post. It's in the task.");
  const task = hq.company.tasks[0];
  assert.equal(task.status, "done");
  assert.equal(task.result, "Post draft");
  assert.equal(task.checkedOutBy, null);
  // The writer only sees its own tools.
  assert.deepEqual(seen[2].tools.sort(), ["list_projects", "request_post_review", "update_task"]);
  assert.ok(res.steps.some((s) => s.startsWith("Created task")));
});

test("agents can't use tools outside their role", async () => {
  const { model } = scripted([
    say("", [{ id: "1", name: "request_github_issue", args: { project_id: "fitbasket", title: "x", body: "y" } }]),
    say("ok"),
  ]);
  const { hq } = make(model);
  const t = hq.createTask({ title: "Write README", assignee: "writer" });
  await hq.runTask(t.id);
  assert.equal(hq.company.approvals.length, 0, "the writer has no issue tool");
});

test("GitHub issues wait for approval, and are only created when approved", async () => {
  const ghLog: string[] = [];
  const { model } = scripted([
    say("", [{ id: "1", name: "request_github_issue", args: { project_id: "fitbasket", title: "Fix CI", body: "Tests fail" } }]),
    say("I've asked you to approve an issue."),
  ]);
  const { hq } = make(model, { token: "t", ghLog });
  await hq.chat("CI is red on FitBasket, log it");
  const approval = hq.company.approvals[0];
  assert.equal(approval.status, "pending");
  assert.ok(!ghLog.some((l) => l.startsWith("POST")), "nothing written before approval");
  await hq.decide(approval.id, true);
  assert.ok(ghLog.includes("POST https://api.github.com/repos/bunki-dev/fitbasket/issues"));
  assert.match(approval.outcome!, /issues\/1/);
});

test("rejecting an approval changes nothing outside the app", async () => {
  const ghLog: string[] = [];
  const { hq } = make(null, { token: "t", ghLog });
  const a = hq.requestApproval("github_issue", "Open issue", { repo: "bunki-dev/fitbasket", title: "x", body: "y" }, "ops", null);
  await hq.decide(a.id, false);
  assert.equal(a.status, "rejected");
  assert.ok(!ghLog.some((l) => l.startsWith("POST")));
});

test("an agent that hits its budget is paused and stops", async () => {
  // 1M input tokens at $3/M = $3, over the planner's $2 budget.
  const { model } = scripted([say("", [{ id: "1", name: "list_tasks", args: {} }], 1_000_000), say("never reached")]);
  const { hq } = make(model);
  const t = hq.createTask({ title: "Plan the week", assignee: "planner" });
  const out = await hq.runTask(t.id);
  assert.match(out, /budget/);
  assert.equal(hq.agent("planner").paused, true);
  assert.ok(hq.company.activity.some((a) => a.action === "Paused agent"));
});

test("task checkout is exclusive", () => {
  const { hq } = make(null);
  const t = hq.createTask({ title: "Check builds", assignee: "ops" });
  hq.checkout(t.id, "ops");
  assert.throws(() => hq.checkout(t.id, "writer"), /already working/);
});

test("without a model Bunki still gives a status update from GitHub", async () => {
  const { hq } = make(null);
  const res = await hq.chat("Morning Bunki, how are my projects going?");
  assert.match(res.reply, /builds are green/);
  assert.equal(hq.company.projects.find((p) => p.id === "fitbasket")?.health?.lastCommit?.message, "Ship it");
});

test("without a model Bunki can add and route a task", async () => {
  const { hq } = make(null);
  const res = await hq.chat("add task: draft a LinkedIn post about ShelfTalk");
  assert.match(res.reply, /Quill/);
  const t = hq.company.tasks[0];
  assert.equal(t.assignee, "writer");
  assert.equal(t.projectId, "shelftalk");
});

test("unknown agents and projects are rejected with a useful message", () => {
  const { hq } = make(null);
  assert.throws(() => hq.createTask({ title: "x", assignee: "ceo" }), /Agents: bunki, ops, writer, planner/);
  assert.throws(() => hq.createTask({ title: "x", projectId: "nope" }), /Projects:/);
});

test("when GitHub can't be reached, Bunki says so instead of calling builds green", async () => {
  const hq = new Hq(null, { save() {} }, {
    model: () => null,
    githubToken: () => "",
    fetch: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
    now: () => NOW,
  });
  const res = await hq.chat("status please");
  assert.doesNotMatch(res.reply, /green/);
  assert.match(res.reply, /couldn't reach GitHub/);
});
