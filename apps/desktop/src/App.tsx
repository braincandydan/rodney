import { useEffect, useState } from "react";
import "./App.css";
import { loadConfig, type RodneyConfig } from "./api";
import { Onboarding } from "./components/Onboarding";
import { Dashboard } from "./components/Dashboard";
import { SkillLauncher } from "./components/SkillLauncher";
import { TerminalPanel } from "./components/TerminalPanel";
import { MemoryBrowser } from "./components/MemoryBrowser";
import { Projects } from "./components/Projects";
import { Personality } from "./components/Personality";
import { useUiStore } from "./store";

const tabs = [
  { id: "dashboard" as const, label: "Dashboard" },
  { id: "skills" as const, label: "Skills" },
  { id: "terminal" as const, label: "Terminal" },
  { id: "memories" as const, label: "Memories" },
  { id: "projects" as const, label: "Projects" },
  { id: "personality" as const, label: "Personality" },
];

export default function App() {
  const [cfg, setCfg] = useState<RodneyConfig | null | undefined>(undefined);
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);

  useEffect(() => {
    loadConfig().then(setCfg).catch(() => setCfg(null));
  }, []);

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
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {tab === "dashboard" ? <Dashboard /> : null}
        {tab === "skills" ? <SkillLauncher /> : null}
        {tab === "terminal" ? <TerminalPanel /> : null}
        {tab === "memories" ? <MemoryBrowser /> : null}
        {tab === "projects" ? <Projects /> : null}
        {tab === "personality" ? <Personality /> : null}
      </main>
    </div>
  );
}
