import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { z } from "zod";
import { openDb, type MemoryCategory } from "./db.js";
import {
  appendJournal,
  deprecateMemory,
  endSession,
  getAgentState,
  insertMemory,
  insertUserObservation,
  listPersonality,
  listUserProfile,
  logMemoryAccess,
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

  const server = new McpServer({
    name: "rodney-memory",
    version: "0.1.0",
  });

  server.registerTool(
    "remember",
    {
      description:
        "Store a memory in Rodney's brain (semantic, episodic, relationship, etc.).",
      inputSchema: {
        content: z.string(),
        category: categorySchema,
        importance: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    async (args) => {
      const id = insertMemory(db, {
        content: args.content,
        category: args.category as MemoryCategory,
        importance: args.importance,
        tags: args.tags,
        confidence: args.confidence,
        sessionId: currentSessionId,
      });
      return jsonResult({ ok: true, id });
    },
  );

  server.registerTool(
    "recall",
    {
      description:
        "Retrieve ranked memories by importance, recency, tags, optional text query.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        category: categorySchema.optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const rows = recallMemories(db, {
        query: args.query,
        limit: args.limit ?? 15,
        category: args.category as MemoryCategory | undefined,
        tags: args.tags,
      });
      touchMemories(
        db,
        rows.map((r) => r.id),
      );
      for (const r of rows) {
        logMemoryAccess(db, r.id, currentSessionId);
      }
      return jsonResult({ memories: rows });
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
      },
    },
    async (args) => {
      currentSessionId = startSession(db, args.project_id);
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
