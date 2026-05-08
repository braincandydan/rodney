use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RodneyConfig {
    pub vault_path: String,
    pub rodney_root: String,
    #[serde(default)]
    pub claude_bin: Option<String>,
}

pub fn config_dir() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|p| p.join("Rodney"))
        .ok_or_else(|| "Could not resolve local data dir".to_string())
}

pub fn config_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

pub fn load_config_disk() -> Result<Option<RodneyConfig>, String> {
    let path = config_file_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let c: RodneyConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(c))
}

pub fn save_config_disk(cfg: &RodneyConfig) -> Result<(), String> {
    let dir = config_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = config_file_path()?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn db_path_for_vault(vault: &str) -> PathBuf {
    PathBuf::from(vault).join(".rodney").join("rodney.db")
}

pub fn mcp_server_js_path(cfg: &RodneyConfig) -> PathBuf {
    PathBuf::from(&cfg.rodney_root).join("packages/memory-mcp/dist/server.js")
}

pub fn write_mcp_config(cfg: &RodneyConfig) -> Result<(), String> {
    let vault = PathBuf::from(&cfg.vault_path);
    let server_js = mcp_server_js_path(cfg);
    if !server_js.exists() {
        return Err(format!(
            "Memory MCP server not built at {} — run `pnpm build:mcp` from Rodney repo root.",
            server_js.display()
        ));
    }
    let db_path = db_path_for_vault(&cfg.vault_path);
    let json = serde_json::json!({
        "mcpServers": {
            "rodney-memory": {
                "command": "node",
                "args": [server_js.to_string_lossy().to_string()],
                "env": {
                    "RODNEY_DB_PATH": db_path.to_string_lossy().to_string(),
                    "RODNEY_VAULT_PATH": cfg.vault_path
                }
            }
        }
    });
    let out = vault.join("rodney-mcp.json");
    std::fs::write(
        &out,
        serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
