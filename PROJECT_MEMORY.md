# PROJECT_MEMORY — EFIRIO

This file records durable project decisions and current state so development can continue across computers and AI sessions.

## 2026-10-04 — Project start

### Brand

Selected product name:

**EFIRIO**

Selected tagline:

**The radio of your city**

Rejected/less suitable working names included Radiola, Efirium, EFIR, Radio Kefir, RadioMir, Volna and RadiGo due to existing use, radio/software conflicts or weaker brand uniqueness.

### Logo direction

Selected visual direction:

**Modern Gradient E-Signal**

A stylized letter E with broadcast arcs.

Final preference:

- light/high-visibility gradient
- cyan → blue → purple → magenta
- must remain readable on dark UI
- monochrome variants required
- geometry should survive 16–24 px rendering

### Product definition

EFIRIO is not intended to be a generic directory of thousands of random internet streams.

Its differentiator is:

**country → region → city → actual radio stations of that city**

First Alpha city:

**Saint Petersburg, Russia**

### Initial platforms

Two clients in one repository:

1. PWA
2. Native Android APK

Future possibilities, not Alpha requirements:

- native iOS
- App Store
- EU alternative iOS stores
- Android Auto
- CarPlay

### Key Alpha features

- city station list
- FM frequency
- station logo
- Play/Pause
- station switching
- favourites
- last station
- stream recovery
- primary/fallback stream
- Now Playing
- Artist
- Title
- track timestamp
- listening history
- favourite tracks

### Privacy / distribution principles

- no advertising
- no account required for basic use
- local-first favourites/history
- no unnecessary data collection
- prefer official public streams
- no own radio relay unless necessary
- PWA must remain independent from app stores
- direct Android APK distribution allowed

### Repository

GitHub repository created:

`v-976/EFIRIO`

Default branch:

`main`

At bootstrap the repository contained only a minimal `README.md`.

### Development workflow

Dynamic Lead → specialist agents → QA → build model.

Agent count is task-dependent, not fixed.

## 2026-10-04 — Alpha architecture selected

### Web / PWA

Selected stack:

- TypeScript
- React
- Vite
- browser HTML audio primitives
- Media Session API as progressive enhancement
- IndexedDB for track history
- localStorage for small Alpha preferences
- Service Worker + Web App Manifest

No server framework for Alpha.

### Android

Selected stack:

- Kotlin
- Jetpack Compose
- AndroidX Media3 / ExoPlayer
- MediaSessionService owns playback
- MediaController drives playback from UI
- DataStore for preferences
- Room for track history
- Kotlin serialization for catalogue parsing

### Shared catalogue

Canonical data remains outside both clients in `data/`.

Added JSON Schema contract: `data/stations.schema.json`.

Important schema decision: streams are an ordered array with `primary` / `fallback` roles rather than two permanently hard-coded URL fields. This preserves the Alpha behaviour while allowing future expansion.

Station-specific metadata endpoints belong in catalogue/configuration, not client constants.

### Backend

No EFIRIO backend for Alpha. A small proxy may be introduced only if a demonstrated browser restriction such as CORS prevents required metadata access. It should not become a radio relay by default.

### Research

Added `docs/STATION_RESEARCH.md` as the evidence ledger for Saint Petersburg.

A station is not `active` merely because an aggregator lists it. Current existence, FM frequency and an actually playable stream must be verified.

### Next technical milestone

1. research and verify the first Saint Petersburg stations
2. populate the canonical catalogue
3. create PWA playback proof using a verified entry
4. create Android Media3 playback proof using the same entry
5. test playback from Finland and real iPhone behaviour

## 2026-10-04 — Now Playing semantics and station time zones

EFIRIO Now Playing represents an **air item**, not only a music track. Normalized item kinds are `music`, `program`, `talk`, `jingle`, and `unknown`. Stations such as Humor FM can publish timed metadata for spoken/program segments as well as songs, and EFIRIO must preserve those items rather than leaving the previous song displayed.

Timestamp rules:

- Preserve a source-provided exact start timestamp as `startedAt` whenever available.
- If the source provides no exact start time, record `detectedAt` when EFIRIO first observes the item change; this is approximate and must not be presented as an exact source time.
- Metadata/history time belongs to the station/city time zone, not the listener device time zone.
- Each city/station must ultimately carry an IANA time-zone identifier; do not implement time zones as fixed arithmetic offsets.
- Saint Petersburg uses `Europe/Moscow` (MSK, UTC+3). Russia currently does not use seasonal clock changes, so Saint Petersburg remains UTC+3 throughout the year even when Finland changes between winter and summer time.
- If a Saint Petersburg metadata source returns a local timestamp without an explicit zone/offset, interpret it in `Europe/Moscow`, not in the browser/device zone.
- If an API supplies an explicit UTC offset or absolute timestamp, preserve that instant and format it for the station time zone when displaying station-air history.

Metadata enrichment policy:

- Prefer official station/API sources.
- Prefer structured JSON/API metadata over HTML scraping when both are available.
- Do not invent missing timestamps or metadata.
- Distinguish exact source time, EFIRIO detection time, and no metadata.
- For regional networks, verify that metadata corresponds to the Saint Petersburg feed rather than silently substituting Moscow/national-air metadata.
