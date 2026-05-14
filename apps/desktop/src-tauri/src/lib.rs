mod config;
mod sqlite;

use config::{db_path_for_vault, load_config_disk, save_config_disk, write_hermes_mcp_config, write_mcp_config, RodneyConfig};
use serde::{Deserialize, Serialize};
use sqlite::{
    approve_memory, dashboard_stats, delete_personality, deprecate_memory, get_agent_state,
    get_memory_graph_data, list_all_memories, list_pending_memories, list_personality,
    list_script_runs, list_user_profile_brief, log_script_run, open_ro_db, recall_memories,
    set_memory_pinned, touch_memory_ids, update_memory_content, upsert_personality, DashboardStats,
    MemoryGraphData, MemoryRow, PersonalityRow, ScriptRunRow,
};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn require_config() -> Result<RodneyConfig, String> {
    load_config_disk()?.ok_or_else(|| "Complete onboarding first.".to_string())
}

fn open_db_for_config(cfg: &RodneyConfig) -> Result<rusqlite::Connection, String> {
    let db = db_path_for_vault(&cfg.vault_path);
    open_ro_db(&db)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillInput {
    pub key: String,
    pub label: String,
    #[serde(default = "default_input_type")]
    pub r#type: String,
    #[serde(default)]
    pub required: bool,
    pub placeholder: Option<String>,
    pub options: Option<Vec<String>>,
    pub default: Option<String>,
}

fn default_input_type() -> String {
    "text".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCard {
    pub category: String,
    pub relative_path: String,
    pub title: String,
    pub inputs: Vec<SkillInput>,
}

/// Parsed result from a skill file's YAML frontmatter block.
struct SkillFrontmatter {
    title: String,
    inputs: Vec<SkillInput>,
}

fn parse_skill_frontmatter(contents: &str) -> SkillFrontmatter {
    // Try to extract a YAML frontmatter block delimited by ---
    if let Some(rest) = contents.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let yaml_block = &rest[..end];
            if let Ok(val) = serde_yaml::from_str::<serde_yaml::Value>(yaml_block) {
                let title = val
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let inputs: Vec<SkillInput> = val
                    .get("inputs")
                    .and_then(|v| serde_yaml::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let title = if title.is_empty() {
                    // Fall back to first # heading after the frontmatter
                    parse_heading_title(&rest[end + 4..])
                } else {
                    title
                };
                return SkillFrontmatter { title, inputs };
            }
        }
    }
    // No valid frontmatter — scan for title: or # heading
    SkillFrontmatter {
        title: parse_heading_title(contents),
        inputs: vec![],
    }
}

fn parse_heading_title(contents: &str) -> String {
    for line in contents.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("# ") {
            return rest.trim().to_string();
        }
        if let Some(rest) = t.strip_prefix("title:") {
            return rest.trim().to_string();
        }
    }
    "Untitled skill".to_string()
}

#[tauri::command]
fn list_skills() -> Result<Vec<SkillCard>, String> {
    let cfg = require_config()?;
    let skills_root = PathBuf::from(&cfg.vault_path).join("skills");
    if !skills_root.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in walkdir::WalkDir::new(&skills_root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if p.extension().and_then(|x| x.to_str()) != Some("md") {
            continue;
        }
        let rel = p
            .strip_prefix(&cfg.vault_path)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let category = p
            .parent()
            .and_then(|parent| parent.strip_prefix(&skills_root).ok())
            .and_then(|sub| sub.to_str())
            .unwrap_or("general")
            .to_string();
        let raw = fs::read_to_string(p).unwrap_or_default();
        let fm = parse_skill_frontmatter(&raw);
        out.push(SkillCard {
            category,
            relative_path: rel,
            title: fm.title,
            inputs: fm.inputs,
        });
    }
    out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCard {
    pub slug: String,
    pub has_overview: bool,
    pub pending_feedback_hint: bool,
}

fn safe_project_path(vault: &str, slug: &str) -> Result<PathBuf, String> {
    if slug.is_empty()
        || slug.contains("..")
        || slug.contains('/')
        || slug.contains('\\')
        || slug.contains('\0')
    {
        return Err(format!("Invalid project slug: {slug}"));
    }
    Ok(PathBuf::from(vault).join("projects").join(slug))
}

fn scan_projects(vault: &Path) -> Result<Vec<ProjectCard>, String> {
    let root = vault.join("projects");
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "_template" {
            continue;
        }
        let overview = p.join("overview.md");
        let docs = p.join("docs");
        let mut pending_hint = false;
        if docs.exists() {
            if let Ok(rd) = fs::read_dir(&docs) {
                for f in rd.flatten() {
                    let fp = f.path();
                    if fp.extension().and_then(|x| x.to_str()) == Some("md") {
                        if let Ok(txt) = fs::read_to_string(&fp) {
                            if txt.contains("status: in-review") || txt.contains("status:in-review") {
                                pending_hint = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
        out.push(ProjectCard {
            slug: name,
            has_overview: overview.exists(),
            pending_feedback_hint: pending_hint,
        });
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}

#[tauri::command]
fn list_projects() -> Result<Vec<ProjectCard>, String> {
    let cfg = require_config()?;
    scan_projects(Path::new(&cfg.vault_path))
}

#[tauri::command]
fn read_project_overview(slug: String) -> Result<Option<String>, String> {
    let cfg = require_config()?;
    let path = safe_project_path(&cfg.vault_path, &slug)?.join("overview.md");
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_project_folder(slug: String) -> Result<(), String> {
    let cfg = require_config()?;
    let path = safe_project_path(&cfg.vault_path, &slug)?;
    if !path.exists() {
        return Err(format!("Project not found: {}", slug));
    }
    std::process::Command::new("explorer")
        .arg(path.to_string_lossy().as_ref())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigPayload {
    pub vault_path: String,
    pub claude_bin: Option<String>,
    pub hermes_bin: Option<String>,
    pub agent_runtime: Option<String>,
    pub agent_name: Option<String>,
    pub personality_notes: Option<String>,
}

#[tauri::command]
fn save_full_config(app: tauri::AppHandle, payload: SaveConfigPayload) -> Result<(), String> {
    let agent_runtime = match payload.agent_runtime.as_deref() {
        Some("hermes") => crate::config::AgentRuntime::Hermes,
        _ => crate::config::AgentRuntime::Claude,
    };
    let cfg = RodneyConfig {
        vault_path: payload.vault_path.trim().to_string(),
        claude_bin: payload.claude_bin.filter(|s| !s.trim().is_empty()),
        hermes_bin: payload.hermes_bin.filter(|s| !s.trim().is_empty()),
        agent_runtime,
        rodney_root: None,
    };
    if cfg.vault_path.is_empty() {
        return Err("vault_path is required.".to_string());
    }
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let vault_template_dir = resource_dir.join("resources/vault-template");
    let server_js = resource_dir.join("resources/memory-mcp/server.js");

    fs::create_dir_all(&cfg.vault_path).map_err(|e| e.to_string())?;
    fs::create_dir_all(Path::new(&cfg.vault_path).join(".session")).map_err(|e| e.to_string())?;
    fs::create_dir_all(Path::new(&cfg.vault_path).join(".rodney")).map_err(|e| e.to_string())?;
    mirror_vault_template(&vault_template_dir, Path::new(&cfg.vault_path))?;
    save_config_disk(&cfg)?;
    write_mcp_config(&cfg, &server_js)?;
    if cfg.agent_runtime == crate::config::AgentRuntime::Hermes {
        write_hermes_mcp_config(&cfg, &server_js)?;
    }
    let agent_path = PathBuf::from(&cfg.vault_path).join("AGENT_CORE.md");
    if payload.agent_name.is_some() || !agent_path.exists() {
        let name = payload
            .agent_name
            .as_deref()
            .unwrap_or("Rodney")
            .trim()
            .to_string();
        let notes = payload
            .personality_notes
            .as_deref()
            .unwrap_or("(Refine in Rodney → Personality or edit AGENT_CORE.md.)")
            .trim()
            .to_string();
        let body = format!(
            "# Agent identity — Rodney vault\n\n**Name:** {name}\n\n## Personality (human-defined)\n\n{notes}\n\n## Locked traits\n\n- Disagreement policy: Allowed once, clearly stated, then align with the human.\n- Role: Team member with memory — use MCP tools to stay grounded.\n"
        );
        fs::write(agent_path, body).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn mirror_vault_template(tmpl: &Path, vault: &Path) -> Result<(), String> {
    if !tmpl.exists() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(tmpl).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        let rel = p.strip_prefix(tmpl).map_err(|e| e.to_string())?;
        let dest = vault.join(rel);
        if p.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        } else if !dest.exists() {
            if let Some(par) = dest.parent() {
                fs::create_dir_all(par).map_err(|e| e.to_string())?;
            }
            fs::copy(p, &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn load_config() -> Result<Option<RodneyConfig>, String> {
    load_config_disk()
}

#[tauri::command]
fn get_dashboard_stats() -> Result<DashboardStats, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    dashboard_stats(&conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFilters {
    pub category: Option<String>,
    #[serde(default)]
    pub include_deprecated: bool,
    pub search: Option<String>,
}

#[tauri::command]
fn memories_list(filters: MemoryFilters) -> Result<Vec<MemoryRow>, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    let cat = filters.category.as_deref();
    list_all_memories(&conn, cat, filters.include_deprecated, filters.search.as_deref())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpdatePayload {
    pub id: i64,
    pub content: String,
}

#[tauri::command]
fn memory_update(payload: MemoryUpdatePayload) -> Result<bool, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    update_memory_content(&conn, payload.id, &payload.content)
}

#[tauri::command]
fn memory_deprecate(id: i64) -> Result<bool, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    deprecate_memory(&conn, id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinPayload {
    pub id: i64,
    pub pinned: bool,
}

#[tauri::command]
fn memory_set_pinned(payload: PinPayload) -> Result<bool, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    set_memory_pinned(&conn, payload.id, payload.pinned)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefetchPayload {
    pub skill_relative_path: String,
    pub project_slug: Option<String>,
    pub recall_query: Option<String>,
    pub recall_tags: Option<Vec<String>>,
    #[serde(default = "default_prefetch_limit")]
    pub limit: i64,
    #[serde(default)]
    pub form_data: Option<HashMap<String, String>>,
}

fn default_prefetch_limit() -> i64 {
    15
}

#[tauri::command]
fn prefetch_session_context(payload: PrefetchPayload) -> Result<String, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    let tags = payload.recall_tags.unwrap_or_default();
    let rows = recall_memories(
        &conn,
        payload.recall_query.as_deref(),
        payload.limit,
        None,
        &tags,
    )?;
    touch_memory_ids(&conn, &rows.iter().map(|r| r.id).collect::<Vec<_>>())?;
    let mut md = String::from("# Session context (Rodney prefetch)\n\n");
    if rows.is_empty() {
        md.push_str("_No matching memories yet — the brain will grow over time._\n");
    } else {
        for r in &rows {
            md.push_str(&format!(
                "## Memory [{}] (importance {})\n{}\n\n",
                r.category, r.importance, r.content
            ));
        }
    }
    let traits = list_personality(&conn)?;
    if !traits.is_empty() {
        md.push_str("## Personality traits\n");
        for t in &traits {
            md.push_str(&format!("- **{}**: {}\n", t.trait_name, t.value));
        }
        md.push('\n');
    }
    let vault = PathBuf::from(&cfg.vault_path);
    let session_dir = vault.join(".session");
    fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;
    fs::write(session_dir.join("SESSION_CONTEXT.md"), &md).map_err(|e| e.to_string())?;
    let mut init_body = format!(
        "## Session Init\nSkill: {}\nProject: {}\nLaunched: {}\nPrefetch tags: {}\n",
        payload.skill_relative_path.trim(),
        payload
            .project_slug
            .unwrap_or_else(|| "(none)".to_string()),
        chrono::Utc::now().to_rfc3339(),
        tags.join(", ")
    );
    if let Some(form_data) = &payload.form_data {
        if !form_data.is_empty() {
            init_body.push_str("\n## Inputs\n");
            let mut entries: Vec<(&String, &String)> = form_data.iter().collect();
            entries.sort_by_key(|(k, _)| *k);
            for (key, value) in entries {
                init_body.push_str(&format!("- **{}**: {}\n", key, value));
            }
        }
    }
    fs::write(session_dir.join("SESSION_INIT.md"), init_body).map_err(|e| e.to_string())?;
    Ok(md)
}

#[tauri::command]
fn get_memory_graph() -> Result<MemoryGraphData, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    get_memory_graph_data(&conn)
}

#[tauri::command]
fn memory_approve(id: i64) -> Result<bool, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    approve_memory(&conn, id)
}

#[tauri::command]
fn pending_memories_list() -> Result<Vec<MemoryRow>, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    list_pending_memories(&conn)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityUpsertPayload {
    pub trait_name: String,
    pub value: String,
    pub locked: Option<bool>,
}

#[tauri::command]
fn personality_list() -> Result<Vec<PersonalityRow>, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    list_personality(&conn)
}

#[tauri::command]
fn personality_upsert(payload: PersonalityUpsertPayload) -> Result<(), String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    upsert_personality(&conn, &payload.trait_name, &payload.value, payload.locked)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraitNamePayload {
    pub trait_name: String,
}

#[tauri::command]
fn personality_delete(payload: TraitNamePayload) -> Result<bool, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    delete_personality(&conn, &payload.trait_name)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLaunchInfo {
    pub cwd: String,
    pub program: String,
    pub args: Vec<String>,
    pub runtime: String,
}

#[tauri::command]
fn get_claude_launch_info() -> Result<ClaudeLaunchInfo, String> {
    let cfg = require_config()?;
    let cwd = cfg.vault_path.clone();
    let (program, args, runtime) = match cfg.agent_runtime {
        crate::config::AgentRuntime::Hermes => {
            let bin = cfg.hermes_bin.clone().unwrap_or_else(|| "hermes".to_string());
            // Hermes MCP is registered in ~/.hermes/config.yaml, not via CLI flag
            let args = vec!["chat".into()];
            (bin, args, "hermes".to_string())
        }
        crate::config::AgentRuntime::Claude => {
            let bin = cfg.claude_bin.clone().unwrap_or_else(|| "claude".to_string());
            let args = vec!["--mcp-config".into(), "rodney-mcp.json".into()];
            (bin, args, "claude".to_string())
        }
    };
    Ok(ClaudeLaunchInfo {
        cwd,
        program,
        args,
        runtime,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDirInfo {
    pub name: String,
    pub dir_path: String,
    pub config: Option<serde_json::Value>,
    pub state: Option<serde_json::Value>,
    pub log_lines: Vec<String>,
    pub files: Vec<String>,
    pub is_watcher_running: bool,
    pub db_runs: Vec<ScriptRunRow>,
}

fn detect_watcher_running() -> bool {
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\") | Where-Object { $_.CommandLine -match 'watcher\\.js' } | Measure-Object | Select-Object -ExpandProperty Count",
        ])
        .output();
    match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout)
                .trim()
                .parse::<i32>()
                .unwrap_or(0)
                > 0
        }
        _ => false,
    }
}

fn safe_script_dir(vault: &str, dir_name: &str) -> Result<PathBuf, String> {
    if dir_name.is_empty()
        || dir_name.contains("..")
        || dir_name.contains('/')
        || dir_name.contains('\\')
        || dir_name.contains('\0')
    {
        return Err(format!("Invalid script dir: {dir_name}"));
    }
    Ok(PathBuf::from(vault).join("scripts").join(dir_name))
}

#[tauri::command]
fn list_script_dirs() -> Result<Vec<ScriptDirInfo>, String> {
    let cfg = require_config()?;
    let scripts_root = PathBuf::from(&cfg.vault_path).join("scripts");
    if !scripts_root.exists() {
        return Ok(vec![]);
    }
    let conn = open_db_for_config(&cfg)?;
    let is_watcher_running = detect_watcher_running();
    let skip_names = ["node_modules", "screenshots", "package-lock.json", ".git"];
    let text_exts = ["js", "ps1", "sh", "ts", "py", "json", "md", "txt", "log"];
    let mut out = vec![];
    for entry in fs::read_dir(&scripts_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let config_val = path
            .join("config.json")
            .exists()
            .then(|| fs::read_to_string(path.join("config.json")).ok())
            .flatten()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
        let state_val = path
            .join("watcher-state.json")
            .exists()
            .then(|| fs::read_to_string(path.join("watcher-state.json")).ok())
            .flatten()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
        let log_lines = if path.join("watcher.log").exists() {
            fs::read_to_string(path.join("watcher.log"))
                .ok()
                .map(|s| {
                    let lines: Vec<String> = s.lines().map(|l| l.to_string()).collect();
                    let start = if lines.len() > 200 { lines.len() - 200 } else { 0 };
                    lines[start..].to_vec()
                })
                .unwrap_or_default()
        } else {
            vec![]
        };
        let mut files: Vec<String> = if let Ok(rd) = fs::read_dir(&path) {
            rd.flatten()
                .filter_map(|f| {
                    let fname = f.file_name().to_string_lossy().to_string();
                    if skip_names.contains(&fname.as_str()) {
                        return None;
                    }
                    let fp = f.path();
                    if !fp.is_file() {
                        return None;
                    }
                    let ext = fp.extension().and_then(|x| x.to_str()).unwrap_or("");
                    text_exts.contains(&ext).then_some(fname)
                })
                .collect()
        } else {
            vec![]
        };
        files.sort();
        let db_runs = list_script_runs(&conn, Some(&name), 50).unwrap_or_default();
        out.push(ScriptDirInfo {
            name,
            dir_path: path.to_string_lossy().to_string(),
            config: config_val,
            state: state_val,
            log_lines,
            files,
            is_watcher_running,
            db_runs,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn read_script_file_content(dir_name: String, file_name: String) -> Result<String, String> {
    let cfg = require_config()?;
    if file_name.contains("..")
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains('\0')
    {
        return Err("Invalid file name".to_string());
    }
    let path = safe_script_dir(&cfg.vault_path, &dir_name)?.join(&file_name);
    if !path.exists() {
        return Err(format!("File not found: {file_name}"));
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogScriptRunPayload {
    pub script_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub success: Option<bool>,
    pub exit_code: Option<i64>,
    pub output: Option<String>,
    pub metadata: Option<String>,
}

#[tauri::command]
fn log_script_run_cmd(payload: LogScriptRunPayload) -> Result<i64, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    log_script_run(
        &conn,
        &payload.script_name,
        &payload.started_at,
        payload.ended_at.as_deref(),
        payload.success,
        payload.exit_code,
        payload.output.as_deref(),
        payload.metadata.as_deref(),
    )
}

#[tauri::command]
fn list_script_runs_cmd(script_name: Option<String>, limit: Option<i64>) -> Result<Vec<ScriptRunRow>, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    list_script_runs(&conn, script_name.as_deref(), limit.unwrap_or(50))
}

// ── Project tasks ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTask {
    pub slug: String,
    pub title: String,
    pub status: String,
    pub priority: Option<String>,
    pub assigned: Option<String>,
    pub created: Option<String>,
    pub completed_at: Option<String>,
    pub body: String,
}

struct TaskFm {
    title: String,
    status: String,
    priority: Option<String>,
    assigned: Option<String>,
    created: Option<String>,
    completed_at: Option<String>,
    body: String,
}

fn parse_task_fm(contents: &str) -> TaskFm {
    if let Some(rest) = contents.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let yaml = &rest[..end];
            let body = rest[end + 4..].trim_start_matches('\n').to_string();
            if let Ok(val) = serde_yaml::from_str::<serde_yaml::Value>(yaml) {
                let str_field = |k: &str| -> Option<String> {
                    val.get(k).and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s != "null")
                };
                return TaskFm {
                    title: str_field("title").unwrap_or_else(|| "Untitled".to_string()),
                    status: str_field("status").unwrap_or_else(|| "todo".to_string()),
                    priority: str_field("priority"),
                    assigned: str_field("assigned"),
                    created: str_field("created"),
                    completed_at: str_field("completed_at"),
                    body,
                };
            }
        }
    }
    TaskFm {
        title: parse_heading_title(contents),
        status: "todo".to_string(),
        priority: None,
        assigned: None,
        created: None,
        completed_at: None,
        body: contents.to_string(),
    }
}

fn task_sort_order(s: &str) -> u8 {
    match s {
        "in-progress" => 0,
        "todo" => 1,
        "blocked" => 2,
        "done" => 3,
        _ => 4,
    }
}

fn list_tasks_in_dir(tasks_dir: &Path) -> Result<Vec<ProjectTask>, String> {
    let mut out = vec![];
    for entry in fs::read_dir(tasks_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() { continue; }
        if path.extension().and_then(|x| x.to_str()) != Some("md") { continue; }
        let slug = path.file_stem().and_then(|x| x.to_str()).unwrap_or("").to_string();
        if slug.starts_with('_') { continue; }
        let raw = fs::read_to_string(&path).unwrap_or_default();
        let fm = parse_task_fm(&raw);
        out.push(ProjectTask { slug, title: fm.title, status: fm.status, priority: fm.priority, assigned: fm.assigned, created: fm.created, completed_at: fm.completed_at, body: fm.body });
    }
    out.sort_by(|a, b| task_sort_order(&a.status).cmp(&task_sort_order(&b.status)).then(a.slug.cmp(&b.slug)));
    Ok(out)
}

#[tauri::command]
fn list_project_tasks(slug: String) -> Result<Vec<ProjectTask>, String> {
    let cfg = require_config()?;
    let tasks_dir = safe_project_path(&cfg.vault_path, &slug)?.join("tasks");
    if !tasks_dir.exists() { return Ok(vec![]); }
    list_tasks_in_dir(&tasks_dir)
}

fn to_task_slug(s: &str) -> String {
    let raw: String = s
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    raw.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskPayload {
    pub project_slug: String,
    pub title: String,
    pub body: Option<String>,
    pub priority: Option<String>,
}

#[tauri::command]
fn create_project_task(payload: CreateTaskPayload) -> Result<String, String> {
    let cfg = require_config()?;
    let tasks_dir = safe_project_path(&cfg.vault_path, &payload.project_slug)?.join("tasks");
    fs::create_dir_all(&tasks_dir).map_err(|e| e.to_string())?;
    let base_slug = to_task_slug(&payload.title);
    let base_slug = if base_slug.is_empty() { "task".to_string() } else { base_slug };
    let mut file_path = tasks_dir.join(format!("{}.md", base_slug));
    let mut n = 1u32;
    while file_path.exists() {
        file_path = tasks_dir.join(format!("{}-{}.md", base_slug, n));
        n += 1;
    }
    let now = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let priority = payload.priority.as_deref().unwrap_or("medium");
    let body = payload.body.as_deref().unwrap_or("## Goal\n\n\n\n## Steps\n\n- [ ] \n\n## Notes\n\n");
    let content = format!(
        "---\ntitle: {}\nstatus: todo\npriority: {}\nassigned: null\ncreated: {}\n---\n\n{}",
        payload.title, priority, now, body
    );
    fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(file_path.file_stem().and_then(|x| x.to_str()).unwrap_or("").to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskStatusPayload {
    pub project_slug: String,
    pub task_slug: String,
    pub status: String,
}

#[tauri::command]
fn update_task_status(payload: UpdateTaskStatusPayload) -> Result<bool, String> {
    let cfg = require_config()?;
    let allowed = ["todo", "in-progress", "done", "blocked"];
    if !allowed.contains(&payload.status.as_str()) {
        return Err(format!("Invalid status: {}", payload.status));
    }
    if payload.task_slug.contains("..") || payload.task_slug.contains('/') || payload.task_slug.contains('\\') {
        return Err("Invalid task slug".to_string());
    }
    let file_path = safe_project_path(&cfg.vault_path, &payload.project_slug)?
        .join("tasks")
        .join(format!("{}.md", payload.task_slug));
    if !file_path.exists() { return Ok(false); }
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let going_done = payload.status == "done";
    let mut found_completed = false;
    let mut lines: Vec<String> = content
        .lines()
        .flat_map(|line| {
            if line.trim_start().starts_with("status:") {
                let result = vec![format!("status: {}", payload.status)];
                if going_done && !found_completed {
                    // will insert completed_at right after status line
                }
                result
            } else if line.trim_start().starts_with("completed_at:") {
                found_completed = true;
                if going_done {
                    vec![format!("completed_at: {}", today)]
                } else {
                    vec![] // remove completed_at when un-done
                }
            } else {
                vec![line.to_string()]
            }
        })
        .collect();
    // If going done and no existing completed_at line, insert it after status line
    if going_done && !found_completed {
        if let Some(pos) = lines.iter().position(|l| l.trim_start().starts_with("status:")) {
            lines.insert(pos + 1, format!("completed_at: {}", today));
        }
    }
    fs::write(&file_path, lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(true)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionPayload {
    pub project_slug: String,
    pub selected_task_slugs: Vec<String>,
    pub focus: Option<String>,
}

#[tauri::command]
fn prefetch_project_session(payload: ProjectSessionPayload) -> Result<String, String> {
    let cfg = require_config()?;
    let vault = PathBuf::from(&cfg.vault_path);
    let conn = open_db_for_config(&cfg)?;
    let project_dir = safe_project_path(&cfg.vault_path, &payload.project_slug)?;

    let mut ctx = format!("# Project session — {}\n\n", payload.project_slug);
    ctx.push_str("> **Project session.** Review all tasks. Focus on selected ones.\n");
    ctx.push_str("> To mark progress: edit the `status:` field in any task's frontmatter (todo → in-progress → done).\n\n---\n\n");

    // Identity
    let core_path = vault.join("AGENT_CORE.md");
    if core_path.exists() {
        ctx.push_str("## Your identity\n\n");
        ctx.push_str(&fs::read_to_string(&core_path).unwrap_or_default());
        ctx.push_str("\n\n");
    }

    // Personality
    let traits = list_personality(&conn)?;
    if !traits.is_empty() {
        ctx.push_str("## Personality\n\n");
        for t in &traits {
            ctx.push_str(&format!("- **{}**: {}\n", t.trait_name, t.value));
        }
        ctx.push('\n');
    }

    // User profile
    let profile = list_user_profile_brief(&conn)?;
    if !profile.is_empty() {
        ctx.push_str("## Who you're working with\n\n");
        for (obs, ctx_note) in &profile {
            if let Some(c) = ctx_note.as_deref().filter(|s| !s.is_empty()) {
                ctx.push_str(&format!("- {} _({})\n", obs, c));
            } else {
                ctx.push_str(&format!("- {}\n", obs));
            }
        }
        ctx.push('\n');
    }

    // Agent state
    let state = get_agent_state(&conn)?;
    ctx.push_str(&format!(
        "## Agent state\n\nEnergy: {} · Clarity: {} · Confidence: {}\n\n---\n\n",
        state.energy.as_deref().unwrap_or("neutral"),
        state.clarity.as_deref().unwrap_or("neutral"),
        state.confidence.as_deref().unwrap_or("neutral"),
    ));

    // Project overview
    ctx.push_str(&format!("## Project: {}\n\n", payload.project_slug));
    let overview = project_dir.join("overview.md");
    if overview.exists() {
        ctx.push_str("### Overview\n\n");
        ctx.push_str(&fs::read_to_string(&overview).unwrap_or_default());
        ctx.push_str("\n\n");
    }

    // Project docs
    let docs_dir = project_dir.join("docs");
    if docs_dir.exists() {
        let mut docs: Vec<(String, String)> = fs::read_dir(&docs_dir)
            .map_err(|e| e.to_string())?
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                if p.is_file() && p.extension().and_then(|x| x.to_str()) == Some("md") {
                    let name = p.file_name()?.to_string_lossy().to_string();
                    let content = fs::read_to_string(&p).ok()?;
                    Some((name, content))
                } else {
                    None
                }
            })
            .collect();
        docs.sort_by(|a, b| a.0.cmp(&b.0));
        if !docs.is_empty() {
            ctx.push_str("### Project docs\n\n");
            for (name, content) in &docs {
                let status_hint = content.lines()
                    .find(|l| l.trim_start().starts_with("status:"))
                    .and_then(|l| l.splitn(2, ':').nth(1))
                    .map(|s| format!(" _({})", s.trim()))
                    .unwrap_or_default();
                ctx.push_str(&format!("#### {}{}\n\n{}\n\n", name, status_hint, content));
            }
        }
    }

    ctx.push_str("---\n\n");

    // All tasks — summary table
    let tasks_dir = project_dir.join("tasks");
    let all_tasks = if tasks_dir.exists() {
        list_tasks_in_dir(&tasks_dir)?
    } else {
        vec![]
    };

    if !all_tasks.is_empty() {
        ctx.push_str("## All tasks\n\n");
        ctx.push_str("| Task | Status | Priority |\n|------|--------|----------|\n");
        for t in &all_tasks {
            ctx.push_str(&format!(
                "| {} | {} | {} |\n",
                t.title,
                t.status,
                t.priority.as_deref().unwrap_or("—")
            ));
        }
        ctx.push('\n');
    }

    ctx.push_str("---\n\n");

    // Selected tasks — full content
    if !payload.selected_task_slugs.is_empty() {
        ctx.push_str("## Your selected tasks\n\n");
        for ts in &payload.selected_task_slugs {
            if let Some(task) = all_tasks.iter().find(|t| &t.slug == ts) {
                ctx.push_str(&format!(
                    "### {} (status: {}, priority: {})\n\n{}\n\n",
                    task.title,
                    task.status,
                    task.priority.as_deref().unwrap_or("—"),
                    task.body
                ));
            }
        }
    } else {
        let active: Vec<&ProjectTask> = all_tasks.iter().filter(|t| t.status != "done").collect();
        if !active.is_empty() {
            ctx.push_str("## Active tasks\n\n");
            for task in active {
                ctx.push_str(&format!("### {} ({})\n\n{}\n\n", task.title, task.status, task.body));
            }
        }
    }

    ctx.push_str("---\n\n");

    // Relevant memories
    let tag_list = vec![payload.project_slug.clone()];
    let mut mems = recall_memories(&conn, None, 15, Some("project"), &tag_list).unwrap_or_default();
    if mems.is_empty() {
        mems = recall_memories(&conn, Some(&payload.project_slug), 10, None, &[]).unwrap_or_default();
    }
    if !mems.is_empty() {
        ctx.push_str("## Relevant memories\n\n");
        for m in &mems {
            ctx.push_str(&format!("- [{}] {}\n", m.category, m.content));
        }
        ctx.push('\n');
    }

    // Write session files
    let session_dir = vault.join(".session");
    fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;
    fs::write(session_dir.join("SESSION_CONTEXT.md"), &ctx).map_err(|e| e.to_string())?;

    let focus_str = payload.focus.as_deref().unwrap_or("(no specific focus)");
    let selected_str = if payload.selected_task_slugs.is_empty() {
        "(all active)".to_string()
    } else {
        payload.selected_task_slugs.join(", ")
    };
    let init = format!(
        "## Session Init\nType: project\nProject: {}\nSelected tasks: {}\nFocus: {}\nLaunched: {}\n",
        payload.project_slug, selected_str, focus_str, chrono::Utc::now().to_rfc3339()
    );
    fs::write(session_dir.join("SESSION_INIT.md"), init).map_err(|e| e.to_string())?;

    Ok(ctx)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let icon = app.default_window_icon().cloned().unwrap();
            let app_handle = app.handle().clone();
            tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("Rodney")
                .on_tray_icon_event(move |_tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            let app_handle2 = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    let tooltip = (|| -> Option<String> {
                        let cfg = load_config_disk().ok()??;
                        let db = db_path_for_vault(&cfg.vault_path);
                        let conn = open_ro_db(&db).ok()?;
                        let pending = list_pending_memories(&conn).ok()?;
                        Some(if pending.is_empty() {
                            "Rodney".to_string()
                        } else {
                            format!("Rodney · {} pending", pending.len())
                        })
                    })();
                    if let Some(tip) = tooltip {
                        if let Some(tray) = app_handle2.tray_by_id("main-tray") {
                            let _ = tray.set_tooltip(Some(&tip));
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_full_config,
            get_dashboard_stats,
            list_skills,
            list_projects,
            read_project_overview,
            open_project_folder,
            memories_list,
            memory_update,
            memory_deprecate,
            memory_set_pinned,
            memory_approve,
            pending_memories_list,
            prefetch_session_context,
            personality_list,
            personality_upsert,
            personality_delete,
            get_claude_launch_info,
            list_script_dirs,
            read_script_file_content,
            log_script_run_cmd,
            list_script_runs_cmd,
            get_memory_graph,
            list_project_tasks,
            create_project_task,
            update_task_status,
            prefetch_project_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
