import type Database from "better-sqlite3";
import type { MemoryCategory } from "./db.js";
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
};
export declare function insertMemory(db: Database.Database, input: {
    content: string;
    category: MemoryCategory;
    importance?: number;
    tags?: string[];
    confidence?: number;
    sessionId?: number | null;
    status?: "pending" | "confirmed";
}): number;
export declare function approveMemory(db: Database.Database, id: number): boolean;
export declare function listPendingMemories(db: Database.Database): MemoryRow[];
export declare function recallMemories(db: Database.Database, input: {
    query?: string;
    limit: number;
    category?: MemoryCategory;
    tags?: string[];
}): MemoryRow[];
export declare function touchMemories(db: Database.Database, ids: number[]): void;
export declare function deprecateMemory(db: Database.Database, id: number): boolean;
export declare function reinforceMemory(db: Database.Database, id: number): boolean;
export declare function setPinned(db: Database.Database, id: number, pinned: boolean): boolean;
export declare function updateMemoryContent(db: Database.Database, id: number, content: string): boolean;
export declare function listMemories(db: Database.Database, filters: {
    category?: MemoryCategory;
    includeDeprecated?: boolean;
}): MemoryRow[];
export declare function startSession(db: Database.Database, projectId?: string): number;
export declare function endSession(db: Database.Database, sessionId: number, summary: string, moodEnd?: string): void;
export declare function logMemoryAccess(db: Database.Database, memoryId: number, sessionId: number | null, wasUseful?: boolean): void;
export declare function getAgentState(db: Database.Database): {
    energy: string | null;
    clarity: string | null;
    confidence: string | null;
    notes: string | null;
    updated_at: string;
};
export declare function updateAgentState(db: Database.Database, input: {
    energy?: string;
    clarity?: string;
    confidence?: string;
    notes?: string;
}): void;
export declare function listPersonality(db: Database.Database): Array<{
    trait: string;
    value: string;
    locked_by_user: number;
    last_updated: string;
}>;
export declare function upsertPersonality(db: Database.Database, trait: string, value: string, lockedByUser?: boolean): void;
export declare function deletePersonalityTrait(db: Database.Database, trait: string): boolean;
export declare function listUserProfile(db: Database.Database): Array<{
    id: number;
    observation: string;
    context: string | null;
    confidence: number;
    created_at: string;
    last_updated: string;
}>;
export declare function insertUserObservation(db: Database.Database, observation: string, context?: string, confidence?: number): number;
export declare function readAgentCore(vaultPath: string): string | null;
export declare function appendJournal(vaultPath: string, entry: string): void;
export declare function logScriptRun(db: Database.Database, input: {
    scriptName: string;
    startedAt: string;
    endedAt?: string | null;
    success?: boolean | null;
    exitCode?: number | null;
    output?: string | null;
    metadata?: Record<string, unknown> | null;
}): number;
