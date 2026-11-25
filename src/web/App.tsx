import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatResult } from "../core/hq.ts";
import type { Company, Task, TaskStatus } from "../core/types.ts";
import type { Backend } from "./backend.ts";
import { Orb, type OrbState } from "./components/Orb.tsx";
import { Settings } from "./components/Settings.tsx";
import { canListen, canSpeak, type Listening, listen, speak } from "./voice.ts";

type Panel = "projects" | "tasks" | "team" | "activity";
const PANELS: { id: Panel; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "tasks", label: "Tasks" },
  { id: "team", label: "Team" },
  { id: "activity", label: "Activity" },
];
const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "review", label: "Needs you" },
  { id: "done", label: "Done" },
];

const ago = (iso?: string) => {
  if (!iso) return "";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

interface Line {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  meta?: string;
}

export default function App({ backend }: { backend: Backend }) {
  const [company, setCompany] = useState<Company>(() => structuredClone(backend.company));
  const [panel, setPanel] = useState<Panel>("projects");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    backend.company.chat.slice(-6).map((t) => ({ role: t.role, text: t.text })),
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("bunki-hq.muted") === "1";
    } catch {
      return false;
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [modelLabel, setModelLabel] = useState(backend.modelLabel());
  const listening = useRef<Listening | null>(null);
  const stopSpeaking = useRef<() => void>(() => {});
  const transcript = useRef<HTMLDivElement>(null);

  const sync = useCallback(() => setCompany(structuredClone(backend.company)), [backend]);

  const act = useCallback(
    async (method: Parameters<Backend["call"]>[0], ...args: unknown[]) => {
      setError("");
      try {
        const out = await backend.call(method, ...args);
        sync();
        return out;
      } catch (e) {
        sync();
        setError((e as Error).message);
        return null;
      }
    },
    [backend, sync],
  );

  // First look: check builds once, then keep the PC view fresh.
  useEffect(() => {
    const stale = backend.company.projects.some(
      (p) => p.repo && (!p.health || Date.now() - Date.parse(p.health.checkedAt) > 30 * 60 * 1000),
    );
    if (stale) act("refreshHealth");
    if (backend.mode !== "pc") return;
    const id = setInterval(() => backend.refresh().then(sync), 20_000);
    return () => clearInterval(id);
  }, [act, backend, sync]);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" });
  }, [lines, heard]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q) return;
    stopSpeaking.current();
    setInput("");
    setHeard("");
    setLines((l) => [...l, { role: "user", text: q }]);
    setOrb("thinking");
    const res = (await act("chat", q)) as ChatResult | null;
    if (!res) {
      setOrb("idle");
      return;
    }
    const meta = [res.model, res.costUsd ? `$${res.costUsd.toFixed(3)}` : ""].filter(Boolean).join(" · ");
    setLines((l) => [...l, { role: "assistant", text: res.reply, steps: res.steps, meta }]);
    if (muted || !canSpeak) {
      setOrb("idle");
      return;
    }
    setOrb("speaking");
    stopSpeaking.current = speak(res.reply, setLevel, () => setOrb((s) => (s === "speaking" ? "idle" : s)));
  }

  function toggleListening() {
    if (orb === "listening") {
      listening.current?.stop();
      return;
    }
    if (orb === "speaking") {
      stopSpeaking.current();
      setOrb("idle");
      return;
    }
    if (orb === "thinking") return;
    if (!canListen) {
      setError("Voice input isn't available in this browser. Type to Bunki instead.");
      return;
    }
    setError("");
    setOrb("listening");
    listening.current = listen({
      onPartial: setHeard,
      onFinal: (t) => ask(t),
      onError: setError,
      onLevel: setLevel,
      onEnd: () => setOrb((s) => (s === "listening" ? "idle" : s)),
    });
  }

  const pending = company.approvals.filter((a) => a.status === "pending");
  const status =
    orb === "listening" ? "Listening…" : orb === "thinking" ? "Thinking…" : orb === "speaking" ? "Speaking (tap to stop)" : canListen ? "Tap to talk" : "Type below to talk";

  return (
    <div className="hq">
      <section className="desk" aria-label="Bunki">
        <header className="desk-top">
          <span className="brand">Bunki HQ</span>
          <div className="desk-tools">
            <button
              type="button"
              className="chip"
              aria-pressed={muted}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                if (next) stopSpeaking.current();
                try {
                  localStorage.setItem("bunki-hq.muted", next ? "1" : "0");
                } catch {
                  /* ignore */
                }
              }}
            >
              {muted ? "Voice off" : "Voice on"}
            </button>
            <button type="button" className="chip" onClick={() => setShowSettings(true)}>
              {modelLabel || "Connect a model"}
            </button>
          </div>
        </header>

        <div className="orb-stage">
          <Orb state={orb} level={level} onClick={toggleListening} label={status} />
          <div className="nameplate">
            <b>Bunki</b>
            <span>Your personal assistant</span>
          </div>
          <p className="orb-status" aria-live="polite">
            {status}
          </p>
        </div>

        <div className="transcript" ref={transcript} aria-live="polite">
          {lines.length === 0 && !heard && (
            <p className="hint">
              Try “How are my projects going?”, “Add task: draft a LinkedIn post about ShelfTalk” or “What needs my
              approval?”
            </p>
          )}
          {lines.map((l, i) => (
            <div key={i} className={`line line-${l.role}`}>
              <p>{l.text}</p>
              {l.steps && l.steps.length > 0 && (
                <ul className="steps">
                  {l.steps.map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ul>
              )}
              {l.meta && <span className="meta">{l.meta}</span>}
            </div>
          ))}
          {heard && <div className="line line-user line-heard">{heard}</div>}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <label htmlFor="ask" className="sr-only">
            Message Bunki
          </label>
          <input
            id="ask"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Bunki"
            autoComplete="off"
            disabled={orb === "thinking"}
          />
          <button type="submit" disabled={!input.trim() || orb === "thinking"}>
            Send
          </button>
        </form>
      </section>

      <main className="floor">
        {pending.length > 0 && (
          <section className="approvals" aria-label="Waiting for you">
            <h2>Waiting for you</h2>
            {pending.map((a) => (
              <article key={a.id} className="approval">
                <p className="approval-title">{a.title}</p>
                <p className="approval-by">
                  From {company.agents.find((x) => x.id === a.requestedBy)?.name ?? a.requestedBy} · {ago(a.createdAt)}
                </p>
                {a.kind === "post_review" && <pre className="draft">{String(a.payload.text ?? "")}</pre>}
                {a.kind === "github_issue" && (
                  <pre className="draft">{`${String(a.payload.repo)}\n\n${String(a.payload.body ?? "")}`}</pre>
                )}
                <div className="approval-actions">
                  {a.kind === "post_review" && (
                    <button type="button" className="ghost" onClick={() => navigator.clipboard?.writeText(String(a.payload.text ?? ""))}>
                      Copy text
                    </button>
                  )}
                  <button type="button" className="ghost" onClick={() => act("decide", a.id, false)}>
                    Reject
                  </button>
                  <button type="button" className="go" onClick={() => act("decide", a.id, true)}>
                    {a.kind === "github_issue" ? "Create issue" : "Approve"}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        <nav className="panel-tabs" role="tablist">
          {PANELS.map((p) => (
            <button key={p.id} role="tab" aria-selected={panel === p.id} onClick={() => setPanel(p.id)}>
              {p.label}
              {p.id === "tasks" && <span className="count">{company.tasks.filter((t) => t.status !== "done").length}</span>}
            </button>
          ))}
        </nav>

        {panel === "projects" && <Projects company={company} onRefresh={() => act("refreshHealth")} />}
        {panel === "tasks" && <Tasks company={company} act={act} />}
        {panel === "team" && <Team company={company} act={act} />}
        {panel === "activity" && <ActivityFeed company={company} />}

        <p className="footnote">
          {backend.mode === "pc"
            ? "Running on your PC: the team keeps working on a heartbeat while this window is closed."
            : "Running in this browser: everything is saved on this device. Run it on your PC to keep the team working in the background."}
        </p>
      </main>

      {showSettings && (
        <Settings
          backend={backend}
          onClose={() => {
            setShowSettings(false);
            setModelLabel(backend.modelLabel());
          }}
          onReset={async () => {
            await act("reset");
            setLines([]);
          }}
        />
      )}
    </div>
  );
}

function Light({ ci }: { ci?: string }) {
  const label =
    ci === "passing" ? "Build passing" : ci === "failing" ? "Build failing" : ci === "running" ? "Building" : ci === "none" ? "No builds" : "Not checked";
  return (
    <span className={`light light-${ci ?? "unknown"}`} title={label}>
      <span aria-hidden />
      {label}
    </span>
  );
}

function Projects({ company, onRefresh }: { company: Company; onRefresh: () => void }) {
  return (
    <section className="projects">
      <div className="section-head">
        <h2>Projects</h2>
        <button type="button" className="ghost" onClick={onRefresh}>
          Check builds
        </button>
      </div>
      <div className="project-grid">
        {company.projects.map((p) => {
          const open = company.tasks.filter((t) => t.projectId === p.id && t.status !== "done").length;
          return (
            <article key={p.id} className={`project ci-${p.health?.ci ?? "unknown"}`}>
              <header>
                <h3>{p.name}</h3>
                {p.repo ? <Light ci={p.health?.ci} /> : <span className="light light-local">On your PC</span>}
              </header>
              <p className="summary">{p.summary}</p>
              {p.health?.lastCommit && (
                <p className="commit">
                  “{p.health.lastCommit.message}” · {ago(p.health.lastCommit.at)}
                </p>
              )}
              {p.health?.error && <p className="commit">{p.health.error}</p>}
              <footer>
                <span>
                  {open} open {open === 1 ? "task" : "tasks"}
                  {typeof p.health?.openIssues === "number" ? ` · ${p.health.openIssues} GitHub issues` : ""}
                </span>
                <span className="links">
                  {p.liveUrl && (
                    <a href={p.liveUrl} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  )}
                  {p.repo && (
                    <a href={`https://github.com/${p.repo}`} target="_blank" rel="noreferrer">
                      Code
                    </a>
                  )}
                </span>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type Act = (method: Parameters<Backend["call"]>[0], ...args: unknown[]) => Promise<unknown>;

function Tasks({ company, act }: { company: Company; act: Act }) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("planner");
  const [projectId, setProjectId] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const name = (id: string | null) => company.agents.find((a) => a.id === id)?.name ?? "Unassigned";
  const project = (id: string | null) => company.projects.find((p) => p.id === id)?.name;

  const card = (t: Task) => (
    <li key={t.id} className="task">
      <p className="task-title">{t.title}</p>
      <p className="task-meta">
        {name(t.assignee)}
        {project(t.projectId) ? ` · ${project(t.projectId)}` : ""}
        {t.checkedOutBy ? " · working now" : ""}
      </p>
      {t.result && (
        <details>
          <summary>Result</summary>
          <pre>{t.result}</pre>
        </details>
      )}
      <div className="task-actions">
        {t.status === "todo" && t.assignee && (
          <button
            type="button"
            className="ghost"
            disabled={running !== null}
            onClick={async () => {
              setRunning(t.id);
              await act("runTask", t.id);
              setRunning(null);
            }}
          >
            {running === t.id ? "Working…" : "Start"}
          </button>
        )}
        {t.status !== "done" && (
          <button type="button" className="ghost" onClick={() => act("editTask", t.id, { status: "done" })}>
            Mark done
          </button>
        )}
      </div>
    </li>
  );

  return (
    <section className="tasks">
      <form
        className="new-task"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await act("addTask", { title, assignee, projectId: projectId || null });
          setTitle("");
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task" aria-label="New task" />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to">
          {company.agents
            .filter((a) => a.id !== "bunki")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          <option value="">No project</option>
          {company.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!title.trim()}>
          Add
        </button>
      </form>
      <div className="board">
        {COLUMNS.map((col) => {
          const items = company.tasks.filter((t) => t.status === col.id || (col.id === "review" && t.status === "blocked"));
          return (
            <div key={col.id} className={`column col-${col.id}`}>
              <h3>
                {col.label} <span>{items.length}</span>
              </h3>
              <ul>{items.slice(0, col.id === "done" ? 8 : 50).map(card)}</ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Team({ company, act }: { company: Company; act: Act }) {
  const month = new Date().toISOString().slice(0, 7);
  const spent = (id: string) => company.spend.find((s) => s.agentId === id && s.month === month)?.usd ?? 0;
  const boss = company.agents.find((a) => !a.reportsTo)!;
  const staff = company.agents.filter((a) => a.reportsTo === boss.id);
  const seat = (a: (typeof company.agents)[number]) => {
    const used = spent(a.id);
    const pct = Math.min(100, (used / Math.max(a.budgetUsd, 0.01)) * 100);
    const doing = company.tasks.filter((t) => t.assignee === a.id && t.status !== "done").length;
    return (
      <article key={a.id} className={`seat${a.paused ? " paused" : ""}`}>
        <div className={`avatar avatar-${a.id}`} aria-hidden>
          {a.name[0]}
        </div>
        <h3>{a.name}</h3>
        <p className="seat-title">{a.title}</p>
        <div className="budget" title={`$${used.toFixed(2)} of $${a.budgetUsd} this month`}>
          <div className={pct >= 80 ? "warn" : ""} style={{ width: `${pct}%` }} />
        </div>
        <p className="seat-meta">
          ${used.toFixed(2)} of ${a.budgetUsd} · {doing} open
        </p>
        <button type="button" className="ghost" onClick={() => act("setPaused", a.id, !a.paused)}>
          {a.paused ? "Resume" : "Pause"}
        </button>
      </article>
    );
  };
  return (
    <section className="team">
      <div className="org">
        <div className="org-top">{seat(boss)}</div>
        <div className="org-row">{staff.map(seat)}</div>
      </div>
      <p className="footnote">
        Each agent has a monthly budget. At 80% the bar turns amber; at 100% the agent pauses itself until you resume it
        or raise the budget.
      </p>
    </section>
  );
}

function ActivityFeed({ company }: { company: Company }) {
  const who = (id: string) => company.agents.find((a) => a.id === id)?.name ?? (id === "you" ? "You" : "System");
  return (
    <section className="activity">
      <ol>
        {company.activity.slice(0, 60).map((a) => (
          <li key={a.id}>
            <span className="when">{ago(a.at)}</span>
            <span>
              <b>{who(a.actor)}</b> {a.action.toLowerCase()}: {a.detail}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
