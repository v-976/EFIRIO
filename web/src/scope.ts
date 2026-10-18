/**
 * Category (scope) persistence and migration (R3.3.1).
 *
 * Internet-only Finland and Estonia used to be their own scope values
 * (`finland-internet`, `estonia-internet`); they now live inside the single
 * `internet` scope behind the country selector. The legacy values are migrated
 * once on boot into `internet` + `efirio.internetCountryId` — the existing
 * country key is reused, no second selector state is invented.
 *
 * The migration is idempotent: the rewrite happens only while a legacy value is
 * present, so a second boot (or React StrictMode's double-invoked initializers)
 * reads the already-migrated values and changes nothing. Unknown or corrupt
 * scope values fall back to `russia` without a write, and no other key —
 * language, city, region, geography, history or last station — is ever touched.
 *
 * Storage access is injected so `node --test` can exercise the migration with a
 * plain Map; `main.tsx` passes the `safeGetItem`/`safeSetItem` wrappers.
 */

export type Scope = 'russia' | 'internet' | 'finland' | 'estonia' | 'romania' | 'latvia' | 'lithuania' | 'albania' | 'kosovo';

export const SCOPE_KEY = 'efirio.scope';
/** The one existing key for the selected Internet country; the migration reuses it. */
export const INTERNET_COUNTRY_KEY = 'efirio.internetCountryId';

/** The minimal storage surface the boot/migration needs. */
export type ScopeStorage = {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
};

/** What the boot reads back: the active scope plus the Internet country choice. */
export type ScopeBoot = { scope: Scope; internetCountryId: string | null };

/** Legacy separate scopes → the country they meant inside the unified Internet category. */
const LEGACY_INTERNET_COUNTRIES: Readonly<Record<string, string>> = {
  'finland-internet': 'finland',
  'estonia-internet': 'estonia',
};

/** Valid stored scopes; anything else (removed or corrupt) means `russia`. */
const STORED_SCOPES: readonly Scope[] = ['russia', 'internet', 'finland', 'estonia', 'romania', 'latvia', 'lithuania', 'albania', 'kosovo'];

/**
 * Reads `efirio.scope` + `efirio.internetCountryId`, rewriting a legacy
 * internet-only scope into the unified Internet category on the way. Returns
 * both values from a single pass so the two selectors can never disagree.
 */
export function bootScope(storage: ScopeStorage): ScopeBoot {
  const saved = storage.get(SCOPE_KEY);
  const legacyCountry = saved === null ? undefined : LEGACY_INTERNET_COUNTRIES[saved];
  if (legacyCountry !== undefined) {
    // The migration's only write; the next boot sees `internet` and skips it.
    storage.set(SCOPE_KEY, 'internet');
    storage.set(INTERNET_COUNTRY_KEY, legacyCountry);
    return { scope: 'internet', internetCountryId: legacyCountry };
  }
  const scope: Scope = saved !== null && (STORED_SCOPES as readonly string[]).includes(saved) ? (saved as Scope) : 'russia';
  return { scope, internetCountryId: storage.get(INTERNET_COUNTRY_KEY) };
}
