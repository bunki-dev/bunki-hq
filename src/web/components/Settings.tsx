import { useState } from "react";
import type { Backend } from "../backend.ts";

export function Settings({ backend, onClose, onReset }: { backend: Backend; onClose: () => void; onReset: () => void }) {
  const current = backend.settings();
  const [provider, setProvider] = useState(current.provider);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(current.model);
  const [endpoint, setEndpoint] = useState(current.endpoint);
  const [deployment, setDeployment] = useState(current.deployment);
  const [githubToken, setGithubToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const where =
    backend.mode === "pc"
      ? "Saved on this PC in your user folder (.bunki-hq/settings.json) and used only by the local server."
      : "Saved in this browser only and sent only to the provider you pick.";

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await backend.saveSettings({ provider, apiKey, model, endpoint, deployment, githubToken });
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <h2 id="settings-title">Settings</h2>
        <p className="fine">
          Without a model, Bunki can still check your builds, add tasks and read out approvals. Connect one to run the team.
        </p>
        <fieldset className="seg">
          <legend className="sr-only">Model provider</legend>
          {(
            [
              ["none", "No model"],
              ["anthropic", "Claude"],
              ["azure", "Azure AI Foundry"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className={provider === k ? "on" : ""}>
              <input type="radio" name="provider" checked={provider === k} onChange={() => setProvider(k)} />
              {label}
            </label>
          ))}
        </fieldset>
        {provider !== "none" && (
          <label>
            API key {current.hasApiKey && <span className="fine">(saved; leave blank to keep)</span>}
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          </label>
        )}
        {provider === "anthropic" && (
          <label>
            Model
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
        )}
        {provider === "azure" && (
          <>
            <label>
              Endpoint
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://my-resource.openai.azure.com" />
            </label>
            <label>
              Deployment
              <input value={deployment} onChange={(e) => setDeployment(e.target.value)} />
            </label>
          </>
        )}
        <label>
          GitHub token <span className="fine">(optional: higher rate limits, and lets approved issues be created)</span>
          {current.hasGithubToken && <span className="fine"> Saved; leave blank to keep.</span>}
          <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} autoComplete="off" />
        </label>
        <p className="fine">{where}</p>
        {error && <p className="error">{error}</p>}
        <div className="sheet-actions">
          <button
            type="button"
            className="ghost danger"
            onClick={() => {
              if (window.confirm("Start the company over? Tasks, approvals and activity will be cleared.")) {
                onReset();
                onClose();
              }
            }}
          >
            Start over
          </button>
          <span className="spacer" />
          {(current.hasApiKey || current.hasGithubToken) && (
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                await backend.saveSettings({ clearApiKey: true, clearGithubToken: true, provider: "none" });
                onClose();
              }}
            >
              Forget keys
            </button>
          )}
          <button type="submit" className="go" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
