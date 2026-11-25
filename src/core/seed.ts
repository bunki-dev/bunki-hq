import type { Company } from "./types.ts";

// A starting company: Bunki in charge, three specialists, and the projects in this portfolio.
export function seedCompany(now = new Date()): Company {
  const at = now.toISOString();
  return {
    name: "Bunki HQ",
    mission: "Ship useful AI projects, keep them healthy, and land an AI engineering role.",
    version: 1,
    projects: [
      {
        id: "fitbasket",
        name: "FitBasket",
        repo: "bunki-dev/fitbasket",
        liveUrl: "https://bunki-dev.github.io/fitbasket/",
        summary: "AI trainer and grocery agent: meals, weekly shop, workouts and a barcode macro tracker.",
        goal: "Used every week for training, meals and the Wednesday shop.",
      },
      {
        id: "game-night",
        name: "Game Night",
        repo: "bunki-dev/game-night",
        liveUrl: "https://game-night-nq9e.onrender.com",
        summary: "Party game with an AI game master: TV screen, phones as controllers.",
        goal: "Played at a real game night, with a LinkedIn post about the AI judge.",
      },
      {
        id: "shelftalk",
        name: "ShelfTalk",
        repo: "bunki-dev/shelftalk",
        liveUrl: "https://bunki-dev.github.io/shelftalk/",
        summary: "Guarded text-to-SQL agent over a grocery warehouse, with a semantic planner and evals.",
        goal: "Live on GitHub Pages with LLM-mode eval results in the README.",
      },
      {
        id: "portfolio",
        name: "Portfolio",
        repo: "bunki-dev/bunki-dev",
        summary: "GitHub profile: project write-ups and requirements-to-evidence table.",
        goal: "Every public project linked and current; recruiters can see evidence in two minutes.",
      },
      {
        id: "bunki-hq",
        name: "Bunki HQ",
        repo: "bunki-dev/bunki-hq",
        summary: "This app: a company of AI agents run by Bunki, the talking orb.",
        goal: "Bunki gives a useful morning status and keeps project tasks moving.",
      },
      {
        id: "bunki",
        name: "Bunki assistant",
        summary: "Personal assistant on the home PC (an OpenJarvis fork), getting a voice orb.",
        goal: "Talk to Bunki at home and from the phone.",
      },
    ],
    agents: [
      {
        id: "bunki",
        name: "Bunki",
        title: "Chief of staff",
        reportsTo: null,
        instructions:
          "You run this company for its owner. Keep a short, honest picture of every project, turn the " +
          "owner's requests into tasks, delegate them to the right specialist, and report back briefly. " +
          "Anything that changes something outside this app needs the owner's approval.",
        tools: [
          "list_projects",
          "check_project_health",
          "list_tasks",
          "create_task",
          "update_task",
          "delegate_task",
          "list_approvals",
          "recent_activity",
          "request_github_issue",
        ],
        budgetUsd: 10,
        paused: false,
      },
      {
        id: "ops",
        name: "Ops",
        title: "Release manager",
        reportsTo: "bunki",
        instructions:
          "You watch builds, deploys and open issues across the projects. Check health, explain failures in " +
          "plain words, and propose a GitHub issue (for approval) when something needs fixing.",
        tools: ["list_projects", "check_project_health", "update_task", "request_github_issue"],
        budgetUsd: 3,
        paused: false,
      },
      {
        id: "writer",
        name: "Quill",
        title: "Writer",
        reportsTo: "bunki",
        instructions:
          "You draft LinkedIn posts, READMEs and cover-letter paragraphs in the owner's voice: plain, specific, " +
          "no hype, real numbers only. Put the draft in the task result. Never claim something was posted.",
        tools: ["list_projects", "update_task", "request_post_review"],
        budgetUsd: 3,
        paused: false,
      },
      {
        id: "planner",
        name: "Atlas",
        title: "Planner",
        reportsTo: "bunki",
        instructions:
          "You break goals into small, concrete tasks with a clear definition of done, and assign each to " +
          "the best specialist. Prefer fewer, sharper tasks.",
        tools: ["list_projects", "list_tasks", "create_task", "update_task"],
        budgetUsd: 2,
        paused: false,
      },
    ],
    tasks: [],
    approvals: [],
    activity: [{ id: "a0", at, actor: "system", action: "Company created", detail: "Bunki HQ is open for business." }],
    spend: [],
    chat: [],
  };
}
