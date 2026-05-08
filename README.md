# Rodney

Local desktop app (Tauri) + Memory MCP server for Claude Code — persistent memory, skills vault, and GUI dashboard.

## Prerequisites

- Node.js 20+ (22.12+ recommended for Vite 7)
- pnpm 9+
- **Rust stable via rustup** (recommended). Homebrew `rust` ≤1.82 cannot parse some transitive crates; `apps/desktop/src-tauri/rust-toolchain.toml` pins stable for reproducible builds.
- [Claude Code](https://docs.anthropic.com/claude-code) CLI (`claude`) with Claude Pro auth

After installing [rustup](https://rustup.rs/), run `rustup default stable` so `cargo`/`rustc` point at `$HOME/.cargo/bin`.

## Setup

```bash
pnpm install
pnpm build:mcp
```

### Memory MCP (Claude Code)

1. Complete onboarding in Rodney (set vault path + repo root), or copy `vault/` template to your vault folder.
2. Rodney writes `rodney-mcp.json` in your vault with absolute paths to `packages/memory-mcp/dist/server.js`.
3. From your vault directory, run Claude Code with MCP config (example):

```bash
cd /path/to/your/vault
claude --mcp-config ./rodney-mcp.json
```

Or configure MCP globally per Claude Code docs using the same JSON.

### Manual test (Phase 0)

1. `pnpm build:mcp`
2. Set `RODNEY_DB_PATH` and `RODNEY_VAULT_PATH`, then run:

```bash
node packages/memory-mcp/dist/server.js
```

Use an MCP inspector or Claude Code with `rodney-mcp.json` to verify tools (`remember`, `recall`, `reflect`, etc.).

### Desktop app

```bash
pnpm dev
```

Runs Vite + Tauri with embedded terminal (PTY), skill launcher, dashboard, memory browser, project tracker, onboarding, and personality editor.

## Workspace layout

- `packages/memory-mcp` — MCP server (SQLite brain)
- `apps/desktop` — Tauri + React GUI
- `vault/` — template vault (skills, projects, `CLAUDE.md`, `AGENT_CORE.md`)

## License

MIT
