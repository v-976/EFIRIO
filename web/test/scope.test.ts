import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERNET_COUNTRY_KEY, SCOPE_KEY, bootScope, type ScopeStorage } from '../src/scope.ts';

/** A plain in-memory stand-in for localStorage; Node has none outside the browser. */
function memoryStorage(entries: [string, string][] = []): ScopeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(entries);
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => { data.set(key, value); },
  };
}

/** Everything the migration is allowed to have written, as one comparable value. */
function snapshot(storage: ScopeStorage & { data: Map<string, string> }): string {
  return JSON.stringify([...storage.data.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

test('finland-internet migrates to the unified Internet scope with Finland', () => {
  const storage = memoryStorage([[SCOPE_KEY, 'finland-internet']]);
  const boot = bootScope(storage);
  assert.deepEqual(boot, { scope: 'internet', internetCountryId: 'finland' });
  assert.equal(storage.data.get(SCOPE_KEY), 'internet');
  assert.equal(storage.data.get(INTERNET_COUNTRY_KEY), 'finland');
});

test('estonia-internet migrates to the unified Internet scope with Estonia', () => {
  const storage = memoryStorage([[SCOPE_KEY, 'estonia-internet']]);
  const boot = bootScope(storage);
  assert.deepEqual(boot, { scope: 'internet', internetCountryId: 'estonia' });
  assert.equal(storage.data.get(SCOPE_KEY), 'internet');
  assert.equal(storage.data.get(INTERNET_COUNTRY_KEY), 'estonia');
});

test('a legacy scope replaces a stale country choice with the country it meant', () => {
  const storage = memoryStorage([[SCOPE_KEY, 'finland-internet'], [INTERNET_COUNTRY_KEY, 'united-kingdom']]);
  assert.equal(bootScope(storage).internetCountryId, 'finland');
});

test('the migration is idempotent: a second boot changes nothing', () => {
  const storage = memoryStorage([[SCOPE_KEY, 'estonia-internet'], [INTERNET_COUNTRY_KEY, 'united-kingdom']]);
  const first = bootScope(storage);
  const afterFirst = snapshot(storage);
  const second = bootScope(storage);
  assert.deepEqual(second, first, 'a repeated boot must converge on the same state');
  assert.equal(snapshot(storage), afterFirst, 'a repeated boot must not write again');
});

test('the unified Internet scope keeps the previously selected country', () => {
  const storage = memoryStorage([[SCOPE_KEY, 'internet'], [INTERNET_COUNTRY_KEY, 'finland']]);
  const before = snapshot(storage);
  assert.deepEqual(bootScope(storage), { scope: 'internet', internetCountryId: 'finland' });
  assert.equal(snapshot(storage), before, 'an already-migrated store must not be rewritten');
});

test('russia, finland, estonia, romania, latvia, lithuania, albania, kosovo and greece pass through untouched', () => {
  for (const scope of ['russia', 'finland', 'estonia', 'romania', 'latvia', 'lithuania', 'albania', 'kosovo', 'greece'] as const) {
    const storage = memoryStorage([[SCOPE_KEY, scope], [INTERNET_COUNTRY_KEY, 'estonia']]);
    const before = snapshot(storage);
    assert.deepEqual(bootScope(storage), { scope, internetCountryId: 'estonia' });
    assert.equal(snapshot(storage), before, `${scope} must not be rewritten`);
  }
});

test('an unknown or corrupt scope falls back to russia without a write', () => {
  const storage = memoryStorage([[SCOPE_KEY, 'germany'], [INTERNET_COUNTRY_KEY, 'finland']]);
  const before = snapshot(storage);
  const boot = bootScope(storage);
  assert.equal(boot.scope, 'russia');
  assert.equal(boot.internetCountryId, 'finland', 'the country choice survives for the next Internet visit');
  assert.equal(snapshot(storage), before, 'a fallback value must not touch storage');
});

test('an empty store boots on russia with no country choice', () => {
  const storage = memoryStorage();
  assert.deepEqual(bootScope(storage), { scope: 'russia', internetCountryId: null });
  assert.equal(storage.data.size, 0, 'a fresh boot must not invent stored settings');
});

test('migration never touches language, city, geography or history keys', () => {
  const storage = memoryStorage([
    [SCOPE_KEY, 'finland-internet'],
    ['efirio.uiLanguage', 'fi'],
    ['efirio.cityId', 'saint-petersburg'],
    ['efirio.lastStationId', 'yule-live'],
    ['efirio.finlandRegionId', 'uusimaa'],
  ]);
  bootScope(storage);
  assert.equal(storage.data.get('efirio.uiLanguage'), 'fi');
  assert.equal(storage.data.get('efirio.cityId'), 'saint-petersburg');
  assert.equal(storage.data.get('efirio.lastStationId'), 'yule-live');
  assert.equal(storage.data.get('efirio.finlandRegionId'), 'uusimaa');
});
