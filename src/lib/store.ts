import { create } from "zustand";
import type { Artifact } from "./artifact";

export type Message = { role: "user" | "assistant"; text: string };
export type Status = "idle" | "listening" | "thinking" | "speaking";

interface StoreState {
  artifact: Artifact | null;
  messages: Message[];
  status: Status;
  setArtifact: (artifact: Artifact | null) => void;
  addMessage: (message: Message) => void;
  setStatus: (status: Status) => void;
}

export const useStore = create<StoreState>((set) => ({
  artifact: null,
  messages: [],
  status: "idle",
  setArtifact: (artifact) => set({ artifact }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setStatus: (status) => set({ status }),
}));
