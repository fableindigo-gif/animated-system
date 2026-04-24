/**
 * Shared event channel for "only one floating layer at a time" behavior
 * across the app shell (profile dropdown) and the dashboard FilterBar
 * popovers (Search dimensions / Thresholds / Saved Views).
 *
 * Each layer dispatches `FLOATING_LAYER_EVENT` with `detail.source` set to
 * its own constant when it opens, and listens for the same event on
 * `window` to close itself when *another* source opens. The two callers
 * don't import each other — they just both import the constants from
 * this module so the event name and source identifiers can never drift.
 *
 * See task #25.
 */

export const FLOATING_LAYER_EVENT = "omni:floating-layer-open" as const;

export type FloatingLayerSource = "profile" | "filter-bar";

export interface FloatingLayerEventDetail {
  source: FloatingLayerSource;
}

export function dispatchFloatingLayerOpen(source: FloatingLayerSource): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<FloatingLayerEventDetail>(FLOATING_LAYER_EVENT, {
      detail: { source },
    }),
  );
}
