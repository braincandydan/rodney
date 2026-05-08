# Manual test — Rodney Phase 0 (Memory MCP)

Prerequisites: Node 20+, `pnpm install`, `pnpm build:mcp`, Claude Code CLI available.

## 1. Build MCP server

```bash
cd /path/to/Rodney
pnpm build:mcp
```

## 2. Run MCP over stdio (sanity)

In one terminal (adjust paths):

```bash
export RODNEY_VAULT_PATH="/absolute/path/to/your/vault"
export RODNEY_DB_PATH="$RODNEY_VAULT_PATH/.rodney/rodney.db"
node packages/memory-mcp/dist/server.js
```

Use any MCP inspector/client against stdio, or proceed to Claude Code.

## 3. Wire Claude Code

1. Complete Rodney onboarding once **or** create `rodney-mcp.json` in your vault (Rodney GUI writes this on save).
2. From the **vault** directory:

```bash
cd "$RODNEY_VAULT_PATH"
claude --mcp-config ./rodney-mcp.json
```

3. In Claude Code, call MCP tools: **`reflect`**, **`remember`**, **`recall`**, **`start_session`**, **`end_session`**.

Expected:

- `reflect` returns vault path, optional `AGENT_CORE.md` text, personality rows, agent mood row.
- `remember` inserts rows inspectable via Rodney GUI **Memories** tab.

## 4. GUI sanity

```bash
pnpm dev
```

- Dashboard counters refresh every ~5s.
- Skills → prefetch → Terminal launches `claude --mcp-config rodney-mcp.json` in the vault cwd.
