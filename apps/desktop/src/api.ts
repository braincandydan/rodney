import { invoke } from "@tauri-apps/api/core";

export type AgentRuntime = "Claude" | "Hermes";

export type RodneyConfig = {
  vaultPath: string;
  claudeBin?: string | null;
  hermesBin?: string | null;
  agentRuntime?: AgentRuntime;
};

export type DashboardStats = {
  memoryCount: number;
  sessionCount: number;
  activeSessions: number;
  agent: {
    energy?: string | null;
    clarity?: string | null;
    confidence?: string | null;
    notes?: string | null;
    updatedAt: string;
  };
};

export type SkillInput = {
  key: string;
  label: string;
  type: "text" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  options?: string[];
  default?: string;
};

export type SkillCard = {
  category: string;
  relativePath: string;
  title: string;
  inputs: SkillInput[];
};

export type ProjectCard = {
  slug: string;
  hasOverview: boolean;
  pendingFeedbackHint: boolean;
};

export type MemoryRow = {
  id: number;
  content: string;
  category: string;
  importance: number;
  pinned: boolean;
  accessCount: number;
  createdAt: string;
  lastAccessed?: string | null;
  tags?: string | null;
  confidence: number;
  sessionId?: number | null;
  isDeprecated: boolean;
  status: string;
};

export type PersonalityRow = {
  traitName: string;
  value: string;
  lockedByUser: boolean;
  lastUpdated: string;
};

export type ClaudeLaunchInfo = {
  cwd: string;
  program: string;
  args: string[];
  runtime: "claude" | "hermes";
};

export async function loadConfig(): Promise<RodneyConfig | null> {
  return invoke<RodneyConfig | null>("load_config");
}

export async function saveFullConfig(payload: {
  vaultPath: string;
  claudeBin?: string | null;
  hermesBin?: string | null;
  agentRuntime?: string | null;
  agentName?: string | null;
  personalityNotes?: string | null;
}): Promise<void> {
  return invoke("save_full_config", { payload });
}

export async function getDashboardStats(): Promise<DashboardStats> {
  return invoke("get_dashboard_stats");
}

export async function listSkills(): Promise<SkillCard[]> {
  return invoke("list_skills");
}

export async function listProjects(): Promise<ProjectCard[]> {
  return invoke("list_projects");
}

export async function memoriesList(filters: {
  category?: string | null;
  includeDeprecated?: boolean;
  search?: string | null;
}): Promise<MemoryRow[]> {
  return invoke("memories_list", { filters });
}

export async function memoryUpdate(id: number, content: string): Promise<boolean> {
  return invoke("memory_update", { payload: { id, content } });
}

export async function memoryDeprecate(id: number): Promise<boolean> {
  return invoke("memory_deprecate", { id });
}

export async function memorySetPinned(id: number, pinned: boolean): Promise<boolean> {
  return invoke("memory_set_pinned", { payload: { id, pinned } });
}

export async function memoryApprove(id: number): Promise<boolean> {
  return invoke("memory_approve", { id });
}

export async function pendingMemoriesList(): Promise<MemoryRow[]> {
  return invoke("pending_memories_list");
}

export async function prefetchSessionContext(payload: {
  skillRelativePath: string;
  projectSlug?: string | null;
  recallQuery?: string | null;
  recallTags?: string[] | null;
  limit?: number | null;
  formData?: Record<string, string> | null;
}): Promise<string> {
  return invoke("prefetch_session_context", { payload });
}

export async function personalityList(): Promise<PersonalityRow[]> {
  return invoke("personality_list");
}

export async function personalityUpsert(traitName: string, value: string, locked?: boolean): Promise<void> {
  return invoke("personality_upsert", { payload: { traitName, value, locked } });
}

export async function personalityDelete(traitName: string): Promise<boolean> {
  return invoke("personality_delete", { payload: { traitName } });
}

export async function getClaudeLaunchInfo(): Promise<ClaudeLaunchInfo> {
  return invoke("get_claude_launch_info");
}

export async function readProjectOverview(slug: string): Promise<string | null> {
  return invoke("read_project_overview", { slug });
}

export async function openProjectFolder(slug: string): Promise<void> {
  return invoke("open_project_folder", { slug });
}

export type ScriptState = {
  date?: string | null;
  arrivalTime?: string | null;
  departureTime?: string | null;
  processed?: boolean | null;
  [key: string]: unknown;
};

export type ScriptRunRow = {
  id: number;
  scriptName: string;
  startedAt: string;
  endedAt?: string | null;
  success?: boolean | null;
  exitCode?: number | null;
  output?: string | null;
  metadata?: string | null;
  createdAt: string;
};

export type ScriptDirInfo = {
  name: string;
  dirPath: string;
  config: Record<string, unknown> | null;
  state: ScriptState | null;
  logLines: string[];
  files: string[];
  isWatcherRunning: boolean;
  dbRuns: ScriptRunRow[];
};

export async function listScriptDirs(): Promise<ScriptDirInfo[]> {
  return invoke("list_script_dirs");
}

export async function readScriptFileContent(dirName: string, fileName: string): Promise<string> {
  return invoke("read_script_file_content", { dirName, fileName });
}

export async function logScriptRunCmd(payload: {
  scriptName: string;
  startedAt: string;
  endedAt?: string | null;
  success?: boolean | null;
  exitCode?: number | null;
  output?: string | null;
  metadata?: string | null;
}): Promise<number> {
  return invoke("log_script_run_cmd", { payload });
}

export type MemoryGraphNode = {
  id: number;
  category: string;
  importance: number;
  accessCount: number;
  tags?: string | null;
  pinned: boolean;
  confidence: number;
  snippet: string;
};

export type MemoryGraphData = {
  nodes: MemoryGraphNode[];
  recentIds: number[];
};

export async function getMemoryGraphData(): Promise<MemoryGraphData> {
  return invoke("get_memory_graph");
}

export async function listScriptRunsCmd(
  scriptName?: string | null,
  limit?: number | null,
): Promise<ScriptRunRow[]> {
  return invoke("list_script_runs_cmd", { scriptName: scriptName ?? null, limit: limit ?? null });
}

export type ProjectTask = {
  slug: string;
  title: string;
  status: "todo" | "in-progress" | "done" | "blocked" | string;
  priority?: string | null;
  assigned?: string | null;
  created?: string | null;
  completedAt?: string | null;
  body: string;
};

export async function listProjectTasks(slug: string): Promise<ProjectTask[]> {
  return invoke("list_project_tasks", { slug });
}

export async function createProjectTask(payload: {
  projectSlug: string;
  title: string;
  body?: string | null;
  priority?: string | null;
}): Promise<string> {
  return invoke("create_project_task", { payload });
}

export async function updateTaskStatus(
  projectSlug: string,
  taskSlug: string,
  status: string,
): Promise<boolean> {
  return invoke("update_task_status", { payload: { projectSlug, taskSlug, status } });
}

export async function prefetchProjectSession(payload: {
  projectSlug: string;
  selectedTaskSlugs: string[];
  focus?: string | null;
}): Promise<string> {
  return invoke("prefetch_project_session", { payload });
}
