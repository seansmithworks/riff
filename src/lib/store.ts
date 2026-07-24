import { create } from "zustand";
import type { Artifact } from "./artifact";

export type Message = { role: "user" | "assistant"; text: string };
export type Status = "idle" | "listening" | "thinking" | "speaking";
export type JobStatus = "sketching" | "done" | "superseded" | "failed";
export type Job = { id: number; label: string; status: JobStatus };

interface StoreState {
  artifact: Artifact | null;
  messages: Message[];
  status: Status;
  jobs: Job[];
  setArtifact: (artifact: Artifact | null) => void;
  addMessage: (message: Message) => void;
  setStatus: (status: Status) => void;
  addJob: (job: Job) => void;
  updateJobStatus: (id: number, status: JobStatus) => void;
}

export const useStore = create<StoreState>((set) => ({
  artifact: null,
  messages: [],
  status: "idle",
  jobs: [],
  setArtifact: (artifact) => set({ artifact }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setStatus: (status) => set({ status }),
  addJob: (job) => set((state) => ({ jobs: [...state.jobs, job] })),
  updateJobStatus: (id, status) =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, status } : job)),
    })),
}));
