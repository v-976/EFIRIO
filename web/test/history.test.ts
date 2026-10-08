import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_LIMIT,
  HISTORY_MAX_AGE_MS,
  HISTORY_STORAGE_KEY,
  HistoryRecorder,
  canOpenHistoryOnPlaying,
  historyTimeLabel,
  loadHistory,
  sanitizeHistoryItem,
  type HistoryItem,
  type StorageLike,
} from '../src/history.ts';
import type { NormalizedTrack } from '../src/metadata.ts';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class BrokenStorage implements StorageLike {
  getItem(): string | null { return null; }
  setItem(): void { throw new Error('QUOTA_EXCEEDED'); }
}

function track(overrides: Partial<NormalizedTrack> = {}): NormalizedTrack {
  return {
    artist: 'Artist',
    title: 'Song',
    kind: 'music',
    startedAt: null,
    detectedAt: new Date().toISOString(), // fresh: retention tests must not depend on the run date
    sourceLocalTime: null,
    timeZone: 'Europe/Moscow',
    timeQuality: 'detected',
    source: 'https://example.org/now-playing',
    ...overrides,
  };
}

const stationA = { id: 'station-a', name: 'Station A' };
const stationB = { id: 'station-b', name: 'Station B' };

function recorder(storage: StorageLike = new MemoryStorage()): HistoryRecorder {
  return new HistoryRecorder({ storage, defaultTimeZone: 'Europe/Moscow' });
}

test('a selected but unplayed station never creates history records', () => {
  const storage = new MemoryStorage();
  const history = recorder(storage);
  history.selectStation(stationA);
  history.handleMetadata(track({ title: 'Never played' }), stationA.id);
  assert.equal(history.list.length, 0);
  assert.equal(storage.getItem(HISTORY_STORAGE_KEY), null);
});

test('a station whose playback never starts produces nothing even after metadata', () => {
  const history = recorder();
  history.selectStation(stationA);
  history.setPlaying(false);
  assert.equal(history.handleMetadata(track({ title: 'Connecting' }), stationA.id), null);
  assert.equal(history.list.length, 0);
});

test('recording starts only after confirmed playback', () => {
  const history = recorder();
  history.selectStation(stationA);
  assert.equal(history.handleMetadata(track({ title: 'One' }), stationA.id), null, 'before playback');
  history.setPlaying(true);
  const list = history.handleMetadata(track({ title: 'One' }), stationA.id);
  assert.equal(list?.length, 1);
  assert.equal(list?.[0].title, 'One');
  assert.equal(list?.[0].stationId, stationA.id);
  assert.equal(list?.[0].stationName, stationA.name);
});

test('repeated metadata for the same item does not duplicate records', () => {
  const history = recorder();
  history.selectStation(stationA);
  history.setPlaying(true);
  history.handleMetadata(track({ title: 'One' }), stationA.id);
  assert.equal(history.handleMetadata(track({ title: 'One' }), stationA.id), null);
  assert.equal(history.handleMetadata(track({ title: 'One', detectedAt: '2026-10-08T12:00:15.000Z' }), stationA.id), null);
  assert.equal(history.list.length, 1);
});

test('a new item heard during listening is appended, newest first', () => {
  const history = recorder();
  history.selectStation(stationA);
  history.setPlaying(true);
  history.handleMetadata(track({ title: 'One' }), stationA.id);
  history.handleMetadata(track({ title: 'Two', kind: 'program' }), stationA.id);
  history.handleMetadata(track({ title: 'Three' }), stationA.id);
  assert.deepEqual(history.list.map((item) => item.title), ['Three', 'Two', 'One']);
});

test('nothing is recorded after pause, and resume does not duplicate', () => {
  const history = recorder();
  history.selectStation(stationA);
  history.setPlaying(true);
  history.handleMetadata(track({ title: 'One' }), stationA.id);

  history.setPlaying(false); // pause
  assert.equal(history.handleMetadata(track({ title: 'Two' }), stationA.id), null, 'item received while paused');
  assert.equal(history.list.length, 1);

  history.setPlaying(true); // resume while the same item is still on air
  assert.equal(history.handleMetadata(track({ title: 'One' }), stationA.id), null, 'same item after resume');
  assert.equal(history.list.length, 1);

  history.handleMetadata(track({ title: 'Two' }), stationA.id); // item changed during the pause
  assert.equal(history.list.length, 2);
  assert.equal(history.list[0].title, 'Two');
});

test('stopping playback stops recording', () => {
  const history = recorder();
  history.selectStation(stationA);
  history.setPlaying(true);
  history.handleMetadata(track({ title: 'One' }), stationA.id);
  history.setPlaying(false); // stop
  assert.equal(history.handleMetadata(track({ title: 'Two' }), stationA.id), null);
  assert.equal(history.list.length, 1);
});

test('station switching rejects stale metadata from the previous station', () => {
  const history = recorder();
  history.selectStation(stationA);
  history.setPlaying(true);
  history.handleMetadata(track({ title: 'A-Item' }), stationA.id);

  history.selectStation(stationB); // switch resets the session and playback gate
  assert.equal(history.isPlaying(), false);
  assert.equal(history.handleMetadata(track({ title: 'A-Item-Stale' }), stationA.id), null, 'stale while stopped');
  history.setPlaying(true);
  assert.equal(history.handleMetadata(track({ title: 'A-Item-Stale' }), stationA.id), null, 'stale after replay started');
  assert.equal(history.list.length, 1);

  history.handleMetadata(track({ title: 'B-Item' }), stationB.id);
  assert.equal(history.list.length, 2);
  assert.equal(history.list[0].stationId, stationB.id);
});

test('switching back to a station does not duplicate the item still on air', () => {
  const history = recorder();
  history.selectStation(stationA);
  history.setPlaying(true);
  history.handleMetadata(track({ title: 'Same' }), stationA.id);

  history.selectStation(stationB);
  history.setPlaying(true);
  history.handleMetadata(track({ title: 'Other' }), stationB.id);

  history.selectStation(stationA);
  history.setPlaying(true);
  assert.equal(history.handleMetadata(track({ title: 'Same' }), stationA.id), null);
  assert.equal(history.list.length, 2);

  history.handleMetadata(track({ title: 'SameButDifferent' }), stationA.id);
  assert.equal(history.list.length, 3);
});

test('history persists locally and a restart does not duplicate the current item', () => {
  const storage = new MemoryStorage();
  const first = recorder(storage);
  first.selectStation(stationA);
  first.setPlaying(true);
  first.handleMetadata(track({ title: 'One', startedAt: '2026-10-08T11:30:00.000Z' }), stationA.id);

  const stored = JSON.parse(storage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as HistoryItem[];
  assert.equal(stored.length, 1);
  assert.equal(stored[0].startedAt, '2026-10-08T11:30:00.000Z');
  assert.equal(stored[0].timeZone, 'Europe/Moscow');
  assert.equal(stored[0].timeQuality, 'exact');

  const second = new HistoryRecorder({ storage, defaultTimeZone: 'Europe/Moscow', station: stationA });
  assert.equal(second.list.length, 1);
  second.selectStation(stationA);
  second.setPlaying(true);
  assert.equal(second.handleMetadata(track({ title: 'One', startedAt: '2026-10-08T11:30:00.000Z' }), stationA.id), null);
  assert.equal(second.list.length, 1);
  second.handleMetadata(track({ title: 'Two' }), stationA.id);
  assert.equal(second.list.length, 2);
});

test('history stays local: no telemetry hooks, storage failure does not break writes', () => {
  const history = new HistoryRecorder({ storage: new BrokenStorage(), defaultTimeZone: 'Europe/Moscow' });
  history.selectStation(stationA);
  history.setPlaying(true);
  const list = history.handleMetadata(track({ title: 'One' }), stationA.id);
  assert.equal(list?.length, 1, 'quota failure must not discard the in-memory record');
});

test('history is capped to the configured limit', () => {
  const history = new HistoryRecorder({ storage: new MemoryStorage(), limit: 3 });
  history.selectStation(stationA);
  history.setPlaying(true);
  for (let index = 0; index < 5; index += 1) history.handleMetadata(track({ title: `Item ${index}` }), stationA.id);
  assert.equal(history.list.length, 3);
  assert.equal(history.list[0].title, 'Item 4');
});

test('corrupted storage never crashes and never drops the healthy records', () => {
  assert.deepEqual(loadHistory('{broken json'), []);
  assert.deepEqual(loadHistory('null'), []);
  assert.deepEqual(loadHistory('{"not":"an array"}'), []);
  assert.deepEqual(loadHistory(''), []);
  assert.deepEqual(loadHistory(null), []);

  const mixed = JSON.stringify([
    { stationId: 'station-a', stationName: 'Station A', artist: 'A', title: 'Healthy', kind: 'music', startedAt: '2026-10-08T11:30:00.000Z', detectedAt: '2026-10-08T11:35:00.000Z', source: 'src' },
    null,
    42,
    'garbage',
    { title: 'Missing station' },
    { stationId: 'station-a', stationName: 'Station A', artist: '', title: '' },
    { stationId: 'station-a', stationName: 'Station A', artist: 'B', title: 'Healthy two', detectedAt: '2026-10-08T12:00:00.000Z' },
    { stationId: 'station-a', stationName: 'Station A', artist: 'C', title: 'No usable time', startedAt: 'nonsense', detectedAt: 'also nonsense' },
    // valid content + valid startedAt but corrupted detection time: dropped (req. 5)
    { stationId: 'station-a', stationName: 'Station A', artist: 'D', title: 'Broken detectedAt', startedAt: '2026-10-08T10:00:00.000Z', detectedAt: 'not-a-timestamp' },
    { stationId: 'station-a', stationName: 'Station A', artist: 'E', title: 'Missing detectedAt', startedAt: '2026-10-08T10:00:00.000Z' },
  ]);
  const items = loadHistory(mixed, { defaultTimeZone: 'Europe/Moscow', now: Date.parse('2026-10-08T13:00:00.000Z') });
  assert.equal(items.length, 2, 'only corrupted records are skipped');
  assert.deepEqual(items.map((item) => item.title), ['Healthy', 'Healthy two']);
  assert.equal(items[1].startedAt, null);
  assert.equal(items[1].timeQuality, 'detected');
});

test('legacy records are migrated safely', () => {
  const legacyExact = sanitizeHistoryItem(
    { stationId: 'station-a', stationName: 'Station A', artist: 'A', title: 'Old exact', kind: 'music', startedAt: '2026-10-08T11:30:00.000Z', detectedAt: '2026-10-08T11:35:00.000Z', source: 'src' },
    'Europe/Moscow',
  );
  assert.ok(legacyExact);
  assert.equal(legacyExact.timeQuality, 'exact');
  assert.equal(legacyExact.timeZone, 'Europe/Moscow');

  // A legacy `startedAt` that is not an ISO instant must never stay in `startedAt`.
  const legacyLocal = sanitizeHistoryItem(
    { stationId: 'station-a', stationName: 'Station A', artist: 'A', title: 'Old local', kind: 'music', startedAt: '14:30', detectedAt: '2026-10-08T11:35:00.000Z', source: 'src' },
    'Europe/Moscow',
  );
  assert.ok(legacyLocal);
  assert.equal(legacyLocal.startedAt, null);
  assert.equal(legacyLocal.sourceLocalTime, '14:30');
  assert.equal(legacyLocal.timeQuality, 'local-only');
  assert.equal(legacyLocal.timeZone, 'Europe/Moscow');

  assert.equal(sanitizeHistoryItem('not an object'), null);
  assert.equal(sanitizeHistoryItem({ stationId: 7, title: 'x' }), null);
});

test('history labels render in the station time zone', () => {
  const base = {
    stationId: 'station-a',
    stationName: 'Station A',
    artist: 'A',
    kind: 'music' as const,
    source: 'src',
    sourceLocalTime: null,
    timeZone: 'Europe/Moscow',
  };
  const exact: HistoryItem = { ...base, title: 'Exact', startedAt: '2026-10-08T11:30:00.000Z', detectedAt: '2026-10-08T11:35:00.000Z', timeQuality: 'exact' };
  assert.equal(historyTimeLabel(exact), '2026-10-08 14:30');

  const localOnly: HistoryItem = { ...base, title: 'Local', startedAt: null, detectedAt: '2026-10-08T11:35:00.000Z', sourceLocalTime: '14:30', timeQuality: 'local-only' };
  assert.equal(historyTimeLabel(localOnly), '14:30');

  const detected: HistoryItem = { ...base, title: 'Detected', startedAt: null, detectedAt: '2026-10-08T11:35:00.000Z', timeQuality: 'detected' };
  assert.equal(historyTimeLabel(detected), '2026-10-08 14:35');
});

test('subscribers receive the updated list', () => {
  const history = recorder();
  const seen: number[] = [];
  const unsubscribe = history.subscribe((items) => seen.push(items.length));
  history.selectStation(stationA);
  history.setPlaying(true);
  history.handleMetadata(track({ title: 'One' }), stationA.id);
  history.handleMetadata(track({ title: 'One' }), stationA.id);
  history.handleMetadata(track({ title: 'Two' }), stationA.id);
  assert.deepEqual(seen, [1, 2]);
  unsubscribe();
  history.handleMetadata(track({ title: 'Three' }), stationA.id);
  assert.deepEqual(seen, [1, 2]);
});

// --- Retention: 48 hours by detectedAt + maximum 100 entries ---

function storedEntry(title: string, detectedAt?: string): Record<string, unknown> {
  return { stationId: 'station-a', stationName: 'Station A', artist: 'A', title, kind: 'music', detectedAt };
}

test('retention: entries older than 48 hours by detectedAt are removed, boundary kept', () => {
  assert.equal(HISTORY_MAX_AGE_MS, 48 * 60 * 60 * 1000, 'retention window is 48 hours');
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  const raw = JSON.stringify([
    storedEntry('Fresh', '2026-10-10T11:59:59.000Z'),
    storedEntry('Exactly 48h', '2026-10-08T12:00:00.000Z'),
    storedEntry('Just over 48h', '2026-10-08T11:59:59.999Z'),
    storedEntry('Ancient', '2026-09-01T12:00:00.000Z'),
  ]);
  const items = loadHistory(raw, { now });
  assert.deepEqual(items.map((item) => item.title), ['Fresh', 'Exactly 48h']);
});

test('retention: at most 100 entries are kept on load', () => {
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  const raw = JSON.stringify(
    Array.from({ length: 150 }, (_, index) => storedEntry(`Item ${index}`, new Date(now - index * 1000).toISOString())),
  );
  const items = loadHistory(raw, { now });
  assert.equal(items.length, HISTORY_LIMIT);
  assert.equal(HISTORY_LIMIT, 100);
  assert.equal(items[0].title, 'Item 0');
  assert.equal(items[items.length - 1].title, 'Item 99');
});

test('retention: the recorder never stores more than 100 entries', () => {
  const storage = new MemoryStorage();
  const history = new HistoryRecorder({ storage });
  history.selectStation(stationA);
  history.setPlaying(true);
  for (let index = 0; index < 105; index += 1) history.handleMetadata(track({ title: `Item ${index}` }), stationA.id);
  assert.equal(history.list.length, 100);
  assert.equal(history.list[0].title, 'Item 104');
  const stored = JSON.parse(storage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as HistoryItem[];
  assert.equal(stored.length, 100, 'persisted payload is capped too');
});

test('retention: corrupted detectedAt records are removed, never guessed', () => {
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  const raw = JSON.stringify([
    { ...storedEntry('Corrupted detectedAt with valid startedAt', 'nonsense'), startedAt: '2026-10-10T10:00:00.000Z' },
    storedEntry('Missing detectedAt'),
    storedEntry('Future detectedAt', '2026-10-10T11:00:00.000Z'),
  ]);
  const items = loadHistory(raw, { now });
  assert.deepEqual(items.map((item) => item.title), ['Future detectedAt']);

  // An incoming track without a usable detection time still produces a valid record.
  const storage = new MemoryStorage();
  const history = new HistoryRecorder({ storage, now: () => '2026-10-10T12:00:00.000Z' });
  history.selectStation(stationA);
  history.setPlaying(true);
  const list = history.handleMetadata(track({ title: 'Incoming broken time', detectedAt: 'garbage', startedAt: null }), stationA.id);
  assert.equal(list?.length, 1);
  assert.equal(list?.[0].detectedAt, '2026-10-10T12:00:00.000Z', 'falls back to the current instant');
  const stored = JSON.parse(storage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as HistoryItem[];
  assert.equal(stored[0].detectedAt, '2026-10-10T12:00:00.000Z');
});

test('retention: 48 hours and 100 entries apply together', () => {
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  const stale = Array.from({ length: 50 }, (_, index) =>
    storedEntry(`Stale ${index}`, new Date(now - HISTORY_MAX_AGE_MS - (index + 1) * 60_000).toISOString()));
  const fresh = Array.from({ length: 120 }, (_, index) =>
    storedEntry(`Fresh ${index}`, new Date(now - index * 1000).toISOString()));
  const items = loadHistory(JSON.stringify([...stale, ...fresh]), { now });
  assert.equal(items.length, 100, 'cap applies after the age filter');
  assert.ok(items.every((item) => item.title.startsWith('Fresh')), 'stale entries never occupy capped slots');
});

test('retention: stale entries are dropped when a new entry is added', () => {
  let clock = Date.parse('2026-10-10T12:00:00.000Z');
  const storage = new MemoryStorage();
  const history = new HistoryRecorder({ storage, now: () => new Date(clock).toISOString() });
  history.selectStation(stationA);
  history.setPlaying(true);

  history.handleMetadata(track({ title: 'First', detectedAt: new Date(clock).toISOString() }), stationA.id);
  assert.equal(history.list.length, 1);

  clock += HISTORY_MAX_AGE_MS; // exactly 48h later: boundary entry still kept
  history.handleMetadata(track({ title: 'Second', detectedAt: new Date(clock).toISOString() }), stationA.id);
  assert.deepEqual(history.list.map((item) => item.title), ['Second', 'First']);

  clock += 1; // strictly older than 48h now: removed by the insert-time cleanup
  history.handleMetadata(track({ title: 'Third', detectedAt: new Date(clock).toISOString() }), stationA.id);
  assert.deepEqual(history.list.map((item) => item.title), ['Third', 'Second']);

  const stored = JSON.parse(storage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as HistoryItem[];
  assert.deepEqual(stored.map((item) => item.title), ['Third', 'Second'], 'persisted payload is cleaned too');
});

test('retention: cleanup runs at load and is persisted back', () => {
  const now = Date.parse('2026-10-10T12:00:00.000Z');
  const storage = new MemoryStorage();
  storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([
    storedEntry('Stale', new Date(now - HISTORY_MAX_AGE_MS - 1).toISOString()),
    storedEntry('Fresh', new Date(now - 1000).toISOString()),
    storedEntry('Corrupt detectedAt', 'not-a-date'),
  ]));
  const history = new HistoryRecorder({ storage, now: () => new Date(now).toISOString() });
  assert.deepEqual(history.list.map((item) => item.title), ['Fresh']);
  const persisted = JSON.parse(storage.getItem(HISTORY_STORAGE_KEY) ?? '[]') as HistoryItem[];
  assert.deepEqual(persisted.map((item) => item.title), ['Fresh'], 'stale/corrupted records are physically removed');
});

test('retention: duplicate and playback gates are unaffected', () => {
  const history = recorder();
  history.selectStation(stationA);
  assert.equal(history.handleMetadata(track({ title: 'One' }), stationA.id), null, 'gate: no playback');
  history.setPlaying(true);
  assert.ok(history.handleMetadata(track({ title: 'One' }), stationA.id));
  assert.equal(history.handleMetadata(track({ title: 'One' }), stationA.id), null, 'gate: duplicate');
  history.setPlaying(false);
  assert.equal(history.handleMetadata(track({ title: 'Two' }), stationA.id), null, 'gate: paused');
  assert.equal(history.list.length, 1);
});

// --- Late `playing` events must not open the history gate (review remark 1) ---

test('a confirmed start of the current session opens the history gate', () => {
  assert.equal(
    canOpenHistoryOnPlaying({ shouldPlay: true, paused: false, readyState: 3, mediaSrc: 'https://stream/one', expectedSrc: 'https://stream/one' }),
    true,
    'a genuine start',
  );
  assert.equal(
    canOpenHistoryOnPlaying({ shouldPlay: true, paused: false, readyState: 4, mediaSrc: 'https://stream/fallback', expectedSrc: 'https://stream/fallback' }),
    true,
    'a fallback stream whose assigned src matches',
  );
});

test('a playing event queued before a pause or an audit stop is ignored', () => {
  assert.equal(
    canOpenHistoryOnPlaying({ shouldPlay: false, paused: true, readyState: 4, mediaSrc: 'https://stream/one', expectedSrc: null }),
    false,
    'after pause: playback intent is cleared',
  );
  assert.equal(
    canOpenHistoryOnPlaying({ shouldPlay: false, paused: true, readyState: 4, mediaSrc: 'https://stream/one', expectedSrc: null }),
    false,
    'after audit stop: playback intent is cleared',
  );
});

test('a playing event from a previous station cannot open the gate', () => {
  assert.equal(
    canOpenHistoryOnPlaying({ shouldPlay: true, paused: true, readyState: 0, mediaSrc: null, expectedSrc: null }),
    false,
    'right after a switch: old src removed, new one not assigned yet',
  );
  assert.equal(
    canOpenHistoryOnPlaying({ shouldPlay: true, paused: false, readyState: 3, mediaSrc: 'https://stream/old', expectedSrc: 'https://stream/new' }),
    false,
    'the event belongs to the superseded stream url',
  );
});

test('a cancelled start cannot open the gate', () => {
  assert.equal(
    canOpenHistoryOnPlaying({ shouldPlay: true, paused: false, readyState: 4, mediaSrc: null, expectedSrc: null }),
    false,
    'the src was removed before the event was delivered',
  );
  assert.equal(
    canOpenHistoryOnPlaying({ shouldPlay: true, paused: false, readyState: 0, mediaSrc: 'https://stream/new', expectedSrc: 'https://stream/new' }),
    false,
    'a fresh stream is still buffering (readyState below HAVE_CURRENT_DATA)',
  );
});
