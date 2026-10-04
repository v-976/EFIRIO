import React from 'react';
import { createRoot } from 'react-dom/client';
import catalogueData from '../../data/stations.json';
import './styles.css';

type Stream = { url: string; role: 'primary' | 'fallback'; format: string };
type Station = {
  id: string;
  name: string;
  frequencyMHz: number | null;
  streams: Stream[];
  status: 'active' | 'temporarily-unavailable' | 'inactive' | 'research';
};
type Catalogue = { countries: Array<{ regions: Array<{ cities: Array<{ id: string; name: string; stations: Station[] }> }> }> };
type RuntimeState = 'available' | 'connecting' | 'live' | 'failed';

const catalogue = catalogueData as Catalogue;
const LAST_STATION_KEY = 'efirio.lastStationId';

function mediaErrorText(error: MediaError | null) {
  if (!error) return 'unknown media error';
  const names: Record<number, string> = {
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
  };
  return names[error.code] ?? `MEDIA_ERR_${error.code}`;
}

function App() {
  const city = catalogue.countries[0]?.regions[0]?.cities.find((candidate) => candidate.id === 'saint-petersburg');
  const stations = city?.stations ?? [];
  const playableStations = React.useMemo(() => stations.filter((station) => station.streams.length > 0), [stations]);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const selectedRef = React.useRef<Station | null>(null);
  const streamIndexRef = React.useRef(0);
  const shouldPlayRef = React.useRef(false);
  const playTokenRef = React.useRef(0);

  const [selected, setSelected] = React.useState<Station | null>(() => {
    const savedId = localStorage.getItem(LAST_STATION_KEY);
    return stations.find((station) => station.id === savedId) ?? null;
  });
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playerStatus, setPlayerStatus] = React.useState('Saint Petersburg · Alpha 0.1');
  const [runtime, setRuntime] = React.useState<Record<string, RuntimeState>>({});
  const [diagnostic, setDiagnostic] = React.useState('');

  React.useEffect(() => { selectedRef.current = selected; }, [selected]);

  const setStationRuntime = React.useCallback((stationId: string, state: RuntimeState) => {
    setRuntime((current) => ({ ...current, [stationId]: state }));
  }, []);

  const updateMediaSession = React.useCallback((station: Station | null) => {
    if (!station || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: station.frequencyMHz ? `${station.frequencyMHz.toFixed(1)} FM · Saint Petersburg` : 'Saint Petersburg',
      album: 'EFIRIO · The radio of your city',
    });
  }, []);

  const playStream = React.useCallback(async (station: Station, streamIndex = 0, token = ++playTokenRef.current): Promise<void> => {
    const audio = audioRef.current;
    const stream = station.streams[streamIndex];
    if (!audio || !stream || token !== playTokenRef.current) return;

    streamIndexRef.current = streamIndex;
    setStationRuntime(station.id, 'connecting');
    setPlayerStatus(streamIndex === 0 ? 'Connecting…' : 'Connecting to fallback…');
    setDiagnostic(`${stream.role} · ${stream.format} · ${stream.url}`);
    updateMediaSession(station);

    audio.src = stream.url;
    audio.load();

    try {
      await audio.play();
      if (token !== playTokenRef.current) return;
      setIsPlaying(true);
      setStationRuntime(station.id, 'live');
      setPlayerStatus(streamIndex === 0 ? 'Live' : 'Live · fallback');
    } catch (error) {
      if (token !== playTokenRef.current) return;
      const reason = error instanceof Error ? error.name : mediaErrorText(audio.error);
      setDiagnostic(`${stream.role} · ${stream.format} · ${reason} · ${stream.url}`);
      if (shouldPlayRef.current && streamIndex + 1 < station.streams.length) {
        await playStream(station, streamIndex + 1, token);
      } else {
        setIsPlaying(false);
        setStationRuntime(station.id, 'failed');
        setPlayerStatus(`Failed · ${mediaErrorText(audio.error)}`);
      }
    }
  }, [setStationRuntime, updateMediaSession]);

  const chooseStation = React.useCallback(async (station: Station, autoPlay = true) => {
    playTokenRef.current += 1;
    selectedRef.current = station;
    setSelected(station);
    localStorage.setItem(LAST_STATION_KEY, station.id);
    streamIndexRef.current = 0;
    updateMediaSession(station);

    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    setIsPlaying(false);

    if (!station.streams.length) {
      shouldPlayRef.current = false;
      setPlayerStatus('Stream unavailable');
      setDiagnostic('No validated production stream');
      return;
    }

    setStationRuntime(station.id, 'available');
    if (autoPlay) {
      shouldPlayRef.current = true;
      await playStream(station, 0, playTokenRef.current);
    } else {
      setPlayerStatus('Available');
    }
  }, [playStream, setStationRuntime, updateMediaSession]);

  const togglePlayback = React.useCallback(async () => {
    const station = selectedRef.current;
    const audio = audioRef.current;
    if (!station?.streams.length || !audio) return;

    if (isPlaying) {
      shouldPlayRef.current = false;
      audio.pause();
      setIsPlaying(false);
      setPlayerStatus('Paused');
      return;
    }

    shouldPlayRef.current = true;
    await playStream(station, streamIndexRef.current);
  }, [isPlaying, playStream]);

  const stepStation = React.useCallback(async (direction: -1 | 1) => {
    if (!playableStations.length) return;
    const current = selectedRef.current;
    const currentIndex = current ? playableStations.findIndex((station) => station.id === current.id) : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    const nextIndex = (baseIndex + direction + playableStations.length) % playableStations.length;
    await chooseStation(playableStations[nextIndex], true);
  }, [chooseStation, playableStations]);

  React.useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;

    const onPlaying = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      const station = selectedRef.current;
      if (!shouldPlayRef.current || !station) return;
      const failedIndex = streamIndexRef.current;
      const failed = station.streams[failedIndex];
      setDiagnostic(`${failed?.role ?? 'stream'} · ${failed?.format ?? 'unknown'} · ${mediaErrorText(audio.error)} · ${failed?.url ?? audio.currentSrc}`);
    };

    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    return () => {
      shouldPlayRef.current = false;
      audio.pause();
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!selected) return;
    updateMediaSession(selected);
    if (!('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    mediaSession.setActionHandler('play', () => void togglePlayback());
    mediaSession.setActionHandler('pause', () => void togglePlayback());
    mediaSession.setActionHandler('previoustrack', () => void stepStation(-1));
    mediaSession.setActionHandler('nexttrack', () => void stepStation(1));
    return () => {
      mediaSession.setActionHandler('play', null);
      mediaSession.setActionHandler('pause', null);
      mediaSession.setActionHandler('previoustrack', null);
      mediaSession.setActionHandler('nexttrack', null);
    };
  }, [selected, stepStation, togglePlayback, updateMediaSession]);

  const badge = (station: Station) => {
    if (!station.streams.length) return ['research', 'Unavailable'];
    const state = runtime[station.id] ?? 'available';
    if (state === 'connecting') return ['research', 'Connecting'];
    if (state === 'live') return ['ready', 'Live'];
    if (state === 'failed') return ['research', 'Failed'];
    return ['ready', 'Available'];
  };

  return (
    <main className="shell">
      <header className="brand"><div className="mark" aria-hidden="true">E)))</div><div><h1>EFIRIO</h1><p>The radio of your city</p></div></header>
      <section className="location"><span>Russia</span><b>›</b><span>Saint Petersburg</span></section>
      <section className="stations" aria-label="Saint Petersburg stations">
        {stations.map((station) => {
          const [badgeClass, badgeText] = badge(station);
          return (
            <button className={`station ${selected?.id === station.id ? 'selected' : ''}`} key={station.id} onClick={() => void chooseStation(station, station.streams.length > 0)}>
              <span className="frequency">{station.frequencyMHz?.toFixed(1) ?? '—'} <small>FM</small></span>
              <span className="stationName">{station.name}</span>
              <span className={badgeClass}>{badgeText}</span>
            </button>
          );
        })}
      </section>
      <footer className="player">
        <button className="play" disabled={!playableStations.length} onClick={() => void stepStation(-1)} aria-label="Previous station">◀</button>
        <div>
          <strong>{selected?.name ?? 'Choose a station'}</strong>
          <span>{selected ? playerStatus : 'Saint Petersburg · Alpha 0.1'}</span>
          {selected && diagnostic ? <span title={diagnostic}>{diagnostic}</span> : null}
        </div>
        <button className="play" disabled={!selected?.streams.length} onClick={() => void togglePlayback()} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
        <button className="play" disabled={!playableStations.length} onClick={() => void stepStation(1)} aria-label="Next station">▶▶</button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
