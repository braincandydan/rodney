import { useEffect, useRef, useState, useMemo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawn } from "tauri-pty";
import { getClaudeLaunchInfo, listSkills, prefetchSessionContext, type SkillCard } from "../api";
import { useUiStore, type TermSession } from "../store";

interface SessionPaneProps {
  session: TermSession;
  isActive: boolean;
}

function TermSessionPane({ session, isActive }: SessionPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    let cancelled = false;
    const disposables: Array<{ dispose: () => void }> = [];
    let ro: ResizeObserver | undefined;
    let term: Terminal | undefined;
    let pty: ReturnType<typeof spawn> | undefined;

    void (async () => {
      try {
        const info = await getClaudeLaunchInfo();
        if (cancelled) return;

        term = new Terminal({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: "Menlo, Monaco, Consolas, monospace",
          theme: {
            background: "#0b0f14",
            foreground: "#e6edf3",
            cursor: "#58a6ff",
          },
        });
        const fit = new FitAddon();
        fitRef.current = fit;
        term.loadAddon(fit);
        term.open(el);
        fit.fit();

        pty = spawn(info.program, info.args, {
          cwd: info.cwd,
          cols: term.cols || 80,
          rows: term.rows || 24,
        });

        disposables.push(pty.onData((data) => term?.write(data)));
        const td = term.onData((data) => pty?.write(data));
        if (td) disposables.push(td);
        disposables.push(
          pty.onExit(({ exitCode }) => {
            term?.writeln(`\r\n\x1b[33mProcess exited (${exitCode})\x1b[0m`);
          }),
        );

        ro = new ResizeObserver(() => {
          if (!term || !pty) return;
          fit.fit();
          pty.resize(term.cols, term.rows);
        });
        ro.observe(el);

        term.writeln(
          `\x1b[36mRodney\x1b[0m — spawning \x1b[35m${info.program} ${info.args.join(" ")}\x1b[0m in ${info.cwd}`,
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
      }
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      disposables.forEach((d) => d.dispose());
      try {
        pty?.kill();
      } catch {
        /* ignore */
      }
      term?.dispose();
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Re-fit when this pane becomes the active visible one
  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
      });
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className="terminal-host"
      style={{ display: isActive ? undefined : "none" }}
    />
  );
}

function skillTag(path: string): string[] {
  const base = path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  return base ? [base] : [];
}

interface NewSessionModalProps {
  onClose: () => void;
  onLaunch: (label: string, skillPath: string) => void;
}

function NewSessionModal({ onClose, onLaunch }: NewSessionModalProps) {
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listSkills()
      .then((s) => { setSkills(s); setLoading(false); })
      .catch((e) => { setErr(String(e)); setLoading(false); });
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal new-session-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: "0.75rem" }}>
          <strong>New Agent Session</strong>
          <button type="button" className="tiny-btn" onClick={onClose}>✕</button>
        </div>
        <button
          type="button"
          className="primary"
          style={{ width: "100%", marginBottom: "1rem" }}
          onClick={() => onLaunch("Agent", "")}
        >
          Start bare agent (no skill)
        </button>
        {loading && <p className="muted tiny">Loading skills…</p>}
        {err && <p className="error tiny">{err}</p>}
        {!loading && !err && grouped.length === 0 && (
          <p className="muted tiny">No skills found in vault.</p>
        )}
        {grouped.map(([cat, items]) => (
          <section key={cat} className="new-session-skill-group">
            <p className="muted tiny new-session-cat">{cat}</p>
            <div className="new-session-skill-list">
              {items.map((s) => (
                <button
                  key={s.relativePath}
                  type="button"
                  className="new-session-skill-btn"
                  onClick={() => onLaunch(s.title, s.relativePath)}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

interface TerminalPanelProps {
  hidden?: boolean;
}

export function TerminalPanel({ hidden }: TerminalPanelProps) {
  const termSessions = useUiStore((s) => s.termSessions);
  const activeTermId = useUiStore((s) => s.activeTermId);
  const addTermSession = useUiStore((s) => s.addTermSession);
  const removeTermSession = useUiStore((s) => s.removeTermSession);
  const setActiveTermId = useUiStore((s) => s.setActiveTermId);
  const [showPicker, setShowPicker] = useState(false);

  async function handleLaunch(label: string, skillPath: string) {
    setShowPicker(false);
    try {
      await prefetchSessionContext({
        skillRelativePath: skillPath,
        recallTags: skillTag(skillPath),
        limit: 15,
      });
    } catch {
      /* non-fatal — session still opens */
    }
    addTermSession(label);
  }

  return (
    <div className="panel terminal-wrap" style={{ display: hidden ? "none" : undefined }}>
      {showPicker && (
        <NewSessionModal
          onClose={() => setShowPicker(false)}
          onLaunch={(label, path) => void handleLaunch(label, path)}
        />
      )}
      <div className="terminal-tab-bar">
        {termSessions.map((s) => (
          <div key={s.id} className={`term-tab${s.id === activeTermId ? " active" : ""}`}>
            <button
              type="button"
              className="term-tab-label"
              onClick={() => setActiveTermId(s.id)}
            >
              {s.label}
            </button>
            <button
              type="button"
              className="term-tab-close"
              title="Close session"
              onClick={() => removeTermSession(s.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="term-tab-add"
          title="New agent session"
          onClick={() => setShowPicker(true)}
        >
          +
        </button>
        <p className="muted tiny term-hint">
          {termSessions.length > 0 ? "" : "No sessions — click + to start one."}
        </p>
      </div>
      {termSessions.map((s) => (
        <TermSessionPane
          key={s.id}
          session={s}
          isActive={s.id === activeTermId && !hidden}
        />
      ))}
    </div>
  );
}
