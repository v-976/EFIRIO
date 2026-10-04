import React from 'react';
import { createRoot } from 'react-dom/client';
import catalogueData from '../../data/stations.json';
import './styles.css';

type Stream = {
  url: string;
  role: 'primary' | 'fallback';
  format: string;
};

type Station = {
  id: string;
  name: string;
  frequencyMHz: number | null;
  streams: Stream[];
  status: 'active' | 'temporarily-unavailable' | 'inactive' | 'research';
};

type Catalogue = {
  countries: Array<{
    regions: Array<{
      cities: Array<{ id: string; name: string; stations: Station[] }>;
    }>;
  }>;
};

const catalogue = catalogueData as Catalogue;
const LAST_STATION_KEY = 'efirio.lastStationId';

function App() {
  const city = catalogue.countries[0]?.regions[0]?.cities.find(
    (candidate) => candidate.id === 'saint-petersburg',
  );
  const stations = city?.stations ?? [];
  const playableStations = React.useMemo(() => stations.filter((station) => station.streams.length > 0), [stations]);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const streamIndexRef = React.useRef(0);
  const shouldPlayRef = React.useRef(false);

  const [selected, setSelected] = React.useState<Station | null>(() => {
    const savedId = localStorage.getItem(LAST_STATION_KEY);
    return stations.find((station) => station.id === savedId) ?? null;
  });
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playerStatus, setPlayerStatus] = React.useState('Saint Petersburg · Alpha 0.1');

  const updateMediaSession = React.useCallback((station: Station | null) => {
    if (!station || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: station.frequencyMHz ? `${station.frequencyMHz.toFixed(1)} FM · Saint Petersburg` : 'Saint Petersburg',
      album: 'EFIRIO · The radio of your city',
    });
  }, []);

  const playStream = React.useCallback(async (station: Station, streamIndex = 0) => {
    const audio = audioRef.current;
    const stream = station.streams[streamIndex];
    if (!audio || !stream) {
      setIsPlaying(false);
      setPlayerStatus('No playable stream');
      return;
    }

    streamIndexRef.current = streamIndex;
    audio.src = stream.url;
    audio.load();
    setPlayerStatus(streamIndex === 0 ? 'Connecting…' : 'Connecting to fallback…');
    updateMediaSession(station);

    try {
      await audio.play();
      setIsPlaying(true);
      setPlayerStatus(streamIndex === 0 ? 'Live' : 'Live · fallback');
    } catch {
      if (shouldPlayRef.current && streamIndex + 1 < station.streams.length) {
        await playStream(station, streamIndex + 1);
      } else {
        setIsPlaying(false);
        setPlayerStatus('Playback unavailable');
      }
    }
  }, [updateMediaSession]);

  const chooseStation = React.useCallback(async (station: Station, autoPlay = true) => {
    setSelected(station);
    localStorage.setItem(LAST_STATION_KEY, station.id);
    streamIndexRef.current = 0;
    updateMediaSession(station);

    if (!station.streams.length) {
      shouldPlayRef.current = false;
      audioRef.current?.pause();
      setIsPlaying(false);
      setPlayerStatus('Stream unavailable');
      return;
    }

    if (autoPlay) {
      shouldPlayRef.current = true;
      await playStream(station, 0);
    } else {
      setPlayerStatus('Ready');
    }
  }, [playStream, updateMediaSession]);

  const togglePlayback = React.useCallback(async () => {
    if (!selected?.streams.length) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      shouldPlayRef.current = false;
      audio.pause();
      setIsPlaying(false);
      setPlayerStatus('Paused');
      return;
    }

    shouldPlayRef.current = true;
    if (audio.src) {
      try {
        await audio.play();
        setIsPlaying(true);
        setPlayerStatus(streamIndexRef.current === 0 ? 'Live' : 'Live · fallback');
        return;
      } catch {
        // Retry through the normal primary/fallback path below.
      }
    }
    await playStream(selected, 0);
  }, [isPlaying, playStream, selected]);

  const stepStation = React.useCallback(async (direction: -1 | 1) => {
    if (!playableStations.length) return;
    const currentIndex = selected ? playableStations.findIndex((station) => station.id === selected.id) : -1;
    const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    const nextIndex = (baseIndex + direction + playableStations.length) % playableStations.length;
    await chooseStation(playableStations[nextIndex], true);
  }, [chooseStation, playableStations, selected]);

  React.useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;

    const onPlaying = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      const station = selected;
      if (!shouldPlayRef.current || !station) return;
      const nextIndex = streamIndexRef.current + 1;
      if (nextIndex < station.streams.length) {
        void playStream(station, nextIndex);
      } else {
        setIsPlaying(false);
        setPlayerStatus('Playback unavailable');
      }
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
  }, [playStream, selected]);

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

  return (
    <main className="shell">
      <header className="brand">
        <div className="mark" aria-hidden="true">E)))</div>
        <div><h1>EFIRIO</h1><p>The radio of your city</p></div>
      </header>

      <section className="location">
        <span>Russia</span><b>›</b><span>Saint Petersburg</span>
      </section>

      <section className="stations" aria-label="Saint Petersburg stations">
        {stations.map((station) => {
          const playable = station.streams.length > 0;
          return (
            <button
              className={`station ${selected?.id === station.id ? 'selected' : ''}`}
              key={station.id}
              onClick={() => void chooseStation(station, playable)}
            >
              <span className="frequency">{station.frequencyMHz?.toFixed(1) ?? '—'} <small>FM</small></span>
              <span className="stationName">{station.name}</span>
              <span className={playable ? 'ready' : 'research'}>{playable ? 'Ready' : 'Unavailable'}</span>
            </button>
          );
        })}
      </section>

      <footer className="player">
        <button className="play" disabled={!playableStations.length} onClick={() => void stepStation(-1)} aria-label="Previous station">◀</button>
        <div>
          <strong>{selected?.name ?? 'Choose a station'}</strong>
          <span>{selected ? playerStatus : 'Saint Petersburg · Alpha 0.1'}</span>
        </div>
        <button className="play" disabled={!selected?.streams.length} onClick={() => void togglePlayback()} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
        <button className="play" disabled={!playableStations.length} onClick={() => void stepStation(1)} aria-label="Next station">▶▶</button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
