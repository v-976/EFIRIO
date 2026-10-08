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

## 2026-10-08 — M1: air-time normalization and listening history

### Time model

New module `web/src/time.ts`:

- Absolute instants are stored strictly as ISO 8601 UTC. ISO input with `Z` or an explicit offset is validated (real calendar date, sane time/offset) and converted.
- Local date+time without offset is interpreted in the station IANA zone (from the catalogue `city.timeZone`), never in the device zone. Conversion is `Intl`-based (`formatToParts`), so any IANA zone works, including future cities.
- A value that maps to a non-existent or ambiguous local time (DST gap/fallback in other zones) is not accepted as an exact timestamp.
- A bare wall-clock value (`14:30`) is never given an invented date: it is kept as `sourceLocalTime` with quality `local-only`.
- Display formatting also goes through the station zone; nothing in Now Playing/history rendering uses the browser zone.

Now Playing model extended to `startedAt` (exact UTC), `detectedAt` (client observation UTC), `sourceLocalTime`, `timeZone` and `timeQuality` (`exact` | `local-only` | `detected`). `startedAt` is never replaced by `detectedAt`. `MetadataConfig` in the catalogue is unchanged; the station zone is passed per request as a separate context argument.

### Listening history

New module `web/src/history.ts` owns the same `efirio.trackHistory.v1` localStorage key:

- `HistoryRecorder` is the single write path and gates every record behind: a selected station, confirmed playback (`audio.playing`), metadata belonging to the currently selected station (stale responses from the previous station are rejected), and an item different from the last recorded one of the session.
- Selecting a station without a successful play, pausing, stopping, an audio error or a running playback audit never create records. On playback start an already-known current item is recorded.
- Loading is corruption-tolerant: broken JSON, non-array payloads and individual broken records are skipped per record without losing healthy history or crashing rendering. Legacy `startedAt` values that are not ISO instants are demoted to `sourceLocalTime`.
- Writes remain local-only with a 100-entry cap; storage failures (quota/private mode) are swallowed.

### Verification

- `npm test` — Node.js built-in test runner, 35 tests covering ISO/offset/local/invalid/duplicate-date inputs, DST ambiguity, device-TZ independence (child processes under different `TZ`), history gating, station switching, stale responses, corrupted records.
- `npm run build` (`tsc -b` + `vite build`) passes. No changes to streams, catalogue content, manifest, GitHub Pages or browser-audit logic.

## 2026-10-08 — M1: history retention limits

`HistoryRecorder` now enforces two simultaneous retention caps, applied both when history is loaded and after every insert:

- **100 entries** maximum (`HISTORY_LIMIT`, unchanged);
- **48 hours** maximum age (`HISTORY_MAX_AGE_MS`) measured strictly by `detectedAt` — the moment EFIRIO observed the item while it was actually being listened to; an entry exactly 48 hours old is still kept, anything strictly older is removed;
- the age filter runs **before** the 100-entry cap, so stale entries never occupy capped slots;
- records with an invalid or missing `detectedAt` are deleted as corrupted (previously a valid `startedAt` could substitute for a missing detection time); the recorder itself always stores a valid `detectedAt`, falling back to the current instant for an incoming track with a broken one;
- at load time the cleaned payload is written back to `efirio.trackHistory.v1`, which also heals broken/legacy payloads;
- duplicate suppression and the confirmed-playback gate are untouched.

Verified with `npm test` (43 tests, including 48-hour boundary, 100-entry cap, corrupted timestamps, combined limits and insert-time cleanup), `npm run typecheck` and `npm run build`.

## 2026-10-08 — M1: code-review hardening

Four review remarks were checked and the three confirmed ones fixed (retention limits unchanged: 100 entries / 48 hours):

1. **Late `playing` events — CONFIRMED, FIXED.** The handler trusted any audio `playing` event, so an event queued before a pause, audit stop, station switch or cancelled start could reopen the history gate without real playback. The gate now goes through `canOpenHistoryOnPlaying` (`web/src/history.ts`): playback intent intact, element not paused, `readyState >= HAVE_CURRENT_DATA`, and the element `src` equal to the stream assigned for the current session (`expectedSrcRef`, cleared on interruption, set in `playStream`). Genuine starts and fallback streams are unaffected; `setIsPlaying` UI logic was deliberately left untouched.
2. **Unguarded `efirio.lastStationId` write — CONFIRMED, FIXED.** A throwing `localStorage.setItem` aborted `chooseStation` before playback could start (plus an unhandled rejection). New module `web/src/storage.ts` (`safeGetItem`/`safeSetItem`) now guards both the startup read and the selection write; storage failures only mean the preference is not persisted.
3. **Metadata/selection races — CONFIRMED, FIXED.** Between `chooseStation` and React effect cleanup an in-flight response of the previous station could still fire, overwriting Media Session, Now Playing and `nowPlayingRef` (which could later attribute the old track to the new station in history). `MetadataContext` gained `isActive()`; `chooseStation` bumps `metadataSessionRef`, and `watchNowPlaying` drops responses/errors of a superseded session.
4. **Source encoding — NOT REPRODUCED.** All sources decode as strict UTF-8 with no replacement characters; the garbled Cyrillic was a PowerShell console artifact. No files were rewritten for encoding.

Verified with `npm test` (54 tests), `npm run typecheck`, `npm run build`, plus a browser smoke test: clean start, station select/switch, real playback to `Live`, pause/resume, persistence of `efirio.lastStationId`, zero console errors.
