import { deriveTimeQuality, normalizeSourceTime, type TimeQuality } from './time.ts';

export type MetadataConfig = {
  type: 'none' | 'icy' | 'json' | 'html' | 'hls' | 'unknown';
  url: string | null;
  historyAvailable: boolean | null;
  notes?: string;
};

export type NowPlayingKind = 'music' | 'program' | 'talk' | 'jingle' | 'unknown';

export const NOW_PLAYING_KINDS: readonly NowPlayingKind[] = ['music', 'program', 'talk', 'jingle', 'unknown'];

export type NormalizedTrack = {
  artist: string;
  title: string;
  kind: NowPlayingKind;
  /** ISO 8601 UTC instant of the real start, only when the source determines one. */
  startedAt: string | null;
  /** ISO 8601 UTC instant at which EFIRIO observed the item. */
  detectedAt: string;
  /** Raw station-local value kept while no absolute instant can be derived. */
  sourceLocalTime: string | null;
  /** IANA time zone of the source (city/station), never the device zone. */
  timeZone: string | null;
  timeQuality: TimeQuality;
  source: string;
};

/**
 * Per-session request context: the station time zone plus session liveness.
 * Keeps `MetadataConfig` catalogue-compatible; `isActive` lets a superseded
 * session (station switch) reject responses that settle too late.
 */
export type MetadataContext = { timeZone?: string | null; isActive?: () => boolean };

export type MetadataProbeResult = {
  ok: boolean;
  track: NormalizedTrack | null;
  error: string | null;
};

const POLL_MS = 15000;

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function firstString(root: unknown, keys: string[]): string {
  const queue: unknown[] = [root]; const visited = new Set<unknown>();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    for (const key of keys) { const found = text(record[key]); if (found) return found; }
    for (const child of Object.values(record)) if (child && typeof child === 'object') queue.push(child);
  }
  return '';
}

function splitCombined(value: string): { artist: string; title: string } {
  const match = value.match(/^\s*(.+?)\s+[–—-]\s+(.+?)\s*$/);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { artist: '', title: value.trim() };
}

function inferKind(artist: string, title: string, explicit = ''): NowPlayingKind {
  const value = `${explicit} ${artist} ${title}`.toLocaleLowerCase();
  if (/jingle|джингл|позывн/.test(value)) return 'jingle';
  if (/program|programme|show|podcast|программ|шоу|новост|анекдот|stand.?up|стендап|квн|однажды|сатья|юмор/.test(value)) return 'program';
  if (/talk|speech|разговор|интервью|ведущ/.test(value)) return 'talk';
  if (artist && title) return 'music';
  return 'unknown';
}

export function normalizeKind(value: unknown): NowPlayingKind {
  return typeof value === 'string' && (NOW_PLAYING_KINDS as readonly string[]).includes(value)
    ? (value as NowPlayingKind)
    : 'unknown';
}

function buildTrack(
  fields: { artist: string; title: string; kind?: NowPlayingKind; rawTime?: unknown },
  source: string,
  context: MetadataContext,
): NormalizedTrack {
  const time = normalizeSourceTime(fields.rawTime, context.timeZone);
  const timeZone = typeof context.timeZone === 'string' && context.timeZone.trim() ? context.timeZone.trim() : null;
  return {
    artist: fields.artist,
    title: fields.title,
    kind: fields.kind ?? inferKind(fields.artist, fields.title),
    startedAt: time.startedAt,
    detectedAt: new Date().toISOString(),
    sourceLocalTime: time.sourceLocalTime,
    timeZone,
    timeQuality: deriveTimeQuality(time.startedAt, time.sourceLocalTime),
    source,
  };
}

function normalizeJson(data: unknown, source: string, context: MetadataContext): NormalizedTrack | null {
  let artist = firstString(data, ['artist', 'artistName', 'performer', 'singer']);
  let title = firstString(data, ['title', 'track', 'trackName', 'song', 'songName', 'name', 'program', 'programme', 'show']);
  const combined = firstString(data, ['songtitle', 'streamTitle', 'nowPlaying', 'current']);
  if ((!artist || !title) && combined) { const parsed = splitCombined(combined); artist ||= parsed.artist; title ||= parsed.title; }
  if (!artist && !title) return null;
  const rawTime = firstString(data, ['startedAt', 'startTime', 'start_at', 'time', 'timestamp']) || null;
  const explicitKind = firstString(data, ['type', 'kind', 'contentType', 'category']);
  return buildTrack({ artist, title, kind: inferKind(artist, title, explicitKind), rawTime }, source, context);
}

function normalizeHtml(html: string, source: string, context: MetadataContext): NormalizedTrack | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const candidates = Array.from(doc.querySelectorAll('[data-artist], [data-title], .track, .song, .playlist-item, .program, .show, li'));
  for (const node of candidates) {
    const element = node as HTMLElement;
    const artist = text(element.dataset.artist) || text(element.querySelector('.artist, [class*=artist]')?.textContent);
    const title = text(element.dataset.title) || text(element.querySelector('.title, [class*=title], [class*=track], [class*=program], [class*=show]')?.textContent);
    if (artist || title) return buildTrack({ artist, title }, source, context);
  }
  const body = text(doc.body?.textContent); const match = body.match(/([^\n]{2,80})\s+[–—-]\s+([^\n]{2,120})/);
  if (!match) return null;
  const artist = match[1].trim(); const title = match[2].trim();
  return buildTrack({ artist, title }, source, context);
}

export async function fetchNowPlaying(metadata: MetadataConfig, context: MetadataContext = {}): Promise<NormalizedTrack | null> {
  if (!metadata.url || !['json', 'html'].includes(metadata.type)) return null;
  const response = await fetch(metadata.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`METADATA_HTTP_${response.status}`);
  if (metadata.type === 'json') return normalizeJson(await response.json(), metadata.url, context);
  return normalizeHtml(await response.text(), metadata.url, context);
}

export async function probeMetadata(metadata: MetadataConfig, timeoutMs = 8000, context: MetadataContext = {}): Promise<MetadataProbeResult> {
  if (!metadata.url) return { ok: false, track: null, error: 'NO_METADATA_URL' };
  if (!['json', 'html'].includes(metadata.type)) return { ok: false, track: null, error: `UNSUPPORTED_${metadata.type.toUpperCase()}` };
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(metadata.url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return { ok: false, track: null, error: `HTTP_${response.status}` };
    const track = metadata.type === 'json' ? normalizeJson(await response.json(), metadata.url, context) : normalizeHtml(await response.text(), metadata.url, context);
    return track ? { ok: true, track, error: null } : { ok: false, track: null, error: 'NO_TRACK_PARSED' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, track: null, error: 'TIMEOUT' };
    if (error instanceof TypeError) return { ok: false, track: null, error: 'FETCH_OR_CORS' };
    return { ok: false, track: null, error: error instanceof Error ? error.name : 'METADATA_ERROR' };
  } finally { window.clearTimeout(timer); }
}

export function watchNowPlaying(metadata: MetadataConfig, context: MetadataContext, onTrack: (track: NormalizedTrack | null) => void, onError?: (error: unknown) => void): () => void {
  let stopped = false;
  // A response that settles after the session was superseded (e.g. a station
  // switch before React runs effect cleanup) must not reach the UI, the Media
  // Session or the history of the newly selected station.
  const deliverable = () => !stopped && context.isActive?.() !== false;
  const poll = async () => { try { const track = await fetchNowPlaying(metadata, context); if (deliverable()) onTrack(track); } catch (error) { if (deliverable()) onError?.(error); } };
  void poll(); const timer = window.setInterval(() => void poll(), POLL_MS);
  return () => { stopped = true; window.clearInterval(timer); };
}

export function contentKey(kind: NowPlayingKind, artist: string, title: string): string {
  return `${kind}\u0000${artist}\u0000${title}`.toLocaleLowerCase();
}

export function trackKey(track: Pick<NormalizedTrack, 'kind' | 'artist' | 'title'>): string {
  return contentKey(track.kind, track.artist, track.title);
}
