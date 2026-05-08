import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { MemoryCategory } from "./db.js";

function isoNow(): string {
  return new Date().toISOString();
}

export type MemoryRow = {
  id: number;
  content: string;
  category: string;
  importance: number;
  pinned: number;
  access_count: number;
  created_at: string;
  last_accessed: string | null;
  tags: string | null;
  confidence: number;
  session_id: number | null;
  is_deprecated: number;
};

export function insertMemory(
  db: Database.Database,
  input: {
    content: string;
    category: MemoryCategory;
    importance?: number;
    tags?: string[];
    confidence?: number;
    sessionId?: number | null;
  },
): number {
  const stmt = db.prepare(
    `INSERT INTO memories (content, category, importance, pinned, access_count, created_at, last_accessed, tags, confidence, session_id, is_deprecated)
     VALUES (@content, @category, @importance, 0, 0, @created_at, NULL, @tags, @confidence, @session_id, 0)`,
  );
  const info = stmt.run({
    content: input.content,
    category: input.category,
    importance: input.importance ?? 3,
    created_at: isoNow(),
    tags: input.tags?.length ? JSON.stringify(input.tags) : null,
    confidence: input.confidence ?? 1,
    session_id: input.sessionId ?? null,
  });
  return Number(info.lastInsertRowid);
}

export function recallMemories(
  db: Database.Database,
  input: {
    query?: string;
    limit: number;
    category?: MemoryCategory;
    tags?: string[];
  },
): MemoryRow[] {
  const limit = Math.min(Math.max(input.limit, 1), 50);
  const parts: string[] = ["is_deprecated = 0"];
  const params: Record<string, string | number> = { limit };

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
      parts.push(`LOWER(tags) LIKE @${key}`);
      params[key] = `%${input.tags[i]!.toLowerCase()}%`;
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
  return stmt.all(params) as MemoryRow[];
}

export function touchMemories(db: Database.Database, ids: number[]): void {
  if (!ids.length) return;
  const now = isoNow();
  const stmt = db.prepare(
    `UPDATE memories SET access_count = access_count + 1, last_accessed = @now WHERE id = @id`,
  );
  const tx = db.transaction(() => {
    for (const id of ids) {
      stmt.run({ id, now });
    }
  });
  tx();
}

export function deprecateMemory(db: Database.Database, id: number): boolean {
  const r = db.prepare(`UPDATE memories SET is_deprecated = 1 WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function reinforceMemory(db: Database.Database, id: number): boolean {
  const r = db
    .prepare(
      `UPDATE memories SET importance = CASE WHEN importance < 5 THEN importance + 1 ELSE importance END WHERE id = ?`,
    )
    .run(id);
  return r.changes > 0;
}

export function setPinned(db: Database.Database, id: number, pinned: boolean): boolean {
  const r = db.prepare(`UPDATE memories SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, id);
  return r.changes > 0;
}

export function updateMemoryContent(
  db: Database.Database,
  id: number,
  content: string,
): boolean {
  const r = db.prepare(`UPDATE memories SET content = ? WHERE id = ?`).run(content, id);
  return r.changes > 0;
}

export function listMemories(
  db: Database.Database,
  filters: { category?: MemoryCategory; includeDeprecated?: boolean },
): MemoryRow[] {
  const parts: string[] = [];
  const params: Record<string, string | number> = {};
  if (!filters.includeDeprecated) {
    parts.push("is_deprecated = 0");
  }
  if (filters.category) {
    parts.push("category = @category");
    params.category = filters.category;
  }
  const where = parts.length ? `WHERE ${parts.join(" AND ")}` : "";
  const stmt = db.prepare(
    `SELECT * FROM memories ${where} ORDER BY pinned DESC, importance DESC, datetime(created_at) DESC`,
  );
  return stmt.all(params) as MemoryRow[];
}

export function startSession(db: Database.Database, projectId?: string): number {
  const stmt = db.prepare(
    `INSERT INTO sessions (started_at, ended_at, project_id, mood_start, mood_end, summary)
     VALUES (@started_at, NULL, @project_id, NULL, NULL, NULL)`,
  );
  const info = stmt.run({ started_at: isoNow(), project_id: projectId ?? null });
  return Number(info.lastInsertRowid);
}

export function endSession(
  db: Database.Database,
  sessionId: number,
  summary: string,
  moodEnd?: string,
): void {
  db.prepare(
    `UPDATE sessions SET ended_at = @ended_at, summary = @summary, mood_end = @mood_end WHERE id = @id`,
  ).run({
    id: sessionId,
    ended_at: isoNow(),
    summary,
    mood_end: moodEnd ?? null,
  });
}

export function logMemoryAccess(
  db: Database.Database,
  memoryId: number,
  sessionId: number | null,
  wasUseful?: boolean,
): void {
  db.prepare(
    `INSERT INTO memory_access_log (memory_id, session_id, accessed_at, was_useful)
     VALUES (@memory_id, @session_id, @accessed_at, @was_useful)`,
  ).run({
    memory_id: memoryId,
    session_id: sessionId,
    accessed_at: isoNow(),
    was_useful: wasUseful === undefined ? null : wasUseful ? 1 : 0,
  });
}

export function getAgentState(db: Database.Database): {
  energy: string | null;
  clarity: string | null;
  confidence: string | null;
  notes: string | null;
  updated_at: string;
} {
  const row = db
    .prepare(`SELECT energy, clarity, confidence, notes, updated_at FROM agent_state WHERE id = 1`)
    .get() as {
    energy: string | null;
    clarity: string | null;
    confidence: string | null;
    notes: string | null;
    updated_at: string;
  };
  return row;
}

export function updateAgentState(
  db: Database.Database,
  input: { energy?: string; clarity?: string; confidence?: string; notes?: string },
): void {
  const cur = getAgentState(db);
  db.prepare(
    `UPDATE agent_state SET
      energy = COALESCE(@energy, energy),
      clarity = COALESCE(@clarity, clarity),
      confidence = COALESCE(@confidence, confidence),
      notes = COALESCE(@notes, notes),
      updated_at = @updated_at
    WHERE id = 1`,
  ).run({
    energy: input.energy ?? cur.energy,
    clarity: input.clarity ?? cur.clarity,
    confidence: input.confidence ?? cur.confidence,
    notes: input.notes ?? cur.notes,
    updated_at: isoNow(),
  });
}

export function listPersonality(db: Database.Database): Array<{
  trait: string;
  value: string;
  locked_by_user: number;
  last_updated: string;
}> {
  return db.prepare(`SELECT trait, value, locked_by_user, last_updated FROM personality ORDER BY trait`).all() as Array<{
    trait: string;
    value: string;
    locked_by_user: number;
    last_updated: string;
  }>;
}

export function upsertPersonality(
  db: Database.Database,
  trait: string,
  value: string,
  lockedByUser?: boolean,
): void {
  const existing = db
    .prepare(`SELECT locked_by_user FROM personality WHERE trait = ?`)
    .get(trait) as { locked_by_user: number } | undefined;
  let locked = 0;
  if (lockedByUser !== undefined) locked = lockedByUser ? 1 : 0;
  else if (existing) locked = existing.locked_by_user;

  const updated = isoNow();
  db.prepare(
    `INSERT INTO personality (trait, value, locked_by_user, last_updated)
     VALUES (@trait, @value, @locked, @updated)
     ON CONFLICT(trait) DO UPDATE SET
       value = excluded.value,
       locked_by_user = excluded.locked_by_user,
       last_updated = excluded.last_updated`,
  ).run({ trait, value, locked, updated });
}

export function deletePersonalityTrait(db: Database.Database, trait: string): boolean {
  const r = db.prepare(`DELETE FROM personality WHERE trait = ?`).run(trait);
  return r.changes > 0;
}

export function listUserProfile(db: Database.Database): Array<{
  id: number;
  observation: string;
  context: string | null;
  confidence: number;
  created_at: string;
  last_updated: string;
}> {
  return db
    .prepare(
      `SELECT id, observation, context, confidence, created_at, last_updated FROM user_profile ORDER BY datetime(last_updated) DESC`,
    )
    .all() as Array<{
    id: number;
    observation: string;
    context: string | null;
    confidence: number;
    created_at: string;
    last_updated: string;
  }>;
}

export function insertUserObservation(
  db: Database.Database,
  observation: string,
  context?: string,
  confidence?: number,
): number {
  const now = isoNow();
  const stmt = db.prepare(
    `INSERT INTO user_profile (observation, context, confidence, created_at, last_updated)
     VALUES (@observation, @context, @confidence, @created_at, @updated)`,
  );
  const info = stmt.run({
    observation,
    context: context ?? null,
    confidence: confidence ?? 1,
    created_at: now,
    updated: now,
  });
  return Number(info.lastInsertRowid);
}

export function readAgentCore(vaultPath: string): string | null {
  const p = path.join(vaultPath, "AGENT_CORE.md");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

export function appendJournal(vaultPath: string, entry: string): void {
  const p = path.join(vaultPath, "journal.md");
  const header = `\n\n## ${isoNow()}\n\n`;
  fs.appendFileSync(p, `${header}${entry}\n`, "utf8");
}
