use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AgentRuntime {
    #[default]
    Claude,
    Hermes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RodneyConfig {
    pub vault_path: String,
    #[serde(default)]
    pub claude_bin: Option<String>,
    #[serde(default)]
    pub hermes_bin: Option<String>,
    #[serde(default)]
    pub agent_runtime: AgentRuntime,
    // Legacy field — accepted on load from old configs but never written.
    #[serde(default, skip_serializing)]
    #[allow(dead_code)]
    pub rodney_root: Option<String>,
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

/// Writes Rodney MCP server entry into ~/.hermes/config.yaml, merging with existing content.
pub fn write_hermes_mcp_config(cfg: &RodneyConfig, server_js: &Path) -> Result<(), String> {
    if !server_js.exists() {
        return Err(format!(
            "Memory MCP server not found at {} — the app may need to be reinstalled.",
            server_js.display()
        ));
    }
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let hermes_dir = home.join(".hermes");
    std::fs::create_dir_all(&hermes_dir).map_err(|e| e.to_string())?;
    let config_path = hermes_dir.join("config.yaml");

    let mut root: serde_yaml::Value = if config_path.exists() {
        let raw = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_yaml::from_str(&raw)
            .unwrap_or(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()))
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    let db_path = db_path_for_vault(&cfg.vault_path);
    let mut env_map = serde_yaml::Mapping::new();
    env_map.insert("RODNEY_DB_PATH".into(), db_path.to_string_lossy().to_string().into());
    env_map.insert("RODNEY_VAULT_PATH".into(), cfg.vault_path.clone().into());
    let mut entry = serde_yaml::Mapping::new();
    entry.insert("command".into(), "node".into());
    entry.insert(
        "args".into(),
        serde_yaml::Value::Sequence(vec![server_js.to_string_lossy().to_string().into()]),
    );
    entry.insert("env".into(), serde_yaml::Value::Mapping(env_map));
    entry.insert("enabled".into(), true.into());

    if let serde_yaml::Value::Mapping(ref mut map) = root {
        let mcp_key = serde_yaml::Value::String("mcp_servers".to_string());
        let mcp = map
            .entry(mcp_key)
            .or_insert(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));
        if let serde_yaml::Value::Mapping(ref mut mcp_map) = mcp {
            mcp_map.insert("rodney-memory".into(), serde_yaml::Value::Mapping(entry));
        }
    }

    std::fs::write(
        &config_path,
        serde_yaml::to_string(&root).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn write_mcp_config(cfg: &RodneyConfig, server_js: &Path) -> Result<(), String> {
    if !server_js.exists() {
        return Err(format!(
            "Memory MCP server not found at {} — the app may need to be reinstalled.",
            server_js.display()
        ));
    }
    let vault = PathBuf::from(&cfg.vault_path);
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
