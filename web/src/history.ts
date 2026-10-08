/**
 * Local listening history for EFIRIO.
 *
 * Responsibilities:
 * - own the `efirio.trackHistory.v1` localStorage payload (load/save/migrate);
 * - survive corrupted legacy records without losing the healthy ones;
 * - keep at most HISTORY_LIMIT entries no older than HISTORY_MAX_AGE_MS,
 *   measured by `detectedAt` (when EFIRIO actually observed the item);
 * - gate writes behind confirmed playback of the currently selected station.
 *
 * History stays on the device: no telemetry, no network.
 */

import { contentKey, normalizeKind, type NormalizedTrack, type NowPlayingKind } from './metadata.ts';
import { deriveTimeQuality, formatInTimeZone, isValidTimeZone, parseUtcInstant, type TimeQuality } from './time.ts';

export const HISTORY_STORAGE_KEY = 'efirio.trackHistory.v1';
/** Retention cap 1: number of stored entries. */
export const HISTORY_LIMIT = 100;
/** Retention cap 2: entries older than 48 hours (by `detectedAt`) are dropped. */
export const HISTORY_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type HistoryItem = {
  stationId: string;
  stationName: string;
  artist: string;
  title: string;
  kind: NowPlayingKind;
  /** ISO 8601 UTC, only when the source determined the real start. */
  startedAt: string | null;
  /** ISO 8601 UTC, moment EFIRIO observed the item. */
  detectedAt: string;
  sourceLocalTime: string | null;
  timeZone: string | null;
  timeQuality: TimeQuality;
  source: string;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type LoadHistoryOptions = {
  defaultTimeZone?: string | null;
  limit?: number;
  /** Retention cut-off reference; defaults to Date.now(). */
  now?: number;
  maxAgeMs?: number;
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Converts one stored record into a trustworthy `HistoryItem`.
 * Returns null when the record itself is corrupted; other records are unaffected.
 */
export function sanitizeHistoryItem(raw: unknown, defaultTimeZone?: string | null): HistoryItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const stationId = cleanString(record.stationId);
  if (!stationId) return null;
  const stationName = cleanString(record.stationName) || stationId;

  const title = cleanString(record.title);
  const artist = cleanString(record.artist);
  if (!title && !artist) return null;

  const fallbackZone = isValidTimeZone(defaultTimeZone) ? defaultTimeZone.trim() : null;
  const zone = isValidTimeZone(record.timeZone) ? record.timeZone.trim() : fallbackZone;

  // Legacy records stored the raw source string in `startedAt`; only a strict
  // ISO instant may stay there, anything else is demoted to `sourceLocalTime`.
  const claimedStartedAt = parseUtcInstant(record.startedAt);
  let sourceLocalTime = cleanString(record.sourceLocalTime) || null;
  if (!claimedStartedAt && !sourceLocalTime) {
    const legacyRaw = cleanString(record.startedAt);
    if (legacyRaw) sourceLocalTime = legacyRaw;
  }

  const startedAt = claimedStartedAt;
  // Retention is measured by `detectedAt`, so a record without a valid
  // detection instant cannot be aged out and is removed as corrupted.
  const detectedAt = parseUtcInstant(record.detectedAt);
  if (!detectedAt) return null;

  return {
    stationId,
    stationName,
    artist,
    title,
    kind: normalizeKind(record.kind),
    startedAt,
    detectedAt,
    sourceLocalTime,
    timeZone: zone,
    timeQuality: deriveTimeQuality(startedAt, sourceLocalTime),
    source: cleanString(record.source) || 'unknown',
  };
}

/**
 * Applies both retention limits at once: entries strictly older than
 * `maxAgeMs` by `detectedAt` are dropped, then the result is capped to the
 * newest `limit` entries. Records with an unparseable `detectedAt` are dropped
 * instead of being guessed. Input order (newest first) is preserved.
 */
export function pruneHistory(items: readonly HistoryItem[], options: { now?: number; limit?: number; maxAgeMs?: number } = {}): HistoryItem[] {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? HISTORY_LIMIT;
  const maxAgeMs = options.maxAgeMs ?? HISTORY_MAX_AGE_MS;
  const kept: HistoryItem[] = [];
  for (const item of items) {
    const detectedMs = Date.parse(item.detectedAt);
    if (!Number.isFinite(detectedMs)) continue; // corrupted timestamp — remove
    if (now - detectedMs > maxAgeMs) continue; // older than the retention window
    kept.push(item);
    if (kept.length >= limit) break;
  }
  return kept;
}

/**
 * Loads history defensively: broken JSON, a non-array payload or individual
 * corrupted entries never throw and never discard the healthy records.
 * Retention (48 hours + 100 entries) is enforced during loading.
 */
export function loadHistory(raw: unknown, options: LoadHistoryOptions = {}): HistoryItem[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const limit = options.limit ?? HISTORY_LIMIT;
  const items: HistoryItem[] = [];
  for (const entry of parsed) {
    const item = sanitizeHistoryItem(entry, options.defaultTimeZone);
    if (item) items.push(item);
  }
  return pruneHistory(items, { now: options.now, limit, maxAgeMs: options.maxAgeMs });
}

export function serializeHistory(items: readonly HistoryItem[]): string {
  return JSON.stringify(items);
}

export function historyItemKey(item: Pick<HistoryItem, 'kind' | 'artist' | 'title'>): string {
  return contentKey(item.kind, item.artist, item.title);
}

/** Station-local rendering: exact instant → raw local value → detection time. */
export function historyTimeLabel(item: HistoryItem): string {
  if (item.timeQuality === 'exact' && item.startedAt) return formatInTimeZone(item.startedAt, item.timeZone, { withDate: true });
  if (item.sourceLocalTime) return item.sourceLocalTime;
  return formatInTimeZone(item.detectedAt, item.timeZone, { withDate: true });
}

/** HAVE_CURRENT_DATA: the lowest state at which playback can actually proceed. */
export const HAVE_CURRENT_DATA = 2;

/** Audio-element snapshot captured when a `playing` event is handled. */
export type PlayingEventState = {
  /** Playback intent of the current session (false after pause/stop). */
  shouldPlay: boolean;
  /** `audio.paused` at event time. */
  paused: boolean;
  /** `audio.readyState` at event time. */
  readyState: number;
  /** Current value of the element's `src` attribute. */
  mediaSrc: string | null;
  /** Stream assigned for the current session; null when it was interrupted. */
  expectedSrc: string | null;
};

/**
 * Decides whether a `playing` event belongs to the current playback session
 * and may open the history gate.
 *
 * `playing` tasks queued before an interruption can be delivered after it, so
 * every late event is rejected: after pause or audit stop (`shouldPlay` is
 * false), after a station switch or cancelled start (the src was removed or
 * reassigned), or while a fresh stream is still buffering (`readyState` too
 * low). Genuine starts — including fallback streams — pass because the
 * assigned stream matches and playback intent is intact.
 */
export function canOpenHistoryOnPlaying(state: PlayingEventState): boolean {
  if (!state.shouldPlay || state.paused) return false;
  if (state.readyState < HAVE_CURRENT_DATA) return false;
  if (!state.expectedSrc || !state.mediaSrc) return false;
  return state.mediaSrc === state.expectedSrc;
}

export type HistoryRecorderOptions = {
  storage?: StorageLike | null;
  storageKey?: string;
  limit?: number;
  defaultTimeZone?: string | null;
  station?: { id: string; name: string } | null;
  now?: () => string;
};

/**
 * Decides *when* an air item may enter the history.
 *
 * A record is written only when:
 * - a station is selected;
 * - playback of that station has been confirmed (`playing` event);
 * - the metadata belongs to the currently selected station (stale responses
 *   from a previously selected station are rejected);
 * - the item differs from the last recorded one for this listening session.
 */
export class HistoryRecorder {
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly limit: number;
  private readonly defaultTimeZone: string | null;
  private readonly now: () => string;
  private readonly listeners = new Set<(items: HistoryItem[]) => void>();
  private entries: HistoryItem[];
  private station: { id: string; name: string } | null;
  private playing = false;
  private lastKey: string | null;

  constructor(options: HistoryRecorderOptions = {}) {
    this.storage = options.storage ?? null;
    this.storageKey = options.storageKey ?? HISTORY_STORAGE_KEY;
    this.limit = options.limit ?? HISTORY_LIMIT;
    this.defaultTimeZone = isValidTimeZone(options.defaultTimeZone) ? options.defaultTimeZone.trim() : null;
    this.now = options.now ?? (() => new Date().toISOString());
    const stored = this.readStored();
    this.entries = stored.items;
    // Cleanup at load time: rewrite the payload when retention or sanitizing
    // actually changed it (also heals broken/legacy payloads).
    if (stored.raw !== null && serializeHistory(this.entries) !== stored.raw) this.persist();
    this.station = options.station ?? null;
    this.lastKey = this.lastKeyForStation(this.station?.id ?? null);
  }

  get list(): HistoryItem[] {
    return [...this.entries];
  }

  subscribe(listener: (items: HistoryItem[]) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Selecting a station ends the previous listening session. */
  selectStation(station: { id: string; name: string } | null): void {
    this.station = station ? { id: station.id, name: station.name } : null;
    this.playing = false;
    this.lastKey = this.lastKeyForStation(this.station?.id ?? null);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  currentStationId(): string | null {
    return this.station?.id ?? null;
  }

  /** Returns the updated list when a record was written, otherwise null. */
  handleMetadata(track: NormalizedTrack | null | undefined, stationId: string): HistoryItem[] | null {
    if (!track || !this.playing || !this.station || !stationId) return null;
    if (stationId !== this.station.id) return null; // stale response of a previous station

    const title = cleanString(track.title);
    const artist = cleanString(track.artist);
    if (!title && !artist) return null;

    const key = contentKey(track.kind, artist, title);
    if (key === this.lastKey) return null; // repeated answer, no duplicate
    this.lastKey = key;

    const startedAt = parseUtcInstant(track.startedAt);
    const sourceLocalTime = cleanString(track.sourceLocalTime) || null;
    const detectedAt = parseUtcInstant(track.detectedAt) ?? startedAt ?? this.now();
    const timeZone = isValidTimeZone(track.timeZone) ? track.timeZone.trim() : this.defaultTimeZone;

    const item: HistoryItem = {
      stationId: this.station.id,
      stationName: this.station.name,
      artist,
      title,
      kind: normalizeKind(track.kind),
      startedAt,
      detectedAt,
      sourceLocalTime,
      timeZone,
      timeQuality: deriveTimeQuality(startedAt, sourceLocalTime),
      source: cleanString(track.source) || 'unknown',
    };

    // Cleanup on insert: enforce 48 hours + 100 entries after every write.
    this.entries = pruneHistory([item, ...this.entries], { now: Date.parse(this.now()), limit: this.limit });
    this.persist();
    this.emit();
    return this.list;
  }

  private lastKeyForStation(stationId: string | null): string | null {
    if (!stationId) return null;
    const newest = this.entries.find((entry) => entry.stationId === stationId);
    return newest ? historyItemKey(newest) : null;
  }

  private readStored(): { items: HistoryItem[]; raw: string | null } {
    if (!this.storage) return { items: [], raw: null };
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch {
      return { items: [], raw: null };
    }
    return { items: loadHistory(raw, { defaultTimeZone: this.defaultTimeZone, limit: this.limit, now: Date.parse(this.now()) }), raw };
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, serializeHistory(this.entries));
    } catch {
      // Quota or private-mode failure must not break playback or the UI.
    }
  }

  private emit(): void {
    const snapshot = this.list;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A single failing subscriber must not block the others.
      }
    }
  }
}
