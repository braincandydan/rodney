import { invoke } from "@tauri-apps/api/core";

export type RodneyConfig = {
  vaultPath: string;
  rodneyRoot: string;
  claudeBin?: string | null;
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

export type SkillCard = {
  category: string;
  relativePath: string;
  title: string;
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
};

export async function loadConfig(): Promise<RodneyConfig | null> {
  return invoke<RodneyConfig | null>("load_config");
}

export async function saveFullConfig(payload: {
  vaultPath: string;
  rodneyRoot: string;
  claudeBin?: string | null;
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

export async function prefetchSessionContext(payload: {
  skillRelativePath: string;
  projectSlug?: string | null;
  recallQuery?: string | null;
  recallTags?: string[] | null;
  limit?: number | null;
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
