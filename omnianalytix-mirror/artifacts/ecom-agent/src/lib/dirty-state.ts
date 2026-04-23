/**
 * Lightweight, app-wide registry of "dirty" view state. Pages can register
 * a key (e.g. "tasks-filter", "draft-task") when they hold unsaved changes,
 * and clear it when the change is persisted or discarded. Sign-out and other
 * destructive transitions check `hasDirtyState()` before proceeding.
 *
 * Intentionally tiny — no React context, no localStorage. Lives in-memory for
 * the lifetime of the SPA session.
 */

const dirtyKeys = new Set<string>();

export function markDirty(key: string): void {
  dirtyKeys.add(key);
}

export function clearDirty(key: string): void {
  dirtyKeys.delete(key);
}

export function hasDirtyState(): boolean {
  return dirtyKeys.size > 0;
}

export function listDirtyKeys(): string[] {
  return Array.from(dirtyKeys);
}

export function clearAllDirty(): void {
  dirtyKeys.clear();
}
