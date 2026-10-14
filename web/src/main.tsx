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
type Scope = 'russia' | 'internet';
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
  const [scope, setScope] = React.useState<Scope>(() => (safeGetItem(() => localStorage.getItem(SCOPE_KEY)) === 'internet' ? 'internet' : 'russia'));
  const [internetCountryId, setInternetCountryId] = React.useState<string | null>(() => safeGetItem(() => localStorage.getItem(INTERNET_COUNTRY_KEY)));
  const [internetCountryData, setInternetCountryData] = React.useState<InternetCountry | null>(null);
  const [internetLoading, setInternetLoading] = React.useState(false);
  const [internetError, setInternetError] = React.useState('');
  const isInternet = scope === 'internet';
  /** Falls back to the first listed country when the saved id is unknown or removed. */
  const internetCountry = React.useMemo(() => internetIndex.countries.find((candidate) => candidate.id === internetCountryId) ?? internetIndex.countries[0] ?? null, [internetCountryId]);
  /** Where the player says we are: the Russian city, or the internet country. */
  const placeLabel = isInternet ? (internetCountry?.name ?? 'Интернет') : city.name;
  const russianStations: Station[] = city?.stations ?? [];
  const internetStations: InternetStation[] = internetCountryData?.stations ?? [];
  const stations: Station[] = isInternet ? internetStations : russianStations;
  const cityTimeZone = isInternet
    ? (internetCountryData?.timeZone ?? null)
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
  const updateMediaSession = React.useCallback((station: Station | null, track?: NormalizedTrack | null) => { if (!station || !('mediaSession' in navigator)) return; const place = cityNameRef.current; navigator.mediaSession.metadata = new MediaMetadata({ title: track?.title || station.name, artist: track?.artist || (station.frequencyMHz ? `${station.frequencyMHz.toFixed(1)} FM · ${place}` : place), album: station.name, artwork: track?.coverUrl ? [{ src: track.coverUrl, sizes: '300x300', type: track.coverUrl.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }] : [] }); }, []);

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
   * they were; only the scope flag itself is stored. Internet and Russia never share
   * a selected station, so the last-station id is cleared for the same reason a city
   * change clears it.
   */
  const changeScope = React.useCallback((nextScope: Scope) => {
    if (nextScope === scope) return;
    teardownPlayback(nextScope === 'internet' ? (internetCountry?.name ?? 'Интернет') : city.name);
    safeSetItem(() => localStorage.setItem(SCOPE_KEY, nextScope));
    setScope(nextScope);
  }, [scope, teardownPlayback, internetCountry, city.name]);

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
    if (!isInternet) return [] as InternetStation[];
    return internetStations.filter((station) => (!trimmedNetQuery || station.name.toLowerCase().includes(trimmedNetQuery)) && (!netGenre || station.genres.includes(netGenre)) && (!netCity || station.city === netCity));
  }, [isInternet, internetStations, trimmedNetQuery, netGenre, netCity]);
  /**
   * The internet catalogue holds well over a thousand entries, so only this many rows
   * are mounted at once; the rest are reached incrementally through "Show more".
   */
  const VISIBLE_CHUNK = 60;
  const [visibleCount, setVisibleCount] = React.useState(VISIBLE_CHUNK);
  React.useEffect(() => { setVisibleCount(VISIBLE_CHUNK); }, [trimmedNetQuery, netGenre, netCity, internetCountryData]);
  const visibleStations: Station[] = isInternet ? filteredInternet.slice(0, visibleCount) : stations;

  return <main className="shell">
    <header className="brand"><div className="mark" aria-hidden="true">E)))</div><div><h1>EFIRIO</h1><p>The radio of your city</p></div></header>
    <section className="location">{isInternet
      ? <><span>Интернет</span><b>›</b><span>{internetCountry?.name ?? '—'}</span><b>›</b><span>Радиостанции</span></>
      : <><span>Russia</span><b>›</b><span>{cityRegion?.name ?? '—'}</span><b>›</b><span>{city?.name ?? '—'}</span></>}</section>
    <section className="cityPicker">
      <label className="cityField scopeField"><span>Category</span>
        <select value={scope} onChange={(event) => changeScope(event.target.value as Scope)}>
          <option value="russia">Россия</option>
          <option value="internet">Интернет</option>
        </select>
      </label>
      {isInternet ? <>
        <label className="cityField"><span>Country</span>
          <select value={internetCountry?.id ?? ''} onChange={(event) => setInternetCountryId(event.target.value)}>
            {internetIndex.countries.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select>
        </label>
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
    {!isInternet && trimmedQuery ? <section className="cityMatches" aria-label="City search results">
      {matches.length ? matches.map(({ city: candidate, region }) => <button key={candidate.id} className={`cityMatch ${candidate.id === city?.id ? 'current' : ''}`} onClick={() => { setQuery(''); changeCity(candidate.id); }}><b>{candidate.name}</b><span>{region.name}</span></button>) : <p>No city matches “{trimmedQuery}”</p>}
    </section> : null}
    {isInternet && internetLoading ? <section className="catalogueNote"><span>Loading {internetCountry?.name ?? 'country'} catalogue…</span></section> : null}
    {isInternet && internetError ? <section className="catalogueNote error"><span>{internetError}</span></section> : null}
    {!isInternet ? <>
      <section className="audit"><button onClick={() => void runAudit()} disabled={auditRunning}>{auditRunning ? 'Auditing…' : 'Audit browser playback'}</button><span>{auditProgress || 'Tests every validated station in this browser'}</span></section>
      {auditResults.length > 0 ? <section className="auditSummary"><strong>{auditResults.filter((r) => r.ok).length}/{auditResults.length} playable</strong><span>{auditResults.filter((r) => !r.ok).map((r) => `${r.stationName}: ${r.error}`).join(' · ') || 'All tested stations passed'}</span></section> : null}
      <section className="audit"><button onClick={() => void runMetadataAudit()} disabled={metadataAuditRunning}>{metadataAuditRunning ? 'Auditing metadata…' : 'Audit Now Playing'}</button><span>{metadataAuditProgress || `Tests metadata for every ${city?.name ?? 'listed'} station`}</span></section>
      {metadataAuditResults.length > 0 ? <section className="auditSummary"><strong>{metadataAuditResults.filter((r) => r.ok).length}/{metadataAuditResults.length} Now Playing</strong><span>{metadataAuditResults.filter((r) => !r.ok).map((r) => `${r.stationName}: ${r.error}`).join(' · ') || 'All stations returned track metadata'}</span></section> : null}
    </> : null}
    {selected && (nowPlaying || metadataStatus) ? <section className={nowPlaying?.coverUrl ? 'nowPlaying withCover' : 'nowPlaying'}>{nowPlaying?.coverUrl ? <img className="cover" src={nowPlaying.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}<div className="nowPlayingText"><small>NOW PLAYING{nowPlaying && KIND_LABELS[nowPlaying.kind] ? ` · ${KIND_LABELS[nowPlaying.kind]}` : ''}</small><strong>{nowPlaying?.title || metadataStatus}</strong>{nowPlaying?.artist ? <span>{nowPlaying.artist}</span> : null}{nowPlaying ? <time>{nowPlayingTimeLabel(nowPlaying)}</time> : null}</div></section> : null}
    <section className="stations" aria-label={`${placeLabel} stations`}>{visibleStations.map((station) => {
      const [badgeClass, badgeText] = badge(station);
      const net = isInternet ? (station as InternetStation) : null;
      return <button className={`station ${selected?.id === station.id ? 'selected' : ''}`} key={station.id} onClick={() => void chooseStation(station, station.streams.length > 0)}>
        {net ? <span className="frequency netGeo">GB</span> : <span className="frequency">{station.frequencyMHz?.toFixed(1) ?? '—'} <small>FM</small></span>}
        <span className="stationName">{station.name}{net
          ? <small className="feedScope netScope">{net.country}{net.city ? ` · ${net.city}` : ''}{net.genres.length ? ` · ${net.genres.join(', ')}` : ''}</small>
          : station.feed === 'federal' ? <small className="feedScope" title="Shared federal/central online feed — this city's own FM broadcast may differ">federal feed</small> : null}</span>
        <span className={badgeClass}>{badgeText}</span>
      </button>;
    })}{isInternet && !visibleStations.length && !internetLoading ? <p className="catalogueNote"><span>{trimmedNetQuery ? `No station matches “${netQuery.trim()}”` : 'No station matches the selected filters'}</span></p> : null}</section>
    {isInternet && visibleCount < filteredInternet.length ? <button className="showMore" onClick={() => setVisibleCount((count) => count + VISIBLE_CHUNK)}>Show more · {Math.min(VISIBLE_CHUNK, filteredInternet.length - visibleCount)} of {filteredInternet.length - visibleCount} remaining</button> : null}
    {history.length > 0 ? <details className="history"><summary>Listening history · {history.length}</summary>{history.slice(0, 20).map((item, index) => <div key={`${item.stationId}-${item.detectedAt}-${index}`}><time>{historyTimeLabel(item)}</time><span><b>{item.title}</b>{item.artist ? ` · ${item.artist}` : ''}<small>{item.stationName}</small></span></div>)}</details> : null}
    <footer className="player"><button className="play" disabled={!playableStations.length} onClick={() => void stepStation(-1)} aria-label="Previous station">◀</button><div className="playerInfo">{nowPlaying ? <Ticker station={selected?.name ?? ''} air={airText(nowPlaying)} /> : <strong>{selected?.name || 'Choose a station'}</strong>}<span>{selected ? playerStatus : `${placeLabel} · ${APP_VERSION}`}</span>{selected && diagnostic ? <span title={diagnostic}>{diagnostic}</span> : null}</div><button className="play" disabled={!selected?.streams.length} onClick={() => void togglePlayback()} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button><button className="play" disabled={!playableStations.length} onClick={() => void stepStation(1)} aria-label="Next station">▶▶</button></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
