// Runs under several TZ values to prove that EFIRIO time handling never
// consults the device time zone.
import { formatInTimeZone, normalizeSourceTime } from '../../src/time.ts';

const payload = {
  local: normalizeSourceTime('2026-10-08T14:30:00', 'Europe/Moscow'),
  timeOnly: normalizeSourceTime('14:30', 'Europe/Moscow'),
  absolute: normalizeSourceTime('2026-10-08T14:30:00Z', 'Europe/Moscow'),
  formatted: formatInTimeZone('2026-10-08T11:30:00.000Z', 'Europe/Moscow', { withDate: true }),
  deviceOffset: new Date('2026-10-08T12:00:00Z').getTimezoneOffset(),
};

console.log(JSON.stringify(payload));
