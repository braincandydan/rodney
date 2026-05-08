import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawn } from "tauri-pty";
import { getClaudeLaunchInfo } from "../api";
import { useUiStore } from "../store";

export function TerminalPanel() {
  const launchKey = useUiStore((s) => s.launchKey);
  const containerRef = useRef<HTMLDivElement>(null);

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
        term.loadAddon(fit);
        term.open(el);
        fit.fit();

        pty = spawn(info.program, info.args, {
          cwd: info.cwd,
          cols: term.cols,
          rows: term.rows,
        });

        disposables.push(
          pty.onData((data) => {
            term?.write(data);
          }),
        );
        const td = term.onData((data) => {
          pty?.write(data);
        });
        if (td) disposables.push(td);

        disposables.push(
          pty.onExit(({ exitCode }) => {
            term?.writeln(`\r\n\x1b[33mProcess exited with code ${exitCode}\x1b[0m`);
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
    };
  }, [launchKey]);

  return (
    <div className="panel terminal-wrap">
      <h2>Claude Code (embedded)</h2>
      <p className="muted tiny">
        Uses your Claude CLI + Pro subscription. Pick a skill or launch bare from the Skills tab.
      </p>
      <div ref={containerRef} className="terminal-host" />
    </div>
  );
}
