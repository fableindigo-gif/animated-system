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
  /**
   * Timestamp of the very first successful sync completion for this process.
   * Stays null until the warehouse transitions from "no rows ever ingested"
   * to "has rows". Used by the front-end to celebrate first value (the
   * "first-insight hero" banner on Home) and by the API server as the
   * extension point where a transactional welcome / first-sync email would
   * be enqueued (no SMTP layer wired yet — see logger.info in
   * routes/etl/index.ts where the structured `first_sync_completed` event
   * is emitted).
   */
  firstCompletedAt: number | null;
  /**
   * True only on the *current* completed run if it was the first sync the
   * tenant ever finished. Cleared at the start of every subsequent run.
   * Drives the UI "Welcome — your first sync just finished" celebration.
   */
  wasFirstSync: boolean;
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
  firstCompletedAt: null,
  wasFirstSync: false,
};
