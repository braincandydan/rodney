import { create } from "zustand";

export type TabId =
  | "dashboard"
  | "skills"
  | "terminal"
  | "memories"
  | "projects"
  | "personality"
  | "scripts";

export type TermSession = {
  id: string;
  label: string;
};

let _sid = 0;
function mkSession(label?: string): TermSession {
  _sid += 1;
  return { id: `ts-${_sid}-${Date.now()}`, label: label ?? `Agent ${_sid}` };
}

const firstSession = mkSession("Agent 1");

type Store = {
  tab: TabId;
  setTab: (t: TabId) => void;
  termSessions: TermSession[];
  activeTermId: string;
  addTermSession: (label?: string) => void;
  removeTermSession: (id: string) => void;
  setActiveTermId: (id: string) => void;
  /** Legacy: adds a new session and navigates to the terminal tab. */
  bumpLaunch: (label?: string) => void;
  pendingCount: number;
  setPendingCount: (n: number) => void;
};

export const useUiStore = create<Store>((set) => ({
  tab: "dashboard",
  setTab: (tab) => set({ tab }),
  termSessions: [firstSession],
  activeTermId: firstSession.id,
  addTermSession: (label?: string) => {
    const s = mkSession(label);
    set((prev) => ({
      termSessions: [...prev.termSessions, s],
      activeTermId: s.id,
      tab: "terminal",
    }));
  },
  removeTermSession: (id: string) => {
    set((prev) => {
      const remaining = prev.termSessions.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = mkSession();
        return { termSessions: [fresh], activeTermId: fresh.id };
      }
      const newActive =
        prev.activeTermId === id
          ? remaining[remaining.length - 1].id
          : prev.activeTermId;
      return { termSessions: remaining, activeTermId: newActive };
    });
  },
  setActiveTermId: (id: string) => set({ activeTermId: id }),
  bumpLaunch: (label?: string) => {
    const s = mkSession(label);
    set((prev) => ({
      termSessions: [...prev.termSessions, s],
      activeTermId: s.id,
      tab: "terminal",
    }));
  },
  pendingCount: 0,
  setPendingCount: (n) => set({ pendingCount: n }),
}));
