/**
 * Local-first UI translation (R3.3).
 *
 * One typed dictionary keyed by `MessageKey`; English is the reference and ships
 * in the main bundle, every other language is a lazy chunk behind a glob. A
 * missing key or a not-yet-loaded dictionary always renders English — never an
 * empty string or a technical key. Station, city, region, artist and programme
 * names are catalogue data and are never translated.
 *
 * The module is deliberately React-free so `node --test` can import it directly;
 * the React binding is two lines in `main.tsx` on top of `subscribeLanguage`.
 */
import { safeGetItem, safeSetItem } from './storage.ts';

export const SUPPORTED_LANGUAGES = ['ru', 'en', 'fi', 'sv', 'et', 'ro', 'el'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Endonyms: the switcher always reads in its own language and never translates. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  ru: 'Русский',
  en: 'English',
  fi: 'Suomi',
  sv: 'Svenska',
  et: 'Eesti',
  ro: 'Română',
  el: 'Ελληνικά',
};

export const LANGUAGE_KEY = 'efirio.uiLanguage';

/** English is the reference dictionary: its key set is the typed key contract. */
export const en = {
  tagline: 'The radio of your city',
  languageLabel: 'Language',
  // Category names.
  scopeRussia: 'Russia',
  scopeInternet: 'Internet',
  scopeFinland: 'Finland',
  scopeFinlandInternet: 'Finland — Internet',
  scopeEstonia: 'Estonia',
  scopeEstoniaInternet: 'Estonia — Internet',
  // Breadcrumbs and geography terms.
  crumbInternet: 'Internet',
  crumbStations: 'Radio stations',
  placeRussia: 'Russia',
  placeFinland: 'Finland',
  placeEstonia: 'Estonia',
  allCountry: 'Whole country',
  allCities: 'All cities',
  categoryLabel: 'Category',
  countryLabel: 'Country',
  regionLabel: 'Region',
  cityLabel: 'City',
  genreLabel: 'Genre',
  allGenres: 'All genres',
  findStation: 'Find a station',
  findCity: 'Find a city',
  stationNamePlaceholder: 'Station name',
  cityNamePlaceholder: 'City name',
  stationGeoPlaceholder: 'Station, city or region',
  searchStationAria: 'Search for a station',
  searchCityAria: 'Search for a city',
  searchFinlandAria: 'Search Finland by station, city or region',
  searchEstoniaAria: 'Search Estonia by station, city or region',
  cityResultsAria: 'City search results',
  stationsAria: '{place} stations',
  // Catalogue messages.
  noCityMatches: 'No city matches “{query}”',
  noStationMatches: 'No station matches “{query}”',
  noStationFilters: 'No station matches the selected filters',
  loadingCatalogue: 'Loading {name} catalogue…',
  errCountryLoad: 'The country catalogue could not be loaded',
  errFinlandInternetLoad: 'The «Finland — Internet» catalogue could not be loaded',
  errEstoniaInternetLoad: 'The «Estonia — Internet» catalogue could not be loaded',
  errFinlandLoad: 'The Finland catalogue could not be loaded',
  errEstoniaLoad: 'The Estonia catalogue could not be loaded',
  // Player states.
  chooseStation: 'Choose a station',
  prevStation: 'Previous station',
  nextStation: 'Next station',
  play: 'Play',
  pause: 'Pause',
  connecting: 'Connecting…',
  connectingFallback: 'Connecting to fallback…',
  live: 'Live',
  liveFallback: 'Live · fallback',
  failed: 'Failed',
  failedWith: 'Failed · {error}',
  available: 'Available',
  paused: 'Paused',
  unavailable: 'Unavailable',
  streamUnavailable: 'Stream unavailable',
  noProductionStream: 'No validated production stream',
  placeVersion: '{place} · {version}',
  // Station rows.
  typeRegional: 'Regional',
  typeLocal: 'Local',
  unitKHz: 'kHz',
  unitFM: 'FM',
  federalFeed: 'federal feed',
  federalFeedHint: 'Shared federal/central online feed — this city’s own FM broadcast may differ',
  showMore: 'Show more · {shown} of {remaining} remaining',
  // Now Playing.
  nowPlayingLabel: 'NOW PLAYING',
  kindProgramme: 'PROGRAMME',
  kindTalk: 'TALK',
  kindJingle: 'STATION ID',
  kindAdvert: 'ADVERT',
  timeSource: 'Source time {time}',
  timeStation: 'Station time {time} ({zone})',
  timeStationNoZone: 'Station time {time}',
  timeDetected: 'Detected {time}',
  loadingTrack: 'Loading track…',
  noTrackMetadata: 'No track metadata',
  metadataUnavailable: 'Metadata unavailable',
  // History.
  historyTitle: 'Listening history · {count}',
  // Audit summaries (the diagnostic buttons were removed from the UI; the
  // result lines remain for the code path and stay translatable).
  auditPlayable: '{ok}/{total} playable',
  auditAllPassed: 'All tested stations passed',
  auditNowPlaying: '{ok}/{total} Now Playing',
  auditAllMetadata: 'All stations returned track metadata',
};

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
export type MessageParams = Record<string, string | number>;
/** The signature components use: a typed key plus optional `{placeholder}` values. */
export type TFunction = (key: MessageKey, params?: MessageParams) => string;

export type PartialMessages = Partial<Messages>;

const loaded = new Map<Language, PartialMessages>();
const loaders = new Map<Language, () => Promise<unknown>>();
const listeners = new Set<() => void>();
let activeLanguage: Language = 'en';
/**
 * Bumped on every notification, including a late dictionary load. React uses it
 * as the `useSyncExternalStore` snapshot so side effects keyed on the language
 * (the document title, `<html lang>`) re-run once the dictionary arrives —
 * otherwise a switch to a not-yet-loaded language would leave them English.
 */
let version = 0;

export function isSupportedLanguage(value: string | null | undefined): value is Language {
  return !!value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Re-renders subscribe here; the snapshot is the plain language code. */
export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getLanguage(): Language { return activeLanguage; }

/** Snapshot for `useSyncExternalStore`: changes on switch *and* on dictionary load. */
export function getLanguageVersion(): number { return version; }

/**
 * Browser-language detection: the first supported base code wins
 * (`fi-FI` → fi, `el-GR` → el); anything unsupported → English.
 * Country/IP geolocation is deliberately never consulted.
 */
export function detectLanguage(preferences: readonly string[]): Language {
  for (const entry of preferences) {
    const base = String(entry).trim().toLowerCase().split(/[-_]/)[0];
    const hit = SUPPORTED_LANGUAGES.find((code) => code === base);
    if (hit) return hit;
  }
  return 'en';
}

function readNavigatorLanguages(): readonly string[] {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { languages?: readonly string[] });
  if (!nav) return [];
  const list = nav.languages && nav.languages.length ? nav.languages : [nav.language];
  return list.filter((value): value is string => typeof value === 'string' && !!value);
}

function interpolate(template: string, params: MessageParams): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Renders one message; an unloaded or partial dictionary falls back to English per key. */
export function translate(lang: Language, key: MessageKey, params?: MessageParams): string {
  const template = (lang === 'en' ? undefined : loaded.get(lang)?.[key]) ?? en[key];
  return params ? interpolate(template, params) : template;
}

/** Registers the lazy dictionary chunks (Vite glob lives in `main.tsx`, not here). */
export function registerLocaleLoaders(registry: Record<string, () => Promise<unknown>>): void {
  for (const [path, loader] of Object.entries(registry)) {
    const code = /\/([a-z]{2})\.ts$/.exec(path)?.[1];
    if (code && isSupportedLanguage(code) && code !== 'en') loaders.set(code, loader);
  }
}

async function loadLocale(lang: Language): Promise<void> {
  if (lang === 'en' || loaded.has(lang)) return;
  const loader = loaders.get(lang);
  if (!loader) return;
  try {
    const module = await loader();
    // The Vite glob uses `import: 'default'`, so the resolved value is the
    // dictionary itself; a namespace object carrying `.default` is also accepted.
    let dictionary: PartialMessages | null = null;
    if (module && typeof module === 'object' && 'default' in module) {
      dictionary = (module as { default?: PartialMessages }).default ?? null;
    } else {
      dictionary = (module as PartialMessages | null) ?? null;
    }
    if (dictionary) { loaded.set(lang, dictionary); notify(); }
  } catch {
    // A failed dictionary never breaks the app: strings simply stay English.
  }
}

/** Manual switch: persists first (the manual choice outranks the browser list), then loads. */
export function setLanguage(lang: Language): void {
  activeLanguage = isSupportedLanguage(lang) ? lang : 'en';
  safeSetItem(() => localStorage.setItem(LANGUAGE_KEY, activeLanguage));
  notify();
  void loadLocale(activeLanguage);
}

/**
 * First launch: a stored manual choice wins; otherwise the browser preference
 * decides. Awaits the dictionary so the first render is already translated.
 */
export async function initLanguage(preferences?: readonly string[]): Promise<Language> {
  const stored = safeGetItem(() => localStorage.getItem(LANGUAGE_KEY));
  const chosen = isSupportedLanguage(stored) ? stored : detectLanguage(preferences ?? readNavigatorLanguages());
  activeLanguage = chosen;
  await loadLocale(chosen);
  return chosen;
}
