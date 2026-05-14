import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { z } from "zod";
import { openDb, type MemoryCategory } from "./db.js";
import {
  appendJournal,
  approveMemory,
  associateMemories,
  deprecateMemory,
  endSession,
  getAgentState,
  getOrientContext,
  getRelatedMemories,
  insertMemory,
  insertUserObservation,
  listPersonality,
  listPendingMemories,
  listUserProfile,
  logMemoryAccess,
  logScriptRun,
  readAgentCore,
  recallMemories,
  reinforceMemory,
  startSession,
  touchMemories,
  updateAgentState,
} from "./repository.js";

const categorySchema = z.enum([
  "core",
  "episodic",
  "semantic",
  "procedural",
  "relationship",
  "project",
]);

function resolvePaths(): { dbPath: string; vaultPath: string } {
  const vaultPath = process.env.RODNEY_VAULT_PATH ?? process.cwd();
  const dbPath =
    process.env.RODNEY_DB_PATH ?? path.join(vaultPath, ".rodney", "rodney.db");
  return { dbPath, vaultPath };
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function main(): Promise<void> {
  const { dbPath, vaultPath } = resolvePaths();
  const db = openDb(dbPath);

  let currentSessionId: number | null = null;
  let currentSkillPath: string | null = null;

  const server = new McpServer({
    name: "rodney-memory",
    version: "0.1.0",
  });

  server.registerTool(
    "remember",
    {
      description:
        "Store a memory in Rodney's brain (semantic, episodic, relationship, etc.). Memories are created as 'pending' and must be approved by the user in the GUI before they appear in future recall.",
      inputSchema: {
        content: z.string(),
        category: categorySchema,
        importance: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
        skill_path: z.string().optional().describe("Relative skill path from SESSION_INIT (e.g. skills/research/web-research.md)"),
      },
    },
    async (args) => {
      const id = insertMemory(
        db,
        {
          content: args.content,
          category: args.category as MemoryCategory,
          importance: args.importance,
          tags: args.tags,
          confidence: args.confidence,
          sessionId: currentSessionId,
        },
        args.skill_path ?? currentSkillPath ?? undefined,
      );
      return jsonResult({ ok: true, id });
    },
  );

  server.registerTool(
    "recall",
    {
      description:
        "Retrieve ranked memories by importance, recency, tags, optional text query. By default also returns associated memories via the link graph (include_related: true).",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        category: categorySchema.optional(),
        tags: z.array(z.string()).optional(),
        include_related: z.boolean().optional().describe("Include 1-hop associated memories (default: true)"),
      },
    },
    async (args) => {
      const rows = recallMemories(db, {
        query: args.query,
        limit: args.limit ?? 15,
        category: args.category as MemoryCategory | undefined,
        tags: args.tags,
        includeRelated: args.include_related ?? true,
      });
      const directRows = rows.filter(r => !r._related);
      const relatedRows = rows.filter(r => r._related);
      touchMemories(db, rows.map(r => r.id));
      for (const r of rows) logMemoryAccess(db, r.id, currentSessionId);
      return jsonResult({ memories: directRows, related: relatedRows });
    },
  );

  server.registerTool(
    "forget",
    {
      description: "Soft-delete (deprecate) a memory by id.",
      inputSchema: {
        id: z.number().int(),
      },
    },
    async (args) => {
      const ok = deprecateMemory(db, args.id);
      return jsonResult({ ok });
    },
  );

  server.registerTool(
    "reinforce",
    {
      description: "Increase importance of a memory (cap 5).",
      inputSchema: {
        id: z.number().int(),
      },
    },
    async (args) => {
      const ok = reinforceMemory(db, args.id);
      return jsonResult({ ok });
    },
  );

  server.registerTool(
    "list_pending",
    {
      description: "List memories awaiting user approval in the GUI.",
      inputSchema: {},
    },
    async () => {
      return jsonResult({ memories: listPendingMemories(db) });
    },
  );

  server.registerTool(
    "approve_memory",
    {
      description: "Approve a pending memory so it becomes available in future recall.",
      inputSchema: { id: z.number().int() },
    },
    async (args) => {
      const ok = approveMemory(db, args.id);
      return jsonResult({ ok });
    },
  );

  server.registerTool(
    "reflect",
    {
      description:
        "Return AGENT_CORE.md text (if vault configured), personality traits, and current mood/state.",
      inputSchema: {},
    },
    async () => {
      const agentCore = readAgentCore(vaultPath);
      const personality = listPersonality(db);
      const mood = getAgentState(db);
      return jsonResult({
        vaultPath,
        agentCore,
        personality,
        mood,
      });
    },
  );

  server.registerTool(
    "update_mood",
    {
      description: "Update structured mood/state fields for the GUI and continuity.",
      inputSchema: {
        energy: z.string().optional(),
        clarity: z.string().optional(),
        confidence: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      updateAgentState(db, {
        energy: args.energy,
        clarity: args.clarity,
        confidence: args.confidence,
        notes: args.notes,
      });
      return jsonResult({ ok: true, mood: getAgentState(db) });
    },
  );

  server.registerTool(
    "observe_user",
    {
      description: "Record an observation about how the user works or prefers to collaborate.",
      inputSchema: {
        observation: z.string(),
        context: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    async (args) => {
      const id = insertUserObservation(db, args.observation, args.context, args.confidence);
      return jsonResult({ ok: true, id });
    },
  );

  server.registerTool(
    "get_user_profile",
    {
      description: "List structured observations about the user.",
      inputSchema: {},
    },
    async () => {
      return jsonResult({ observations: listUserProfile(db) });
    },
  );

  server.registerTool(
    "start_session",
    {
      description: "Open a Rodney session record (call once per Claude Code session start).",
      inputSchema: {
        project_id: z.string().optional(),
        skill_path: z.string().optional().describe("Relative skill path if launched from a skill session"),
      },
    },
    async (args) => {
      currentSessionId = startSession(db, args.project_id);
      currentSkillPath = args.skill_path ?? null;
      return jsonResult({ session_id: currentSessionId });
    },
  );

  server.registerTool(
    "end_session",
    {
      description:
        "Close the current session, write summary, optionally append journal entry in vault.",
      inputSchema: {
        summary: z.string(),
        mood_end: z.string().optional(),
        journal_entry: z.string().optional(),
      },
    },
    async (args) => {
      if (currentSessionId == null) {
        return jsonResult({ ok: false, error: "No active session; call start_session first." });
      }
      endSession(db, currentSessionId, args.summary, args.mood_end);
      if (args.journal_entry?.trim()) {
        try {
          appendJournal(vaultPath, args.journal_entry.trim());
        } catch (e) {
          return jsonResult({
            ok: true,
            warning: `Journal append failed: ${String(e)}`,
            session_id: currentSessionId,
          });
        }
      }
      const sid = currentSessionId;
      currentSessionId = null;
      return jsonResult({ ok: true, session_id: sid });
    },
  );

  server.registerTool(
    "orient",
    {
      description:
        "Load full context in one call: AGENT_CORE, personality, top memories, recent session summary, user profile, mood, and active projects. Call this at blank-terminal startup instead of separate reflect + recall + project scan.",
      inputSchema: {},
    },
    async () => {
      const ctx = getOrientContext(db, vaultPath);
      const imp = (n: number) => "●".repeat(Math.max(0, n)) + "○".repeat(Math.max(0, 5 - n));
      const lines: string[] = [];

      lines.push("## Current state");
      lines.push(`Energy: ${ctx.mood.energy ?? "—"} · Clarity: ${ctx.mood.clarity ?? "—"} · Confidence: ${ctx.mood.confidence ?? "—"}`);
      if (ctx.mood.notes?.trim()) lines.push(`Notes: ${ctx.mood.notes}`);

      if (ctx.agent_core) {
        lines.push("\n## Who you are");
        lines.push(ctx.agent_core.trim());
      }

      if (ctx.personality.length) {
        lines.push("\n## Personality");
        for (const p of ctx.personality) lines.push(`- **${p.trait}**: ${p.value}`);
      }

      if (ctx.user_profile.length) {
        lines.push("\n## About this user");
        for (const u of ctx.user_profile) {
          lines.push(`- ${u.observation}${u.context ? ` *(${u.context})*` : ""}`);
        }
      }

      if (ctx.memories.length) {
        lines.push("\n## Recent memories (top 12)");
        for (const m of ctx.memories) {
          const pin = m.pinned ? "📌 " : "";
          lines.push(`[${imp(m.importance)}] [${m.category}] ${pin}${m.content.slice(0, 120)}`);
        }
      }

      if (ctx.recent_session) {
        const s = ctx.recent_session;
        lines.push("\n## Last session");
        if (s.project_id) lines.push(`Project: ${s.project_id}`);
        if (s.ended_at) lines.push(`Ended: ${s.ended_at}`);
        if (s.mood_end) lines.push(`Mood: ${s.mood_end}`);
        if (s.summary) lines.push(`Summary: ${s.summary}`);
      }

      if (ctx.projects.length) {
        lines.push("\n## Active projects");
        for (const p of ctx.projects) lines.push(`- ${p}`);
      } else {
        lines.push("\n## Active projects");
        lines.push("(none)");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.registerTool(
    "associate",
    {
      description: "Explicitly link two memories as related. Strength = 1.0, type = explicit. Call when you recognise two memories are meaningfully connected.",
      inputSchema: {
        from_id: z.number().int(),
        to_id: z.number().int(),
      },
    },
    async (args) => {
      const ok = associateMemories(db, args.from_id, args.to_id);
      return jsonResult({ ok });
    },
  );

  server.registerTool(
    "recall_related",
    {
      description: "Traverse the memory association graph from a seed memory ID. Returns neighbor memories sorted by link strength.",
      inputSchema: {
        memory_id: z.number().int(),
        depth: z.number().int().min(1).max(2).optional().describe("1 or 2 hops (default 1)"),
        limit: z.number().int().min(1).max(20).optional().describe("Max results (default 10)"),
      },
    },
    async (args) => {
      const rows = getRelatedMemories(db, args.memory_id, args.depth ?? 1, args.limit ?? 10);
      touchMemories(db, rows.map(r => r.id));
      for (const r of rows) logMemoryAccess(db, r.id, currentSessionId);
      return jsonResult({ seed_id: args.memory_id, related: rows });
    },
  );

  server.registerTool(
    "log_script_run",
    {
      description:
        "Record a script execution result in Rodney's DB. Call from scripts (or skill sessions) after a run completes. Results appear in the Scripts dashboard.",
      inputSchema: {
        script_name: z.string().describe("Short identifier for the script, e.g. 'payworks'"),
        started_at: z.string().describe("ISO 8601 start time"),
        ended_at: z.string().optional().describe("ISO 8601 end time"),
        success: z.boolean().optional(),
        exit_code: z.number().int().optional(),
        output: z.string().optional().describe("Tail of stdout/stderr"),
        metadata: z
          .record(z.unknown())
          .optional()
          .describe("Structured output, e.g. { hours_added: 7.5, employees: 12 }"),
      },
    },
    async (args) => {
      const id = logScriptRun(db, {
        scriptName: args.script_name,
        startedAt: args.started_at,
        endedAt: args.ended_at,
        success: args.success,
        exitCode: args.exit_code,
        output: args.output,
        metadata: args.metadata as Record<string, unknown> | undefined,
      });
      return jsonResult({ ok: true, id });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
