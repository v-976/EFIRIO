import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNowPlaying, trackKey, watchNowPlaying, type MetadataConfig, type NormalizedTrack } from '../src/metadata.ts';

const originalFetch = globalThis.fetch;

function serve(payload: unknown): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

const config: MetadataConfig = { type: 'json', url: 'https://example.org/now-playing', historyAvailable: true };
const moscow = { timeZone: 'Europe/Moscow' };

test('normalizes a source local time without offset in the station time zone', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  serve({ artist: 'Artist', title: 'Song', time: '2026-10-08T14:30:00' });
  const track = await fetchNowPlaying(config, moscow);
  assert.ok(track);
  assert.equal(track.startedAt, '2026-10-08T11:30:00.000Z');
  assert.equal(track.timeQuality, 'exact');
  assert.equal(track.timeZone, 'Europe/Moscow');
  assert.match(track.detectedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('normalizes an absolute source timestamp to UTC', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  serve({ artist: 'Artist', title: 'Song', timestamp: '2026-10-08T14:30:00+03:00' });
  const track = await fetchNowPlaying(config, moscow);
  assert.ok(track);
  assert.equal(track.startedAt, '2026-10-08T11:30:00.000Z');
  assert.equal(track.timeQuality, 'exact');
});

test('keeps a bare wall-clock time without inventing a date', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  serve({ artist: 'Artist', title: 'Song', time: '14:30' });
  const track = await fetchNowPlaying(config, moscow);
  assert.ok(track);
  assert.equal(track.startedAt, null);
  assert.equal(track.sourceLocalTime, '14:30');
  assert.equal(track.timeQuality, 'local-only');
});

test('marks unusable source times as detected', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  serve({ artist: 'Artist', title: 'Song', time: 'сегодня в 14:30' });
  const track = await fetchNowPlaying(config, moscow);
  assert.ok(track);
  assert.equal(track.startedAt, null);
  assert.equal(track.sourceLocalTime, null);
  assert.equal(track.timeQuality, 'detected');
  assert.ok(!Number.isNaN(Date.parse(track.detectedAt)));
});

test('works without a time context, keeping the catalogue config compatible', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  serve({ artist: 'Artist', title: 'Song', time: '2026-10-08T14:30:00' });
  const track = await fetchNowPlaying(config);
  assert.ok(track);
  assert.equal(track.timeZone, null);
  assert.equal(track.startedAt, null, 'a local value must not be converted without a station zone');
  assert.equal(track.timeQuality, 'local-only');

  const untouched = await fetchNowPlaying({ type: 'none', url: null, historyAvailable: null });
  assert.equal(untouched, null);
});

test('classifies air item kinds', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const cases: Array<[Record<string, unknown>, NormalizedTrack['kind']]> = [
    [{ artist: 'Queen', title: 'Radio Ga Ga' }, 'music'],
    [{ program: 'Утренний шоу с Анной' }, 'program'],
    [{ artist: 'Позывные', title: 'Эфир 12' }, 'jingle'],
    [{ artist: 'Ведущая', title: 'Разговор о погоде' }, 'talk'],
    [{ artist: '', title: '—' }, 'unknown'],
  ];
  for (const [payload, expected] of cases) {
    serve(payload);
    const track = await fetchNowPlaying(config, moscow);
    assert.ok(track, JSON.stringify(payload));
    assert.equal(track.kind, expected, JSON.stringify(payload));
  }
});

test('identical items share a key while different items do not', () => {
  const one = trackKey({ kind: 'music', artist: 'Queen', title: 'Radio Ga Ga' });
  const repeated = trackKey({ kind: 'music', artist: 'Queen', title: 'Radio Ga Ga' });
  const otherTitle = trackKey({ kind: 'music', artist: 'Queen', title: 'Bohemian Rhapsody' });
  const otherKind = trackKey({ kind: 'program', artist: 'Queen', title: 'Radio Ga Ga' });
  assert.equal(one, repeated);
  assert.notEqual(one, otherTitle);
  assert.notEqual(one, otherKind);
});

// --- Session liveness: a superseded station must not receive late responses (review remark 3) ---

type WatchHandle = { settle: (value: Response) => void; delivered: NormalizedTrack[]; errors: unknown[] };
type AfterHook = { after(fn: () => void): void };

function startWatch(t: AfterHook, isActive: () => boolean): WatchHandle {
  let settle: (value: Response) => void = () => {};
  globalThis.fetch = (() => new Promise<Response>((resolve) => { settle = resolve; })) as typeof fetch;
  // `watchNowPlaying` uses the DOM timer API; Node provides the same functions.
  const hadWindow = 'window' in globalThis;
  (globalThis as { window?: unknown }).window = globalThis;
  const delivered: NormalizedTrack[] = [];
  const errors: unknown[] = [];
  const stop = watchNowPlaying(config, { timeZone: 'Europe/Moscow', isActive }, (track) => { if (track) delivered.push(track); }, (error) => { errors.push(error); });
  t.after(() => {
    stop();
    globalThis.fetch = originalFetch;
    if (!hadWindow) delete (globalThis as { window?: unknown }).window;
  });
  return { settle, delivered, errors };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a superseded session never receives a late metadata response', async (t) => {
  let active = true;
  const watch = startWatch(t, () => active);

  active = false; // chooseStation invalidated the session while the request was in flight
  watch.settle(new Response(JSON.stringify({ artist: 'Stale', title: 'Previous station track' }), { status: 200 }));
  await flush();
  assert.equal(watch.delivered.length, 0, 'a stale response must not reach Now Playing / Media Session / history');
  assert.deepEqual(watch.errors, []);
});

test('a superseded session never receives a late metadata error', async (t) => {
  let active = true;
  const watch = startWatch(t, () => active);

  active = false;
  watch.settle(new Response('denied', { status: 500 }));
  await flush();
  assert.equal(watch.errors.length, 0, 'a stale error must not overwrite the status of the new station');
  assert.equal(watch.delivered.length, 0);
});

test('an active session still receives metadata responses', async (t) => {
  const watch = startWatch(t, () => true);
  watch.settle(new Response(JSON.stringify({ artist: 'Current', title: 'Station track' }), { status: 200 }));
  await flush();
  assert.equal(watch.delivered.length, 1, 'normal delivery must stay intact');
  assert.equal(watch.delivered[0].title, 'Station track');
  assert.deepEqual(watch.errors, []);
});
