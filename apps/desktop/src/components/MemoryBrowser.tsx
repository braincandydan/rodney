import { useEffect, useMemo, useState } from "react";
import type { MemoryRow } from "../api";
import { memoriesList, memoryDeprecate, memorySetPinned, memoryUpdate } from "../api";

const cats = ["core", "episodic", "semantic", "procedural", "relationship", "project"];

export function MemoryBrowser() {
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [cat, setCat] = useState<string>("");
  const [incDep, setIncDep] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<MemoryRow | null>(null);
  const [draft, setDraft] = useState("");

  async function reload() {
    try {
      const list = await memoriesList({
        category: cat || null,
        includeDeprecated: incDep,
      });
      setRows(list);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, incDep]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.importance !== b.importance) return b.importance - a.importance;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [rows]);

  function openEdit(r: MemoryRow) {
    setEdit(r);
    setDraft(r.content);
  }

  async function saveEdit() {
    if (!edit) return;
    await memoryUpdate(edit.id, draft);
    setEdit(null);
    await reload();
  }

  return (
    <div className="panel">
      <h2>Memories</h2>
      <div className="toolbar">
        <label className="inline">
          Category{" "}
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">all</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={incDep} onChange={(e) => setIncDep(e.target.checked)} />
          Include deprecated
        </label>
        <button type="button" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      {err ? <p className="error">{err}</p> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Pinned</th>
              <th>Cat</th>
              <th>Imp</th>
              <th>Content</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className={r.isDeprecated ? "deprecated" : undefined}>
                <td>
                  <input
                    type="checkbox"
                    checked={r.pinned}
                    onChange={(e) => void memorySetPinned(r.id, e.target.checked).then(reload)}
                  />
                </td>
                <td>{r.category}</td>
                <td>{r.importance}</td>
                <td className="cell-content">{r.content.slice(0, 200)}{r.content.length > 200 ? "…" : ""}</td>
                <td className="cell-actions">
                  <button type="button" onClick={() => openEdit(r)}>
                    Edit
                  </button>
                  <button type="button" className="danger" onClick={() => void memoryDeprecate(r.id).then(reload)}>
                    Forget
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Edit memory #{edit.id}</h3>
            <textarea rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="modal-actions">
              <button type="button" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={() => void saveEdit()}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
