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
  status: string;
  skill_path: string | null;
};

export type MemoryLinkRow = {
  id: number;
  from_id: number;
  to_id: number;
  link_type: string;
  strength: number;
  created_at: string;
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
    status?: "pending" | "confirmed";
  },
  sessionSkillPath?: string,
): number {
  const tagsJson = input.tags?.length ? JSON.stringify(input.tags) : null;
  const stmt = db.prepare(
    `INSERT INTO memories (content, category, importance, pinned, access_count, created_at, last_accessed, tags, confidence, session_id, is_deprecated, status, skill_path)
     VALUES (@content, @category, @importance, 0, 0, @created_at, NULL, @tags, @confidence, @session_id, 0, @status, @skill_path)`,
  );
  const info = stmt.run({
    content: input.content,
    category: input.category,
    importance: input.importance ?? 3,
    created_at: isoNow(),
    tags: tagsJson,
    confidence: input.confidence ?? 1,
    session_id: input.sessionId ?? null,
    status: input.status ?? "pending",
    skill_path: sessionSkillPath ?? null,
  });
  const newId = Number(info.lastInsertRowid);

  // Auto-link on tag overlap (cap 10 links per new memory)
  if (input.tags?.length) {
    autoLinkByTags(db, newId, input.tags);
  }

  return newId;
}

function autoLinkByTags(db: Database.Database, newId: number, tags: string[]): void {
  // Find up to 10 existing confirmed memories sharing at least one tag
  const tagConditions = tags.map((_, i) => `LOWER(COALESCE(tags,'')) LIKE @t${i}`).join(" OR ");
  const params: Record<string, string | number> = { newId };
  for (let i = 0; i < tags.length; i++) {
    params[`t${i}`] = `%"${tags[i]!.toLowerCase()}"%`;
  }
  const candidates = db.prepare(
    `SELECT id, tags FROM memories
     WHERE id != @newId
       AND is_deprecated = 0
       AND (status = 'confirmed' OR status IS NULL)
       AND (${tagConditions})
     LIMIT 10`,
  ).all(params) as Array<{ id: number; tags: string | null }>;

  if (!candidates.length) return;

  const upsert = db.prepare(
    `INSERT INTO memory_links (from_id, to_id, link_type, strength, created_at)
     VALUES (@a, @b, 'tag_overlap', @strength, @ts)
     ON CONFLICT(from_id, to_id) DO UPDATE SET strength = MAX(strength, excluded.strength)`,
  );

  const tx = db.transaction(() => {
    for (const c of candidates) {
      let existingTags: string[] = [];
      try { existingTags = JSON.parse(c.tags ?? "[]"); } catch (_) {}
      const shared = tags.filter(t => existingTags.some(e => e.toLowerCase() === t.toLowerCase())).length;
      const strength = shared / Math.max(tags.length, existingTags.length);
      if (strength <= 0) continue;
      const ts = isoNow();
      upsert.run({ a: newId,  b: c.id, strength, ts });
      upsert.run({ a: c.id,  b: newId, strength, ts });
    }
  });
  tx();
}

export function approveMemory(db: Database.Database, id: number): boolean {
  const r = db
    .prepare(`UPDATE memories SET status = 'confirmed' WHERE id = ? AND status = 'pending'`)
    .run(id);
  return r.changes > 0;
}

export function listPendingMemories(db: Database.Database): MemoryRow[] {
  return db
    .prepare(
      `SELECT * FROM memories WHERE status = 'pending' AND is_deprecated = 0 ORDER BY datetime(created_at) DESC`,
    )
    .all() as MemoryRow[];
}

export function recallMemories(
  db: Database.Database,
  input: {
    query?: string;
    limit: number;
    category?: MemoryCategory;
    tags?: string[];
    includeRelated?: boolean;
  },
): Array<MemoryRow & { _related?: true }> {
  const limit = Math.min(Math.max(input.limit, 1), 50);
  const parts: string[] = ["is_deprecated = 0", "(status = 'confirmed' OR status IS NULL)"];
  const params: Record<string, string | number> = { limit };

  if (input.category) {
    parts.push("category = @category");
    params.category = input.category;
  }

  if (input.query?.trim()) {
    parts.push("(LOWER(content) LIKE @q OR LOWER(tags) LIKE @q)");
    params.q = `%${input.query.trim().toLowerCase()}%`;
  }

  if (input.tags?.length) {
    for (let i = 0; i < input.tags.length; i++) {
      const key = `tag${i}`;
      parts.push(`LOWER(COALESCE(tags,'')) LIKE @${key}`);
      params[key] = `%"${input.tags[i]!.toLowerCase()}"%`;
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
  const direct = db.prepare(sql).all(params) as MemoryRow[];

  if (!(input.includeRelated ?? true) || !direct.length) return direct;

  // 1-hop graph expansion — up to ceil(limit/2) additional memories
  const directIds = new Set(direct.map(r => r.id));
  const relatedCap = Math.ceil(limit / 2);
  const placeholders = Array.from(directIds).map((_, i) => `@seed${i}`).join(",");
  const seedParams: Record<string, number> = { relatedCap };
  Array.from(directIds).forEach((id, i) => { seedParams[`seed${i}`] = id; });

  const neighbors = db.prepare(
    `SELECT DISTINCT m.*, ml.strength
     FROM memory_links ml
     JOIN memories m ON (m.id = CASE WHEN ml.from_id IN (${placeholders}) THEN ml.to_id ELSE ml.from_id END)
     WHERE (ml.from_id IN (${placeholders}) OR ml.to_id IN (${placeholders}))
       AND m.is_deprecated = 0
       AND (m.status = 'confirmed' OR m.status IS NULL)
     ORDER BY ml.strength DESC, m.importance DESC
     LIMIT @relatedCap`,
  ).all(seedParams) as MemoryRow[];

  const related: Array<MemoryRow & { _related: true }> = neighbors
    .filter(n => !directIds.has(n.id))
    .slice(0, relatedCap)
    .map(n => ({ ...n, _related: true as const }));

  return [...direct, ...related];
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
  const parts: string[] = ["(status = 'confirmed' OR status IS NULL)"];
  const params: Record<string, string | number> = {};
  if (!filters.includeDeprecated) {
    parts.push("is_deprecated = 0");
  }
  if (filters.category) {
    parts.push("category = @category");
    params.category = filters.category;
  }
  const where = `WHERE ${parts.join(" AND ")}`;
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

  // Auto-link memories created in the same session
  const sessionMemories = db.prepare(
    `SELECT id, importance FROM memories
     WHERE session_id = @session_id AND is_deprecated = 0
     ORDER BY importance DESC LIMIT 20`,
  ).all({ session_id: sessionId }) as Array<{ id: number; importance: number }>;

  if (sessionMemories.length < 2) return;

  const top = sessionMemories.slice(0, 10);
  const upsert = db.prepare(
    `INSERT INTO memory_links (from_id, to_id, link_type, strength, created_at)
     VALUES (@a, @b, 'same_session', 0.3, @ts)
     ON CONFLICT(from_id, to_id) DO NOTHING`,
  );
  const ts = isoNow();
  const tx = db.transaction(() => {
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        upsert.run({ a: top[i]!.id, b: top[j]!.id, ts });
        upsert.run({ a: top[j]!.id, b: top[i]!.id, ts });
      }
    }
  });
  tx();
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

export function associateMemories(
  db: Database.Database,
  fromId: number,
  toId: number,
): boolean {
  const ts = isoNow();
  const upsert = db.prepare(
    `INSERT INTO memory_links (from_id, to_id, link_type, strength, created_at)
     VALUES (@a, @b, 'explicit', 1.0, @ts)
     ON CONFLICT(from_id, to_id) DO UPDATE SET strength = 1.0, link_type = 'explicit'`,
  );
  const tx = db.transaction(() => {
    upsert.run({ a: fromId, b: toId, ts });
    upsert.run({ a: toId, b: fromId, ts });
  });
  tx();
  return true;
}

export function getRelatedMemories(
  db: Database.Database,
  memoryId: number,
  depth: number,
  limit: number,
): Array<MemoryRow & { strength: number; link_type: string }> {
  const visited = new Set<number>([memoryId]);
  const results: Array<MemoryRow & { strength: number; link_type: string }> = [];

  const fetchNeighbors = (seedIds: number[], accumulated: typeof results) => {
    const placeholders = seedIds.map((_, i) => `@s${i}`).join(",");
    const params: Record<string, number> = { limit };
    seedIds.forEach((id, i) => { params[`s${i}`] = id; });
    const rows = db.prepare(
      `SELECT m.*, ml.strength, ml.link_type
       FROM memory_links ml
       JOIN memories m ON (m.id = CASE WHEN ml.from_id IN (${placeholders}) THEN ml.to_id ELSE ml.from_id END)
       WHERE (ml.from_id IN (${placeholders}) OR ml.to_id IN (${placeholders}))
         AND m.is_deprecated = 0
         AND (m.status = 'confirmed' OR m.status IS NULL)
       ORDER BY ml.strength DESC, m.importance DESC
       LIMIT @limit`,
    ).all(params) as Array<MemoryRow & { strength: number; link_type: string }>;
    for (const row of rows) {
      if (!visited.has(row.id)) {
        visited.add(row.id);
        accumulated.push(row);
      }
    }
  };

  fetchNeighbors([memoryId], results);

  if (depth >= 2 && results.length > 0) {
    const hop1Ids = results.map(r => r.id);
    fetchNeighbors(hop1Ids, results);
  }

  return results.slice(0, limit);
}

export type OrientContext = {
  memories: MemoryRow[];
  recent_session: {
    summary: string | null;
    ended_at: string | null;
    project_id: string | null;
    mood_end: string | null;
  } | null;
  personality: Array<{ trait: string; value: string }>;
  user_profile: Array<{ observation: string; context: string | null }>;
  mood: { energy: string | null; clarity: string | null; confidence: string | null; notes: string | null };
  agent_core: string | null;
  projects: string[];
};

export function getOrientContext(db: Database.Database, vaultPath: string): OrientContext {
  const memories = db.prepare(
    `SELECT * FROM memories
     WHERE is_deprecated = 0 AND (status = 'confirmed' OR status IS NULL)
     ORDER BY pinned DESC, importance DESC, datetime(last_accessed) DESC NULLS LAST
     LIMIT 12`,
  ).all() as MemoryRow[];

  const recent_session = db.prepare(
    `SELECT summary, ended_at, project_id, mood_end FROM sessions
     WHERE ended_at IS NOT NULL ORDER BY datetime(ended_at) DESC LIMIT 1`,
  ).get() as { summary: string | null; ended_at: string | null; project_id: string | null; mood_end: string | null } | null ?? null;

  const personality = db.prepare(
    `SELECT trait, value FROM personality ORDER BY trait`,
  ).all() as Array<{ trait: string; value: string }>;

  const user_profile = db.prepare(
    `SELECT observation, context FROM user_profile
     ORDER BY datetime(last_updated) DESC LIMIT 5`,
  ).all() as Array<{ observation: string; context: string | null }>;

  const mood = db.prepare(
    `SELECT energy, clarity, confidence, notes FROM agent_state WHERE id = 1`,
  ).get() as { energy: string | null; clarity: string | null; confidence: string | null; notes: string | null };

  const agent_core = readAgentCore(vaultPath);

  // List project slugs from vault/projects/
  let projects: string[] = [];
  try {
    const projectsDir = path.join(vaultPath, "projects");
    if (fs.existsSync(projectsDir)) {
      projects = fs.readdirSync(projectsDir)
        .filter(n => !n.startsWith(".") && n !== "_template" && fs.statSync(path.join(projectsDir, n)).isDirectory());
    }
  } catch (_) {}

  return { memories, recent_session, personality, user_profile, mood, agent_core, projects };
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

export function logScriptRun(
  db: Database.Database,
  input: {
    scriptName: string;
    startedAt: string;
    endedAt?: string | null;
    success?: boolean | null;
    exitCode?: number | null;
    output?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): number {
  const stmt = db.prepare(
    `INSERT INTO script_runs (script_name, started_at, ended_at, success, exit_code, output, metadata)
     VALUES (@script_name, @started_at, @ended_at, @success, @exit_code, @output, @metadata)`,
  );
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
