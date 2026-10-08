/**
 * Station-time helpers for EFIRIO.
 *
 * Rules (see PROJECT_MEMORY "Now Playing semantics and station time zones"):
 * - absolute instants are stored as ISO 8601 UTC;
 * - station-local values are interpreted strictly in the station IANA time zone,
 *   never in the browser/device time zone;
 * - a source value that carries only a wall-clock time (or cannot be mapped
 *   unambiguously) is kept as raw local time and is not promoted to `startedAt`.
 */

export type TimeQuality = 'exact' | 'local-only' | 'detected';

export type SourceTime = {
  /** ISO 8601 UTC instant, only when the source value determines one moment. */
  startedAt: string | null;
  /** Raw local value from the source, kept while no instant can be derived. */
  sourceLocalTime: string | null;
  quality: TimeQuality;
};

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** 2026-10-08T14:30:00Z / 2026-10-08T14:30:00+03:00 / 2026-10-08 14:30:00-05:00 */
const ABSOLUTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/;
/** 2026-10-08T14:30:00 — date and time without offset. */
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?$/;
/** 2026-10-08 */
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 14:30 / 9:30:05 — no date at all. */
const LOCAL_TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 100 || month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

function wallFromUtc(instantMs: number, timeZone: string): WallClock | null {
  try {
    const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
      const part = parts.find((candidate) => candidate.type === type);
      return part ? Number(part.value) : Number.NaN;
    };
    const wall: WallClock = {
      year: read('year'),
      month: read('month'),
      day: read('day'),
      hour: read('hour'),
      minute: read('minute'),
      second: read('second'),
    };
    const values = Object.values(wall);
    if (values.some((value) => !Number.isFinite(value))) return null;
    return wall;
  } catch {
    return null;
  }
}

/** Offset of `timeZone` at the given instant, in milliseconds (UTC+3 → +3h). */
function offsetMsAt(instantMs: number, timeZone: string): number | null {
  const wall = wallFromUtc(instantMs, timeZone);
  if (!wall) return null;
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

function wallEquals(candidate: WallClock | null, expected: WallClock): boolean {
  return (
    candidate !== null &&
    candidate.year === expected.year &&
    candidate.month === expected.month &&
    candidate.day === expected.day &&
    candidate.hour === expected.hour &&
    candidate.minute === expected.minute &&
    candidate.second === expected.second
  );
}

/**
 * Maps a wall-clock time to a UTC instant inside `timeZone`.
 * Returns null when the local time does not exist (DST gap) or maps to more
 * than one instant (DST fallback), because such values are not credible timestamps.
 */
function utcFromWall(wall: WallClock, timeZone: string): number | null {
  const nominal = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const firstOffset = offsetMsAt(nominal, timeZone);
  if (firstOffset === null) return null;
  let instant = nominal - firstOffset;
  const secondOffset = offsetMsAt(instant, timeZone);
  if (secondOffset !== null && secondOffset !== firstOffset) instant = nominal - secondOffset;
  if (!wallEquals(wallFromUtc(instant, timeZone), wall)) return null;
  for (const delta of [MINUTE_MS * 30, HOUR_MS]) {
    if (wallEquals(wallFromUtc(instant - delta, timeZone), wall)) return null;
    if (wallEquals(wallFromUtc(instant + delta, timeZone), wall)) return null;
  }
  return instant;
}

/**
 * Strictly parses a full ISO 8601 instant that carries `Z` or an explicit
 * offset and returns its canonical ISO 8601 UTC form. Anything else returns null.
 */
export function parseUtcInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(ABSOLUTE_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (!isRealDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const rawFraction = match[7] ?? '';
  const millisecond = rawFraction ? Number(rawFraction.slice(0, 3).padEnd(3, '0')) : 0;
  const offsetToken = match[8];
  let offsetMinutes = 0;
  if (offsetToken !== 'Z') {
    const sign = offsetToken.startsWith('-') ? -1 : 1;
    const offsetHours = Number(offsetToken.slice(1, 3));
    const offsetPart = Number(offsetToken.slice(-2));
    if (offsetHours > 14 || offsetPart > 59) return null;
    offsetMinutes = sign * (offsetHours * 60 + offsetPart);
  }
  const instant = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMinutes * MINUTE_MS;
  return new Date(instant).toISOString();
}

export function deriveTimeQuality(startedAt: string | null, sourceLocalTime: string | null): TimeQuality {
  if (startedAt) return 'exact';
  if (sourceLocalTime) return 'local-only';
  return 'detected';
}

/**
 * Normalizes a raw timestamp coming from a metadata source.
 *
 * - ISO with `Z`/offset → converted to UTC (`exact`);
 * - local date+time without offset → interpreted in `timeZone` (`exact`);
 * - local time without a date, or a local value that cannot be mapped
 *   unambiguously → kept as `sourceLocalTime` (`local-only`), no date invented;
 * - anything invalid → `detected`, nothing accepted as a timestamp.
 */
export function normalizeSourceTime(raw: unknown, timeZone?: string | null): SourceTime {
  const source = typeof raw === 'string' ? raw.trim() : '';
  if (!source) return { startedAt: null, sourceLocalTime: null, quality: 'detected' };

  const absolute = parseUtcInstant(source);
  if (absolute !== null) return { startedAt: absolute, sourceLocalTime: null, quality: 'exact' };

  const localDateTime = source.match(LOCAL_DATETIME_PATTERN);
  if (localDateTime) {
    const zone = isValidTimeZone(timeZone) ? timeZone.trim() : null;
    const wall: WallClock = {
      year: Number(localDateTime[1]),
      month: Number(localDateTime[2]),
      day: Number(localDateTime[3]),
      hour: Number(localDateTime[4]),
      minute: Number(localDateTime[5]),
      second: localDateTime[6] ? Number(localDateTime[6]) : 0,
    };
    if (isRealDate(wall.year, wall.month, wall.day) && wall.hour <= 23 && wall.minute <= 59 && wall.second <= 59 && zone) {
      const instant = utcFromWall(wall, zone);
      if (instant !== null) return { startedAt: new Date(instant).toISOString(), sourceLocalTime: null, quality: 'exact' };
    }
    return { startedAt: null, sourceLocalTime: source, quality: 'local-only' };
  }

  const timeOnly = source.match(LOCAL_TIME_PATTERN);
  if (timeOnly && Number(timeOnly[1]) <= 23 && Number(timeOnly[2]) <= 59 && (timeOnly[3] === undefined || Number(timeOnly[3]) <= 59)) {
    return { startedAt: null, sourceLocalTime: source, quality: 'local-only' };
  }

  if (LOCAL_DATE_PATTERN.test(source)) {
    const [, yearText, monthText, dayText] = source.split('-');
    if (isRealDate(Number(yearText), Number(monthText), Number(dayText))) {
      return { startedAt: null, sourceLocalTime: source, quality: 'local-only' };
    }
    return { startedAt: null, sourceLocalTime: null, quality: 'detected' };
  }

  return { startedAt: null, sourceLocalTime: null, quality: 'detected' };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/**
 * Renders an ISO 8601 UTC instant inside an IANA time zone.
 * Falls back to UTC when the instant or the zone is unusable.
 */
export function formatInTimeZone(value: unknown, timeZone: unknown, options: { withDate?: boolean } = {}): string {
  const instantText = parseUtcInstant(value);
  const instantMs = instantText === null ? null : Date.parse(instantText);
  if (instantMs === null) return '';
  const zone = isValidTimeZone(timeZone) ? timeZone.trim() : 'UTC';
  const wall = wallFromUtc(instantMs, zone);
  if (!wall) return '';
  const time = `${pad(wall.hour)}:${pad(wall.minute)}`;
  if (!options.withDate) return time;
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)} ${time}`;
}
