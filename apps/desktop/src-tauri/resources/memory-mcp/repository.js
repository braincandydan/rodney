import fs from "node:fs";
import path from "node:path";
function isoNow() {
    return new Date().toISOString();
}
export function insertMemory(db, input) {
    const stmt = db.prepare(`INSERT INTO memories (content, category, importance, pinned, access_count, created_at, last_accessed, tags, confidence, session_id, is_deprecated, status)
     VALUES (@content, @category, @importance, 0, 0, @created_at, NULL, @tags, @confidence, @session_id, 0, @status)`);
    const info = stmt.run({
        content: input.content,
        category: input.category,
        importance: input.importance ?? 3,
        created_at: isoNow(),
        tags: input.tags?.length ? JSON.stringify(input.tags) : null,
        confidence: input.confidence ?? 1,
        session_id: input.sessionId ?? null,
        status: input.status ?? "pending",
    });
    return Number(info.lastInsertRowid);
}
export function approveMemory(db, id) {
    const r = db
        .prepare(`UPDATE memories SET status = 'confirmed' WHERE id = ? AND status = 'pending'`)
        .run(id);
    return r.changes > 0;
}
export function listPendingMemories(db) {
    return db
        .prepare(`SELECT * FROM memories WHERE status = 'pending' AND is_deprecated = 0 ORDER BY datetime(created_at) DESC`)
        .all();
}
export function recallMemories(db, input) {
    const limit = Math.min(Math.max(input.limit, 1), 50);
    const parts = ["is_deprecated = 0", "(status = 'confirmed' OR status IS NULL)"];
    const params = { limit };
    if (input.category) {
        parts.push("category = @category");
        params.category = input.category;
    }
    if (input.query?.trim()) {
        parts.push("(LOWER(content) LIKE @q OR LOWER(tags) LIKE @q)");
        const q = `%${input.query.trim().toLowerCase()}%`;
        params.q = q;
    }
    if (input.tags?.length) {
        for (let i = 0; i < input.tags.length; i++) {
            const key = `tag${i}`;
            parts.push(`LOWER(COALESCE(tags,'')) LIKE @${key}`);
            params[key] = `%"${input.tags[i].toLowerCase()}"%`;
        }
    }
    const where = parts.join(" AND ");
    const sql = `
    SELECT * FROM memories
    WHERE ${where}
    ORDER BY pinned DESC, importance DESC,
      CASE WHEN last_accessed IS NULL THEN 1 ELSE 0 END,
      datetime(last_accessed) DESC,
      datetime(created_at) DESC
    LIMIT @limit
  `;
    const stmt = db.prepare(sql);
    return stmt.all(params);
}
export function touchMemories(db, ids) {
    if (!ids.length)
        return;
    const now = isoNow();
    const stmt = db.prepare(`UPDATE memories SET access_count = access_count + 1, last_accessed = @now WHERE id = @id`);
    const tx = db.transaction(() => {
        for (const id of ids) {
            stmt.run({ id, now });
        }
    });
    tx();
}
export function deprecateMemory(db, id) {
    const r = db.prepare(`UPDATE memories SET is_deprecated = 1 WHERE id = ?`).run(id);
    return r.changes > 0;
}
export function reinforceMemory(db, id) {
    const r = db
        .prepare(`UPDATE memories SET importance = CASE WHEN importance < 5 THEN importance + 1 ELSE importance END WHERE id = ?`)
        .run(id);
    return r.changes > 0;
}
export function setPinned(db, id, pinned) {
    const r = db.prepare(`UPDATE memories SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, id);
    return r.changes > 0;
}
export function updateMemoryContent(db, id, content) {
    const r = db.prepare(`UPDATE memories SET content = ? WHERE id = ?`).run(content, id);
    return r.changes > 0;
}
export function listMemories(db, filters) {
    const parts = ["(status = 'confirmed' OR status IS NULL)"];
    const params = {};
    if (!filters.includeDeprecated) {
        parts.push("is_deprecated = 0");
    }
    if (filters.category) {
        parts.push("category = @category");
        params.category = filters.category;
    }
    const where = `WHERE ${parts.join(" AND ")}`;
    const stmt = db.prepare(`SELECT * FROM memories ${where} ORDER BY pinned DESC, importance DESC, datetime(created_at) DESC`);
    return stmt.all(params);
}
export function startSession(db, projectId) {
    const stmt = db.prepare(`INSERT INTO sessions (started_at, ended_at, project_id, mood_start, mood_end, summary)
     VALUES (@started_at, NULL, @project_id, NULL, NULL, NULL)`);
    const info = stmt.run({ started_at: isoNow(), project_id: projectId ?? null });
    return Number(info.lastInsertRowid);
}
export function endSession(db, sessionId, summary, moodEnd) {
    db.prepare(`UPDATE sessions SET ended_at = @ended_at, summary = @summary, mood_end = @mood_end WHERE id = @id`).run({
        id: sessionId,
        ended_at: isoNow(),
        summary,
        mood_end: moodEnd ?? null,
    });
}
export function logMemoryAccess(db, memoryId, sessionId, wasUseful) {
    db.prepare(`INSERT INTO memory_access_log (memory_id, session_id, accessed_at, was_useful)
     VALUES (@memory_id, @session_id, @accessed_at, @was_useful)`).run({
        memory_id: memoryId,
        session_id: sessionId,
        accessed_at: isoNow(),
        was_useful: wasUseful === undefined ? null : wasUseful ? 1 : 0,
    });
}
export function getAgentState(db) {
    const row = db
        .prepare(`SELECT energy, clarity, confidence, notes, updated_at FROM agent_state WHERE id = 1`)
        .get();
    return row;
}
export function updateAgentState(db, input) {
    const cur = getAgentState(db);
    db.prepare(`UPDATE agent_state SET
      energy = COALESCE(@energy, energy),
      clarity = COALESCE(@clarity, clarity),
      confidence = COALESCE(@confidence, confidence),
      notes = COALESCE(@notes, notes),
      updated_at = @updated_at
    WHERE id = 1`).run({
        energy: input.energy ?? cur.energy,
        clarity: input.clarity ?? cur.clarity,
        confidence: input.confidence ?? cur.confidence,
        notes: input.notes ?? cur.notes,
        updated_at: isoNow(),
    });
}
export function listPersonality(db) {
    return db.prepare(`SELECT trait, value, locked_by_user, last_updated FROM personality ORDER BY trait`).all();
}
export function upsertPersonality(db, trait, value, lockedByUser) {
    const existing = db
        .prepare(`SELECT locked_by_user FROM personality WHERE trait = ?`)
        .get(trait);
    let locked = 0;
    if (lockedByUser !== undefined)
        locked = lockedByUser ? 1 : 0;
    else if (existing)
        locked = existing.locked_by_user;
    const updated = isoNow();
    db.prepare(`INSERT INTO personality (trait, value, locked_by_user, last_updated)
     VALUES (@trait, @value, @locked, @updated)
     ON CONFLICT(trait) DO UPDATE SET
       value = excluded.value,
       locked_by_user = excluded.locked_by_user,
       last_updated = excluded.last_updated`).run({ trait, value, locked, updated });
}
export function deletePersonalityTrait(db, trait) {
    const r = db.prepare(`DELETE FROM personality WHERE trait = ?`).run(trait);
    return r.changes > 0;
}
export function listUserProfile(db) {
    return db
        .prepare(`SELECT id, observation, context, confidence, created_at, last_updated FROM user_profile ORDER BY datetime(last_updated) DESC`)
        .all();
}
export function insertUserObservation(db, observation, context, confidence) {
    const now = isoNow();
    const stmt = db.prepare(`INSERT INTO user_profile (observation, context, confidence, created_at, last_updated)
     VALUES (@observation, @context, @confidence, @created_at, @updated)`);
    const info = stmt.run({
        observation,
        context: context ?? null,
        confidence: confidence ?? 1,
        created_at: now,
        updated: now,
    });
    return Number(info.lastInsertRowid);
}
export function readAgentCore(vaultPath) {
    const p = path.join(vaultPath, "AGENT_CORE.md");
    if (!fs.existsSync(p))
        return null;
    return fs.readFileSync(p, "utf8");
}
export function appendJournal(vaultPath, entry) {
    const p = path.join(vaultPath, "journal.md");
    const header = `\n\n## ${isoNow()}\n\n`;
    fs.appendFileSync(p, `${header}${entry}\n`, "utf8");
}
export function logScriptRun(db, input) {
    const stmt = db.prepare(`INSERT INTO script_runs (script_name, started_at, ended_at, success, exit_code, output, metadata)
     VALUES (@script_name, @started_at, @ended_at, @success, @exit_code, @output, @metadata)`);
    const info = stmt.run({
        script_name: input.scriptName,
        started_at: input.startedAt,
        ended_at: input.endedAt ?? null,
        success: input.success == null ? null : input.success ? 1 : 0,
        exit_code: input.exitCode ?? null,
        output: input.output ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
    return Number(info.lastInsertRowid);
}
