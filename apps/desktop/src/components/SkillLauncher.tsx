import { useEffect, useMemo, useState } from "react";
import type { SkillCard } from "../api";
import { listSkills, prefetchSessionContext } from "../api";
import { useUiStore } from "../store";

function skillTag(path: string): string[] {
  const base = path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  return base ? [base] : [];
}

export function SkillLauncher() {
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const setTab = useUiStore((s) => s.setTab);
  const bumpLaunch = useUiStore((s) => s.bumpLaunch);

  useEffect(() => {
    listSkills()
      .then(setSkills)
      .catch((e) => setErr(String(e)));
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, SkillCard[]>();
    for (const s of skills) {
      const k = s.category || "general";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [skills]);

  async function launch(skillPath: string) {
    setErr(null);
    try {
      await prefetchSessionContext({
        skillRelativePath: skillPath,
        recallTags: skillTag(skillPath),
        limit: 15,
      });
      bumpLaunch();
      setTab("terminal");
    } catch (e) {
      setErr(String(e));
    }
  }

  async function launchBare() {
    setErr(null);
    try {
      await prefetchSessionContext({
        skillRelativePath: "",
        recallTags: [],
        limit: 15,
      });
      bumpLaunch();
      setTab("terminal");
    } catch (e) {
      setErr(String(e));
    }
  }

  if (err) return <p className="error">{err}</p>;

  return (
    <div className="panel">
      <div className="row-between">
        <h2>Skills</h2>
        <button type="button" className="primary" onClick={() => void launchBare()}>
          Launch Claude (no skill)
        </button>
      </div>
      <p className="muted">
        Click a card to prefetch memories into <code>.session/SESSION_CONTEXT.md</code> and open the embedded
        terminal.
      </p>
      {grouped.map(([cat, items]) => (
        <section key={cat} className="skill-section">
          <h3>{cat}</h3>
          <div className="skill-grid">
            {items.map((s) => (
              <button
                key={s.relativePath}
                type="button"
                className="skill-card"
                onClick={() => void launch(s.relativePath)}
              >
                <div className="skill-title">{s.title}</div>
                <div className="skill-path">{s.relativePath}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
      {!skills.length ? <p className="muted">No skills found under vault/skills.</p> : null}
    </div>
  );
}
