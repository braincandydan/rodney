import { useState } from "react";
import type { RodneyConfig } from "../api";
import { saveFullConfig } from "../api";

type Props = {
  onDone: (cfg: RodneyConfig) => void;
};

export function Onboarding({ onDone }: Props) {
  const [vaultPath, setVaultPath] = useState("");
  const [rodneyRoot, setRodneyRoot] = useState("");
  const [claudeBin, setClaudeBin] = useState("");
  const [agentName, setAgentName] = useState("Rodney");
  const [personalityNotes, setPersonalityNotes] = useState(
    "- Tone: direct, warm, concise.\n- Values: honesty, clarity, shipping.",
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await saveFullConfig({
        vaultPath,
        rodneyRoot,
        claudeBin: claudeBin.trim() || null,
        agentName,
        personalityNotes,
      });
      onDone({
        vaultPath,
        rodneyRoot,
        claudeBin: claudeBin.trim() || null,
      });
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel narrow">
      <h1>Rodney onboarding</h1>
      <p className="muted">
        Point Rodney at your vault (workspace markdown) and this repo root so we can wire up the Memory MCP
        server.
      </p>
      <form onSubmit={submit} className="form-grid">
        <label>
          Vault folder (absolute path)
          <input
            required
            value={vaultPath}
            onChange={(e) => setVaultPath(e.target.value)}
            placeholder="/Users/you/RodneyVault"
          />
        </label>
        <label>
          Rodney repo root (absolute path)
          <input
            required
            value={rodneyRoot}
            onChange={(e) => setRodneyRoot(e.target.value)}
            placeholder="/Users/you/Downloads/Rodney"
          />
        </label>
        <label>
          Claude CLI binary (optional, default <code>claude</code>)
          <input value={claudeBin} onChange={(e) => setClaudeBin(e.target.value)} placeholder="claude" />
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
        {err ? <p className="error full">{err}</p> : null}
        <button type="submit" className="primary full" disabled={busy}>
          {busy ? "Saving…" : "Save & continue"}
        </button>
      </form>
    </div>
  );
}
