import { useEffect, useState, useCallback } from "react";
import {
  listScriptDirs,
  readScriptFileContent,
  type ScriptDirInfo,
  type ScriptRunRow,
} from "../api";

type LogRun = {
  launchLine: string;
  startTime: string;
  endTime: string;
  resultLine: string;
  success: boolean;
  timestamp: string;
};

function parseLogRuns(lines: string[]): LogRun[] {
  const runs: LogRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const launchMatch = line.match(/^(\[.+?\]).*Launching .+?:\s*(\S+)\s*→\s*(\S+)/);
    if (!launchMatch) continue;
    const timestamp = launchMatch[1] ?? "";
    const startTime = launchMatch[2] ?? "";
    const endTime = launchMatch[3] ?? "";
    const next = lines[i + 1] ?? "";
    const isSuccess = next.includes("Hours logged") || next.includes("logged successfully");
    runs.push({
      launchLine: line,
      startTime,
      endTime,
      resultLine: next,
      success: isSuccess,
      timestamp,
    });
  }
  return runs.reverse();
}

function calcHours(arrival: string, departure: string, lunchStart = "12:00", lunchEnd = "12:30"): string {
  const toMins = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const arrMins = toMins(arrival);
  const depMins = toMins(departure);
  let total = depMins - arrMins;
  if (total <= 0) return "—";
  const lunchS = toMins(lunchStart);
  const lunchE = toMins(lunchEnd);
  if (arrMins < lunchE && depMins > lunchS) {
    const overlap = Math.min(depMins, lunchE) - Math.max(arrMins, lunchS);
    if (overlap > 0) total -= overlap;
  }
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function StatusDot({ ok, title }: { ok: boolean | null; title?: string }) {
  const color = ok === null ? "var(--muted)" : ok ? "#3fb950" : "var(--danger)";
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

type DetailTab = "overview" | "log" | "history" | "files" | "db";

export function ScriptsDashboard() {
  const [scripts, setScripts] = useState<ScriptDirInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listScriptDirs()
      .then((data) => {
        setScripts(data);
        setError(null);
        if (data.length > 0 && selected === null) {
          setSelected(data[0]?.name ?? null);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selected]);

  useEffect(() => {
    load();
  }, [load]);

  const active = scripts.find((s) => s.name === selected) ?? null;

  function openFile(dirName: string, fileName: string) {
    if (selectedFile === fileName) {
      setSelectedFile(null);
      setFileContent(null);
      return;
    }
    setSelectedFile(fileName);
    setFileLoading(true);
    readScriptFileContent(dirName, fileName)
      .then((c) => setFileContent(c))
      .catch((e) => setFileContent(`Error: ${String(e)}`))
      .finally(() => setFileLoading(false));
  }

  if (loading) return <div className="muted" style={{ padding: "1rem" }}>Loading scripts…</div>;
  if (error) return <div className="error" style={{ padding: "1rem" }}>{error}</div>;
  if (scripts.length === 0) {
    return (
      <div className="panel" style={{ marginTop: "1rem" }}>
        <p className="muted">No script directories found in <code>scripts/</code>.</p>
        <p className="muted tiny">Create a subdirectory under your vault's <code>scripts/</code> folder to get started.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
      {/* Sidebar */}
      <div style={{ width: 200, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <span className="muted tiny" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>Scripts</span>
          <button className="tiny-btn" onClick={load} title="Refresh">↺</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {scripts.map((s) => {
            const processed = s.state?.processed === true;
            const isToday = s.state?.date === new Date().toISOString().slice(0, 10);
            const status: boolean | null = isToday ? processed : null;
            return (
              <button
                key={s.name}
                onClick={() => { setSelected(s.name); setDetailTab("overview"); setSelectedFile(null); setFileContent(null); }}
                style={{
                  textAlign: "left",
                  background: selected === s.name ? "#162032" : "#0e141f",
                  border: `1px solid ${selected === s.name ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: 8,
                  padding: "0.5rem 0.65rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <StatusDot ok={status} title={processed ? "Processed today" : isToday ? "Pending today" : "No data today"} />
                <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{s.name}</span>
                {s.isWatcherRunning && (
                  <span style={{ marginLeft: "auto", fontSize: "0.65rem", color: "#3fb950" }}>live</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail pane */}
      {active && (
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div className="row-between" style={{ marginBottom: "0.65rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{active.name}</h3>
              {active.isWatcherRunning && (
                <span style={{ fontSize: "0.72rem", color: "#3fb950", border: "1px solid #3fb950", borderRadius: 4, padding: "0.1rem 0.4rem" }}>
                  watcher running
                </span>
              )}
              {active.config?.status ? (
                <span className="muted tiny">{String(active.config.status)}</span>
              ) : null}
            </div>
          </div>

          {/* Tab bar */}
          <div className="toolbar" style={{ marginBottom: "0.65rem" }}>
            {(["overview", "log", "history", "files", "db"] as DetailTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setDetailTab(t)}
                style={{
                  background: detailTab === t ? "var(--accent)" : "#0e141f",
                  color: detailTab === t ? "#041019" : "var(--text)",
                  border: `1px solid ${detailTab === t ? "transparent" : "var(--border)"}`,
                  fontWeight: detailTab === t ? 600 : 400,
                  fontSize: "0.82rem",
                  padding: "0.3rem 0.65rem",
                }}
              >
                {t === "db" ? "DB Runs" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {detailTab === "overview" && <OverviewTab script={active} />}

          {/* Log tab */}
          {detailTab === "log" && (
            <div
              style={{
                background: "#0b0f14",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0.65rem 0.75rem",
                maxHeight: 480,
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: "0.78rem",
                lineHeight: 1.6,
              }}
            >
              {active.logLines.length === 0 ? (
                <span className="muted">No log file found.</span>
              ) : (
                active.logLines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      color: line.includes("failed") || line.includes("ERROR")
                        ? "var(--danger)"
                        : line.includes("Hours logged") || line.includes("logged successfully")
                        ? "#3fb950"
                        : line.includes("Launching")
                        ? "var(--accent)"
                        : "var(--text)",
                    }}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>
          )}

          {/* History tab */}
          {detailTab === "history" && <HistoryTab logLines={active.logLines} />}

          {/* Files tab */}
          {detailTab === "files" && (
            <FilesTab
              script={active}
              selectedFile={selectedFile}
              fileContent={fileContent}
              fileLoading={fileLoading}
              onOpenFile={openFile}
            />
          )}

          {/* DB runs tab */}
          {detailTab === "db" && <DbRunsTab runs={active.dbRuns} />}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ script }: { script: ScriptDirInfo }) {
  const state = script.state;
  const today = new Date().toISOString().slice(0, 10);
  const isToday = state?.date === today;

  const arrival = state?.arrivalTime ? String(state.arrivalTime) : null;
  const departure = state?.departureTime ? String(state.departureTime) : null;

  const lunchStart = script.config?.lunchStart ? String(script.config.lunchStart) : "12:00";
  const lunchEnd = script.config?.lunchEnd ? String(script.config.lunchEnd) : "12:30";
  const hours = arrival && departure ? calcHours(arrival, departure, lunchStart, lunchEnd) : null;

  const lastLogLine = script.logLines[script.logLines.length - 1] ?? null;
  const isIdle = lastLogLine?.includes("idle until tomorrow") || lastLogLine?.includes("Already submitted");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* Today's status card */}
      <div className="panel" style={{ padding: "0.85rem 1rem" }}>
        <div className="stat-label" style={{ marginBottom: "0.5rem" }}>
          Today — {isToday ? today : (state?.date ? `Last seen: ${state.date}` : "No data")}
        </div>
        {state ? (
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <div>
              <div className="stat-label">Arrival</div>
              <div className="stat-value small">{arrival ?? "—"}</div>
            </div>
            <div>
              <div className="stat-label">Departure</div>
              <div className="stat-value small">{departure ?? "—"}</div>
            </div>
            {hours && (
              <div>
                <div className="stat-label">Hours</div>
                <div className="stat-value small" style={{ color: "#3fb950" }}>{hours}</div>
              </div>
            )}
            <div>
              <div className="stat-label">Status</div>
              <div
                className="stat-value small"
                style={{ color: state.processed ? "#3fb950" : "var(--accent)" }}
              >
                {state.processed ? "Submitted" : "Pending"}
              </div>
            </div>
          </div>
        ) : (
          <span className="muted tiny">No state file found.</span>
        )}
      </div>

      {/* Watcher status */}
      <div className="panel" style={{ padding: "0.85rem 1rem" }}>
        <div className="stat-label" style={{ marginBottom: "0.4rem" }}>Watcher</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <StatusDot
            ok={script.isWatcherRunning ? true : isIdle ? null : null}
            title="Process status"
          />
          <span style={{ fontSize: "0.88rem" }}>
            {script.isWatcherRunning ? "Running" : isIdle ? "Idle (submitted today)" : "Stopped / unknown"}
          </span>
        </div>
        {lastLogLine && (
          <div className="muted tiny" style={{ marginTop: "0.4rem", fontFamily: "monospace" }}>
            Last: {lastLogLine}
          </div>
        )}
      </div>

      {/* Config summary */}
      {script.config && (
        <div className="panel" style={{ padding: "0.85rem 1rem" }}>
          <div className="stat-label" style={{ marginBottom: "0.4rem" }}>Config</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem" }}>
            {(["defaultStart", "defaultEnd", "lunchStart", "lunchEnd", "ntfyTopic"] as const).map((k) =>
              script.config![k] != null ? (
                <div key={k}>
                  <div className="stat-label" style={{ fontSize: "0.7rem" }}>{k}</div>
                  <div style={{ fontSize: "0.85rem" }}>{String(script.config![k])}</div>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ logLines }: { logLines: string[] }) {
  const runs = parseLogRuns(logLines);
  if (runs.length === 0) {
    return <div className="muted" style={{ padding: "0.5rem 0" }}>No run history found in log.</div>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Start → End</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => (
            <tr key={i}>
              <td className="muted tiny" style={{ whiteSpace: "nowrap" }}>{r.timestamp}</td>
              <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>
                {r.startTime} → {r.endTime}
              </td>
              <td>
                <span style={{ color: r.success ? "#3fb950" : "var(--danger)", fontSize: "0.82rem" }}>
                  {r.success ? "OK" : "failed"}
                </span>
                <span className="muted tiny" style={{ marginLeft: "0.5rem" }}>
                  {r.resultLine.replace(/^\[.+?\]\s*/, "").slice(0, 60)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilesTab({
  script,
  selectedFile,
  fileContent,
  fileLoading,
  onOpenFile,
}: {
  script: ScriptDirInfo;
  selectedFile: string | null;
  fileContent: string | null;
  fileLoading: boolean;
  onOpenFile: (dir: string, file: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start" }}>
      <div style={{ width: 160, flexShrink: 0 }}>
        {script.files.map((f) => (
          <button
            key={f}
            onClick={() => onOpenFile(script.name, f)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: selectedFile === f ? "#162032" : "transparent",
              border: `1px solid ${selectedFile === f ? "var(--accent)" : "transparent"}`,
              borderRadius: 6,
              padding: "0.3rem 0.5rem",
              fontSize: "0.82rem",
              marginBottom: "0.2rem",
              wordBreak: "break-all",
            }}
          >
            {f}
          </button>
        ))}
        {script.files.length === 0 && <span className="muted tiny">No files found.</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {fileLoading && <div className="muted tiny">Loading…</div>}
        {!fileLoading && fileContent !== null && (
          <pre
            style={{
              background: "#0b0f14",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "0.75rem",
              margin: 0,
              overflowX: "auto",
              overflowY: "auto",
              maxHeight: 480,
              fontSize: "0.78rem",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {fileContent}
          </pre>
        )}
        {!fileLoading && fileContent === null && (
          <div className="muted tiny">Select a file to view its content.</div>
        )}
      </div>
    </div>
  );
}

function DbRunsTab({ runs }: { runs: ScriptRunRow[] }) {
  if (runs.length === 0) {
    return (
      <div className="muted" style={{ padding: "0.5rem 0" }}>
        No DB runs yet. Scripts can call the <code>log_script_run</code> MCP tool to log results here.
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Ended</th>
            <th>Result</th>
            <th>Metadata</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            let meta: Record<string, unknown> | null = null;
            try {
              if (r.metadata) meta = JSON.parse(r.metadata);
            } catch {
              /* ignore */
            }
            return (
              <tr key={r.id}>
                <td className="muted tiny" style={{ whiteSpace: "nowrap" }}>
                  {r.startedAt.replace("T", " ").slice(0, 19)}
                </td>
                <td className="muted tiny" style={{ whiteSpace: "nowrap" }}>
                  {r.endedAt ? r.endedAt.replace("T", " ").slice(0, 19) : "—"}
                </td>
                <td>
                  {r.success === null || r.success === undefined ? (
                    <span className="muted">—</span>
                  ) : (
                    <span style={{ color: r.success ? "#3fb950" : "var(--danger)" }}>
                      {r.success ? "OK" : `failed${r.exitCode != null ? ` (${r.exitCode})` : ""}`}
                    </span>
                  )}
                </td>
                <td style={{ fontSize: "0.8rem" }}>
                  {meta ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {Object.entries(meta).map(([k, v]) => (
                        <span key={k}>
                          <span className="muted">{k}:</span>{" "}
                          <strong>{String(v)}</strong>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
