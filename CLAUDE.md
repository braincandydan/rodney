# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Rodney — Developer Context

## Who you are helping

You are working with **the developer who is building Rodney**, not an end-user running it.
Do not follow the vault `CLAUDE.md` startup ritual. Do not call MCP memory tools. That is end-user behavior.

## What Rodney is

A local desktop companion for Claude Code — gives users persistent memory, a skill launcher, and a GUI dashboard. Distributed privately to a small trusted team. Each person gets their own copy of the Rodney repo on their machine and their own Claude membership.

Three parts:

| Part | Location | What it does |
|---|---|---|
| Memory MCP server | `packages/memory-mcp/` | Node.js MCP server, SQLite brain. Claude Code connects here for `remember`, `recall`, `reflect`, etc. |
| Desktop GUI | `apps/desktop/` | Tauri (Rust) + React. Tabs: Dashboard, Skills, Terminal, Memories, Projects, Personality. Terminal tab spawns Claude Code via PTY. |
| Vault template | `vault/` | Template files. Copied to user's chosen vault folder at onboarding. This is source — not a live vault. |

## Two folders on this machine

| Folder | Role |
|---|---|
| `D:\rodney` | Source repo — **you are here** |
| `D:\Rodney Wiki` | Developer's live test vault (dogfooding) |

`D:\Rodney Wiki` was seeded from `vault/` during onboarding and is a live independent copy.
Template changes in `vault/` do **not** auto-sync there — that is intentional (skip-if-exists protects user edits).

## Workspace layout

```
rodney/
├── apps/desktop/
│   ├── src/
│   │   ├── api.ts            ← all Tauri invoke() calls, typed
│   │   ├── store.ts          ← Zustand UI state
│   │   ├── App.tsx           ← tab shell
│   │   └── components/       ← Dashboard, SkillLauncher, TerminalPanel,
│   │                            MemoryBrowser, Projects, Personality, Onboarding
│   └── src-tauri/src/
│       ├── lib.rs            ← all #[tauri::command] handlers
│       ├── config.rs         ← RodneyConfig struct, disk read/write, MCP JSON writer
│       ├── sqlite.rs         ← DB queries + writes used by Tauri commands
│       └── main.rs
├── packages/memory-mcp/src/
│   ├── server.ts             ← MCP server, tool registrations
│   ├── repository.ts         ← all SQLite read/write logic
│   └── db.ts                 ← schema, migrations, openDb()
└── vault/                    ← template only — gets mirrored on onboarding
    ├── CLAUDE.md             ← end-user agent constitution (NOT this file)
    ├── AGENT_CORE.md         ← personality anchor template
    ├── skills/               ← built-in skill markdown files
    └── projects/_template/   ← project doc template
```

## Architecture — decisions that matter

**Config** lives at `%LOCALAPPDATA%\Rodney\config.json` (not in vault). Fields: `vaultPath`, `claudeBin`.

The MCP server (`packages/memory-mcp/dist/server.js`) and vault template are bundled into the Tauri app as resources at `src-tauri/resources/`. Tauri resolves them at runtime via `app.path().resource_dir()`. Run `node scripts/copy-resources.mjs` (or `pnpm dev`) to refresh resources before building.

**DB** lives at `<vaultPath>/.rodney/rodney.db`. Both the GUI (via Rust in `sqlite.rs`) and the MCP server (via Node in `repository.ts`) read and write the DB. WAL mode prevents contention. `open_ro_db` in `sqlite.rs` is misleadingly named — it opens in read-write mode and is used for writes like approve, pin, deprecate, and content edits.

**Vault seeding** (`mirror_vault_template` in `lib.rs`) copies `vault/` to user's chosen folder on onboarding. Skip-if-exists — never overwrites existing files. Preserves user edits on re-run.

**MCP config** (`rodney-mcp.json`) written into vault root by Tauri on save. Points Node at `packages/memory-mcp/dist/server.js` with env vars `RODNEY_DB_PATH` and `RODNEY_VAULT_PATH`.

**Skills** are `.md` files under `<vaultPath>/skills/`. Tauri walks the directory at runtime. Title parsed from `# Heading` or `title:` frontmatter line. Input field definitions live in YAML frontmatter and drive dynamic form generation in the GUI.

**Session handoff** — when user launches a skill from the GUI, Tauri writes two files into the vault:
- `.session/SESSION_INIT.md` — skill path, project slug, launch timestamp, form inputs
- `.session/SESSION_CONTEXT.md` — pre-fetched memories (tag-matched) **plus** all personality traits from the DB

The end-user `CLAUDE.md` reads these at Claude Code startup. Personality traits are injected at prefetch time so the agent always has them — no MCP call required.

**Memory approval queue** — agent writes from `remember` land in `status = 'pending'`. Only `status = 'confirmed'` memories are returned by `recall` or included in session prefetch. The GUI Memory Browser shows a pending review panel; Approve sets `status = 'confirmed'`, Reject deprecates the row. The `status` column was added via idempotent `ALTER TABLE` migration — existing rows default to `'confirmed'`.

**Personality** stored in DB (`personality` table), editable via GUI. Also auto-injected into `SESSION_CONTEXT.md` on every skill launch. Separate from `AGENT_CORE.md` which is a markdown file the human controls directly.

## MCP tools the memory server exposes

`remember` · `recall` · `forget` · `reinforce` · `reflect` · `list_pending` · `approve_memory` · `start_session` · `end_session` · `observe_user` · `get_user_profile` · `update_mood`

DB tables: `sessions` · `memories` · `personality` · `user_profile` · `memory_access_log` · `agent_state`

## Dev commands

```bash
pnpm install       # install all workspace deps
pnpm build:mcp     # compile memory-mcp TypeScript → dist/
pnpm dev           # build:mcp + tauri dev (Vite + Rust hot reload)
pnpm lint          # lint all packages
```

To verify Rust changes without launching the full GUI:
```bash
cd apps/desktop/src-tauri && cargo check
```

First Rust build is slow — `cargo` targets cache in `apps/desktop/src-tauri/target/`.

## Test vault notes

Skills in `D:\Rodney Wiki\skills\` that are not in `vault/skills/` (e.g. `photo-vote.md`, `project-manage.md`) are developer test files, not part of the shipped template.

## Development status

**Working and functional:**
- Onboarding — full flow: mirrors vault template, writes `rodney-mcp.json`, creates `AGENT_CORE.md`
- Config load/save — persists correctly to OS local data dir
- Dashboard — memory/session counts, agent state display, 5s polling
- Skills tab — lists skills by category, launches Claude Code sessions with prefetch
- Terminal tab — xterm + PTY, multiple named sessions with tabs, skill picker modal, session context prefetch before launch
- Memory Browser — list, category filter, include-deprecated toggle, inline edit, pin, deprecate; pending review panel for agent-written memories
- Projects tab — lists projects, flags any with `status: in-review` docs
- Personality tab — add/edit/delete traits stored in DB; traits auto-injected into every session context
- MCP server — all tools registered and operational
- Memory approval queue — agent writes go to `pending`, user approves/rejects via GUI

**Rough edges (built but incomplete):**
- Memory Browser has no text search — category filter only
- Dashboard agent state is read-only — no way to edit it from GUI
- Onboarding has a native folder picker (Browse button) — vault path is the only required input
- Projects tab lists slugs only — no way to open, edit, or create project docs from GUI

**Not built yet:**
- No automated tests of any kind
- No vault template migration — existing user vaults do not receive new template files after initial setup
- No in-GUI skill editor or skill creator
- No memory search (full text)
- No notification when agent writes new memories during a session

## Common task patterns

### Add a new Tauri command (most common task)

Touch these files in order:
1. `apps/desktop/src-tauri/src/lib.rs` — add the handler function with `#[tauri::command]`, add it to `tauri::generate_handler![]`
2. `apps/desktop/src-tauri/src/sqlite.rs` — add the DB query if needed
3. `apps/desktop/src/api.ts` — add the typed `invoke()` wrapper
4. Component file — call the new api function

Run `cargo check` (fast) or `pnpm dev` (full) to verify Rust. Rust errors do not surface until compile.

### Add a new MCP tool

Touch these files:
1. `packages/memory-mcp/src/repository.ts` — add the DB logic
2. `packages/memory-mcp/src/server.ts` — register the tool with `server.registerTool()`

Run `pnpm build:mcp` then test via Claude Code with `--mcp-config rodney-mcp.json` from the vault.

### Edit the vault template

Edit files under `vault/`. These changes apply to new users on first onboarding only.
To test: manually copy the changed file into `D:\Rodney Wiki` (template does not auto-sync to existing vaults).

### Add a new React component/tab

1. Create component in `apps/desktop/src/components/`
2. Add tab entry to `tabs` array in `App.tsx`
3. Render it in `App.tsx` main section (follow existing pattern)

## No automated tests

No test suite exists. Verify all changes manually:
- Rust/Tauri changes: run `pnpm dev`, exercise the feature in the GUI
- MCP changes: run `pnpm build:mcp`, open Claude Code from the test vault and call the tool
- React changes: `pnpm dev` hot-reloads — check in the running app

Do not look for test files. Do not write tests unprompted unless the developer asks.

## Hard rules for agents working here

- Do not follow vault `CLAUDE.md` startup ritual — that is for end-users
- Do not call MCP memory tools — you are developing the app, not using it
- `vault/` files are templates — do not treat them as the live vault
- `D:\Rodney Wiki\CLAUDE.md` is a live end-user copy — `vault/CLAUDE.md` is the source template — they are different files with different purposes
- When editing Rust (`lib.rs`, `config.rs`, `sqlite.rs`) you must run `cargo check` or `pnpm dev` to verify — Rust errors are silent until compile
- When editing MCP server (`packages/memory-mcp/src/`) run `pnpm build:mcp` before testing
