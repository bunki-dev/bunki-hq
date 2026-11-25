// Model adapters over plain fetch: the Anthropic Messages API and Azure OpenAI chat completions.
// One shape in, one shape out, so the agent loop doesn't care which provider it's talking to.

import type { Fetch } from "./github.ts";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[] }
  | { role: "tool"; callId: string; name: string; result: string; isError: boolean };

export interface Reply {
  text: string;
  calls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export interface Model {
  label: string;
  complete(system: string, messages: Msg[], tools: ToolSpec[]): Promise<Reply>;
  /** Estimated USD per million tokens (input, output). Editable in settings. */
  price: { input: number; output: number };
}

export class ModelError extends Error {}

function friendly(status: number, body: any): ModelError {
  if (status === 401 || status === 403) return new ModelError("The API key was rejected. Check it in Settings.");
  if (status === 429) return new ModelError("The model provider is rate limiting or out of credit. Try again shortly.");
  const msg = body?.error?.message ?? JSON.stringify(body)?.slice(0, 200);
  return new ModelError(`Model call failed (${status}): ${msg}`);
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  browser?: boolean;
  fetch?: Fetch;
  price?: { input: number; output: number };
}

export function anthropic(o: AnthropicOptions): Model {
  const f = o.fetch ?? fetch;
  const wire = (messages: Msg[]) => {
    const out: any[] = [];
    for (const m of messages) {
      if (m.role === "user") out.push({ role: "user", content: m.text });
      else if (m.role === "assistant") {
        const content: any[] = m.text ? [{ type: "text", text: m.text }] : [];
        for (const c of m.calls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
        out.push({ role: "assistant", content });
      } else {
        const block = { type: "tool_result", tool_use_id: m.callId, content: m.result, is_error: m.isError };
        const last = out[out.length - 1];
        if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
        else out.push({ role: "user", content: [block] });
      }
    }
    return out;
  };
  return {
    label: `Claude (${o.model})`,
    price: o.price ?? { input: 3, output: 15 },
    async complete(system, messages, tools) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": o.apiKey,
        "anthropic-version": "2023-06-01",
      };
      if (o.browser) headers["anthropic-dangerous-direct-browser-access"] = "true";
      const res = await f("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: o.model,
          max_tokens: 1200,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
          messages: wire(messages),
        }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw friendly(res.status, body);
      const blocks: any[] = body.content ?? [];
      return {
        text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
        calls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
    },
  };
}

export interface AzureOptions {
  apiKey: string;
  endpoint: string;
  deployment: string;
  apiVersion?: string;
  fetch?: Fetch;
  price?: { input: number; output: number };
}

export function azureOpenAI(o: AzureOptions): Model {
  const f = o.fetch ?? fetch;
  const url = `${o.endpoint.replace(/\/$/, "")}/openai/deployments/${o.deployment}/chat/completions?api-version=${
    o.apiVersion ?? "2024-10-21"
  }`;
  return {
    label: `Azure AI Foundry (${o.deployment})`,
    price: o.price ?? { input: 2.5, output: 10 },
    async complete(system, messages, tools) {
      const wire: any[] = [{ role: "system", content: system }];
      for (const m of messages) {
        if (m.role === "user") wire.push({ role: "user", content: m.text });
        else if (m.role === "assistant")
          wire.push({
            role: "assistant",
            content: m.text || null,
            ...(m.calls.length
              ? {
                  tool_calls: m.calls.map((c) => ({
                    id: c.id,
                    type: "function",
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  })),
                }
              : {}),
          });
        else wire.push({ role: "tool", tool_call_id: m.callId, content: m.result });
      }
      const res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json", "api-key": o.apiKey },
        body: JSON.stringify({
          messages: wire,
          max_tokens: 1200,
          tools: tools.map((t) => ({ type: "function", function: t })),
        }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw friendly(res.status, body);
      const msg = body.choices?.[0]?.message ?? {};
      return {
        text: msg.content ?? "",
        calls: (msg.tool_calls ?? []).map((c: any) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(c.function?.arguments || "{}");
          } catch {
            args = { _unparseable: c.function?.arguments };
          }
          return { id: c.id, name: c.function?.name, args };
        }),
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      };
    },
  };
}

export interface ModelSettings {
  provider: "none" | "anthropic" | "azure";
  apiKey: string;
  model: string;
  endpoint: string;
  deployment: string;
  githubToken: string;
}

export const DEFAULT_SETTINGS: ModelSettings = {
  provider: "none",
  apiKey: "",
  model: "claude-sonnet-5-5",
  endpoint: "",
  deployment: "",
  githubToken: "",
};

export function modelFrom(s: ModelSettings, browser: boolean, f?: Fetch): Model | null {
  if (s.provider === "anthropic" && s.apiKey) return anthropic({ apiKey: s.apiKey, model: s.model, browser, fetch: f });
  if (s.provider === "azure" && s.apiKey && s.endpoint && s.deployment)
    return azureOpenAI({ apiKey: s.apiKey, endpoint: s.endpoint, deployment: s.deployment, fetch: f });
  return null;
}
