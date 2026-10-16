import React from 'react';
import { createRoot } from 'react-dom/client';
import catalogueData from '../../data/stations.json';
import internetIndexData from '../../data/internet-index.json';
import { countryEndonym } from './countries.ts';
import { HistoryRecorder, canOpenHistoryOnPlaying, historyTimeLabel, type HistoryItem, type StorageLike } from './history.ts';
import {
  LANGUAGE_LABELS, SUPPORTED_LANGUAGES, getLanguage, getLanguageVersion, initLanguage, registerLocaleLoaders,
  setLanguage, subscribeLanguage, translate,
  type Language, type MessageKey, type MessageParams, type TFunction,
} from './i18n.ts';
import { isSupportedMetadata, probeMetadata, type MetadataConfig, type MetadataProbeResult, type NormalizedTrack, watchNowPlaying } from './metadata.ts';
import { bootScope, INTERNET_COUNTRY_KEY, SCOPE_KEY, type Scope } from './scope.ts';
import { safeGetItem, safeSetItem } from './storage.ts';
import { formatInTimeZone } from './time.ts';
import './styles.css';

/** Every non-English dictionary is its own lazy chunk; English ships inline as the fallback. */
const localeModules = import.meta.glob('./locales/*.ts', { import: 'default' });
registerLocaleLoaders(localeModules);

type Stream = { url: string; role: 'primary' | 'fallback'; format: string };
/** `feed` is absent on Saint Petersburg entries, which predate the field and are all local. */
type Station = { id: string; name: string; frequencyMHz: number | null; streams: Stream[]; metadata: MetadataConfig; status: 'active' | 'temporarily-unavailable' | 'inactive' | 'research'; feed?: 'local' | 'federal' };
type City = { id: string; name: string; timeZone?: string | null; stations: Station[] };
type Region = { id: string; name: string; cities: City[] };
type Catalogue = { countries: Array<{ regions: Region[] }> };

/**
 * Internet catalogue entries reuse the player's `Station` shape so the existing
 * playback, metadata and history code keeps working unchanged, and add the
 * geography an internet station actually has. `frequencyMHz` is always null:
 * an internet-only station has no FM frequency and one must never be invented.
 */
type InternetStream = Stream & { verifiedAt?: string; availableFromFinland?: boolean | null; notes?: string };
type InternetStation = {
  id: string;
  name: string;
  country: string;
  region: string | null;
  city: string | null;
  language: string | null;
  genres: string[];
  frequencyMHz: null;
  website: string | null;
  streams: InternetStream[];
  metadata: MetadataConfig;
  logo: string | null;
  status: Station['status'];
  verification: { stationVerifiedAt: string | null; sources: string[]; notes: string };
};
type InternetCountry = { id: string; name: string; code: string; timeZone: string | null; stations: InternetStation[] };
type InternetIndex = { schemaVersion: number; updatedAt: string | null; countries: Array<{ id: string; name: string; code: string; timeZone: string | null; stationCount: number }> };
/**
 * Finland is a standalone terrestrial catalogue with its own geography: a nationwide
 * bucket («Вся страна»), regions and cities. Station records live once in a registry;
 * buckets reference them by id, so a multi-region network is never copied per city.
 * `frequencies` keeps the territory of every confirmed FM row; a station with no
 * confirmed FM value carries `frequencyMHz: null` and renders the "FI" geo chip —
 * an FM number is never invented.
 */
type FinlandFrequency = { locality: string | null; region: string | null; mhz: number };
type FinlandStation = {
  id: string;
  name: string;
  type: 'nationwide' | 'regional' | 'local';
  language: string | null;
  genres: string[];
  frequencyMHz: number | null;
  frequencies: FinlandFrequency[];
  website: string | null;
  streams: InternetStream[];
  metadata: MetadataConfig;
  logo: string | null;
  status: Station['status'];
  verification: { stationVerifiedAt: string | null; frequencyVerifiedAt: string | null; sources: string[]; notes: string };
};
type FinlandRegion = { id: string; name: string; stations: string[]; cities: string[] };
type FinlandCity = { id: string; name: string; regionId: string; stations: string[] };
type FinlandCatalogue = {
  schemaVersion: number;
  updatedAt: string | null;
  country: { id: string; name: string; code: string; timeZone: string | null };
  stations: FinlandStation[];
  nationwide: string[];
  regions: FinlandRegion[];
  cities: FinlandCity[];
};
/**
 * Estonia (R3.4) mirrors the Finland shape exactly, with one addition: an AM
 * frequency carries `band: 'AM'` (Radio Eli, AM 1035 kHz) so the chip renders
 * «1035 кГц» instead of inventing an FM number.
 */
type EstoniaFrequency = { locality: string | null; region: string | null; mhz: number; band?: 'FM' | 'AM' };
type EstoniaStation = {
  id: string;
  name: string;
  type: 'nationwide' | 'regional' | 'local';
  language: string | null;
  genres: string[];
  frequencyMHz: number | null;
  frequencies: EstoniaFrequency[];
  website: string | null;
  streams: InternetStream[];
  metadata: MetadataConfig;
  logo: string | null;
  status: Station['status'];
  verification: { stationVerifiedAt: string | null; frequencyVerifiedAt: string | null; sources: string[]; notes: string };
};
type EstoniaRegion = { id: string; name: string; stations: string[]; cities: string[] };
type EstoniaCity = { id: string; name: string; regionId: string; stations: string[] };
type EstoniaCatalogue = {
  schemaVersion: number;
  updatedAt: string | null;
  country: { id: string; name: string; code: string; timeZone: string | null };
  stations: EstoniaStation[];
  nationwide: string[];
  regions: EstoniaRegion[];
  cities: EstoniaCity[];
};
/** Shared view shape so the Russia audit/metadata helpers accept Finland/Estonia entries structurally. */
type CatalogueStation = Station | InternetStation | FinlandStation | EstoniaStation;
type RuntimeState = 'available' | 'connecting' | 'live' | 'failed';
type AuditResult = { stationId: string; stationName: string; ok: boolean; streamIndex: number | null; format: string | null; error: string | null };
type StationMetadataAudit = MetadataProbeResult & { stationId: string; stationName: string };
/** Player status as a message key (+ params) so a language switch re-renders it live. */
type PlayerStatus = { key: MessageKey; params?: MessageParams };

const catalogue = catalogueData as Catalogue;
const LAST_STATION_KEY = 'efirio.lastStationId';
const CITY_ID_KEY = 'efirio.cityId';
const FALLBACK_CITY_ID = 'saint-petersburg';
const APP_VERSION = 'Alpha 0.1';
/** Finland keeps its own geography keys so neither the saved Russian city nor the UK internet selection is ever touched. */
const FINLAND_REGION_KEY = 'efirio.finlandRegionId';
const FINLAND_CITY_KEY = 'efirio.finlandCityId';
const FINLAND_ALL_REGIONS = 'all';
const FINLAND_ALL_CITIES = 'all';
/** Estonia keeps its own geography keys, exactly like Finland: no other scope is ever disturbed. */
const ESTONIA_REGION_KEY = 'efirio.estoniaRegionId';
const ESTONIA_CITY_KEY = 'efirio.estoniaCityId';
const ESTONIA_ALL_REGIONS = 'all';
const ESTONIA_ALL_CITIES = 'all';

/** The index is tiny and always bundled; each country's stations are a separate chunk fetched only when opened. */
// The index ships as data rather than a typed module, so it is narrowed through
// `unknown`. Keeping the country list shape in `InternetIndex` is what the schema and
// the catalogue builder are validated against at build time.
const internetIndex = internetIndexData as unknown as InternetIndex;
// The index lives beside the catalogue files so that the glob below only ever sees
// per-country chunks, never the index itself. Each country module is the record.
const internetCountryModules = import.meta.glob('../../data/internet/*.json', { import: 'default' });
function loadInternetCountry(id: string): Promise<InternetCountry> {
  const loader = internetCountryModules[`../../data/internet/${id}.json`];
  if (!loader) return Promise.reject(new Error(`No internet catalogue for "${id}"`));
  return loader().then((module) => module as InternetCountry);
}

/**
 * The Finnish terrestrial catalogue is a single country file behind its own glob,
 * so it ships as a separate lazy chunk and is fetched only when the Finland
 * category is opened. The Finnish internet-only catalogue is a regular
 * `data/internet/*.json` country file and reuses `loadInternetCountry('finland')`.
 */
const finlandModules = import.meta.glob('../../data/finland.json', { import: 'default' });
function loadFinlandCatalogue(): Promise<FinlandCatalogue> {
  const loader = finlandModules['../../data/finland.json'];
  if (!loader) return Promise.reject(new Error('Finland catalogue unavailable'));
  return loader().then((module) => module as FinlandCatalogue);
}

/**
 * The Estonian terrestrial catalogue follows the same pattern: a single country
 * file behind its own glob, fetched only when «Эстония» is opened. The Estonian
 * internet-only catalogue is a regular `data/internet/*.json` country file and
 * reuses `loadInternetCountry('estonia')` (the UK-only index is untouched).
 */
const estoniaModules = import.meta.glob('../../data/estonia.json', { import: 'default' });
function loadEstoniaCatalogue(): Promise<EstoniaCatalogue> {
  const loader = estoniaModules['../../data/estonia.json'];
  if (!loader) return Promise.reject(new Error('Estonia catalogue unavailable'));
  return loader().then((module) => module as EstoniaCatalogue);
}

/** Every city in the catalogue with its region, so the UI can walk region → city without hard-coding either. */
type LocatedCity = { city: City; region: Region };
const ALL_CITIES: LocatedCity[] = catalogue.countries.flatMap((country) => country.regions.flatMap((region) => region.cities.map((city) => ({ city, region }))));
const REGIONS: Region[] = catalogue.countries.flatMap((country) => country.regions);

function findCity(id: string | null): LocatedCity | undefined {
  if (!id) return undefined;
  return ALL_CITIES.find((candidate) => candidate.city.id === id);
}
/** New installs, unknown or removed ids always land on Saint Petersburg. */
function resolveCity(id: string | null): LocatedCity { return findCity(id) ?? findCity(FALLBACK_CITY_ID) ?? ALL_CITIES[0]; }

/** Now Playing time is always rendered in the station time zone, never the device zone. */
function nowPlayingTimeLabel(t: TFunction, track: NormalizedTrack): string {
  if (track.timeQuality === 'exact' && track.startedAt) return t('timeSource', { time: formatInTimeZone(track.startedAt, track.timeZone, { withDate: true }) });
  if (track.sourceLocalTime) return track.timeZone ? t('timeStation', { time: track.sourceLocalTime, zone: track.timeZone }) : t('timeStationNoZone', { time: track.sourceLocalTime });
  return t('timeDetected', { time: formatInTimeZone(track.detectedAt, track.timeZone, { withDate: true }) });
}

/** Short label for non-music air items; music needs no label. Values are message keys. */
const KIND_KEYS: Partial<Record<NormalizedTrack['kind'], MessageKey>> = { program: 'kindProgramme', talk: 'kindTalk', jingle: 'kindJingle', advert: 'kindAdvert' };

/** Running line for the footer: station name (accent colour) + what is on air now. Scrolls only when it does not fit. */
function airText(track: NormalizedTrack): string {
  const artist = track.artist?.trim() ?? '';
  const title = track.title?.trim() ?? '';
  return artist && title ? `${artist} — ${title}` : artist || title;
}

function Ticker({ station, air }: { station: string; air: string }) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const itemRef = React.useRef<HTMLElement | null>(null);
  const [scroll, setScroll] = React.useState(false);
  const plain = station && air ? `${station} · ${air}` : station || air;
  React.useLayoutEffect(() => {
    const box = boxRef.current; const item = itemRef.current;
    if (!box || !item) return;
    setScroll(item.scrollWidth > box.clientWidth + 1);
  }, [plain]);
  const seconds = Math.max(10, plain.length * 0.3);
  const content = (
    <>
      {station ? <em className="tickerStation">{station}</em> : null}
      {station && air ? <i className="tickerDot">·</i> : null}
      {air}
    </>
  );
  return (
    <div className="ticker" ref={boxRef} title={plain}>
      <div className={scroll ? 'tickerTrack run' : 'tickerTrack'} style={scroll ? { animationDuration: `${seconds}s` } : undefined}>
        <b className="tickerItem" ref={itemRef}>{content}</b>
        {scroll ? <b className="tickerItem" aria-hidden="true">{content}</b> : null}
      </div>
    </div>
  );
}

function mediaErrorText(error: MediaError | null) { if (!error) return 'unknown media error'; const names: Record<number, string> = { 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' }; return names[error.code] ?? `MEDIA_ERR_${error.code}`; }
function probeStream(url: string, timeoutMs = 7000): Promise<{ ok: boolean; error: string | null }> { return new Promise((resolve) => { const audio = new Audio(); audio.preload = 'auto'; audio.muted = true; let settled = false; const finish = (ok: boolean, error: string | null) => { if (settled) return; settled = true; clearTimeout(timer); audio.pause(); audio.removeAttribute('src'); audio.load(); resolve({ ok, error }); }; const timer = window.setTimeout(() => finish(false, 'TIMEOUT'), timeoutMs); audio.addEventListener('playing', () => finish(true, null), { once: true }); audio.addEventListener('canplay', () => finish(true, null), { once: true }); audio.addEventListener('error', () => finish(false, mediaErrorText(audio.error)), { once: true }); audio.src = url; audio.load(); void audio.play().catch((error) => finish(false, error instanceof Error ? error.name : 'PLAY_REJECTED')); }); }

function App() {
  /**
   * Live UI language. The snapshot is a version counter that also bumps when a
   * lazy dictionary finishes loading, and it is an effect dependency — so side
   * effects keyed on the language (the document title) re-run once the
   * translated strings actually arrive, not only when the code changes.
   */
  const langVersion = React.useSyncExternalStore(subscribeLanguage, getLanguageVersion, () => 0);
  const lang = getLanguage();
  const t = React.useCallback<TFunction>((key, params) => translate(lang, key, params), [lang]);
  React.useEffect(() => { document.documentElement.lang = lang; document.title = `EFIRIO — ${t('tagline')}`; }, [lang, langVersion, t]);
  const [cityId, setCityId] = React.useState<string | null>(() => { const saved = safeGetItem(() => localStorage.getItem(CITY_ID_KEY)); return resolveCity(saved).city.id; });
  const located = resolveCity(cityId);
  const city = located.city;
  const cityRegion = located.region;
  /**
   * Scope lives in its own key, deliberately separate from `efirio.cityId`, so
   * switching between Russia and Internet never disturbs the saved Russian city.
   * One idempotent boot pass feeds both selectors: a legacy `finland-internet` /
   * `estonia-internet` value is rewritten to `internet` + country here, so scope
   * and country can never disagree (StrictMode's double-run simply reads the
   * already-migrated values).
   */
  const persistedScope = React.useMemo(() => bootScope({
    get: (key) => safeGetItem(() => localStorage.getItem(key)),
    set: (key, value) => { safeSetItem(() => localStorage.setItem(key, value)); },
  }), []);
  const [scope, setScope] = React.useState<Scope>(persistedScope.scope);
  const [internetCountryId, setInternetCountryId] = React.useState<string | null>(persistedScope.internetCountryId);
  const [internetCountryData, setInternetCountryData] = React.useState<InternetCountry | null>(null);
  const [internetLoading, setInternetLoading] = React.useState(false);
  /** Error states hold a message key, so the text follows the active language. */
  const [internetError, setInternetError] = React.useState<MessageKey | null>(null);
  const isInternet = scope === 'internet';
  const isFinland = scope === 'finland';
  const isEstonia = scope === 'estonia';
  /** Falls back to the first listed country when the saved id is unknown or removed. */
  const internetCountry = React.useMemo(() => internetIndex.countries.find((candidate) => candidate.id === internetCountryId) ?? internetIndex.countries[0] ?? null, [internetCountryId]);
  /** Finland terrestrial catalogue, loaded on demand from its own lazy chunk. */
  const [finlandData, setFinlandData] = React.useState<FinlandCatalogue | null>(null);
  const [finlandLoading, setFinlandLoading] = React.useState(false);
  const [finlandError, setFinlandError] = React.useState<MessageKey | null>(null);
  /** Estonia terrestrial catalogue, loaded on demand from its own lazy chunk. */
  const [estoniaData, setEstoniaData] = React.useState<EstoniaCatalogue | null>(null);
  const [estoniaLoading, setEstoniaLoading] = React.useState(false);
  const [estoniaError, setEstoniaError] = React.useState<MessageKey | null>(null);
  /**
   * Finland geography persists under its own keys: neither the saved Russian city
   * nor the UK internet selection is ever read or written here. Unknown or removed
   * ids simply resolve to «Вся страна» / «Все города» below.
   */
  const [finlandRegionId, setFinlandRegionId] = React.useState<string>(() => safeGetItem(() => localStorage.getItem(FINLAND_REGION_KEY)) || FINLAND_ALL_REGIONS);
  const [finlandCityId, setFinlandCityId] = React.useState<string>(() => safeGetItem(() => localStorage.getItem(FINLAND_CITY_KEY)) || FINLAND_ALL_CITIES);
  const fiRegion = finlandData?.regions.find((candidate) => candidate.id === finlandRegionId) ?? null;
  const fiCities = React.useMemo(() => (fiRegion && finlandData ? finlandData.cities.filter((candidate) => candidate.regionId === fiRegion.id) : []), [finlandData, fiRegion]);
  const fiCity = fiCities.find((candidate) => candidate.id === finlandCityId) ?? null;
  /**
   * Finland search covers station names, cities and regions across the whole
   * Finnish catalogue, so a regional station is reachable even from «Вся страна».
   * Geo entries are built from the id-referencing buckets — never from station copies.
   */
  const [fiQuery, setFiQuery] = React.useState('');
  const trimmedFiQuery = fiQuery.trim();
  const fiGeoIndex = React.useMemo(() => {
    const index = new Map<string, { station: FinlandStation; regions: string[]; cities: string[] }>();
    if (!finlandData) return index;
    for (const station of finlandData.stations) index.set(station.id, { station, regions: [], cities: [] });
    for (const region of finlandData.regions) for (const id of region.stations) index.get(id)?.regions.push(region.name);
    for (const cityEntry of finlandData.cities) {
      const regionName = finlandData.regions.find((candidate) => candidate.id === cityEntry.regionId)?.name ?? '';
      for (const id of cityEntry.stations) {
        const entry = index.get(id);
        if (!entry) continue;
        entry.cities.push(cityEntry.name);
        if (regionName && !entry.regions.includes(regionName)) entry.regions.push(regionName);
      }
    }
    return index;
  }, [finlandData]);
  const fiSearchResults = React.useMemo(() => {
    const needle = trimmedFiQuery.toLowerCase();
    if (!needle) return [];
    const results: Array<{ station: FinlandStation; where: string }> = [];
    for (const entry of fiGeoIndex.values()) {
      const hitCity = entry.cities.find((value) => value.toLowerCase().includes(needle)) ?? null;
      const hitRegion = entry.regions.find((value) => value.toLowerCase().includes(needle)) ?? null;
      // Nationwide stations are never copied into city buckets, yet their confirmed
      // transmitters do carry the searched town — frequency rows are territory-tagged,
      // so they count as a geographic match without breaking the bucket design.
      const hitFreq = entry.station.frequencies.find((value) => (value.locality ?? '').toLowerCase().includes(needle) || (value.region ?? '').toLowerCase().includes(needle)) ?? null;
      const hitFreqLocality = hitFreq && (hitFreq.locality ?? '').toLowerCase().includes(needle) ? hitFreq.locality : null;
      const hitFreqRegion = hitFreq && (hitFreq.region ?? '').toLowerCase().includes(needle) ? hitFreq.region : null;
      const match = entry.station.name.toLowerCase().includes(needle) || !!hitCity || !!hitRegion || !!hitFreq;
      if (match) results.push({ station: entry.station, where: hitCity ?? hitFreqLocality ?? hitRegion ?? hitFreqRegion ?? entry.cities[0] ?? entry.regions[0] ?? '' });
    }
    return results;
  }, [fiGeoIndex, trimmedFiQuery]);
  /** «Вся страна» lists the nationwide bucket; a region lists its regional/local stations; a city narrows further. */
  const finlandVisibleStations = React.useMemo<FinlandStation[]>(() => {
    if (!finlandData) return [];
    if (trimmedFiQuery) return fiSearchResults.map((entry) => entry.station);
    const ids = !fiRegion ? finlandData.nationwide : (fiCity ? fiCity.stations : fiRegion.stations);
    return ids.map((id) => fiGeoIndex.get(id)?.station).filter((station): station is FinlandStation => !!station);
  }, [finlandData, fiGeoIndex, trimmedFiQuery, fiSearchResults, fiRegion, fiCity]);
  /**
   * Estonia geography persists under its own keys, exactly like Finland: neither
   * the saved Russian city nor the UK internet selection is ever read or written here.
   */
  const [estoniaRegionId, setEstoniaRegionId] = React.useState<string>(() => safeGetItem(() => localStorage.getItem(ESTONIA_REGION_KEY)) || ESTONIA_ALL_REGIONS);
  const [estoniaCityId, setEstoniaCityId] = React.useState<string>(() => safeGetItem(() => localStorage.getItem(ESTONIA_CITY_KEY)) || ESTONIA_ALL_CITIES);
  const eeRegion = estoniaData?.regions.find((candidate) => candidate.id === estoniaRegionId) ?? null;
  const eeCities = React.useMemo(() => (eeRegion && estoniaData ? estoniaData.cities.filter((candidate) => candidate.regionId === eeRegion.id) : []), [estoniaData, eeRegion]);
  const eeCity = eeCities.find((candidate) => candidate.id === estoniaCityId) ?? null;
  /** Estonia search covers station names, cities and regions across the whole catalogue (all 15 maakonnad). */
  const [eeQuery, setEeQuery] = React.useState('');
  const trimmedEeQuery = eeQuery.trim();
  const eeGeoIndex = React.useMemo(() => {
    const index = new Map<string, { station: EstoniaStation; regions: string[]; cities: string[] }>();
    if (!estoniaData) return index;
    for (const station of estoniaData.stations) index.set(station.id, { station, regions: [], cities: [] });
    for (const region of estoniaData.regions) for (const id of region.stations) index.get(id)?.regions.push(region.name);
    for (const cityEntry of estoniaData.cities) {
      const regionName = estoniaData.regions.find((candidate) => candidate.id === cityEntry.regionId)?.name ?? '';
      for (const id of cityEntry.stations) {
        const entry = index.get(id);
        if (!entry) continue;
        entry.cities.push(cityEntry.name);
        if (regionName && !entry.regions.includes(regionName)) entry.regions.push(regionName);
      }
    }
    return index;
  }, [estoniaData]);
  const eeSearchResults = React.useMemo(() => {
    const needle = trimmedEeQuery.toLowerCase();
    if (!needle) return [];
    const results: Array<{ station: EstoniaStation; where: string }> = [];
    for (const entry of eeGeoIndex.values()) {
      const hitCity = entry.cities.find((value) => value.toLowerCase().includes(needle)) ?? null;
      const hitRegion = entry.regions.find((value) => value.toLowerCase().includes(needle)) ?? null;
      // Nationwide stations live only in the nationwide bucket, yet their confirmed
      // TTJA transmitter rows carry the searched town — frequency rows are
      // territory-tagged, so they count as a geographic match without copying stations.
      const hitFreq = entry.station.frequencies.find((value) => (value.locality ?? '').toLowerCase().includes(needle) || (value.region ?? '').toLowerCase().includes(needle)) ?? null;
      const hitFreqLocality = hitFreq && (hitFreq.locality ?? '').toLowerCase().includes(needle) ? hitFreq.locality : null;
      const hitFreqRegion = hitFreq && (hitFreq.region ?? '').toLowerCase().includes(needle) ? hitFreq.region : null;
      const match = entry.station.name.toLowerCase().includes(needle) || !!hitCity || !!hitRegion || !!hitFreq;
      if (match) results.push({ station: entry.station, where: hitCity ?? hitFreqLocality ?? hitRegion ?? hitFreqRegion ?? entry.cities[0] ?? entry.regions[0] ?? '' });
    }
    return results;
  }, [eeGeoIndex, trimmedEeQuery]);
  const estoniaVisibleStations = React.useMemo<EstoniaStation[]>(() => {
    if (!estoniaData) return [];
    if (trimmedEeQuery) return eeSearchResults.map((entry) => entry.station);
    const ids = !eeRegion ? estoniaData.nationwide : (eeCity ? eeCity.stations : eeRegion.stations);
    return ids.map((id) => eeGeoIndex.get(id)?.station).filter((station): station is EstoniaStation => !!station);
  }, [estoniaData, eeGeoIndex, trimmedEeQuery, eeSearchResults, eeRegion, eeCity]);
  /** The selected Internet country's endonym, shared by the picker, breadcrumb, card subtitles and player. */
  const internetCountryName = internetCountry ? countryEndonym(internetCountry.id, internetCountry.name) : '';
  /** Where the player says we are: a country endonym (never translated) or a terrestrial city/region. */
  const placeLabel = isInternet
    ? (internetCountryName || t('crumbInternet'))
    : isEstonia
      ? (eeCity?.name ?? eeRegion?.name ?? countryEndonym('estonia'))
      : isFinland
        ? (fiCity?.name ?? fiRegion?.name ?? countryEndonym('finland'))
        : city.name;
  const russianStations: Station[] = city?.stations ?? [];
  /**
   * One shared country-file state serves the unified Internet category, and it
   * only counts once it actually holds the selected country: while the next
   * country's file loads, the previous country's rows are never shown.
   */
  const netCountryData = isInternet && internetCountryData?.id === internetCountry?.id ? internetCountryData : null;
  const internetStations: InternetStation[] = netCountryData?.stations ?? [];
  const stations: Station[] = isInternet ? internetStations : isEstonia ? estoniaVisibleStations : isFinland ? finlandVisibleStations : russianStations;
  const cityTimeZone = netCountryData
    ? netCountryData.timeZone
    : isEstonia
      ? (estoniaData?.country.timeZone ?? null)
      : isFinland
        ? (finlandData?.country.timeZone ?? null)
        : (typeof city?.timeZone === 'string' && city.timeZone.trim() ? city.timeZone.trim() : null);
  const playableStations = React.useMemo(() => stations.filter((station) => station.streams.length > 0), [stations]);
  const audioRef = React.useRef<HTMLAudioElement | null>(null); const selectedRef = React.useRef<Station | null>(null); const streamIndexRef = React.useRef(0); const shouldPlayRef = React.useRef(false); const playTokenRef = React.useRef(0); const nowPlayingRef = React.useRef<NormalizedTrack | null>(null);
  /** Stream assigned for the current playback session; null while interrupted. */
  const expectedSrcRef = React.useRef<string | null>(null);
  /** Bumped on every station switch so superseded metadata responses are dropped. */
  const metadataSessionRef = React.useRef(0);
  const [selected, setSelected] = React.useState<Station | null>(() => { const savedId = safeGetItem(() => localStorage.getItem(LAST_STATION_KEY)); return stations.find((station) => station.id === savedId) ?? null; });
  const recorderRef = React.useRef<HistoryRecorder | null>(null);
  const recorderZoneRef = React.useRef<string | null>(null);
  if (!recorderRef.current || recorderZoneRef.current !== cityTimeZone) {
    let storage: StorageLike | null = null;
    try { storage = window.localStorage; } catch { storage = null; } // storage may be blocked entirely
    recorderRef.current = new HistoryRecorder({ storage, defaultTimeZone: cityTimeZone, station: selected });
    recorderZoneRef.current = cityTimeZone;
  }
  const recorder = recorderRef.current;
  const [isPlaying, setIsPlaying] = React.useState(false); const [playerStatus, setPlayerStatus] = React.useState<PlayerStatus>({ key: 'placeVersion' }); const [runtime, setRuntime] = React.useState<Record<string, RuntimeState>>({}); const [diagnostic, setDiagnostic] = React.useState('');
  const [auditRunning, setAuditRunning] = React.useState(false); const [auditProgress, setAuditProgress] = React.useState(''); const [auditResults, setAuditResults] = React.useState<AuditResult[]>([]);
  const [metadataAuditRunning, setMetadataAuditRunning] = React.useState(false); const [metadataAuditProgress, setMetadataAuditProgress] = React.useState(''); const [metadataAuditResults, setMetadataAuditResults] = React.useState<StationMetadataAudit[]>([]);
  const [nowPlaying, setNowPlaying] = React.useState<NormalizedTrack | null>(null); const [metadataStatus, setMetadataStatus] = React.useState<MessageKey | null>(null);
  const [history, setHistory] = React.useState<HistoryItem[]>(() => recorder.list);
  React.useEffect(() => recorder.subscribe(setHistory), [recorder]);
  React.useEffect(() => { selectedRef.current = selected; }, [selected]);
  const setStationRuntime = React.useCallback((stationId: string, state: RuntimeState) => setRuntime((current) => ({ ...current, [stationId]: state })), []);
  /** Read at call time so `updateMediaSession` keeps a stable identity when the city changes. */
  const cityNameRef = React.useRef(placeLabel);
  React.useEffect(() => { cityNameRef.current = placeLabel; }, [placeLabel]);
  const updateMediaSession = React.useCallback((station: Station | null, track?: NormalizedTrack | null) => { if (!station || !('mediaSession' in navigator)) return; const place = cityNameRef.current; const unitKHz = translate(getLanguage(), 'unitKHz'); const unitFM = translate(getLanguage(), 'unitFM'); navigator.mediaSession.metadata = new MediaMetadata({ title: track?.title || station.name, artist: track?.artist || (station.frequencyMHz ? (station.frequencyMHz < 10 ? `${Math.round(station.frequencyMHz * 1000)} ${unitKHz} · ${place}` : `${station.frequencyMHz.toFixed(1)} ${unitFM} · ${place}`) : place), album: station.name, artwork: track?.coverUrl ? [{ src: track.coverUrl, sizes: '300x300', type: track.coverUrl.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }] : [] }); }, []);

  /**
   * Leaving a city, or the whole scope, tears down everything that belongs to the
   * outgoing context: playback, the pending metadata watcher, runtime badges and the
   * recorder session, so a late track or audio callback from the previous context can
   * never surface on the next one.
   */
  const teardownPlayback = React.useCallback(() => {
    playTokenRef.current += 1;
    metadataSessionRef.current += 1;
    expectedSrcRef.current = null;
    shouldPlayRef.current = false;
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    nowPlayingRef.current = null;
    recorderRef.current?.selectStation(null);
    selectedRef.current = null;
    setNowPlaying(null);
    setMetadataStatus(null);
    setRuntime({});
    setDiagnostic('');
    setAuditResults([]);
    setAuditProgress('');
    setMetadataAuditResults([]);
    setMetadataAuditProgress('');
    setIsPlaying(false);
    setSelected(null);
    setPlayerStatus({ key: 'placeVersion' });
    safeSetItem(() => localStorage.setItem(LAST_STATION_KEY, ''));
  }, []);

  const changeCity = React.useCallback((nextCityId: string) => {
    const next = findCity(nextCityId);
    if (!next || next.city.id === cityId) return; // unknown ids must never silently fall back to another city
    teardownPlayback();
    safeSetItem(() => localStorage.setItem(CITY_ID_KEY, next.city.id));
    setCityId(next.city.id);
  }, [cityId, teardownPlayback]);

  /**
   * Switching scope leaves the Russian city id and its restore mechanism exactly as
   * they were; only the scope flag itself is stored. No two scopes ever share a
   * selected station, so the last-station id is cleared for the same reason a city
   * change clears it — and the outgoing playback is torn down first.
   */
  const changeScope = React.useCallback((nextScope: Scope) => {
    if (nextScope === scope) return;
    teardownPlayback();
    safeSetItem(() => localStorage.setItem(SCOPE_KEY, nextScope));
    setScope(nextScope);
  }, [scope, teardownPlayback]);

  /**
   * Switching country inside the unified Internet category behaves like every
   * other geography change: playback is torn down first (a stream from the
   * previous country must never keep playing under the new one), and the
   * selection persists under the existing country key — the Russian city and
   * the other scope keys are never touched. The catalogue itself loads through
   * the shared effect below, keyed on the resolved country.
   */
  const changeInternetCountry = React.useCallback((nextCountryId: string) => {
    if (nextCountryId === internetCountryId) return;
    teardownPlayback();
    safeSetItem(() => localStorage.setItem(INTERNET_COUNTRY_KEY, nextCountryId));
    setInternetCountryId(nextCountryId);
  }, [internetCountryId, teardownPlayback]);

  /**
   * Region and city changes inside Finland behave exactly like a Russian city
   * change: playback stops, the selection persists under the Finland-only keys.
   * The saved Russian city and the UK internet selection are never touched.
   */
  const changeFinlandRegion = React.useCallback((nextRegionId: string) => {
    const region = finlandData?.regions.find((candidate) => candidate.id === nextRegionId) ?? null;
    teardownPlayback();
    setFinlandRegionId(region?.id ?? FINLAND_ALL_REGIONS);
    setFinlandCityId(FINLAND_ALL_CITIES);
    safeSetItem(() => localStorage.setItem(FINLAND_REGION_KEY, region?.id ?? FINLAND_ALL_REGIONS));
    safeSetItem(() => localStorage.setItem(FINLAND_CITY_KEY, FINLAND_ALL_CITIES));
  }, [finlandData, teardownPlayback]);

  const changeFinlandCity = React.useCallback((nextCityId: string) => {
    const cityEntry = fiCities.find((candidate) => candidate.id === nextCityId) ?? null;
    teardownPlayback();
    setFinlandCityId(cityEntry?.id ?? FINLAND_ALL_CITIES);
    safeSetItem(() => localStorage.setItem(FINLAND_CITY_KEY, cityEntry?.id ?? FINLAND_ALL_CITIES));
  }, [fiCities, teardownPlayback]);

  /**
   * Region and city changes inside Estonia behave exactly like the Finland ones:
   * playback stops and the selection persists under the Estonia-only keys; the
   * saved Russian city and the UK internet selection are never touched.
   */
  const changeEstoniaRegion = React.useCallback((nextRegionId: string) => {
    const region = estoniaData?.regions.find((candidate) => candidate.id === nextRegionId) ?? null;
    teardownPlayback();
    setEstoniaRegionId(region?.id ?? ESTONIA_ALL_REGIONS);
    setEstoniaCityId(ESTONIA_ALL_CITIES);
    safeSetItem(() => localStorage.setItem(ESTONIA_REGION_KEY, region?.id ?? ESTONIA_ALL_REGIONS));
    safeSetItem(() => localStorage.setItem(ESTONIA_CITY_KEY, ESTONIA_ALL_CITIES));
  }, [estoniaData, teardownPlayback]);

  const changeEstoniaCity = React.useCallback((nextCityId: string) => {
    const cityEntry = eeCities.find((candidate) => candidate.id === nextCityId) ?? null;
    teardownPlayback();
    setEstoniaCityId(cityEntry?.id ?? ESTONIA_ALL_CITIES);
    safeSetItem(() => localStorage.setItem(ESTONIA_CITY_KEY, cityEntry?.id ?? ESTONIA_ALL_CITIES));
  }, [eeCities, teardownPlayback]);

  /** Countries are separate static files, loaded only when that country is opened. */
  React.useEffect(() => {
    if (!isInternet || !internetCountry) return;
    const target = internetCountry.id;
    if (internetCountryData?.id === target) return;
    let cancelled = false;
    setInternetLoading(true);
    setInternetError(null);
    void loadInternetCountry(target)
      .then((data) => {
        if (cancelled) return;
        setInternetCountryData(data);
        setInternetCountryId(target);
        safeSetItem(() => localStorage.setItem(INTERNET_COUNTRY_KEY, target));
      })
      .catch(() => { if (!cancelled) setInternetError('errCountryLoad'); })
      .finally(() => { if (!cancelled) setInternetLoading(false); });
    return () => { cancelled = true; };
  }, [isInternet, internetCountry, internetCountryData]);

  /** The Finnish terrestrial catalogue is a lazy chunk, fetched on the first switch to the category. */
  React.useEffect(() => {
    if (!isFinland || finlandData) return;
    let cancelled = false;
    setFinlandLoading(true);
    setFinlandError(null);
    void loadFinlandCatalogue()
      .then((data) => { if (!cancelled) setFinlandData(data); })
      .catch(() => { if (!cancelled) setFinlandError('errFinlandLoad'); })
      .finally(() => { if (!cancelled) setFinlandLoading(false); });
    return () => { cancelled = true; };
  }, [isFinland, finlandData]);

  /** The Estonian terrestrial catalogue is a lazy chunk, fetched on the first switch to the category. */
  React.useEffect(() => {
    if (!isEstonia || estoniaData) return;
    let cancelled = false;
    setEstoniaLoading(true);
    setEstoniaError(null);
    void loadEstoniaCatalogue()
      .then((data) => { if (!cancelled) setEstoniaData(data); })
      .catch(() => { if (!cancelled) setEstoniaError('errEstoniaLoad'); })
      .finally(() => { if (!cancelled) setEstoniaLoading(false); });
    return () => { cancelled = true; };
  }, [isEstonia, estoniaData]);

  React.useEffect(() => {
    setNowPlaying(null); nowPlayingRef.current = null; setMetadataStatus(null);
    if (!isSupportedMetadata(selected?.metadata)) return;
    setMetadataStatus('loadingTrack');
    const session = metadataSessionRef.current;
    const isActive = () => session === metadataSessionRef.current;
    return watchNowPlaying(selected.metadata, { timeZone: cityTimeZone, isActive }, (track) => {
      if (!track) { setMetadataStatus('noTrackMetadata'); return; }
      setMetadataStatus(null); setNowPlaying(track); nowPlayingRef.current = track; updateMediaSession(selected, track);
      recorder.handleMetadata(track, selected.id);
    }, (error) => { console.warn('[EFIRIO] metadata', selected.id, error); setMetadataStatus('metadataUnavailable'); });
  }, [selected, cityTimeZone, recorder, updateMediaSession]);

  const playStream = React.useCallback(async (station: Station, streamIndex = 0, token = ++playTokenRef.current): Promise<void> => { const audio = audioRef.current; const stream = station.streams[streamIndex]; if (!audio || !stream || token !== playTokenRef.current) return; streamIndexRef.current = streamIndex; setStationRuntime(station.id, 'connecting'); setPlayerStatus({ key: streamIndex === 0 ? 'connecting' : 'connectingFallback' }); setDiagnostic(`${stream.role} · ${stream.format} · ${stream.url}`); updateMediaSession(station, nowPlaying); audio.src = stream.url; expectedSrcRef.current = stream.url; audio.load(); try { await audio.play(); if (token !== playTokenRef.current) return; setIsPlaying(true); setStationRuntime(station.id, 'live'); setPlayerStatus({ key: streamIndex === 0 ? 'live' : 'liveFallback' }); } catch (error) { if (token !== playTokenRef.current) return; const reason = error instanceof Error ? error.name : mediaErrorText(audio.error); setDiagnostic(`${stream.role} · ${stream.format} · ${reason} · ${stream.url}`); if (shouldPlayRef.current && streamIndex + 1 < station.streams.length) await playStream(station, streamIndex + 1, token); else { setIsPlaying(false); setStationRuntime(station.id, 'failed'); setPlayerStatus({ key: 'failedWith', params: { error: mediaErrorText(audio.error) } }); } } }, [nowPlaying, setStationRuntime, updateMediaSession]);
  const chooseStation = React.useCallback(async (station: Station, autoPlay = true) => { playTokenRef.current += 1; metadataSessionRef.current += 1; expectedSrcRef.current = null; selectedRef.current = station; setSelected(station); recorderRef.current?.selectStation(station); nowPlayingRef.current = null; safeSetItem(() => localStorage.setItem(LAST_STATION_KEY, station.id)); streamIndexRef.current = 0; updateMediaSession(station); const audio = audioRef.current; if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } setIsPlaying(false); if (!station.streams.length) { shouldPlayRef.current = false; setPlayerStatus({ key: 'streamUnavailable' }); setDiagnostic('No validated production stream'); return; } setStationRuntime(station.id, 'available'); if (autoPlay) { shouldPlayRef.current = true; await playStream(station, 0, playTokenRef.current); } else setPlayerStatus({ key: 'available' }); }, [playStream, setStationRuntime, updateMediaSession]);
  const togglePlayback = React.useCallback(async () => { const station = selectedRef.current; const audio = audioRef.current; if (!station?.streams.length || !audio) return; if (isPlaying) { shouldPlayRef.current = false; expectedSrcRef.current = null; audio.pause(); setIsPlaying(false); setPlayerStatus({ key: 'paused' }); return; } shouldPlayRef.current = true; await playStream(station, streamIndexRef.current); }, [isPlaying, playStream]);
  const stepStation = React.useCallback(async (direction: -1 | 1) => { if (!playableStations.length) return; const current = selectedRef.current; const currentIndex = current ? playableStations.findIndex((station) => station.id === current.id) : -1; const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0; const nextIndex = (baseIndex + direction + playableStations.length) % playableStations.length; await chooseStation(playableStations[nextIndex], true); }, [chooseStation, playableStations]);

  const runAudit = React.useCallback(async () => { if (auditRunning) return; shouldPlayRef.current = false; playTokenRef.current += 1; audioRef.current?.pause(); expectedSrcRef.current = null; recorderRef.current?.setPlaying(false); setIsPlaying(false); setAuditRunning(true); setAuditResults([]); const results: AuditResult[] = []; for (let stationIndex = 0; stationIndex < playableStations.length; stationIndex += 1) { const station = playableStations[stationIndex]; setAuditProgress(`${stationIndex + 1}/${playableStations.length} · ${station.name}`); let passed: AuditResult | null = null; let lastError = 'NO_STREAM_PASSED'; for (let streamIndex = 0; streamIndex < station.streams.length; streamIndex += 1) { const stream = station.streams[streamIndex]; const probe = await probeStream(stream.url); if (probe.ok) { passed = { stationId: station.id, stationName: station.name, ok: true, streamIndex, format: stream.format, error: null }; break; } lastError = `${stream.role}/${stream.format}: ${probe.error}`; } const result = passed ?? { stationId: station.id, stationName: station.name, ok: false, streamIndex: null, format: null, error: lastError }; results.push(result); setAuditResults([...results]); setStationRuntime(station.id, result.ok ? 'available' : 'failed'); } setAuditRunning(false); setAuditProgress(`Complete · ${results.filter((r) => r.ok).length}/${results.length} browser-playable`); console.table(results); }, [auditRunning, playableStations, setStationRuntime]);
  const runMetadataAudit = React.useCallback(async () => { if (metadataAuditRunning) return; setMetadataAuditRunning(true); setMetadataAuditResults([]); const results: StationMetadataAudit[] = []; for (let index = 0; index < stations.length; index += 1) { const station = stations[index]; setMetadataAuditProgress(`${index + 1}/${stations.length} · ${station.name}`); const probe = await probeMetadata(station.metadata, 8000, { timeZone: cityTimeZone }); const result = { ...probe, stationId: station.id, stationName: station.name }; results.push(result); setMetadataAuditResults([...results]); } setMetadataAuditRunning(false); setMetadataAuditProgress(`Complete · ${results.filter((r) => r.ok).length}/${results.length} Now Playing available`); console.table(results); }, [metadataAuditRunning, stations, cityTimeZone]);

  React.useEffect(() => {
    const audio = new Audio(); audio.preload = 'none'; audioRef.current = audio;
    const onPlaying = () => {
      setIsPlaying(true);
      // A `playing` task queued before a pause, stop, station switch or a
      // cancelled start may be delivered afterwards; only a confirmed start of
      // the current session may open the history gate.
      const confirmed = canOpenHistoryOnPlaying({
        shouldPlay: shouldPlayRef.current,
        paused: audio.paused,
        readyState: audio.readyState,
        mediaSrc: audio.getAttribute('src'),
        expectedSrc: expectedSrcRef.current,
      });
      if (!confirmed) return;
      const recorder = recorderRef.current; recorder?.setPlaying(true);
      const station = selectedRef.current; const track = nowPlayingRef.current;
      if (station && track) recorder?.handleMetadata(track, station.id);
    };
    const onPause = () => { setIsPlaying(false); recorderRef.current?.setPlaying(false); };
    const onError = () => { recorderRef.current?.setPlaying(false); const station = selectedRef.current; if (!shouldPlayRef.current || !station) return; const failed = station.streams[streamIndexRef.current]; setDiagnostic(`${failed?.role ?? 'stream'} · ${failed?.format ?? 'unknown'} · ${mediaErrorText(audio.error)} · ${failed?.url ?? audio.currentSrc}`); };
    audio.addEventListener('playing', onPlaying); audio.addEventListener('pause', onPause); audio.addEventListener('error', onError);
    return () => { shouldPlayRef.current = false; expectedSrcRef.current = null; recorderRef.current?.setPlaying(false); audio.pause(); audio.removeEventListener('playing', onPlaying); audio.removeEventListener('pause', onPause); audio.removeEventListener('error', onError); audioRef.current = null; };
  }, []);
  React.useEffect(() => { if (!selected || !('mediaSession' in navigator)) return; const mediaSession = navigator.mediaSession; mediaSession.setActionHandler('play', () => void togglePlayback()); mediaSession.setActionHandler('pause', () => void togglePlayback()); mediaSession.setActionHandler('previoustrack', () => void stepStation(-1)); mediaSession.setActionHandler('nexttrack', () => void stepStation(1)); return () => { mediaSession.setActionHandler('play', null); mediaSession.setActionHandler('pause', null); mediaSession.setActionHandler('previoustrack', null); mediaSession.setActionHandler('nexttrack', null); }; }, [selected, stepStation, togglePlayback]);
  const badge = (station: Station): [string, MessageKey] => { if (!station.streams.length) return ['research', 'unavailable']; const state = runtime[station.id] ?? 'available'; if (state === 'connecting') return ['research', 'connecting']; if (state === 'live') return ['ready', 'live']; if (state === 'failed') return ['research', 'failed']; return ['ready', 'available']; };

  /** Region → city. Picking a region whose cities do not include the current city lands on its first city. */
  const citiesInRegion = cityRegion?.cities ?? [];
  const onRegionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = REGIONS.find((candidate) => candidate.id === event.target.value);
    if (!next) return;
    if (next.cities.some((candidate) => candidate.id === city?.id)) return;
    if (next.cities[0]) changeCity(next.cities[0].id);
  };
  /** City search over the whole catalogue, matching Latin and Cyrillic spellings case-insensitively. */
  const [query, setQuery] = React.useState('');
  const trimmedQuery = query.trim();
  const matches = React.useMemo(() => {
    if (!trimmedQuery) return [];
    const needle = trimmedQuery.toLowerCase();
    return ALL_CITIES.filter(({ city: candidate }) => candidate.name.toLowerCase().includes(needle)).slice(0, 24);
  }, [trimmedQuery]);

  /** Internet filters: station-name search plus genre/city, only where the catalogue knows them. */
  const [netQuery, setNetQuery] = React.useState('');
  const [netGenre, setNetGenre] = React.useState('');
  const [netCity, setNetCity] = React.useState('');
  const trimmedNetQuery = netQuery.trim().toLowerCase();
  const genreCounts = React.useMemo(() => internetStations.reduce((counts, station) => { for (const genre of station.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1); return counts; }, new Map<string, number>()), [internetStations]);
  // A filter must only offer what it can meaningfully select. Full Radio Browser tag
  // strings run to hundreds of near-duplicate one-offs, so only genres shared by at
  // least four stations are offered as filters; every station keeps its full tag set.
  const GENRE_MIN_SHARE = 4;
    const netGenres = React.useMemo(() => [...genreCounts.entries()].filter(([, count]) => count >= GENRE_MIN_SHARE).map(([genre]) => genre).sort((a, b) => a.localeCompare(b)), [genreCounts]);
  const netCities = React.useMemo(() => [...new Set(internetStations.map((station) => station.city).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b)), [internetStations]);
  const filteredInternet = React.useMemo(() => {
    if (!isInternet) return [] as InternetStation[];
    return internetStations.filter((station) => (!trimmedNetQuery || station.name.toLowerCase().includes(trimmedNetQuery)) && (!netGenre || station.genres.includes(netGenre)) && (!netCity || station.city === netCity));
  }, [isInternet, internetStations, trimmedNetQuery, netGenre, netCity]);
  /** Filters never leak across categories or countries: a UK city must not hide Finnish stations. */
  React.useEffect(() => { setNetQuery(''); setNetGenre(''); setNetCity(''); setFiQuery(''); }, [scope, internetCountryId]);
  /**
   * The internet catalogue holds well over a thousand entries, so only this many rows
   * are mounted at once; the rest are reached incrementally through "Show more".
   * Finland uses the same incremental rendering for its (smaller) lists.
   */
  const VISIBLE_CHUNK = 60;
  const [visibleCount, setVisibleCount] = React.useState(VISIBLE_CHUNK);
  React.useEffect(() => { setVisibleCount(VISIBLE_CHUNK); }, [trimmedNetQuery, netGenre, netCity, internetCountryData, trimmedFiQuery, finlandData, finlandRegionId, finlandCityId, trimmedEeQuery, estoniaData, estoniaRegionId, estoniaCityId]);
  const shownList: Station[] = isInternet ? filteredInternet : isEstonia ? estoniaVisibleStations : isFinland ? finlandVisibleStations : stations;
  const chunkedView = isInternet || isFinland || isEstonia;
  const visibleStations: Station[] = chunkedView ? shownList.slice(0, visibleCount) : stations;
  /**
   * The frequency chip follows the current geography — the place that matched an
   * active search, else the city's confirmed FM, else the region's, else the
   * record's first confirmed value — and never invents one: without a confirmed
   * FM value for that territory the "FI" geo chip shows instead.
   */
  const fiFrequency = (fi: FinlandStation, where?: string): number | null => {
    if (fi.frequencies.length) {
      if (where) {
        const hit = fi.frequencies.find((value) => (value.locality && (value.locality === where || value.locality.startsWith(where) || where.startsWith(value.locality))) || value.region === where);
        if (hit) return hit.mhz;
      }
      if (fiCity) {
        const hit = fi.frequencies.find((value) => value.locality && (value.locality === fiCity.name || value.locality.startsWith(fiCity.name)));
        if (hit) return hit.mhz;
      }
      if (fiRegion) {
        const hit = fi.frequencies.find((value) => value.region === fiRegion.name);
        if (hit) return hit.mhz;
      }
    }
    return fi.frequencyMHz;
  };
  /**
   * Estonia chip: the matched frequency *with its band*. An AM row (Radio Eli,
   * AM 1035 kHz) renders «1035 кГц» — an FM number is never invented either way.
   */
  const eeFrequency = (ee: EstoniaStation, where?: string): { mhz: number; band: 'FM' | 'AM' } | null => {
    const bandOf = (value: EstoniaFrequency): { mhz: number; band: 'FM' | 'AM' } => ({ mhz: value.mhz, band: value.band ?? 'FM' });
    if (ee.frequencies.length) {
      if (where) {
        const hit = ee.frequencies.find((value) => (value.locality && (value.locality === where || value.locality.startsWith(where) || where.startsWith(value.locality))) || value.region === where);
        if (hit) return bandOf(hit);
      }
      if (eeCity) {
        const hit = ee.frequencies.find((value) => value.locality && (value.locality === eeCity.name || value.locality.startsWith(eeCity.name)));
        if (hit) return bandOf(hit);
      }
      if (eeRegion) {
        const hit = ee.frequencies.find((value) => value.region === eeRegion.name);
        if (hit) return bandOf(hit);
      }
      if (ee.frequencyMHz != null) {
        const hit = ee.frequencies.find((value) => value.mhz === ee.frequencyMHz);
        if (hit) return bandOf(hit);
      }
    }
    return ee.frequencyMHz != null ? { mhz: ee.frequencyMHz, band: 'FM' } : null;
  };
  const netGeoCode = internetCountry?.code ?? 'GB';

  return <main className="shell">
    <header className="brand"><div className="mark" aria-hidden="true">E)))</div><div><h1>EFIRIO</h1><p>{t('tagline')}</p></div></header>
    <section className="location">{isInternet
      ? <><span>{t('crumbInternet')}</span><b>›</b><span>{internetCountryName || '—'}</span><b>›</b><span>{t('crumbStations')}</span></>
      : isEstonia
        ? <><span>{countryEndonym('estonia')}</span><b>›</b><span>{eeRegion?.name ?? t('allCountry')}</span>{eeCity ? <><b>›</b><span>{eeCity.name}</span></> : null}</>
        : isFinland
          ? <><span>{countryEndonym('finland')}</span><b>›</b><span>{fiRegion?.name ?? t('allCountry')}</span>{fiCity ? <><b>›</b><span>{fiCity.name}</span></> : null}</>
          : <><span>{countryEndonym('russia')}</span><b>›</b><span>{cityRegion?.name ?? '—'}</span><b>›</b><span>{city?.name ?? '—'}</span></>}</section>
    <section className="cityPicker">
      <label className="cityField scopeField"><span>{t('categoryLabel')}</span>
        <select value={scope} onChange={(event) => changeScope(event.target.value as Scope)}>
          <option value="russia">{countryEndonym('russia')}</option>
          <option value="internet">{t('scopeInternet')}</option>
          <option value="finland">{countryEndonym('finland')}</option>
          <option value="estonia">{countryEndonym('estonia')}</option>
        </select>
      </label>
      <label className="cityField"><span>{t('languageLabel')}</span>
        <select value={lang} onChange={(event) => setLanguage(event.target.value as Language)}>
          {SUPPORTED_LANGUAGES.map((code) => <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>)}
        </select>
      </label>
      {isInternet ? <>
        <label className="cityField"><span>{t('countryLabel')}</span>
          <select value={internetCountry?.id ?? ''} onChange={(event) => changeInternetCountry(event.target.value)}>
            {internetIndex.countries.map((candidate) => <option key={candidate.id} value={candidate.id}>{countryEndonym(candidate.id, candidate.name)}</option>)}
          </select>
        </label>
        <label className="cityField citySearch"><span>{t('findStation')}</span>
          <input type="search" inputMode="search" autoComplete="off" value={netQuery} onChange={(event) => setNetQuery(event.target.value)} placeholder={t('stationNamePlaceholder')} aria-label={t('searchStationAria')} />
        </label>
        {netGenres.length > 0 ? <label className="cityField"><span>{t('genreLabel')}</span>
          <select value={netGenre} onChange={(event) => setNetGenre(event.target.value)}>
            <option value="">{t('allGenres')}</option>
            {netGenres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
          </select>
        </label> : null}
        {netCities.length > 0 ? <label className="cityField"><span>{t('cityLabel')}</span>
          <select value={netCity} onChange={(event) => setNetCity(event.target.value)}>
            <option value="">{t('allCities')}</option>
            {netCities.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label> : null}
      </> : isFinland ? <>
        <label className="cityField"><span>{t('regionLabel')}</span>
          <select value={fiRegion?.id ?? FINLAND_ALL_REGIONS} onChange={(event) => changeFinlandRegion(event.target.value)}>
            <option value={FINLAND_ALL_REGIONS}>{t('allCountry')}</option>
            {(finlandData?.regions ?? []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </label>
        {fiRegion ? <label className="cityField"><span>{t('cityLabel')}</span>
          <select value={fiCity?.id ?? FINLAND_ALL_CITIES} onChange={(event) => changeFinlandCity(event.target.value)}>
            <option value={FINLAND_ALL_CITIES}>{t('allCities')}</option>
            {fiCities.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label> : null}
        <label className="cityField citySearch"><span>{t('findStation')}</span>
          <input type="search" inputMode="search" autoComplete="off" value={fiQuery} onChange={(event) => setFiQuery(event.target.value)} placeholder={t('stationGeoPlaceholder')} aria-label={t('searchFinlandAria', { country: countryEndonym('finland') })} />
        </label>
      </> : isEstonia ? <>
        <label className="cityField"><span>{t('regionLabel')}</span>
          <select value={eeRegion?.id ?? ESTONIA_ALL_REGIONS} onChange={(event) => changeEstoniaRegion(event.target.value)}>
            <option value={ESTONIA_ALL_REGIONS}>{t('allCountry')}</option>
            {(estoniaData?.regions ?? []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </label>
        {eeRegion ? <label className="cityField"><span>{t('cityLabel')}</span>
          <select value={eeCity?.id ?? ESTONIA_ALL_CITIES} onChange={(event) => changeEstoniaCity(event.target.value)}>
            <option value={ESTONIA_ALL_CITIES}>{t('allCities')}</option>
            {eeCities.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label> : null}
        <label className="cityField citySearch"><span>{t('findStation')}</span>
          <input type="search" inputMode="search" autoComplete="off" value={eeQuery} onChange={(event) => setEeQuery(event.target.value)} placeholder={t('stationGeoPlaceholder')} aria-label={t('searchEstoniaAria', { country: countryEndonym('estonia') })} />
        </label>
      </> : <>
        <label className="cityField"><span>{t('regionLabel')}</span>
          <select value={cityRegion?.id ?? ''} onChange={onRegionChange}>
            {REGIONS.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </label>
        <label className="cityField"><span>{t('cityLabel')}</span>
          <select value={city?.id ?? ''} onChange={(event) => changeCity(event.target.value)}>
            {citiesInRegion.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
        <label className="cityField citySearch"><span>{t('findCity')}</span>
          <input type="search" inputMode="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('cityNamePlaceholder')} aria-label={t('searchCityAria')} />
        </label>
      </>}
    </section>
    {scope === 'russia' && trimmedQuery ? <section className="cityMatches" aria-label={t('cityResultsAria')}>
      {matches.length ? matches.map(({ city: candidate, region }) => <button key={candidate.id} className={`cityMatch ${candidate.id === city?.id ? 'current' : ''}`} onClick={() => { setQuery(''); changeCity(candidate.id); }}><b>{candidate.name}</b><span>{region.name}</span></button>) : <p>{t('noCityMatches', { query: trimmedQuery })}</p>}
    </section> : null}
    {isInternet && internetLoading ? <section className="catalogueNote"><span>{t('loadingCatalogue', { name: internetCountryName || t('countryLabel') })}</span></section> : null}
    {isInternet && internetError ? <section className="catalogueNote error"><span>{t(internetError)}</span></section> : null}
    {isFinland && finlandLoading ? <section className="catalogueNote"><span>{t('loadingCatalogue', { name: countryEndonym('finland') })}</span></section> : null}
    {isFinland && finlandError ? <section className="catalogueNote error"><span>{t(finlandError, { country: countryEndonym('finland') })}</span></section> : null}
    {isEstonia && estoniaLoading ? <section className="catalogueNote"><span>{t('loadingCatalogue', { name: countryEndonym('estonia') })}</span></section> : null}
    {isEstonia && estoniaError ? <section className="catalogueNote error"><span>{t(estoniaError, { country: countryEndonym('estonia') })}</span></section> : null}
    {scope === 'russia' ? <>
      {auditResults.length > 0 ? <section className="auditSummary"><strong>{t('auditPlayable', { ok: auditResults.filter((r) => r.ok).length, total: auditResults.length })}</strong><span>{auditResults.filter((r) => !r.ok).map((r) => `${r.stationName}: ${r.error}`).join(' · ') || t('auditAllPassed')}</span></section> : null}
      {metadataAuditResults.length > 0 ? <section className="auditSummary"><strong>{t('auditNowPlaying', { ok: metadataAuditResults.filter((r) => r.ok).length, total: metadataAuditResults.length })}</strong><span>{metadataAuditResults.filter((r) => !r.ok).map((r) => `${r.stationName}: ${r.error}`).join(' · ') || t('auditAllMetadata')}</span></section> : null}
    </> : null}
    {selected && (nowPlaying || metadataStatus) ? <section className={nowPlaying?.coverUrl ? 'nowPlaying withCover' : 'nowPlaying'}>{nowPlaying?.coverUrl ? <img className="cover" src={nowPlaying.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}<div className="nowPlayingText"><small>{t('nowPlayingLabel')}{nowPlaying && KIND_KEYS[nowPlaying.kind] ? ` · ${t(KIND_KEYS[nowPlaying.kind]!)}` : ''}</small><strong>{nowPlaying?.title || (metadataStatus ? t(metadataStatus) : '')}</strong>{nowPlaying?.artist ? <span>{nowPlaying.artist}</span> : null}{nowPlaying ? <time>{nowPlayingTimeLabel(t, nowPlaying)}</time> : null}</div></section> : null}
    <section className="stations" aria-label={t('stationsAria', { place: placeLabel })}>{visibleStations.map((station) => {
      const [badgeClass, badgeKey] = badge(station);
      if (isEstonia) {
        const ee = station as EstoniaStation;
        const where = trimmedEeQuery ? (eeSearchResults.find((entry) => entry.station.id === ee.id)?.where ?? '') : '';
        const eeHit = eeFrequency(ee, where || undefined);
        const typeLabel = ee.type === 'nationwide' ? t('allCountry') : ee.type === 'regional' ? t('typeRegional') : t('typeLocal');
        return <button className={`station ${selected?.id === ee.id ? 'selected' : ''}`} key={ee.id} onClick={() => void chooseStation(station, station.streams.length > 0)}>
          {eeHit != null
            ? eeHit.band === 'AM'
              ? <span className="frequency">{Math.round(eeHit.mhz * 1000)} <small>{t('unitKHz')}</small></span>
              : <span className="frequency">{eeHit.mhz.toFixed(1)} <small>{t('unitFM')}</small></span>
            : <span className="frequency netGeo">EE</span>}
          <span className="stationName">{ee.name}<small className="feedScope netScope">{where ? `${typeLabel} · ${where}` : typeLabel}</small></span>
          <span className={badgeClass}>{t(badgeKey)}</span>
        </button>;
      }
      if (isFinland) {
        const fi = station as FinlandStation;
        // In search results show the place that actually matched the query, not an arbitrary first city.
        const where = trimmedFiQuery ? (fiSearchResults.find((entry) => entry.station.id === fi.id)?.where ?? '') : '';
        const fiMhz = fiFrequency(fi, where || undefined);
        const typeLabel = fi.type === 'nationwide' ? t('allCountry') : fi.type === 'regional' ? t('typeRegional') : t('typeLocal');
        return <button className={`station ${selected?.id === fi.id ? 'selected' : ''}`} key={fi.id} onClick={() => void chooseStation(station, station.streams.length > 0)}>
          {fiMhz != null ? <span className="frequency">{fiMhz.toFixed(1)} <small>{t('unitFM')}</small></span> : <span className="frequency netGeo">FI</span>}
          <span className="stationName">{fi.name}<small className="feedScope netScope">{where ? `${typeLabel} · ${where}` : typeLabel}</small></span>
          <span className={badgeClass}>{t(badgeKey)}</span>
        </button>;
      }
      const net = isInternet ? (station as InternetStation) : null;
      return <button className={`station ${selected?.id === station.id ? 'selected' : ''}`} key={station.id} onClick={() => void chooseStation(station, station.streams.length > 0)}>
        {net ? <span className="frequency netGeo">{netGeoCode}</span> : <span className="frequency">{station.frequencyMHz?.toFixed(1) ?? '—'} <small>{t('unitFM')}</small></span>}
        <span className="stationName">{station.name}{net
          ? <small className="feedScope netScope">{internetCountryName || net.country}{net.city ? ` · ${net.city}` : ''}{net.genres.length ? ` · ${net.genres.join(', ')}` : ''}</small>
          : station.feed === 'federal' ? <small className="feedScope" title={t('federalFeedHint')}>{t('federalFeed')}</small> : null}</span>
        <span className={badgeClass}>{t(badgeKey)}</span>
      </button>;
    })}{chunkedView && !visibleStations.length && !internetLoading && !finlandLoading && !estoniaLoading && (isInternet ? !!netCountryData : isEstonia ? !!estoniaData : !!finlandData) ? <p className="catalogueNote"><span>{isEstonia && trimmedEeQuery ? t('noStationMatches', { query: eeQuery.trim() }) : isFinland && trimmedFiQuery ? t('noStationMatches', { query: fiQuery.trim() }) : trimmedNetQuery ? t('noStationMatches', { query: netQuery.trim() }) : t('noStationFilters')}</span></p> : null}</section>
    {chunkedView && visibleCount < shownList.length ? <button className="showMore" onClick={() => setVisibleCount((count) => count + VISIBLE_CHUNK)}>{t('showMore', { shown: Math.min(VISIBLE_CHUNK, shownList.length - visibleCount), remaining: shownList.length - visibleCount })}</button> : null}
    {history.length > 0 ? <details className="history"><summary>{t('historyTitle', { count: history.length })}</summary>{history.slice(0, 20).map((item, index) => <div key={`${item.stationId}-${item.detectedAt}-${index}`}><time>{historyTimeLabel(item)}</time><span><b>{item.title}</b>{item.artist ? ` · ${item.artist}` : ''}<small>{item.stationName}</small></span></div>)}</details> : null}
    <footer className="player"><button className="play" disabled={!playableStations.length} onClick={() => void stepStation(-1)} aria-label={t('prevStation')}>◀</button><div className="playerInfo">{nowPlaying ? <Ticker station={selected?.name ?? ''} air={airText(nowPlaying)} /> : <strong>{selected?.name || t('chooseStation')}</strong>}<span>{selected ? t(playerStatus.key, { place: placeLabel, version: APP_VERSION, ...playerStatus.params }) : t('placeVersion', { place: placeLabel, version: APP_VERSION })}</span>{selected && diagnostic ? <span title={diagnostic}>{diagnostic}</span> : null}</div><button className="play" disabled={!selected?.streams.length} onClick={() => void togglePlayback()} aria-label={isPlaying ? t('pause') : t('play')}>{isPlaying ? 'Ⅱ' : '▶'}</button><button className="play" disabled={!playableStations.length} onClick={() => void stepStation(1)} aria-label={t('nextStation')}>▶▶</button></footer>
  </main>;
}
/** Boot waits for the language dictionary so the very first paint is already translated. */
void initLanguage().finally(() => {
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
});
