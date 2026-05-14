import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { RodneyConfig } from "../api";
import { saveFullConfig } from "../api";

type Props = {
  onDone: (cfg: RodneyConfig) => void;
};

export function Onboarding({ onDone }: Props) {
  const [vaultPath, setVaultPath] = useState("");
  const [claudeBin, setClaudeBin] = useState("");
  const [hermesBin, setHermesBin] = useState("");
  const [agentRuntime, setAgentRuntime] = useState<"claude" | "hermes">("claude");
  const [agentName, setAgentName] = useState("Rodney");
  const [personalityNotes, setPersonalityNotes] = useState(
    "- Tone: direct, warm, concise.\n- Values: honesty, clarity, shipping.",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickFolder() {
    const selected = await open({ directory: true, title: "Choose your Rodney vault folder" });
    if (selected) setVaultPath(selected as string);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vaultPath.trim()) {
      setErr("Please select a vault folder.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await saveFullConfig({
        vaultPath,
        claudeBin: claudeBin.trim() || null,
        hermesBin: hermesBin.trim() || null,
        agentRuntime,
        agentName,
        personalityNotes,
      });
      onDone({ vaultPath, claudeBin: claudeBin.trim() || null, hermesBin: hermesBin.trim() || null, agentRuntime: agentRuntime === "hermes" ? "Hermes" : "Claude" });
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel narrow">
      <h1>Welcome to Rodney</h1>
      <p className="muted">
        Choose a folder where Rodney will store your memories, skills, and session context.
        A new folder or an empty existing one works best.
      </p>
      <form onSubmit={submit} className="form-grid">
        <label>
          Vault folder
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              required
              value={vaultPath}
              onChange={(e) => setVaultPath(e.target.value)}
              placeholder="Click Browse or paste a path…"
              style={{ flex: 1 }}
            />
            <button type="button" onClick={pickFolder} style={{ whiteSpace: "nowrap" }}>
              Browse…
            </button>
          </div>
        </label>
        <label>
          Agent display name
          <input required value={agentName} onChange={(e) => setAgentName(e.target.value)} />
        </label>
        <label className="full">
          Personality seed (markdown bullets)
          <textarea
            rows={6}
            value={personalityNotes}
            onChange={(e) => setPersonalityNotes(e.target.value)}
          />
        </label>

        <div className="full">
          <button
            type="button"
            className="link"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--muted)" }}
          >
            {showAdvanced ? "▾" : "▸"} Advanced options
          </button>
        </div>
        {showAdvanced && (
          <>
            <label className="full">
              Agent runtime
              <select value={agentRuntime} onChange={(e) => setAgentRuntime(e.target.value as "claude" | "hermes")}>
                <option value="claude">Claude Code</option>
                <option value="hermes">Hermes Agent</option>
              </select>
            </label>
            {agentRuntime === "claude" && (
              <label className="full">
                Claude CLI binary (leave blank to use <code>claude</code> from PATH)
                <input
                  value={claudeBin}
                  onChange={(e) => setClaudeBin(e.target.value)}
                  placeholder="claude"
                />
              </label>
            )}
            {agentRuntime === "hermes" && (
              <label className="full">
                Hermes binary (leave blank to use <code>hermes</code> from PATH)
                <input
                  value={hermesBin}
                  onChange={(e) => setHermesBin(e.target.value)}
                  placeholder="hermes"
                />
              </label>
            )}
          </>
        )}

        {err ? <p className="error full">{err}</p> : null}
        <button type="submit" className="primary full" disabled={busy}>
          {busy ? "Setting up…" : "Set up Rodney"}
        </button>
      </form>
    </div>
  );
}
