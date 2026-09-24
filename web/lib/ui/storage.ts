// Every localStorage access in the app goes through here. A browser can refuse a
// write (a private window, a full quota, storage disabled by policy); the modules
// carry on in memory, and this is the one place that knows it happened, so the
// Shell can say what will not survive a reload instead of the loss being silent.
// No "use client": the helpers are plain functions that server modules, tests and
// client modules can all import; only the hook touches React.
import { useSyncExternalStore } from "react";

export interface StorageStatus {
  /** a write was refused and the warning has not been dismissed since */
  failed: boolean;
  /** every key whose write was refused during this page load, first failure first */
  keys: string[];
}

const NONE: StorageStatus = { failed: false, keys: [] };
const failedKeys: string[] = [];
let dismissed = false;
let snapshot: StorageStatus = NONE;
const listeners = new Set<() => void>();

function publish() {
  snapshot = { failed: failedKeys.length > 0 && !dismissed, keys: [...failedKeys] };
  for (const f of listeners) f();
}

/**
 * A refused write. writeLS / removeLS call it; a module with its own persistence
 * path can too. The same key failing again is not news (the draft saves on every
 * keystroke), so it does not undo a dismissal; a key that has not failed before does.
 */
export function markStorageFailed(key: string): void {
  if (failedKeys.includes(key)) return;
  failedKeys.push(key);
  dismissed = false;
  publish();
}

/** Hides the warning for this page load; the next failure of a new key shows it again. */
export function dismissStorageWarning(): void {
  if (dismissed || failedKeys.length === 0) return;
  dismissed = true;
  publish();
}

/** The current status outside React (tests, non-hook callers). */
export const getStorageStatus = (): StorageStatus => snapshot;
const getServerStatus = (): StorageStatus => NONE;
function subscribe(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** For the Shell banner: `failed` is true while a refused write is waiting to be seen. */
export function useStorageFailed(): StorageStatus {
  return useSyncExternalStore(subscribe, getStorageStatus, getServerStatus);
}

/** null on the server, when the key is absent, and when the browser refuses reads. */
export function readLS(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True when the value is stored. False on the server (nothing to store into) and when the browser refused, which is recorded. */
export function writeLS(key: string, value: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    markStorageFailed(key);
    return false;
  }
}

/** A refused removal is recorded too: what is stored would come back on reload, contrary to what the page shows. */
export function removeLS(key: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    markStorageFailed(key);
    return false;
  }
}
