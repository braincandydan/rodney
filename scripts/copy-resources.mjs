import { cpSync, mkdirSync, rmSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const resourcesDir = join(root, "apps/desktop/src-tauri/resources");

// Copy vault template
const vaultSrc = join(root, "vault");
const vaultDest = join(resourcesDir, "vault-template");
if (existsSync(vaultDest)) rmSync(vaultDest, { recursive: true });
mkdirSync(vaultDest, { recursive: true });
cpSync(vaultSrc, vaultDest, { recursive: true });
console.log("Copied vault template → src-tauri/resources/vault-template");

// Copy MCP server dist
const mcpSrc = join(root, "packages/memory-mcp/dist");
if (!existsSync(mcpSrc)) {
  console.error(
    "ERROR: packages/memory-mcp/dist not found — run pnpm build:mcp first"
  );
  process.exit(1);
}
const mcpDest = join(resourcesDir, "memory-mcp");
if (existsSync(mcpDest)) rmSync(mcpDest, { recursive: true });
mkdirSync(mcpDest, { recursive: true });
cpSync(mcpSrc, mcpDest, { recursive: true });
console.log("Copied MCP server     → src-tauri/resources/memory-mcp");
