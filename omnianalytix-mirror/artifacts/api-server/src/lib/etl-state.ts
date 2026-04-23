export interface EtlProgress {
  status: "idle" | "running" | "complete" | "error";
  startedAt: number | null;
  completedAt: number | null;
  phase: string;
  pct: number;
  rowsExtracted: number;
  lastResult: {
    shopify: number;
    googleAds: number;
    mapping: number;
    durationMs: number;
  } | null;
  lastError: string | null;
}

export const etlState: EtlProgress = {
  status: "idle",
  startedAt: null,
  completedAt: null,
  phase: "idle",
  pct: 0,
  rowsExtracted: 0,
  lastResult: null,
  lastError: null,
};
