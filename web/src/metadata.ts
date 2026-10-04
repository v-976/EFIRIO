export type MetadataConfig = {
  type: 'none' | 'icy' | 'json' | 'html' | 'hls' | 'unknown';
  url: string | null;
  historyAvailable: boolean | null;
  notes?: string;
};

export type NormalizedTrack = {
  artist: string;
  title: string;
  startedAt: string | null;
  detectedAt: string;
  source: string;
};

const POLL_MS = 15000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(root: unknown, keys: string[]): string {
  const queue: unknown[] = [root];
  const visited = new Set<unknown>();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const found = text(record[key]);
      if (found) return found;
    }
    for (const child of Object.values(record)) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return '';
}

function splitCombined(value: string): { artist: string; title: string } {
  const match = value.match(/^\s*(.+?)\s+[–—-]\s+(.+?)\s*$/);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { artist: '', title: value.trim() };
}

function normalizeJson(data: unknown, source: string): NormalizedTrack | null {
  let artist = firstString(data, ['artist', 'artistName', 'performer', 'singer']);
  let title = firstString(data, ['title', 'track', 'trackName', 'song', 'songName', 'name']);
  const combined = firstString(data, ['songtitle', 'streamTitle', 'nowPlaying', 'current']);
  if ((!artist || !title) && combined) {
    const parsed = splitCombined(combined);
    artist ||= parsed.artist;
    title ||= parsed.title;
  }
  if (!artist && !title) return null;
  const startedAt = firstString(data, ['startedAt', 'startTime', 'start_at', 'time', 'timestamp']) || null;
  return { artist, title, startedAt, detectedAt: new Date().toISOString(), source };
}

function normalizeHtml(html: string, source: string): NormalizedTrack | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const candidates = Array.from(doc.querySelectorAll('[data-artist], [data-title], .track, .song, .playlist-item, li'));
  for (const node of candidates) {
    const element = node as HTMLElement;
    const artist = text(element.dataset.artist) || text(element.querySelector('.artist, [class*=artist]')?.textContent);
    const title = text(element.dataset.title) || text(element.querySelector('.title, [class*=title], [class*=track]')?.textContent);
    if (artist || title) return { artist, title, startedAt: null, detectedAt: new Date().toISOString(), source };
  }
  const body = text(doc.body?.textContent);
  const match = body.match(/([^\n]{2,80})\s+[–—-]\s+([^\n]{2,120})/);
  if (!match) return null;
  return { artist: match[1].trim(), title: match[2].trim(), startedAt: null, detectedAt: new Date().toISOString(), source };
}

export async function fetchNowPlaying(metadata: MetadataConfig): Promise<NormalizedTrack | null> {
  if (!metadata.url || !['json', 'html'].includes(metadata.type)) return null;
  const response = await fetch(metadata.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`METADATA_HTTP_${response.status}`);
  if (metadata.type === 'json') return normalizeJson(await response.json(), metadata.url);
  return normalizeHtml(await response.text(), metadata.url);
}

export function watchNowPlaying(
  metadata: MetadataConfig,
  onTrack: (track: NormalizedTrack | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  let stopped = false;
  const poll = async () => {
    try {
      const track = await fetchNowPlaying(metadata);
      if (!stopped) onTrack(track);
    } catch (error) {
      if (!stopped) onError?.(error);
    }
  };
  void poll();
  const timer = window.setInterval(() => void poll(), POLL_MS);
  return () => { stopped = true; window.clearInterval(timer); };
}

export function trackKey(track: NormalizedTrack): string {
  return `${track.artist}\u0000${track.title}`.toLocaleLowerCase();
}
