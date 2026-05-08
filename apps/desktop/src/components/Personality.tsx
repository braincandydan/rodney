import { useEffect, useState } from "react";
import type { PersonalityRow } from "../api";
import { personalityDelete, personalityList, personalityUpsert } from "../api";

export function Personality() {
  const [rows, setRows] = useState<PersonalityRow[]>([]);
  const [traitName, setTraitName] = useState("");
  const [value, setValue] = useState("");
  const [locked, setLocked] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try {
      setRows(await personalityList());
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await personalityUpsert(traitName.trim(), value, locked);
    setTraitName("");
    setValue("");
    setLocked(false);
    await reload();
  }

  return (
    <div className="panel">
      <h2>Personality (SQLite)</h2>
      <p className="muted">
        Traits complement <code>AGENT_CORE.md</code>. Use lowercase snake_case trait keys (e.g.{" "}
        <code>tone</code>, <code>verbosity</code>).
      </p>
      {err ? <p className="error">{err}</p> : null}
      <form onSubmit={(e) => void submit(e)} className="form-grid">
        <label>
          Trait
          <input required value={traitName} onChange={(e) => setTraitName(e.target.value)} placeholder="tone" />
        </label>
        <label className="full">
          Value
          <textarea required rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
          Locked by user (agent merges conservatively)
        </label>
        <button type="submit" className="primary">
          Upsert trait
        </button>
      </form>

      <h3>Current traits</h3>
      <ul className="trait-list">
        {rows.map((r) => (
          <li key={r.traitName}>
            <strong>{r.traitName}</strong> {r.lockedByUser ? "(locked)" : ""}
            <div className="muted">{r.value}</div>
            <button type="button" className="danger tiny-btn" onClick={() => void personalityDelete(r.traitName).then(reload)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {!rows.length ? <p className="muted">No traits stored yet — MCP `reflect` will still read AGENT_CORE.md.</p> : null}
    </div>
  );
}
