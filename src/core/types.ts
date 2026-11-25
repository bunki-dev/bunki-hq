// The data model for Bunki HQ: a personal "company" of AI agents that Bunki runs for you.
// Plain JSON-friendly types so the same engine works in the browser and on the PC server.

export type TaskStatus = "todo" | "doing" | "review" | "done" | "blocked";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Project {
  id: string;
  name: string;
  repo?: string; // owner/name on GitHub
  liveUrl?: string;
  summary: string;
  goal?: string; // what "done" looks like for this project
  // Filled from GitHub when available.
  health?: ProjectHealth;
}

export interface ProjectHealth {
  checkedAt: string;
  ci: "passing" | "failing" | "running" | "none" | "unknown";
  ciWorkflow?: string;
  lastCommit?: { message: string; at: string; sha: string };
  openIssues?: number;
  error?: string;
}

export interface Agent {
  id: string;
  name: string;
  title: string;
  reportsTo: string | null; // null for Bunki
  instructions: string;
  tools: string[]; // tool names this agent may use
  budgetUsd: number; // per calendar month
  paused: boolean;
}

export interface Task {
  id: string;
  title: string;
  detail: string;
  projectId: string | null;
  assignee: string | null; // agent id
  status: TaskStatus;
  createdBy: string; // "you" or an agent id
  createdAt: string;
  updatedAt: string;
  checkedOutBy: string | null; // agent currently working on it
  result?: string;
}

export interface Approval {
  id: string;
  kind: string; // e.g. "github_issue", "publish_post"
  title: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  taskId: string | null;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  outcome?: string;
}

export interface Activity {
  id: string;
  at: string;
  actor: string; // "you", an agent id or "system"
  action: string;
  detail: string;
  costUsd?: number;
}

export interface Spend {
  agentId: string;
  month: string; // YYYY-MM
  usd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface Company {
  name: string;
  mission: string;
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  approvals: Approval[];
  activity: Activity[];
  spend: Spend[];
  chat: ChatTurn[];
  version: number;
}
