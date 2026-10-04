import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Station = {
  id: string;
  name: string;
  frequencyMHz: number | null;
  streams: { url: string; role: 'primary' | 'fallback'; format: string }[];
  status: 'active' | 'temporarily-unavailable' | 'inactive' | 'research';
};

type Catalogue = {
  countries: Array<{
    regions: Array<{
      cities: Array<{ id: string; name: string; stations: Station[] }>;
    }>;
  }>;
};

function App() {
  const [stations, setStations] = React.useState<Station[]>([]);
  const [selected, setSelected] = React.useState<Station | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/data/stations.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`);
        return response.json() as Promise<Catalogue>;
      })
      .then((catalogue) => {
        const city = catalogue.countries[0]?.regions[0]?.cities.find(
          (candidate) => candidate.id === 'saint-petersburg',
        );
        setStations(city?.stations ?? []);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Catalogue unavailable'),
      );
  }, []);

  return (
    <main className="shell">
      <header className="brand">
        <div className="mark" aria-hidden="true">E)))</div>
        <div>
          <h1>EFIRIO</h1>
          <p>The radio of your city</p>
        </div>
      </header>

      <section className="location">
        <span>Russia</span><b>›</b><span>Saint Petersburg</span>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="stations" aria-label="Saint Petersburg stations">
        {stations.map((station) => {
          const playable = station.streams.length > 0;
          return (
            <button
              className={`station ${selected?.id === station.id ? 'selected' : ''}`}
              key={station.id}
              onClick={() => setSelected(station)}
            >
              <span className="frequency">
                {station.frequencyMHz?.toFixed(1) ?? '—'} <small>FM</small>
              </span>
              <span className="stationName">{station.name}</span>
              <span className={playable ? 'ready' : 'research'}>
                {playable ? 'Ready' : 'Research'}
              </span>
            </button>
          );
        })}
      </section>

      <footer className="player">
        <div>
          <strong>{selected?.name ?? 'Choose a station'}</strong>
          <span>
            {selected
              ? selected.streams.length
                ? 'Stream ready'
                : 'Stream verification in progress'
              : 'Saint Petersburg · Alpha 0.1'}
          </span>
        </div>
        <button className="play" disabled={!selected?.streams.length} aria-label="Play">
          ▶
        </button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
