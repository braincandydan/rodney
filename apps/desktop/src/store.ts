import { create } from "zustand";

export type TabId =
  | "dashboard"
  | "skills"
  | "terminal"
  | "memories"
  | "projects"
  | "personality";

type Store = {
  tab: TabId;
  setTab: (t: TabId) => void;
  launchKey: number;
  bumpLaunch: () => void;
};

export const useUiStore = create<Store>((set) => ({
  tab: "dashboard",
  setTab: (tab) => set({ tab }),
  launchKey: 0,
  bumpLaunch: () => set((s) => ({ launchKey: s.launchKey + 1 })),
}));
