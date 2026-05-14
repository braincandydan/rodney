import { useEffect, useState } from "react";
import "./App.css";
import { loadConfig, pendingMemoriesList, type RodneyConfig } from "./api";
import { Onboarding } from "./components/Onboarding";
import { Dashboard } from "./components/Dashboard";
import { SkillLauncher } from "./components/SkillLauncher";
import { TerminalPanel } from "./components/TerminalPanel";
import { MemoryBrowser } from "./components/MemoryBrowser";
import { Projects } from "./components/Projects";
import { Personality } from "./components/Personality";
import { ScriptsDashboard } from "./components/ScriptsDashboard";
import { useUiStore } from "./store";

const tabs = [
  { id: "dashboard" as const, label: "Dashboard" },
  { id: "skills" as const, label: "Skills" },
  { id: "terminal" as const, label: "Terminal" },
  { id: "memories" as const, label: "Memories" },
  { id: "projects" as const, label: "Projects" },
  { id: "scripts" as const, label: "Scripts" },
  { id: "personality" as const, label: "Personality" },
];

export default function App() {
  const [cfg, setCfg] = useState<RodneyConfig | null | undefined>(undefined);
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);
  const pendingCount = useUiStore((s) => s.pendingCount);
  const setPendingCount = useUiStore((s) => s.setPendingCount);

  useEffect(() => {
    loadConfig().then(setCfg).catch(() => setCfg(null));
  }, []);

  useEffect(() => {
    function poll() {
      pendingMemoriesList().then((list) => setPendingCount(list.length)).catch(() => {});
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [setPendingCount]);

  if (cfg === undefined) {
    return <div className="app-loading muted">Loading Rodney…</div>;
  }

  if (!cfg) {
    return (
      <div className="app-shell">
        <Onboarding
          onDone={(next) => {
            setCfg(next);
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <strong>Rodney</strong>
          <span className="muted tiny">{cfg.vaultPath}</span>
        </div>
        <nav className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tab ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "memories" && pendingCount > 0 ? (
                <span className="tab-badge">{pendingCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {tab === "dashboard" ? <Dashboard /> : null}
        {tab === "skills" ? <SkillLauncher /> : null}
        <TerminalPanel hidden={tab !== "terminal"} />
        {tab === "memories" ? <MemoryBrowser /> : null}
        {tab === "projects" ? <Projects /> : null}
        {tab === "scripts" ? <ScriptsDashboard /> : null}
        {tab === "personality" ? <Personality /> : null}
      </main>
    </div>
  );
}
