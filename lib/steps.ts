/** Client-safe pipeline step definitions (no server-only imports). Shared by lib/agent.ts and the UI. */

export type StepId = "perceive" | "garments" | "score" | "decide" | "tryon" | "recolor" | "rescue" | "tips" | "explain";

export const STEP_ORDER: StepId[] = [
  "perceive",
  "garments",
  "score",
  "decide",
  "tryon",
  "recolor",
  "rescue",
  "tips",
  "explain",
];

export const STEP_LABEL: Record<StepId, string> = {
  perceive: "Read your skin today",
  garments: "Find each garment's colour",
  score: "Score the outfit (explainable rules)",
  decide: "Decide: buy or fix",
  tryon: "Try the outfit on, layer by layer",
  recolor: "Find a better colour on you",
  rescue: "Rescue with makeup",
  tips: "Write your makeup tips",
  explain: "Write the verdict",
};

export interface AgentEvent {
  step: StepId;
  status: "running" | "done" | "error" | "skipped";
  api?: string;
  detail?: string;
}
