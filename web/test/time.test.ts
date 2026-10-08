import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  deriveTimeQuality,
  formatInTimeZone,
  isValidTimeZone,
  normalizeSourceTime,
  parseUtcInstant,
} from '../src/time.ts';

test('ISO 8601 with Z is accepted as an exact UTC instant', () => {
  const result = normalizeSourceTime('2026-10-08T14:30:00Z', 'Europe/Moscow');
  assert.equal(result.startedAt, '2026-10-08T14:30:00.000Z');
  assert.equal(result.sourceLocalTime, null);
  assert.equal(result.quality, 'exact');
});

test('ISO 8601 with a positive offset is converted to UTC', () => {
  assert.equal(normalizeSourceTime('2026-10-08T14:30:00+03:00', 'Europe/Moscow').startedAt, '2026-10-08T11:30:00.000Z');
  assert.equal(normalizeSourceTime('2026-10-08T14:30:00+05:30', 'Europe/Moscow').startedAt, '2026-10-08T09:00:00.000Z');
  assert.equal(normalizeSourceTime('2026-10-08T14:30:00+0300', 'Europe/Moscow').startedAt, '2026-10-08T11:30:00.000Z');
});

test('ISO 8601 with a negative offset is converted to UTC', () => {
  assert.equal(normalizeSourceTime('2026-10-08T14:30:00-05:00', 'Europe/Moscow').startedAt, '2026-10-08T19:30:00.000Z');
  assert.equal(normalizeSourceTime('2026-10-08T09:00:00-00:00', 'Europe/Moscow').startedAt, '2026-10-08T09:00:00.000Z');
});

test('Moscow local time without offset is interpreted in Europe/Moscow', () => {
  const withSeconds = normalizeSourceTime('2026-10-08T14:30:15', 'Europe/Moscow');
  assert.equal(withSeconds.startedAt, '2026-10-08T11:30:15.000Z');
  assert.equal(withSeconds.quality, 'exact');

  const spaceSeparator = normalizeSourceTime('2026-10-08 14:30', 'Europe/Moscow');
  assert.equal(spaceSeparator.startedAt, '2026-10-08T11:30:00.000Z');

  // Europe/Moscow has no seasonal clock changes: UTC+3 all year.
  const winter = normalizeSourceTime('2026-01-15T14:30:00', 'Europe/Moscow');
  assert.equal(winter.startedAt, '2026-01-15T11:30:00.000Z');
  const summer = normalizeSourceTime('2026-07-15T14:30:00', 'Europe/Moscow');
  assert.equal(summer.startedAt, '2026-07-15T11:30:00.000Z');
});

test('local time without a date is never promoted to a timestamp', () => {
  const result = normalizeSourceTime('14:30', 'Europe/Moscow');
  assert.equal(result.startedAt, null);
  assert.equal(result.sourceLocalTime, '14:30');
  assert.equal(result.quality, 'local-only');
  assert.doesNotMatch(JSON.stringify(result), /\d{4}-\d{2}-\d{2}/, 'no date may be invented');

  assert.equal(normalizeSourceTime('9:05:07', 'Europe/Moscow').sourceLocalTime, '9:05:07');
  assert.equal(normalizeSourceTime('9:05:07', 'Europe/Moscow').startedAt, null);
});

test('local date without an offset cannot be converted without a time zone', () => {
  const result = normalizeSourceTime('2026-10-08T14:30:00', null);
  assert.equal(result.startedAt, null);
  assert.equal(result.sourceLocalTime, '2026-10-08T14:30:00');
  assert.equal(result.quality, 'local-only');
});

test('invalid timestamps are rejected', () => {
  const invalid: unknown[] = [
    '',
    '   ',
    null,
    undefined,
    42,
    1769654400000,
    { time: '2026-10-08T14:30:00Z' },
    'not a date',
    'yesterday 14:30',
    '2026-02-30T10:00:00Z',
    '2026-13-01T10:00:00Z',
    '2026-10-08T25:00:00Z',
    '2026-10-08T14:61:00Z',
    '2026-10-08T14:30:61Z',
    '2026-10-08T14:30:00+99:00',
    '2026-10-08',
    '10/08/2026 14:30',
    '31.02.2026 25:61',
  ];
  for (const value of invalid) {
    const result = normalizeSourceTime(value, 'Europe/Moscow');
    assert.equal(result.startedAt, null, `must not accept ${JSON.stringify(value)}`);
    assert.equal(result.quality !== 'exact', true, `must not mark ${JSON.stringify(value)} as exact`);
    assert.ok(['local-only', 'detected'].includes(result.quality));
    assert.equal(parseUtcInstant(value), null, `parseUtcInstant must reject ${JSON.stringify(value)}`);
  }
});

test('date rollover is preserved when converting across midnight', () => {
  const utc = normalizeSourceTime('2026-01-01T00:30:00+03:00', 'Europe/Moscow');
  assert.equal(utc.startedAt, '2025-12-31T21:30:00.000Z');
  assert.match(utc.startedAt ?? '', /^2025-12-31/);

  const local = normalizeSourceTime('2026-01-01T01:00:00', 'Europe/Moscow');
  assert.equal(local.startedAt, '2025-12-31T22:00:00.000Z');

  assert.equal(formatInTimeZone('2025-12-31T21:30:00.000Z', 'Europe/Moscow', { withDate: true }), '2026-01-01 00:30');
  assert.equal(formatInTimeZone('2026-01-01T00:30:00.000Z', 'America/New_York', { withDate: true }), '2025-12-31 19:30');
});

test('ambiguous and non-existent local times are not treated as credible', () => {
  // America/New_York DST fallback: 01:30 happens twice on 2026-11-01.
  const ambiguous = normalizeSourceTime('2026-11-01T01:30:00', 'America/New_York');
  assert.equal(ambiguous.startedAt, null);
  assert.equal(ambiguous.quality, 'local-only');
  assert.equal(ambiguous.sourceLocalTime, '2026-11-01T01:30:00');

  // America/New_York DST gap: 02:30 does not exist on 2026-03-08.
  const gap = normalizeSourceTime('2026-03-08T02:30:00', 'America/New_York');
  assert.equal(gap.startedAt, null);
  assert.equal(gap.quality, 'local-only');

  // A normal New York local time still converts (EDT, UTC-4).
  const normal = normalizeSourceTime('2026-10-08T14:30:00', 'America/New_York');
  assert.equal(normal.startedAt, '2026-10-08T18:30:00.000Z');
});

test('formatting uses the station time zone, not the device zone', () => {
  const instant = '2026-10-08T11:30:00.000Z';
  assert.equal(formatInTimeZone(instant, 'Europe/Moscow'), '14:30');
  assert.equal(formatInTimeZone(instant, 'America/New_York'), '07:30');
  assert.equal(formatInTimeZone(instant, 'Europe/Moscow', { withDate: true }), '2026-10-08 14:30');
  assert.equal(formatInTimeZone(instant, null), '11:30');
  assert.equal(formatInTimeZone('nonsense', 'Europe/Moscow'), '');
  assert.equal(isValidTimeZone('Europe/Moscow'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimeZone(null), false);
});

test('deriveTimeQuality follows the available evidence', () => {
  assert.equal(deriveTimeQuality('2026-10-08T11:30:00.000Z', null), 'exact');
  assert.equal(deriveTimeQuality(null, '14:30'), 'local-only');
  assert.equal(deriveTimeQuality(null, null), 'detected');
});

test('results do not depend on the device time zone', () => {
  const probe = fileURLToPath(new URL('./fixtures/tz-probe.ts', import.meta.url));
  const expected = {
    local: { startedAt: '2026-10-08T11:30:00.000Z', sourceLocalTime: null, quality: 'exact' },
    timeOnly: { startedAt: null, sourceLocalTime: '14:30', quality: 'local-only' },
    absolute: { startedAt: '2026-10-08T14:30:00.000Z', sourceLocalTime: null, quality: 'exact' },
    formatted: '2026-10-08 14:30',
    deviceOffset: null as number | null,
  };

  const outputs = ['UTC', 'America/New_York', 'Australia/Sydney'].map((zone) => {
    const run = spawnSync(process.execPath, [probe], {
      env: { ...process.env, TZ: zone },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
    return { zone, parsed };
  });

  const offsets = outputs.map((entry) => entry.parsed.deviceOffset);
  assert.equal(new Set(offsets).size, offsets.length, 'probe must really run under different device zones');

  for (const { parsed } of outputs) {
    assert.deepEqual({ ...parsed, deviceOffset: null }, expected);
  }
});
