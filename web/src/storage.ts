/**
 * Storage access that never throws.
 *
 * Safari private mode, blocked cookies and quota exhaustion make even the
 * `localStorage` getter or `setItem` throw. Selection and playback code must
 * keep working when persistence is unavailable.
 */

/** Runs a storage read; returns null instead of throwing. */
export function safeGetItem(read: () => string | null): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** Runs a storage write; reports success instead of throwing. */
export function safeSetItem(write: () => void): boolean {
  try {
    write();
    return true;
  } catch {
    return false;
  }
}
