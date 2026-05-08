mod config;
mod sqlite;

use config::{db_path_for_vault, load_config_disk, save_config_disk, write_mcp_config, RodneyConfig};
use serde::{Deserialize, Serialize};
use sqlite::{
    dashboard_stats, delete_personality, deprecate_memory, list_all_memories, list_personality,
    open_ro_db, recall_memories, set_memory_pinned, touch_memory_ids, update_memory_content,
    upsert_personality, DashboardStats, MemoryRow, PersonalityRow,
};
use std::fs;
use std::path::{Path, PathBuf};

fn require_config() -> Result<RodneyConfig, String> {
    load_config_disk()?.ok_or_else(|| "Complete onboarding first.".to_string())
}

fn open_db_for_config(cfg: &RodneyConfig) -> Result<rusqlite::Connection, String> {
    let db = db_path_for_vault(&cfg.vault_path);
    open_ro_db(&db)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCard {
    pub category: String,
    pub relative_path: String,
    pub title: String,
}

fn parse_skill_title(contents: &str) -> String {
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
        let title = parse_skill_title(&raw);
        out.push(SkillCard {
            category,
            relative_path: rel,
            title,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigPayload {
    pub vault_path: String,
    pub rodney_root: String,
    pub claude_bin: Option<String>,
    pub agent_name: Option<String>,
    pub personality_notes: Option<String>,
}

#[tauri::command]
fn save_full_config(payload: SaveConfigPayload) -> Result<(), String> {
    let cfg = RodneyConfig {
        vault_path: payload.vault_path.trim().to_string(),
        rodney_root: payload.rodney_root.trim().to_string(),
        claude_bin: payload.claude_bin.filter(|s| !s.trim().is_empty()),
    };
    if cfg.vault_path.is_empty() || cfg.rodney_root.is_empty() {
        return Err("vault_path and rodney_root are required.".to_string());
    }
    fs::create_dir_all(&cfg.vault_path).map_err(|e| e.to_string())?;
    fs::create_dir_all(Path::new(&cfg.vault_path).join(".session")).map_err(|e| e.to_string())?;
    fs::create_dir_all(Path::new(&cfg.vault_path).join(".rodney")).map_err(|e| e.to_string())?;
    mirror_vault_template(&cfg.rodney_root, Path::new(&cfg.vault_path))?;
    save_config_disk(&cfg)?;
    write_mcp_config(&cfg)?;
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

fn mirror_vault_template(rodney_root: &str, vault: &Path) -> Result<(), String> {
    let tmpl = PathBuf::from(rodney_root).join("vault");
    if !tmpl.exists() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(&tmpl).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        let rel = p.strip_prefix(&tmpl).map_err(|e| e.to_string())?;
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
}

#[tauri::command]
fn memories_list(filters: MemoryFilters) -> Result<Vec<MemoryRow>, String> {
    let cfg = require_config()?;
    let conn = open_db_for_config(&cfg)?;
    let cat = filters.category.as_deref();
    list_all_memories(&conn, cat, filters.include_deprecated)
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
    let vault = PathBuf::from(&cfg.vault_path);
    let session_dir = vault.join(".session");
    fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;
    fs::write(session_dir.join("SESSION_CONTEXT.md"), &md).map_err(|e| e.to_string())?;
    let init_body = format!(
        "## Session Init\nSkill: {}\nProject: {}\nLaunched: {}\nPrefetch tags: {:?}\n",
        payload.skill_relative_path.trim(),
        payload
            .project_slug
            .unwrap_or_else(|| "(none)".to_string()),
        chrono::Utc::now().to_rfc3339(),
        tags.join(", ")
    );
    fs::write(session_dir.join("SESSION_INIT.md"), init_body).map_err(|e| e.to_string())?;
    Ok(md)
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
}

#[tauri::command]
fn get_claude_launch_info() -> Result<ClaudeLaunchInfo, String> {
    let cfg = require_config()?;
    let cwd = cfg.vault_path.clone();
    let program = cfg
        .claude_bin
        .clone()
        .unwrap_or_else(|| "claude".to_string());
    let args = vec!["--mcp-config".into(), "rodney-mcp.json".into()];
    Ok(ClaudeLaunchInfo {
        cwd,
        program,
        args,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_pty::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_full_config,
            get_dashboard_stats,
            list_skills,
            list_projects,
            memories_list,
            memory_update,
            memory_deprecate,
            memory_set_pinned,
            prefetch_session_context,
            personality_list,
            personality_upsert,
            personality_delete,
            get_claude_launch_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
