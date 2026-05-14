import Database from "better-sqlite3";
export type MemoryCategory = "core" | "episodic" | "semantic" | "procedural" | "relationship" | "project";
export declare function openDb(dbPath: string): Database.Database;
export declare function migrate(db: Database.Database): void;
