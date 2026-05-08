import { useEffect, useState } from "react";
import type { ProjectCard } from "../api";
import { listProjects } from "../api";

export function Projects() {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="error">{err}</p>;

  return (
    <div className="panel">
      <h2>Projects</h2>
      <p className="muted">Scanned from <code>vault/projects/</code> (skips <code>_template</code>).</p>
      <div className="project-grid">
        {projects.map((p) => (
          <div key={p.slug} className="project-card">
            <div className="project-slug">{p.slug}</div>
            <div className="muted tiny">
              Overview: {p.hasOverview ? "yes" : "missing"}
              {p.pendingFeedbackHint ? " · docs awaiting review" : ""}
            </div>
          </div>
        ))}
      </div>
      {!projects.length ? <p className="muted">No projects yet.</p> : null}
    </div>
  );
}
