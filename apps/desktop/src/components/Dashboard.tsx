import { useEffect, useState } from "react";
import type { DashboardStats } from "../api";
import { getDashboardStats } from "../api";

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const s = await getDashboardStats();
        if (!cancelled) {
          setStats(s);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    }
    tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (err) return <p className="error">{err}</p>;
  if (!stats) return <p className="muted">Loading dashboard…</p>;

  return (
    <div className="panel">
      <h2>Dashboard</h2>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Memories</div>
          <div className="stat-value">{stats.memoryCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sessions (total)</div>
          <div className="stat-value">{stats.sessionCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active sessions</div>
          <div className="stat-value">{stats.activeSessions}</div>
        </div>
      </div>
      <h3>Agent state</h3>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Energy</div>
          <div className="stat-value small">{stats.agent.energy ?? "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Clarity</div>
          <div className="stat-value small">{stats.agent.clarity ?? "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Confidence</div>
          <div className="stat-value small">{stats.agent.confidence ?? "—"}</div>
        </div>
      </div>
      <p className="muted">
        <strong>Notes:</strong> {stats.agent.notes?.trim() ? stats.agent.notes : "—"}
      </p>
      <p className="muted tiny">Updated {stats.agent.updatedAt}</p>
    </div>
  );
}
