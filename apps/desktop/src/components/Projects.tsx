import { useEffect, useState } from "react";
import type { ProjectCard, ProjectTask } from "../api";
import {
  createProjectTask,
  listProjectTasks,
  listProjects,
  openProjectFolder,
  prefetchProjectSession,
  readProjectOverview,
  updateTaskStatus,
} from "../api";
import { useUiStore } from "../store";

const STATUS_COLORS: Record<string, string> = {
  "todo": "var(--muted)",
  "in-progress": "var(--accent)",
  "done": "#3fb950",
  "blocked": "var(--danger)",
};

const STATUS_ORDER = ["in-progress", "todo", "blocked", "done"];

function StatusPill({ status }: { status: string }) {
  return (
    <span
      style={{
        fontSize: "0.68rem",
        padding: "0.1rem 0.45rem",
        borderRadius: 4,
        border: `1px solid ${STATUS_COLORS[status] ?? "var(--border)"}`,
        color: STATUS_COLORS[status] ?? "var(--muted)",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

// ── Launch modal ────────────────────────────────────────────────────────────

interface LaunchModalProps {
  project: ProjectCard;
  tasks: ProjectTask[];
  onClose: () => void;
}

function LaunchModal({ project, tasks, onClose }: LaunchModalProps) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    tasks.filter((t) => t.status === "in-progress").forEach((t) => initial.add(t.slug));
    return initial;
  });
  const [focus, setFocus] = useState("");
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const addTermSession = useUiStore((s) => s.addTermSession);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function launch() {
    setLaunching(true);
    setErr(null);
    try {
      await prefetchProjectSession({
        projectSlug: project.slug,
        selectedTaskSlugs: [...selected],
        focus: focus.trim() || null,
      });
      const label = focus.trim() || project.slug;
      addTermSession(label);
      onClose();
    } catch (e) {
      setErr(String(e));
      setLaunching(false);
    }
  }

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: tasks.filter((t) => t.status === status),
  })).filter((g) => g.items.length > 0);

  const doneTasks = tasks.filter((t) => t.status === "done");
  if (doneTasks.length > 0) {
    grouped.push({ status: "done", items: doneTasks });
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div
        className="modal-dialog"
        style={{ width: "min(560px, 92vw)", maxHeight: "80vh", overflowY: "auto" }}
      >
        <h3 style={{ margin: "0 0 0.25rem" }}>Work on {project.slug}</h3>
        <p className="muted tiny" style={{ margin: "0 0 1rem" }}>
          Select tasks to focus on. The agent receives full project context + selected task details.
        </p>

        {tasks.length === 0 ? (
          <p className="muted tiny">No tasks yet — create one first.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1rem" }}>
            {grouped.map(({ status, items }) => (
              <div key={status}>
                <div
                  className="muted tiny"
                  style={{ textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.35rem" }}
                >
                  {status}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  {items.map((task) => {
                    const checked = selected.has(task.slug);
                    const isDone = task.status === "done";
                    return (
                      <label
                        key={task.slug}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "0.65rem",
                          padding: "0.5rem 0.65rem",
                          borderRadius: 8,
                          border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                          background: checked ? "rgba(88,166,255,0.06)" : "#0e141f",
                          cursor: isDone ? "default" : "pointer",
                          opacity: isDone ? 0.5 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isDone}
                          onChange={() => toggle(task.slug)}
                          style={{ marginTop: 2, flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{task.title}</div>
                          {task.priority && (
                            <div className="muted tiny" style={{ marginTop: 2 }}>
                              priority: {task.priority}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="form-grid" style={{ marginBottom: "0.75rem" }}>
          <label style={{ flexDirection: "column", gap: "0.3rem", display: "flex" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Session focus</span>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. build the login flow, fix the webhook bug…"
              className="skill-form-input"
              autoComplete="off"
            />
          </label>
        </div>

        {err && <p className="error tiny" style={{ marginBottom: "0.5rem" }}>{err}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={launching}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void launch()}
            disabled={launching}
          >
            {launching ? "Launching…" : "Launch session"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New task form ───────────────────────────────────────────────────────────

interface NewTaskFormProps {
  projectSlug: string;
  onCreated: (task: ProjectTask) => void;
  onCancel: () => void;
}

function NewTaskForm({ projectSlug, onCreated, onCancel }: NewTaskFormProps) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const taskSlug = await createProjectTask({ projectSlug, title: title.trim(), priority });
      onCreated({ slug: taskSlug, title: title.trim(), status: "todo", priority, body: "" });
    } catch (ex) {
      setErr(String(ex));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      style={{
        border: "1px solid var(--accent)",
        borderRadius: 8,
        padding: "0.65rem",
        background: "rgba(88,166,255,0.04)",
        marginTop: "0.5rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title…"
          className="skill-form-input"
          style={{ flex: 1, minWidth: 160 }}
          autoFocus
          autoComplete="off"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="skill-form-input"
          style={{ width: 110 }}
        >
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
        <button type="submit" className="primary tiny-btn" disabled={saving || !title.trim()}>
          {saving ? "…" : "Add"}
        </button>
        <button type="button" className="tiny-btn" onClick={onCancel} disabled={saving}>
          ×
        </button>
      </div>
      {err && <p className="error tiny" style={{ marginTop: "0.35rem" }}>{err}</p>}
    </form>
  );
}

// ── Burndown chart ──────────────────────────────────────────────────────────

function BurndownChart({ tasks }: { tasks: ProjectTask[] }) {
  const tasksWithDates = tasks.filter((t) => t.created);
  if (tasksWithDates.length < 3) return null;

  const total = tasks.length;
  const toMs = (s: string) => new Date(s).getTime();
  const earliest = Math.min(...tasksWithDates.map((t) => toMs(t.created!)));
  const now = Date.now();
  const span = now - earliest;
  if (span <= 0) return null;

  // Build actual burndown: for each sample point, count tasks NOT done as of that date
  const SAMPLES = 30;
  const points: { x: number; remaining: number }[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = earliest + (span * i) / SAMPLES;
    const remaining = tasks.filter((task) => {
      if (task.status !== "done") return true;
      if (!task.completedAt) return false;
      return toMs(task.completedAt) > t;
    }).length;
    points.push({ x: i / SAMPLES, remaining });
  }

  const W = 280, H = 90, PAD = { t: 8, r: 8, b: 20, l: 28 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const px = (x: number) => PAD.l + x * iW;
  const py = (r: number) => PAD.t + (1 - r / total) * iH;

  const actualPath = points.map((p, i) =>
    `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.remaining).toFixed(1)}`
  ).join(" ");
  const idealPath = `M${px(0)},${py(total)} L${px(1)},${py(0)}`;

  const startLabel = new Date(earliest).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const todayLabel = new Date(now).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div style={{ marginTop: "0.75rem", marginBottom: "0.25rem" }}>
      <div className="muted tiny" style={{ marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Burndown
      </div>
      <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
        {/* Y axis */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + iH} stroke="var(--border)" strokeWidth={1} />
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize={9} fill="var(--muted)">{total}</text>
        <text x={PAD.l - 4} y={PAD.t + iH} textAnchor="end" fontSize={9} fill="var(--muted)">0</text>
        {/* X axis */}
        <line x1={PAD.l} y1={PAD.t + iH} x2={PAD.l + iW} y2={PAD.t + iH} stroke="var(--border)" strokeWidth={1} />
        <text x={PAD.l} y={H - 4} fontSize={9} fill="var(--muted)">{startLabel}</text>
        <text x={PAD.l + iW} y={H - 4} textAnchor="end" fontSize={9} fill="var(--muted)">{todayLabel}</text>
        {/* Ideal */}
        <path d={idealPath} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="4 2" />
        {/* Actual */}
        <path d={actualPath} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ── Task row ────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: ProjectTask;
  projectSlug: string;
  onStatusChange: (slug: string, status: string) => void;
}

function TaskRow({ task, projectSlug, onStatusChange }: TaskRowProps) {
  const [saving, setSaving] = useState(false);

  async function cycleStatus() {
    const next = task.status === "todo"
      ? "in-progress"
      : task.status === "in-progress"
      ? "done"
      : task.status === "done"
      ? "todo"
      : "todo";
    setSaving(true);
    try {
      await updateTaskStatus(projectSlug, task.slug, next);
      onStatusChange(task.slug, next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.65rem",
        padding: "0.45rem 0.5rem",
        borderRadius: 6,
        background: "#0b0f14",
        border: "1px solid var(--border)",
        opacity: task.status === "done" ? 0.55 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => void cycleStatus()}
        disabled={saving}
        title="Click to cycle status"
        style={{
          background: "transparent",
          border: `1px solid ${STATUS_COLORS[task.status] ?? "var(--border)"}`,
          borderRadius: "50%",
          width: 16,
          height: 16,
          padding: 0,
          flexShrink: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {task.status === "done" && (
          <span style={{ fontSize: "0.6rem", color: "#3fb950", lineHeight: 1 }}>✓</span>
        )}
        {task.status === "in-progress" && (
          <span style={{ fontSize: "0.55rem", color: "var(--accent)", lineHeight: 1 }}>●</span>
        )}
      </button>
      <span style={{ flex: 1, fontSize: "0.85rem", textDecoration: task.status === "done" ? "line-through" : "none" }}>
        {task.title}
      </span>
      <StatusPill status={task.status} />
      {task.priority && (
        <span className="muted tiny">{task.priority}</span>
      )}
    </div>
  );
}

// ── Projects ────────────────────────────────────────────────────────────────

export function Projects() {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [overviews, setOverviews] = useState<Record<string, string | null>>({});
  const [tasks, setTasks] = useState<Record<string, ProjectTask[]>>({});
  const [showingTasks, setShowingTasks] = useState<string | null>(null);
  const [newTaskFor, setNewTaskFor] = useState<string | null>(null);
  const [launchProject, setLaunchProject] = useState<ProjectCard | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((e) => setErr(String(e)));
  }, []);

  async function toggle(slug: string) {
    if (expanded === slug) {
      setExpanded(null);
      return;
    }
    setExpanded(slug);
    if (!(slug in overviews)) {
      const content = await readProjectOverview(slug).catch(() => null);
      setOverviews((prev) => ({ ...prev, [slug]: content }));
    }
  }

  async function loadTasks(slug: string) {
    if (tasks[slug]) {
      setShowingTasks(showingTasks === slug ? null : slug);
      return;
    }
    const list = await listProjectTasks(slug).catch(() => [] as ProjectTask[]);
    setTasks((prev) => ({ ...prev, [slug]: list }));
    setShowingTasks(slug);
  }

  function handleTaskCreated(projectSlug: string, task: ProjectTask) {
    setTasks((prev) => ({
      ...prev,
      [projectSlug]: [...(prev[projectSlug] ?? []), task],
    }));
    setNewTaskFor(null);
  }

  function handleStatusChange(projectSlug: string, taskSlug: string, status: string) {
    const today = new Date().toISOString().slice(0, 10);
    setTasks((prev) => ({
      ...prev,
      [projectSlug]: (prev[projectSlug] ?? []).map((t) =>
        t.slug === taskSlug
          ? { ...t, status, completedAt: status === "done" ? today : undefined }
          : t
      ),
    }));
  }

  async function openLaunchModal(project: ProjectCard) {
    if (!tasks[project.slug]) {
      const list = await listProjectTasks(project.slug).catch(() => [] as ProjectTask[]);
      setTasks((prev) => ({ ...prev, [project.slug]: list }));
    }
    setLaunchProject(project);
  }

  if (err) return <p className="error">{err}</p>;

  const projectTasks = launchProject ? (tasks[launchProject.slug] ?? []) : [];

  return (
    <div className="panel">
      {launchProject && (
        <LaunchModal
          project={launchProject}
          tasks={projectTasks}
          onClose={() => setLaunchProject(null)}
        />
      )}

      <h2>Projects</h2>
      <p className="muted">
        Scanned from <code>vault/projects/</code>. Each project can have tasks in{" "}
        <code>tasks/</code> — the agent works through them in sessions.
      </p>

      <div className="project-grid">
        {projects.map((p) => {
          const projectTaskList = tasks[p.slug] ?? [];
          const activeTasks = projectTaskList.filter((t) => t.status !== "done");
          const doneTasks = projectTaskList.filter((t) => t.status === "done");

          return (
            <div key={p.slug} className="project-card">
              <div className="project-card-header">
                <button
                  type="button"
                  className="project-slug-btn"
                  onClick={() => void toggle(p.slug)}
                >
                  {expanded === p.slug ? "▾" : "▸"} {p.slug}
                </button>
                <div className="project-badges">
                  {!p.hasOverview && <span className="badge-warn">no overview</span>}
                  {p.pendingFeedbackHint && <span className="badge-review">needs review</span>}
                </div>
                <div style={{ display: "flex", gap: "0.35rem", marginLeft: "auto", alignItems: "center" }}>
                  <button
                    type="button"
                    className="tiny-btn"
                    onClick={() => void loadTasks(p.slug)}
                    title="Show tasks"
                    style={{ color: showingTasks === p.slug ? "var(--accent)" : undefined }}
                  >
                    Tasks {projectTaskList.length > 0 ? `(${activeTasks.length}/${projectTaskList.length})` : ""}
                  </button>
                  <button
                    type="button"
                    className="primary tiny-btn"
                    onClick={() => void openLaunchModal(p)}
                    title="Start a work session for this project"
                  >
                    Work on this ▶
                  </button>
                  <button
                    type="button"
                    className="project-open-btn tiny-btn"
                    onClick={() => void openProjectFolder(p.slug)}
                    title="Open folder in Explorer"
                  >
                    Open ↗
                  </button>
                </div>
              </div>

              {/* Overview */}
              {expanded === p.slug && (
                <div className="project-overview">
                  {overviews[p.slug] === undefined ? (
                    <p className="muted">Loading…</p>
                  ) : overviews[p.slug] === null ? (
                    <p className="muted">No overview.md yet.</p>
                  ) : (
                    <pre className="overview-content">{overviews[p.slug]}</pre>
                  )}
                </div>
              )}

              {/* Tasks panel */}
              {showingTasks === p.slug && (
                <div
                  style={{
                    padding: "0.65rem",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  {projectTaskList.length === 0 ? (
                    <p className="muted tiny">No tasks yet.</p>
                  ) : (
                    <>
                      <BurndownChart tasks={projectTaskList} />
                      {/* Active tasks */}
                      {activeTasks.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.5rem" }}>
                          {activeTasks.map((task) => (
                            <TaskRow
                              key={task.slug}
                              task={task}
                              projectSlug={p.slug}
                              onStatusChange={(slug, status) => handleStatusChange(p.slug, slug, status)}
                            />
                          ))}
                        </div>
                      )}
                      {/* Done tasks (collapsed summary) */}
                      {doneTasks.length > 0 && (
                        <div className="muted tiny" style={{ marginTop: "0.35rem" }}>
                          {doneTasks.length} task{doneTasks.length !== 1 ? "s" : ""} done
                        </div>
                      )}
                    </>
                  )}

                  {/* New task form / button */}
                  {newTaskFor === p.slug ? (
                    <NewTaskForm
                      projectSlug={p.slug}
                      onCreated={(task) => handleTaskCreated(p.slug, task)}
                      onCancel={() => setNewTaskFor(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="tiny-btn"
                      style={{ marginTop: "0.5rem" }}
                      onClick={() => setNewTaskFor(p.slug)}
                    >
                      + New task
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!projects.length ? <p className="muted">No projects yet.</p> : null}
    </div>
  );
}
