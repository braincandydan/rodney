use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRow {
    pub id: i64,
    pub content: String,
    pub category: String,
    pub importance: i64,
    pub pinned: bool,
    pub access_count: i64,
    pub created_at: String,
    pub last_accessed: Option<String>,
    pub tags: Option<String>,
    pub confidence: f64,
    pub session_id: Option<i64>,
    pub is_deprecated: bool,
    pub status: String,
}

fn map_memory_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryRow> {
    Ok(MemoryRow {
        id: row.get(0)?,
        content: row.get(1)?,
        category: row.get(2)?,
        importance: row.get(3)?,
        pinned: row.get::<_, i64>(4)? != 0,
        access_count: row.get(5)?,
        created_at: row.get(6)?,
        last_accessed: row.get(7)?,
        tags: row.get(8)?,
        confidence: row.get(9)?,
        session_id: row.get(10)?,
        is_deprecated: row.get::<_, i64>(11)? != 0,
        status: row.get::<_, Option<String>>(12)?.unwrap_or_else(|| "confirmed".to_string()),
    })
}

pub fn open_ro_db(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          project_id TEXT,
          mood_start TEXT,
          mood_end TEXT,
          summary TEXT
        );
        CREATE TABLE IF NOT EXISTS memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          category TEXT NOT NULL,
          importance INTEGER NOT NULL DEFAULT 3,
          pinned INTEGER NOT NULL DEFAULT 0,
          access_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          last_accessed TEXT,
          tags TEXT,
          confidence REAL NOT NULL DEFAULT 1.0,
          session_id INTEGER,
          is_deprecated INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
        CREATE INDEX IF NOT EXISTS idx_memories_deprecated ON memories(is_deprecated);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
        CREATE TABLE IF NOT EXISTS personality (
          trait TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          locked_by_user INTEGER NOT NULL DEFAULT 0,
          last_updated TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_profile (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          observation TEXT NOT NULL,
          context TEXT,
          confidence REAL NOT NULL DEFAULT 1.0,
          created_at TEXT NOT NULL,
          last_updated TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_access_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER NOT NULL,
          session_id INTEGER,
          accessed_at TEXT NOT NULL,
          was_useful INTEGER,
          FOREIGN KEY (memory_id) REFERENCES memories(id),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
        CREATE TABLE IF NOT EXISTS agent_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          energy TEXT,
          clarity TEXT,
          confidence TEXT,
          notes TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO agent_state (id, energy, clarity, confidence, notes, updated_at)
        VALUES (1, 'neutral', 'neutral', 'neutral', '', datetime('now'));
        CREATE TABLE IF NOT EXISTS script_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          script_name TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          success INTEGER,
          exit_code INTEGER,
          output TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_script_runs_name ON script_runs(script_name);
        CREATE INDEX IF NOT EXISTS idx_script_runs_started ON script_runs(started_at);
        ",
    )
    .map_err(|e| e.to_string())?;
    // Idempotent column migration — error ignored if column already exists
    let _ = conn.execute_batch("ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'");
    Ok(conn)
}

pub fn recall_memories(
    conn: &Connection,
    query: Option<&str>,
    limit: i64,
    category: Option<&str>,
    tag_list: &[String],
) -> Result<Vec<MemoryRow>, String> {
    const ALLOW_CAT: &[&str] = &[
        "core",
        "episodic",
        "semantic",
        "procedural",
        "relationship",
        "project",
    ];
    let mut sql = String::from(
        "SELECT id, content, category, importance, pinned, access_count, created_at, last_accessed, tags, confidence, session_id, is_deprecated, status
         FROM memories WHERE is_deprecated = 0 AND (status = 'confirmed' OR status IS NULL)",
    );
    let mut vals: Vec<rusqlite::types::Value> = vec![];
    if let Some(c) = category {
        if ALLOW_CAT.contains(&c) {
            sql.push_str(" AND category = ?");
            vals.push(rusqlite::types::Value::Text(c.to_string()));
        }
    }
    if let Some(q) = query {
        let pat = format!("%{}%", q.to_lowercase());
        sql.push_str(" AND (LOWER(content) LIKE ? OR LOWER(COALESCE(tags,'')) LIKE ?)");
        vals.push(rusqlite::types::Value::Text(pat.clone()));
        vals.push(rusqlite::types::Value::Text(pat));
    }
    for t in tag_list {
        sql.push_str(" AND LOWER(COALESCE(tags,'')) LIKE ?");
        vals.push(rusqlite::types::Value::Text(format!("%\"{}\"%" , t.to_lowercase())));
    }
    sql.push_str(
        " ORDER BY pinned DESC, importance DESC,
          CASE WHEN last_accessed IS NULL THEN 1 ELSE 0 END,
          datetime(last_accessed) DESC,
          datetime(created_at) DESC
          LIMIT ?",
    );
    vals.push(rusqlite::types::Value::Integer(limit));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(vals))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        out.push(map_memory_row(&row).map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn touch_memory_ids(conn: &Connection, ids: &[i64]) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    for id in ids {
        conn.execute(
            "UPDATE memories SET access_count = access_count + 1, last_accessed = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_all_memories(
    conn: &Connection,
    category: Option<&str>,
    include_deprecated: bool,
    search: Option<&str>,
) -> Result<Vec<MemoryRow>, String> {
    const ALLOW_CAT: &[&str] = &[
        "core",
        "episodic",
        "semantic",
        "procedural",
        "relationship",
        "project",
    ];
    let mut sql = String::from(
        "SELECT id, content, category, importance, pinned, access_count, created_at, last_accessed, tags, confidence, session_id, is_deprecated, status FROM memories",
    );
    let mut clauses = vec!["(status = 'confirmed' OR status IS NULL)".to_string()];
    let mut vals: Vec<rusqlite::types::Value> = vec![];
    if !include_deprecated {
        clauses.push("is_deprecated = 0".to_string());
    }
    if let Some(c) = category {
        if ALLOW_CAT.contains(&c) {
            clauses.push("category = ?".to_string());
            vals.push(rusqlite::types::Value::Text(c.to_string()));
        }
    }
    if let Some(q) = search {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            let pat = format!("%{}%", trimmed.to_lowercase());
            clauses.push("(LOWER(content) LIKE ? OR LOWER(COALESCE(tags,'')) LIKE ?)".to_string());
            vals.push(rusqlite::types::Value::Text(pat.clone()));
            vals.push(rusqlite::types::Value::Text(pat));
        }
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY pinned DESC, importance DESC, datetime(created_at) DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(vals), map_memory_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn deprecate_memory(conn: &Connection, id: i64) -> Result<bool, String> {
    let n = conn
        .execute("UPDATE memories SET is_deprecated = 1 WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn update_memory_content(conn: &Connection, id: i64, content: &str) -> Result<bool, String> {
    let n = conn
        .execute(
            "UPDATE memories SET content = ?1 WHERE id = ?2",
            params![content, id],
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn set_memory_pinned(conn: &Connection, id: i64, pinned: bool) -> Result<bool, String> {
    let n = conn
        .execute(
            "UPDATE memories SET pinned = ?1 WHERE id = ?2",
            params![if pinned { 1 } else { 0 }, id],
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn approve_memory(conn: &Connection, id: i64) -> Result<bool, String> {
    let n = conn
        .execute(
            "UPDATE memories SET status = 'confirmed' WHERE id = ?1 AND status = 'pending'",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn list_pending_memories(conn: &Connection) -> Result<Vec<MemoryRow>, String> {
    let sql = "SELECT id, content, category, importance, pinned, access_count, created_at, last_accessed, tags, confidence, session_id, is_deprecated, status \
               FROM memories WHERE status = 'pending' AND is_deprecated = 0 ORDER BY datetime(created_at) DESC";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_memory_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentState {
    pub energy: Option<String>,
    pub clarity: Option<String>,
    pub confidence: Option<String>,
    pub notes: Option<String>,
    pub updated_at: String,
}

pub fn get_agent_state(conn: &Connection) -> Result<AgentState, String> {
    conn.query_row(
        "SELECT energy, clarity, confidence, notes, updated_at FROM agent_state WHERE id = 1",
        [],
        |row| {
            Ok(AgentState {
                energy: row.get(0)?,
                clarity: row.get(1)?,
                confidence: row.get(2)?,
                notes: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub memory_count: i64,
    pub session_count: i64,
    pub active_sessions: i64,
    pub agent: AgentState,
}

pub fn dashboard_stats(conn: &Connection) -> Result<DashboardStats, String> {
    let memory_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memories WHERE is_deprecated = 0",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let session_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let active_sessions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE ended_at IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let agent = get_agent_state(conn)?;
    Ok(DashboardStats {
        memory_count,
        session_count,
        active_sessions,
        agent,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityRow {
    pub trait_name: String,
    pub value: String,
    pub locked_by_user: bool,
    pub last_updated: String,
}

pub fn list_personality(conn: &Connection) -> Result<Vec<PersonalityRow>, String> {
    let mut stmt = conn
        .prepare("SELECT trait, value, locked_by_user, last_updated FROM personality ORDER BY trait")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PersonalityRow {
                trait_name: row.get(0)?,
                value: row.get(1)?,
                locked_by_user: row.get::<_, i64>(2)? != 0,
                last_updated: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn upsert_personality(
    conn: &Connection,
    trait_name: &str,
    value: &str,
    locked: Option<bool>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let existing_locked: Option<i64> = conn
        .query_row(
            "SELECT locked_by_user FROM personality WHERE trait = ?1",
            params![trait_name],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let locked_val = match locked {
        Some(l) => if l { 1 } else { 0 },
        None => existing_locked.unwrap_or(0),
    };
    conn.execute(
        "INSERT INTO personality (trait, value, locked_by_user, last_updated)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(trait) DO UPDATE SET
           value = excluded.value,
           locked_by_user = excluded.locked_by_user,
           last_updated = excluded.last_updated",
        params![trait_name, value, locked_val, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_personality(conn: &Connection, trait_name: &str) -> Result<bool, String> {
    let n = conn
        .execute("DELETE FROM personality WHERE trait = ?1", params![trait_name])
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn list_user_profile_brief(conn: &Connection) -> Result<Vec<(String, Option<String>)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT observation, context FROM user_profile \
             ORDER BY datetime(last_updated) DESC LIMIT 12",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRunRow {
    pub id: i64,
    pub script_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub success: Option<bool>,
    pub exit_code: Option<i64>,
    pub output: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
}

pub fn log_script_run(
    conn: &Connection,
    script_name: &str,
    started_at: &str,
    ended_at: Option<&str>,
    success: Option<bool>,
    exit_code: Option<i64>,
    output: Option<&str>,
    metadata: Option<&str>,
) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO script_runs (script_name, started_at, ended_at, success, exit_code, output, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            script_name,
            started_at,
            ended_at,
            success.map(|b| if b { 1i64 } else { 0i64 }),
            exit_code,
            output,
            metadata,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryNode {
    pub id: i64,
    pub category: String,
    pub importance: i64,
    pub access_count: i64,
    pub tags: Option<String>,
    pub pinned: bool,
    pub confidence: f64,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryGraphData {
    pub nodes: Vec<MemoryNode>,
    pub recent_ids: Vec<i64>,
}

pub fn get_memory_graph_data(conn: &Connection) -> Result<MemoryGraphData, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, category, importance, access_count, tags, pinned, confidence,
                    SUBSTR(content, 1, 50) as snippet
             FROM memories
             WHERE is_deprecated = 0 AND (status = 'confirmed' OR status IS NULL)
             ORDER BY pinned DESC, importance DESC, access_count DESC
             LIMIT 150",
        )
        .map_err(|e| e.to_string())?;

    let nodes = stmt
        .query_map([], |row| {
            Ok(MemoryNode {
                id: row.get(0)?,
                category: row.get(1)?,
                importance: row.get(2)?,
                access_count: row.get(3)?,
                tags: row.get(4)?,
                pinned: row.get::<_, i64>(5)? != 0,
                confidence: row.get(6)?,
                snippet: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut recent_stmt = conn
        .prepare(
            "SELECT DISTINCT memory_id FROM memory_access_log
             WHERE accessed_at > datetime('now', '-30 seconds')",
        )
        .map_err(|e| e.to_string())?;

    let recent_ids = recent_stmt
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(MemoryGraphData { nodes, recent_ids })
}

pub fn list_script_runs(
    conn: &Connection,
    script_name: Option<&str>,
    limit: i64,
) -> Result<Vec<ScriptRunRow>, String> {
    let sql;
    let vals: Vec<rusqlite::types::Value>;
    if let Some(name) = script_name {
        sql = "SELECT id, script_name, started_at, ended_at, success, exit_code, output, metadata, created_at \
               FROM script_runs WHERE script_name = ?1 ORDER BY datetime(started_at) DESC LIMIT ?2";
        vals = vec![
            rusqlite::types::Value::Text(name.to_string()),
            rusqlite::types::Value::Integer(limit),
        ];
    } else {
        sql = "SELECT id, script_name, started_at, ended_at, success, exit_code, output, metadata, created_at \
               FROM script_runs ORDER BY datetime(started_at) DESC LIMIT ?1";
        vals = vec![rusqlite::types::Value::Integer(limit)];
    }
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(vals), |row| {
            Ok(ScriptRunRow {
                id: row.get(0)?,
                script_name: row.get(1)?,
                started_at: row.get(2)?,
                ended_at: row.get(3)?,
                success: row.get::<_, Option<i64>>(4)?.map(|v| v != 0),
                exit_code: row.get(5)?,
                output: row.get(6)?,
                metadata: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
