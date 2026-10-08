import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeGetItem, safeSetItem } from '../src/storage.ts';

test('safeGetItem returns the stored value', () => {
  assert.equal(safeGetItem(() => 'nashe'), 'nashe');
  assert.equal(safeGetItem(() => null), null);
});

test('safeGetItem survives a blocked storage getter', () => {
  // Safari/Firefox throw on even *reading* `window.localStorage` when cookies
  // are blocked; the app must still start and select a station.
  const blocked = { get storage(): never { throw new Error('SecurityError'); } };
  assert.equal(safeGetItem(() => blocked.storage), null);
});

test('safeSetItem reports a successful write', () => {
  const store = new Map<string, string>();
  assert.equal(safeSetItem(() => store.set('efirio.lastStationId', 'nashe')), true);
  assert.equal(store.get('efirio.lastStationId'), 'nashe');
});

test('safeSetItem never throws on quota or private-mode failures', () => {
  // Regression: an unguarded `localStorage.setItem` aborted chooseStation
  // before the station could start playing.
  let executed = false;
  const failed = safeSetItem(() => { executed = true; throw new Error('QuotaExceededError'); });
  assert.equal(failed, false);
  assert.equal(executed, true, 'the write was attempted');
});
