import { deriveTimeQuality, normalizeSourceTime, type TimeQuality } from './time.ts';

export type MetadataConfig = {
  /**
   * `air` — the hostingradio.ru / emgsound.ru air-log JSON that sits next to an
   * HLS playlist (`…/<channel>/metadata.json`): `{ generatedTime, previous[],
   * current, next[] }` with exact `startTime` (ISO with offset) and a numeric
   * item `type` (1 advert, 2 station ID/jingle, 3 music, 4 programme).
   */
  type: 'none' | 'icy' | 'json' | 'html' | 'hls' | 'air' | 'unknown';
  url: string | null;
  historyAvailable: boolean | null;
  notes?: string;
};

export type NowPlayingKind = 'music' | 'program' | 'talk' | 'jingle' | 'advert' | 'unknown';

export const NOW_PLAYING_KINDS: readonly NowPlayingKind[] = ['music', 'program', 'talk', 'jingle', 'advert', 'unknown'];

/** Metadata types this client can read. Everything else is treated as "no metadata". */
export const SUPPORTED_METADATA_TYPES: readonly MetadataConfig['type'][] = ['json', 'html', 'air'];

export function isSupportedMetadata(metadata: MetadataConfig | null | undefined): metadata is MetadataConfig & { url: string } {
  return !!metadata?.url && SUPPORTED_METADATA_TYPES.includes(metadata.type);
}

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
  /** Cover art of the current item, when the source provides one. */
  coverUrl?: string | null;
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

/** Keys that hold past/future items; their fields must never fill the current item. */
const NON_CURRENT_KEYS = new Set(['prev_tracks', 'previous', 'prev', 'history', 'next_tracks', 'next', 'last_tracks', 'playlist']);

function firstString(root: unknown, keys: string[]): string {
  // Prefer the current on-air item; never mistake a previous track for Now Playing.
  const queue: unknown[] = [root]; const visited = new Set<unknown>();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    for (const key of keys) { const found = text(record[key]); if (found) return found; }
    for (const [childKey, child] of Object.entries(record)) if (child && typeof child === 'object' && !NON_CURRENT_KEYS.has(childKey)) queue.push(child);
  }
  return '';
}

function splitCombined(value: string): { artist: string; title: string } {
  const match = value.match(/^\s*(.+?)\s+[–—-]\s+(.+?)\s*$/);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { artist: '', title: value.trim() };
}

function inferKind(artist: string, title: string, explicit = ''): NowPlayingKind {
  const value = `${explicit} ${artist} ${title}`.toLocaleLowerCase();
  if (/^\s*реклама\s*$|advert/.test(`${artist} ${title}`.toLocaleLowerCase()) || /advert/.test(explicit.toLocaleLowerCase())) return 'advert';
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
  fields: { artist: string; title: string; kind?: NowPlayingKind; rawTime?: unknown; coverUrl?: string | null },
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
    ...(fields.coverUrl ? { coverUrl: fields.coverUrl } : {}),
  };
}

const AIR_KINDS: Record<number, NowPlayingKind> = { 1: 'advert', 2: 'jingle', 3: 'music', 4: 'program' };

function httpsUrl(value: unknown): string | null {
  const candidate = text(value);
  return /^https:\/\//i.test(candidate) ? candidate : null;
}

/**
 * hostingradio.ru / emgsound.ru air log. Only `current` is Now Playing; the
 * `previous`/`next` lists are never used as a substitute, so an empty or
 * missing current item yields "no metadata" instead of a stale track.
 */
export function normalizeAir(data: unknown, source: string, context: MetadataContext = {}): NormalizedTrack | null {
  const root = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  const current = root?.current && typeof root.current === 'object' ? root.current as Record<string, unknown> : null;
  if (!current) return null;
  const artist = text(current.artist);
  const title = text(current.title);
  if (!artist && !title) return null;
  const numericType = typeof current.type === 'number' ? current.type : Number(current.type);
  const kind = AIR_KINDS[numericType] ?? inferKind(artist, title);
  const coverUrl = httpsUrl(current.coverImageUrl300) ?? httpsUrl(current.coverImageUrl600) ?? httpsUrl(current.coverImageUrl100);
  return buildTrack({ artist, title, kind, rawTime: current.startTime ?? null, coverUrl }, source, context);
}

function normalizeByType(metadata: MetadataConfig, body: string, context: MetadataContext): NormalizedTrack | null {
  const source = metadata.url ?? 'unknown';
  if (metadata.type === 'html') return normalizeHtml(body, source, context);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  return metadata.type === 'air' ? normalizeAir(parsed, source, context) : normalizeJson(parsed, source, context);
}

function normalizeJson(data: unknown, source: string, context: MetadataContext): NormalizedTrack | null {
  // Providers may include prev_tracks/history alongside the current item.
  // Resolve current first, rather than breadth-first scanning into history.
  const root = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  const current = root?.current ?? root?.now_playing ?? root?.nowPlaying ?? root?.current_track ?? root?.currentTrack ?? root?.track ?? root?.data ?? data;
  const artist = firstString(current, ['artist', 'artistName', 'performer', 'singer']);
  let title = firstString(current, ['title', 'trackName', 'song', 'songName', 'name', 'program', 'programme', 'show']);
  let finalArtist = artist;
  const combined = firstString(current, ['songtitle', 'streamTitle', 'nowPlaying']);
  if ((!finalArtist || !title) && combined) { const parsed = splitCombined(combined); finalArtist ||= parsed.artist; title ||= parsed.title; }
  if (!finalArtist && !title) return null;
  let rawTime: string | null = firstString(current, ['startedAt', 'startTime', 'start_at', 'timestamp']) || null;
  if (!rawTime) {
    // fmgid-style payloads split the station-local start into `date` + `time`.
    const date = firstString(current, ['date']); const clock = firstString(current, ['time']);
    rawTime = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{1,2}:\d{2}(:\d{2})?$/.test(clock) ? `${date}T${clock.split(':')[0].length === 1 ? `0${clock}` : clock}` : (clock || date || null);
  }
  const explicitKind = firstString(current, ['type', 'kind', 'contentType', 'category']);
  return buildTrack({ artist: finalArtist, title, kind: inferKind(finalArtist, title, explicitKind), rawTime }, source, context);
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
  if (!isSupportedMetadata(metadata)) return null;
  const response = await fetch(metadata.url, { cache: 'no-store' });
  // The air service answers 404 while the current item is unknown (adverts
  // between songs, a channel with no log): that is "nothing on air", not a fault.
  if (metadata.type === 'air' && response.status === 404) return null;
  if (!response.ok) throw new Error(`METADATA_HTTP_${response.status}`);
  return normalizeByType(metadata, await response.text(), context);
}

export async function probeMetadata(metadata: MetadataConfig, timeoutMs = 8000, context: MetadataContext = {}): Promise<MetadataProbeResult> {
  if (!metadata.url) return { ok: false, track: null, error: 'NO_METADATA_URL' };
  if (!isSupportedMetadata(metadata)) return { ok: false, track: null, error: `UNSUPPORTED_${metadata.type.toUpperCase()}` };
  const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(metadata.url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return { ok: false, track: null, error: `HTTP_${response.status}` };
    const track = normalizeByType(metadata, await response.text(), context);
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
