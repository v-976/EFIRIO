import React from 'react';
import { createRoot } from 'react-dom/client';
import catalogueData from '../../data/stations.json';
import internetIndexData from '../../data/internet-index.json';
import { HistoryRecorder, canOpenHistoryOnPlaying, historyTimeLabel, type HistoryItem, type StorageLike } from './history.ts';
import { isSupportedMetadata, probeMetadata, type MetadataConfig, type MetadataProbeResult, type NormalizedTrack, watchNowPlaying } from './metadata.ts';
import { safeGetItem, safeSetItem } from './storage.ts';
import { formatInTimeZone } from './time.ts';
import './styles.css';

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
/** Russia keeps the existing city hierarchy; Internet drills to a country with no region/city of its own. */
type Scope = 'russia' | 'internet' | 'finland' | 'finland-internet' | 'estonia' | 'estonia-internet';
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

const catalogue = catalogueData as Catalogue;
const LAST_STATION_KEY = 'efirio.lastStationId';
const CITY_ID_KEY = 'efirio.cityId';
const FALLBACK_CITY_ID = 'saint-petersburg';
const APP_VERSION = 'Alpha 0.1';
const SCOPE_KEY = 'efirio.scope';
const INTERNET_COUNTRY_KEY = 'efirio.internetCountryId';
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
function nowPlayingTimeLabel(track: NormalizedTrack): string {
  if (track.timeQuality === 'exact' && track.startedAt) return `Source time ${formatInTimeZone(track.startedAt, track.timeZone, { withDate: true })}`;
  if (track.sourceLocalTime) return `Station time ${track.sourceLocalTime}${track.timeZone ? ` (${track.timeZone})` : ''}`;
  return `Detected ${formatInTimeZone(track.detectedAt, track.timeZone, { withDate: true })}`;
}

/** Short label for non-music air items; music needs no label. */
const KIND_LABELS: Partial<Record<NormalizedTrack['kind'], string>> = { program: 'PROGRAMME', talk: 'TALK', jingle: 'STATION ID', advert: 'ADVERT' };

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
  const [cityId, setCityId] = React.useState<string | null>(() => { const saved = safeGetItem(() => localStorage.getItem(CITY_ID_KEY)); return resolveCity(saved).city.id; });
  const located = resolveCity(cityId);
  const city = located.city;
  const cityRegion = located.region;
  /**
   * Scope lives in its own key, deliberately separate from `efirio.cityId`, so
   * switching between Russia and Internet never disturbs the saved Russian city.
   */
  const [scope, setScope] = React.useState<Scope>(() => {
    const saved = safeGetItem(() => localStorage.getItem(SCOPE_KEY));
    return saved === 'internet' || saved === 'finland' || saved === 'finland-internet' || saved === 'estonia' || saved === 'estonia-internet' ? saved : 'russia';
  });
  const [internetCountryId, setInternetCountryId] = React.useState<string | null>(() => safeGetItem(() => localStorage.getItem(INTERNET_COUNTRY_KEY)));
  const [internetCountryData, setInternetCountryData] = React.useState<InternetCountry | null>(null);
  const [internetLoading, setInternetLoading] = React.useState(false);
  const [internetError, setInternetError] = React.useState('');
  const isInternet = scope === 'internet';
  const isFinland = scope === 'finland';
  const isFinlandInternet = scope === 'finland-internet';
  const isEstonia = scope === 'estonia';
  const isEstoniaInternet = scope === 'estonia-internet';
  const isNetLike = isInternet || isFinlandInternet || isEstoniaInternet;
  /** Falls back to the first listed country when the saved id is unknown or removed. */
  const internetCountry = React.useMemo(() => internetIndex.countries.find((candidate) => candidate.id === internetCountryId) ?? internetIndex.countries[0] ?? null, [internetCountryId]);
  /** One shared country-file state serves every internet category; the id tells them apart. */
  const ukCountryData = internetCountryData && internetCountryData.id !== 'finland' && internetCountryData.id !== 'estonia' ? internetCountryData : null;
  const finlandNetData = internetCountryData?.id === 'finland' ? internetCountryData : null;
  const estoniaNetData = internetCountryData?.id === 'estonia' ? internetCountryData : null;
  /** Finland terrestrial catalogue, loaded on demand from its own lazy chunk. */
  const [finlandData, setFinlandData] = React.useState<FinlandCatalogue | null>(null);
  const [finlandLoading, setFinlandLoading] = React.useState(false);
  const [finlandError, setFinlandError] = React.useState('');
  /** Estonia terrestrial catalogue, loaded on demand from its own lazy chunk. */
  const [estoniaData, setEstoniaData] = React.useState<EstoniaCatalogue | null>(null);
  const [estoniaLoading, setEstoniaLoading] = React.useState(false);
  const [estoniaError, setEstoniaError] = React.useState('');
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
  /** Where the player says we are: the Russian city, an internet country or a terrestrial context. */
  const placeLabel = isInternet
    ? (internetCountry?.name ?? 'Интернет')
    : isEstoniaInternet
      ? 'Эстония — Интернет'
      : isFinlandInternet
        ? 'Финляндия — Интернет'
        : isEstonia
          ? (eeCity?.name ?? eeRegion?.name ?? 'Эстония')
          : isFinland
            ? (fiCity?.name ?? fiRegion?.name ?? 'Финляндия')
            : city.name;
  const russianStations: Station[] = city?.stations ?? [];
  const netCountryData = isInternet ? ukCountryData : isEstoniaInternet ? estoniaNetData : isFinlandInternet ? finlandNetData : null;
  const internetStations: InternetStation[] = netCountryData?.stations ?? [];
  const stations: Station[] = isNetLike ? internetStations : isEstonia ? estoniaVisibleStations : isFinland ? finlandVisibleStations : russianStations;
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
  const [isPlaying, setIsPlaying] = React.useState(false); const [playerStatus, setPlayerStatus] = React.useState(`${placeLabel} · ${APP_VERSION}`); const [runtime, setRuntime] = React.useState<Record<string, RuntimeState>>({}); const [diagnostic, setDiagnostic] = React.useState('');
  const [auditRunning, setAuditRunning] = React.useState(false); const [auditProgress, setAuditProgress] = React.useState(''); const [auditResults, setAuditResults] = React.useState<AuditResult[]>([]);
  const [metadataAuditRunning, setMetadataAuditRunning] = React.useState(false); const [metadataAuditProgress, setMetadataAuditProgress] = React.useState(''); const [metadataAuditResults, setMetadataAuditResults] = React.useState<StationMetadataAudit[]>([]);
  const [nowPlaying, setNowPlaying] = React.useState<NormalizedTrack | null>(null); const [metadataStatus, setMetadataStatus] = React.useState('');
  const [history, setHistory] = React.useState<HistoryItem[]>(() => recorder.list);
  React.useEffect(() => recorder.subscribe(setHistory), [recorder]);
  React.useEffect(() => { selectedRef.current = selected; }, [selected]);
  const setStationRuntime = React.useCallback((stationId: string, state: RuntimeState) => setRuntime((current) => ({ ...current, [stationId]: state })), []);
  /** Read at call time so `updateMediaSession` keeps a stable identity when the city changes. */
  const cityNameRef = React.useRef(placeLabel);
  React.useEffect(() => { cityNameRef.current = placeLabel; }, [placeLabel]);
  const updateMediaSession = React.useCallback((station: Station | null, track?: NormalizedTrack | null) => { if (!station || !('mediaSession' in navigator)) return; const place = cityNameRef.current; navigator.mediaSession.metadata = new MediaMetadata({ title: track?.title || station.name, artist: track?.artist || (station.frequencyMHz ? (station.frequencyMHz < 10 ? `${Math.round(station.frequencyMHz * 1000)} kHz · ${place}` : `${station.frequencyMHz.toFixed(1)} FM · ${place}`) : place), album: station.name, artwork: track?.coverUrl ? [{ src: track.coverUrl, sizes: '300x300', type: track.coverUrl.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }] : [] }); }, []);

  /**
   * Leaving a city, or the whole scope, tears down everything that belongs to the
   * outgoing context: playback, the pending metadata watcher, runtime badges and the
   * recorder session, so a late track or audio callback from the previous context can
   * never surface on the next one.
   */
  const teardownPlayback = React.useCallback((nextLabel: string) => {
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
    setMetadataStatus('');
    setRuntime({});
    setDiagnostic('');
    setAuditResults([]);
    setAuditProgress('');
    setMetadataAuditResults([]);
    setMetadataAuditProgress('');
    setIsPlaying(false);
    setSelected(null);
    setPlayerStatus(`${nextLabel} · ${APP_VERSION}`);
    safeSetItem(() => localStorage.setItem(LAST_STATION_KEY, ''));
  }, []);

  const changeCity = React.useCallback((nextCityId: string) => {
    const next = findCity(nextCityId);
    if (!next || next.city.id === cityId) return; // unknown ids must never silently fall back to another city
    teardownPlayback(next.city.name);
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
    const label = nextScope === 'internet'
      ? (internetCountry?.name ?? 'Интернет')
      : nextScope === 'finland'
        ? 'Финляндия'
        : nextScope === 'finland-internet'
          ? 'Финляндия — Интернет'
          : nextScope === 'estonia'
            ? 'Эстония'
            : nextScope === 'estonia-internet'
              ? 'Эстония — Интернет'
              : city.name;
    teardownPlayback(label);
    safeSetItem(() => localStorage.setItem(SCOPE_KEY, nextScope));
    setScope(nextScope);
  }, [scope, teardownPlayback, internetCountry, city.name]);

  /**
   * Region and city changes inside Finland behave exactly like a Russian city
   * change: playback stops, the selection persists under the Finland-only keys.
   * The saved Russian city and the UK internet selection are never touched.
   */
  const changeFinlandRegion = React.useCallback((nextRegionId: string) => {
    const region = finlandData?.regions.find((candidate) => candidate.id === nextRegionId) ?? null;
    teardownPlayback(region?.name ?? 'Вся страна');
    setFinlandRegionId(region?.id ?? FINLAND_ALL_REGIONS);
    setFinlandCityId(FINLAND_ALL_CITIES);
    safeSetItem(() => localStorage.setItem(FINLAND_REGION_KEY, region?.id ?? FINLAND_ALL_REGIONS));
    safeSetItem(() => localStorage.setItem(FINLAND_CITY_KEY, FINLAND_ALL_CITIES));
  }, [finlandData, teardownPlayback]);

  const changeFinlandCity = React.useCallback((nextCityId: string) => {
    const cityEntry = fiCities.find((candidate) => candidate.id === nextCityId) ?? null;
    teardownPlayback(cityEntry?.name ?? (fiRegion?.name ?? 'Вся страна'));
    setFinlandCityId(cityEntry?.id ?? FINLAND_ALL_CITIES);
    safeSetItem(() => localStorage.setItem(FINLAND_CITY_KEY, cityEntry?.id ?? FINLAND_ALL_CITIES));
  }, [fiCities, fiRegion, teardownPlayback]);

  /**
   * Region and city changes inside Estonia behave exactly like the Finland ones:
   * playback stops and the selection persists under the Estonia-only keys; the
   * saved Russian city and the UK internet selection are never touched.
   */
  const changeEstoniaRegion = React.useCallback((nextRegionId: string) => {
    const region = estoniaData?.regions.find((candidate) => candidate.id === nextRegionId) ?? null;
    teardownPlayback(region?.name ?? 'Вся страна');
    setEstoniaRegionId(region?.id ?? ESTONIA_ALL_REGIONS);
    setEstoniaCityId(ESTONIA_ALL_CITIES);
    safeSetItem(() => localStorage.setItem(ESTONIA_REGION_KEY, region?.id ?? ESTONIA_ALL_REGIONS));
    safeSetItem(() => localStorage.setItem(ESTONIA_CITY_KEY, ESTONIA_ALL_CITIES));
  }, [estoniaData, teardownPlayback]);

  const changeEstoniaCity = React.useCallback((nextCityId: string) => {
    const cityEntry = eeCities.find((candidate) => candidate.id === nextCityId) ?? null;
    teardownPlayback(cityEntry?.name ?? (eeRegion?.name ?? 'Вся страна'));
    setEstoniaCityId(cityEntry?.id ?? ESTONIA_ALL_CITIES);
    safeSetItem(() => localStorage.setItem(ESTONIA_CITY_KEY, cityEntry?.id ?? ESTONIA_ALL_CITIES));
  }, [eeCities, eeRegion, teardownPlayback]);

  /** Countries are separate static files, loaded only when that country is opened. */
  React.useEffect(() => {
    if (!isInternet || !internetCountry) return;
    const target = internetCountry.id;
    if (internetCountryData?.id === target) return;
    let cancelled = false;
    setInternetLoading(true);
    setInternetError('');
    void loadInternetCountry(target)
      .then((data) => {
        if (cancelled) return;
        setInternetCountryData(data);
        setInternetCountryId(target);
        safeSetItem(() => localStorage.setItem(INTERNET_COUNTRY_KEY, target));
      })
      .catch(() => { if (!cancelled) setInternetError('Country catalogue could not be loaded'); })
      .finally(() => { if (!cancelled) setInternetLoading(false); });
    return () => { cancelled = true; };
  }, [isInternet, internetCountry, internetCountryData]);

  /** «Финляндия — Интернет» reuses the internet-country loader with a fixed country id. */
  React.useEffect(() => {
    if (!isFinlandInternet || internetCountryData?.id === 'finland') return;
    let cancelled = false;
    setInternetLoading(true);
    setInternetError('');
    void loadInternetCountry('finland')
      .then((data) => { if (!cancelled) setInternetCountryData(data); })
      .catch(() => { if (!cancelled) setInternetError('Каталог «Финляндия — Интернет» не загрузился'); })
      .finally(() => { if (!cancelled) setInternetLoading(false); });
    return () => { cancelled = true; };
  }, [isFinlandInternet, internetCountryData]);

  /**
   * «Эстония — Интернет» loads `data/internet/estonia.json` directly: the index
   * stays UK-only, so the shared index state is never consulted or overwritten.
   */
  React.useEffect(() => {
    if (!isEstoniaInternet || internetCountryData?.id === 'estonia') return;
    let cancelled = false;
    setInternetLoading(true);
    setInternetError('');
    void loadInternetCountry('estonia')
      .then((data) => { if (!cancelled) setInternetCountryData(data); })
      .catch(() => { if (!cancelled) setInternetError('Каталог «Эстония — Интернет» не загрузился'); })
      .finally(() => { if (!cancelled) setInternetLoading(false); });
    return () => { cancelled = true; };
  }, [isEstoniaInternet, internetCountryData]);

  /** The Finnish terrestrial catalogue is a lazy chunk, fetched on the first switch to the category. */
  React.useEffect(() => {
    if (!isFinland || finlandData) return;
    let cancelled = false;
    setFinlandLoading(true);
    setFinlandError('');
    void loadFinlandCatalogue()
      .then((data) => { if (!cancelled) setFinlandData(data); })
      .catch(() => { if (!cancelled) setFinlandError('Каталог Финляндии не загрузился'); })
      .finally(() => { if (!cancelled) setFinlandLoading(false); });
    return () => { cancelled = true; };
  }, [isFinland, finlandData]);

  /** The Estonian terrestrial catalogue is a lazy chunk, fetched on the first switch to the category. */
  React.useEffect(() => {
    if (!isEstonia || estoniaData) return;
    let cancelled = false;
    setEstoniaLoading(true);
    setEstoniaError('');
    void loadEstoniaCatalogue()
      .then((data) => { if (!cancelled) setEstoniaData(data); })
      .catch(() => { if (!cancelled) setEstoniaError('Каталог Эстонии не загрузился'); })
      .finally(() => { if (!cancelled) setEstoniaLoading(false); });
    return () => { cancelled = true; };
  }, [isEstonia, estoniaData]);

  React.useEffect(() => {
    setNowPlaying(null); nowPlayingRef.current = null; setMetadataStatus('');
    if (!isSupportedMetadata(selected?.metadata)) return;
    setMetadataStatus('Loading track…');
    const session = metadataSessionRef.current;
    const isActive = () => session === metadataSessionRef.current;
    return watchNowPlaying(selected.metadata, { timeZone: cityTimeZone, isActive }, (track) => {
      if (!track) { setMetadataStatus('No track metadata'); return; }
      setMetadataStatus(''); setNowPlaying(track); nowPlayingRef.current = track; updateMediaSession(selected, track);
      recorder.handleMetadata(track, selected.id);
    }, (error) => { console.warn('[EFIRIO] metadata', selected.id, error); setMetadataStatus('Metadata unavailable'); });
  }, [selected, cityTimeZone, recorder, updateMediaSession]);

  const playStream = React.useCallback(async (station: Station, streamIndex = 0, token = ++playTokenRef.current): Promise<void> => { const audio = audioRef.current; const stream = station.streams[streamIndex]; if (!audio || !stream || token !== playTokenRef.current) return; streamIndexRef.current = streamIndex; setStationRuntime(station.id, 'connecting'); setPlayerStatus(streamIndex === 0 ? 'Connecting…' : 'Connecting to fallback…'); setDiagnostic(`${stream.role} · ${stream.format} · ${stream.url}`); updateMediaSession(station, nowPlaying); audio.src = stream.url; expectedSrcRef.current = stream.url; audio.load(); try { await audio.play(); if (token !== playTokenRef.current) return; setIsPlaying(true); setStationRuntime(station.id, 'live'); setPlayerStatus(streamIndex === 0 ? 'Live' : 'Live · fallback'); } catch (error) { if (token !== playTokenRef.current) return; const reason = error instanceof Error ? error.name : mediaErrorText(audio.error); setDiagnostic(`${stream.role} · ${stream.format} · ${reason} · ${stream.url}`); if (shouldPlayRef.current && streamIndex + 1 < station.streams.length) await playStream(station, streamIndex + 1, token); else { setIsPlaying(false); setStationRuntime(station.id, 'failed'); setPlayerStatus(`Failed · ${mediaErrorText(audio.error)}`); } } }, [nowPlaying, setStationRuntime, updateMediaSession]);
  const chooseStation = React.useCallback(async (station: Station, autoPlay = true) => { playTokenRef.current += 1; metadataSessionRef.current += 1; expectedSrcRef.current = null; selectedRef.current = station; setSelected(station); recorderRef.current?.selectStation(station); nowPlayingRef.current = null; safeSetItem(() => localStorage.setItem(LAST_STATION_KEY, station.id)); streamIndexRef.current = 0; updateMediaSession(station); const audio = audioRef.current; if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } setIsPlaying(false); if (!station.streams.length) { shouldPlayRef.current = false; setPlayerStatus('Stream unavailable'); setDiagnostic('No validated production stream'); return; } setStationRuntime(station.id, 'available'); if (autoPlay) { shouldPlayRef.current = true; await playStream(station, 0, playTokenRef.current); } else setPlayerStatus('Available'); }, [playStream, setStationRuntime, updateMediaSession]);
  const togglePlayback = React.useCallback(async () => { const station = selectedRef.current; const audio = audioRef.current; if (!station?.streams.length || !audio) return; if (isPlaying) { shouldPlayRef.current = false; expectedSrcRef.current = null; audio.pause(); setIsPlaying(false); setPlayerStatus('Paused'); return; } shouldPlayRef.current = true; await playStream(station, streamIndexRef.current); }, [isPlaying, playStream]);
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
  const badge = (station: Station) => { if (!station.streams.length) return ['research', 'Unavailable']; const state = runtime[station.id] ?? 'available'; if (state === 'connecting') return ['research', 'Connecting']; if (state === 'live') return ['ready', 'Live']; if (state === 'failed') return ['research', 'Failed']; return ['ready', 'Available']; };

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
    if (!isNetLike) return [] as InternetStation[];
    return internetStations.filter((station) => (!trimmedNetQuery || station.name.toLowerCase().includes(trimmedNetQuery)) && (!netGenre || station.genres.includes(netGenre)) && (!netCity || station.city === netCity));
  }, [isNetLike, internetStations, trimmedNetQuery, netGenre, netCity]);
  /** Filters never leak across categories: a UK search string must not hide Finnish stations. */
  React.useEffect(() => { setNetQuery(''); setNetGenre(''); setNetCity(''); setFiQuery(''); }, [scope]);
  /**
   * The internet catalogue holds well over a thousand entries, so only this many rows
   * are mounted at once; the rest are reached incrementally through "Show more".
   * Finland uses the same incremental rendering for its (smaller) lists.
   */
  const VISIBLE_CHUNK = 60;
  const [visibleCount, setVisibleCount] = React.useState(VISIBLE_CHUNK);
  React.useEffect(() => { setVisibleCount(VISIBLE_CHUNK); }, [trimmedNetQuery, netGenre, netCity, internetCountryData, trimmedFiQuery, finlandData, finlandRegionId, finlandCityId, trimmedEeQuery, estoniaData, estoniaRegionId, estoniaCityId]);
  const shownList: Station[] = isNetLike ? filteredInternet : isEstonia ? estoniaVisibleStations : isFinland ? finlandVisibleStations : stations;
  const chunkedView = isNetLike || isFinland || isEstonia;
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
  const netGeoCode = isInternet ? (internetCountry?.code ?? 'GB') : (netCountryData?.code ?? 'FI');

  return <main className="shell">
    <header className="brand"><div className="mark" aria-hidden="true">E)))</div><div><h1>EFIRIO</h1><p>The radio of your city</p></div></header>
    <section className="location">{isInternet
      ? <><span>Интернет</span><b>›</b><span>{internetCountry?.name ?? '—'}</span><b>›</b><span>Радиостанции</span></>
      : isEstoniaInternet
        ? <><span>Эстония — Интернет</span><b>›</b><span>Радиостанции</span></>
        : isFinlandInternet
          ? <><span>Финляндия — Интернет</span><b>›</b><span>Радиостанции</span></>
          : isEstonia
            ? <><span>Эстония</span><b>›</b><span>{eeRegion?.name ?? 'Вся страна'}</span>{eeCity ? <><b>›</b><span>{eeCity.name}</span></> : null}</>
            : isFinland
              ? <><span>Финляндия</span><b>›</b><span>{fiRegion?.name ?? 'Вся страна'}</span>{fiCity ? <><b>›</b><span>{fiCity.name}</span></> : null}</>
              : <><span>Russia</span><b>›</b><span>{cityRegion?.name ?? '—'}</span><b>›</b><span>{city?.name ?? '—'}</span></>}</section>
    <section className="cityPicker">
      <label className="cityField scopeField"><span>Category</span>
        <select value={scope} onChange={(event) => changeScope(event.target.value as Scope)}>
          <option value="russia">Россия</option>
          <option value="internet">Интернет</option>
          <option value="finland">Финляндия</option>
          <option value="finland-internet">Финляндия — Интернет</option>
          <option value="estonia">Эстония</option>
          <option value="estonia-internet">Эстония — Интернет</option>
        </select>
      </label>
      {isNetLike ? <>
        {isInternet ? <label className="cityField"><span>Country</span>
          <select value={internetCountry?.id ?? ''} onChange={(event) => setInternetCountryId(event.target.value)}>
            {internetIndex.countries.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label> : null}
        <label className="cityField citySearch"><span>Find a station</span>
          <input type="search" inputMode="search" autoComplete="off" value={netQuery} onChange={(event) => setNetQuery(event.target.value)} placeholder="Station name" aria-label="Search for a station" />
        </label>
        {netGenres.length > 0 ? <label className="cityField"><span>Genre</span>
          <select value={netGenre} onChange={(event) => setNetGenre(event.target.value)}>
            <option value="">All genres</option>
            {netGenres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
          </select>
        </label> : null}
        {netCities.length > 0 ? <label className="cityField"><span>City</span>
          <select value={netCity} onChange={(event) => setNetCity(event.target.value)}>
            <option value="">All cities</option>
            {netCities.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label> : null}
      </> : isFinland ? <>
        <label className="cityField"><span>Region</span>
          <select value={fiRegion?.id ?? FINLAND_ALL_REGIONS} onChange={(event) => changeFinlandRegion(event.target.value)}>
            <option value={FINLAND_ALL_REGIONS}>Вся страна</option>
            {(finlandData?.regions ?? []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </label>
        {fiRegion ? <label className="cityField"><span>City</span>
          <select value={fiCity?.id ?? FINLAND_ALL_CITIES} onChange={(event) => changeFinlandCity(event.target.value)}>
            <option value={FINLAND_ALL_CITIES}>Все города</option>
            {fiCities.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label> : null}
        <label className="cityField citySearch"><span>Find a station</span>
          <input type="search" inputMode="search" autoComplete="off" value={fiQuery} onChange={(event) => setFiQuery(event.target.value)} placeholder="Station, city or region" aria-label="Search Finland by station, city or region" />
        </label>
      </> : isEstonia ? <>
        <label className="cityField"><span>Region</span>
          <select value={eeRegion?.id ?? ESTONIA_ALL_REGIONS} onChange={(event) => changeEstoniaRegion(event.target.value)}>
            <option value={ESTONIA_ALL_REGIONS}>Вся страна</option>
            {(estoniaData?.regions ?? []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </label>
        {eeRegion ? <label className="cityField"><span>City</span>
          <select value={eeCity?.id ?? ESTONIA_ALL_CITIES} onChange={(event) => changeEstoniaCity(event.target.value)}>
            <option value={ESTONIA_ALL_CITIES}>Все города</option>
            {eeCities.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label> : null}
        <label className="cityField citySearch"><span>Find a station</span>
          <input type="search" inputMode="search" autoComplete="off" value={eeQuery} onChange={(event) => setEeQuery(event.target.value)} placeholder="Station, city or region" aria-label="Search Estonia by station, city or region" />
        </label>
      </> : <>
        <label className="cityField"><span>Region</span>
          <select value={cityRegion?.id ?? ''} onChange={onRegionChange}>
            {REGIONS.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </label>
        <label className="cityField"><span>City</span>
          <select value={city?.id ?? ''} onChange={(event) => changeCity(event.target.value)}>
            {citiesInRegion.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
        <label className="cityField citySearch"><span>Find a city</span>
          <input type="search" inputMode="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="City name" aria-label="Search for a city" />
        </label>
      </>}
    </section>
    {scope === 'russia' && trimmedQuery ? <section className="cityMatches" aria-label="City search results">
      {matches.length ? matches.map(({ city: candidate, region }) => <button key={candidate.id} className={`cityMatch ${candidate.id === city?.id ? 'current' : ''}`} onClick={() => { setQuery(''); changeCity(candidate.id); }}><b>{candidate.name}</b><span>{region.name}</span></button>) : <p>No city matches “{trimmedQuery}”</p>}
    </section> : null}
    {isNetLike && internetLoading ? <section className="catalogueNote"><span>Loading {isInternet ? (internetCountry?.name ?? 'country') : isEstoniaInternet ? 'Эстония' : 'Финляндия'} catalogue…</span></section> : null}
    {isNetLike && internetError ? <section className="catalogueNote error"><span>{internetError}</span></section> : null}
    {isFinland && finlandLoading ? <section className="catalogueNote"><span>Loading Финляндия catalogue…</span></section> : null}
    {isFinland && finlandError ? <section className="catalogueNote error"><span>{finlandError}</span></section> : null}
    {isEstonia && estoniaLoading ? <section className="catalogueNote"><span>Loading Эстония catalogue…</span></section> : null}
    {isEstonia && estoniaError ? <section className="catalogueNote error"><span>{estoniaError}</span></section> : null}
    {scope === 'russia' ? <>
      <section className="audit"><button onClick={() => void runAudit()} disabled={auditRunning}>{auditRunning ? 'Auditing…' : 'Audit browser playback'}</button><span>{auditProgress || 'Tests every validated station in this browser'}</span></section>
      {auditResults.length > 0 ? <section className="auditSummary"><strong>{auditResults.filter((r) => r.ok).length}/{auditResults.length} playable</strong><span>{auditResults.filter((r) => !r.ok).map((r) => `${r.stationName}: ${r.error}`).join(' · ') || 'All tested stations passed'}</span></section> : null}
      <section className="audit"><button onClick={() => void runMetadataAudit()} disabled={metadataAuditRunning}>{metadataAuditRunning ? 'Auditing metadata…' : 'Audit Now Playing'}</button><span>{metadataAuditProgress || `Tests metadata for every ${city?.name ?? 'listed'} station`}</span></section>
      {metadataAuditResults.length > 0 ? <section className="auditSummary"><strong>{metadataAuditResults.filter((r) => r.ok).length}/{metadataAuditResults.length} Now Playing</strong><span>{metadataAuditResults.filter((r) => !r.ok).map((r) => `${r.stationName}: ${r.error}`).join(' · ') || 'All stations returned track metadata'}</span></section> : null}
    </> : null}
    {selected && (nowPlaying || metadataStatus) ? <section className={nowPlaying?.coverUrl ? 'nowPlaying withCover' : 'nowPlaying'}>{nowPlaying?.coverUrl ? <img className="cover" src={nowPlaying.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}<div className="nowPlayingText"><small>NOW PLAYING{nowPlaying && KIND_LABELS[nowPlaying.kind] ? ` · ${KIND_LABELS[nowPlaying.kind]}` : ''}</small><strong>{nowPlaying?.title || metadataStatus}</strong>{nowPlaying?.artist ? <span>{nowPlaying.artist}</span> : null}{nowPlaying ? <time>{nowPlayingTimeLabel(nowPlaying)}</time> : null}</div></section> : null}
    <section className="stations" aria-label={`${placeLabel} stations`}>{visibleStations.map((station) => {
      const [badgeClass, badgeText] = badge(station);
      if (isEstonia) {
        const ee = station as EstoniaStation;
        const where = trimmedEeQuery ? (eeSearchResults.find((entry) => entry.station.id === ee.id)?.where ?? '') : '';
        const eeHit = eeFrequency(ee, where || undefined);
        const typeLabel = ee.type === 'nationwide' ? 'Вся страна' : ee.type === 'regional' ? 'Региональная' : 'Локальная';
        return <button className={`station ${selected?.id === ee.id ? 'selected' : ''}`} key={ee.id} onClick={() => void chooseStation(station, station.streams.length > 0)}>
          {eeHit != null
            ? eeHit.band === 'AM'
              ? <span className="frequency">{Math.round(eeHit.mhz * 1000)} <small>кГц</small></span>
              : <span className="frequency">{eeHit.mhz.toFixed(1)} <small>FM</small></span>
            : <span className="frequency netGeo">EE</span>}
          <span className="stationName">{ee.name}<small className="feedScope netScope">{where ? `${typeLabel} · ${where}` : typeLabel}</small></span>
          <span className={badgeClass}>{badgeText}</span>
        </button>;
      }
      if (isFinland) {
        const fi = station as FinlandStation;
        // In search results show the place that actually matched the query, not an arbitrary first city.
        const where = trimmedFiQuery ? (fiSearchResults.find((entry) => entry.station.id === fi.id)?.where ?? '') : '';
        const fiMhz = fiFrequency(fi, where || undefined);
        const typeLabel = fi.type === 'nationwide' ? 'Вся страна' : fi.type === 'regional' ? 'Региональная' : 'Локальная';
        return <button className={`station ${selected?.id === fi.id ? 'selected' : ''}`} key={fi.id} onClick={() => void chooseStation(station, station.streams.length > 0)}>
          {fiMhz != null ? <span className="frequency">{fiMhz.toFixed(1)} <small>FM</small></span> : <span className="frequency netGeo">FI</span>}
          <span className="stationName">{fi.name}<small className="feedScope netScope">{where ? `${typeLabel} · ${where}` : typeLabel}</small></span>
          <span className={badgeClass}>{badgeText}</span>
        </button>;
      }
      const net = isNetLike ? (station as InternetStation) : null;
      return <button className={`station ${selected?.id === station.id ? 'selected' : ''}`} key={station.id} onClick={() => void chooseStation(station, station.streams.length > 0)}>
        {net ? <span className="frequency netGeo">{netGeoCode}</span> : <span className="frequency">{station.frequencyMHz?.toFixed(1) ?? '—'} <small>FM</small></span>}
        <span className="stationName">{station.name}{net
          ? <small className="feedScope netScope">{net.country}{net.city ? ` · ${net.city}` : ''}{net.genres.length ? ` · ${net.genres.join(', ')}` : ''}</small>
          : station.feed === 'federal' ? <small className="feedScope" title="Shared federal/central online feed — this city's own FM broadcast may differ">federal feed</small> : null}</span>
        <span className={badgeClass}>{badgeText}</span>
      </button>;
    })}{chunkedView && !visibleStations.length && !internetLoading && !finlandLoading && !estoniaLoading && (isNetLike ? !!netCountryData : isEstonia ? !!estoniaData : !!finlandData) ? <p className="catalogueNote"><span>{isEstonia && trimmedEeQuery ? `No station matches “${eeQuery.trim()}”` : isFinland && trimmedFiQuery ? `No station matches “${fiQuery.trim()}”` : trimmedNetQuery ? `No station matches “${netQuery.trim()}”` : 'No station matches the selected filters'}</span></p> : null}</section>
    {chunkedView && visibleCount < shownList.length ? <button className="showMore" onClick={() => setVisibleCount((count) => count + VISIBLE_CHUNK)}>Show more · {Math.min(VISIBLE_CHUNK, shownList.length - visibleCount)} of {shownList.length - visibleCount} remaining</button> : null}
    {history.length > 0 ? <details className="history"><summary>Listening history · {history.length}</summary>{history.slice(0, 20).map((item, index) => <div key={`${item.stationId}-${item.detectedAt}-${index}`}><time>{historyTimeLabel(item)}</time><span><b>{item.title}</b>{item.artist ? ` · ${item.artist}` : ''}<small>{item.stationName}</small></span></div>)}</details> : null}
    <footer className="player"><button className="play" disabled={!playableStations.length} onClick={() => void stepStation(-1)} aria-label="Previous station">◀</button><div className="playerInfo">{nowPlaying ? <Ticker station={selected?.name ?? ''} air={airText(nowPlaying)} /> : <strong>{selected?.name || 'Choose a station'}</strong>}<span>{selected ? playerStatus : `${placeLabel} · ${APP_VERSION}`}</span>{selected && diagnostic ? <span title={diagnostic}>{diagnostic}</span> : null}</div><button className="play" disabled={!selected?.streams.length} onClick={() => void togglePlayback()} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button><button className="play" disabled={!playableStations.length} onClick={() => void stepStation(1)} aria-label="Next station">▶▶</button></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
