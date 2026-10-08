# EFIRIO Architecture

## Alpha technology stack

### Web / PWA

- TypeScript
- React
- Vite
- standards-based HTMLAudioElement playback layer
- Media Session API as progressive enhancement
- IndexedDB for track history
- localStorage for small preferences such as last station and favourites during the first proof; preference reads and writes are exception-safe, so blocked or full storage must not break station selection or playback
- Service Worker / Web App Manifest for installability

Reasoning: the web client is primarily an audio application with a modest UI. React + TypeScript keeps state and UI explicit without introducing a server framework. Vite provides a small build surface. Playback remains based on browser media primitives so Safari/iOS behaviour can be tested directly rather than hidden behind a large abstraction.

### Android

- Kotlin
- Jetpack Compose UI
- AndroidX Media3 / ExoPlayer
- MediaSessionService for background playback
- MediaController from the UI
- DataStore for preferences
- Room for track history when history is implemented
- Kotlin serialization for catalogue parsing

The player and MediaSession live in a service, not in the Activity. The UI controls playback through MediaController. This is required for reliable background playback and system media controls.

## Repository boundaries

```text
android/     Native Android client
web/         PWA client
data/        Shared catalogue and schemas
assets/      Shared branding and station assets
docs/        Architecture, research and QA documentation
```

Neither client owns the canonical station catalogue.

## Catalogue contract

Canonical catalogue: `data/stations.json`
Schema: `data/stations.schema.json`

The catalogue is hierarchical for navigation but each station has a globally stable `id`.

Station IDs must never be based on array position. Once published, an ID should not change merely because a station changes frequency, stream URL or branding.

## Stream model

A station has an ordered `streams` array rather than only two hard-coded URL fields. Alpha UI may expose the behaviour as primary → fallback, while the data contract can support more than two endpoints later.

Each stream records:

- URL
- format
- role (`primary` or `fallback`)
- verification state/date
- optional notes

## Metadata model

Metadata is an adapter problem. Different stations may expose ICY metadata, JSON APIs, HTML Now Playing pages or no metadata at all.

Catalogue entries identify a metadata source by type and endpoint. Client code must not contain station-specific URL constants.

Normalized Now Playing record:

```text
stationId
artist
title
kind              music | program | talk | jingle | unknown
startedAt         optional exact source time, ISO 8601 UTC
detectedAt        client detection time, ISO 8601 UTC
sourceLocalTime   raw station-local value while no instant is derivable
timeZone          IANA time zone of the source city/station
timeQuality       exact | local-only | detected
source
```

`startedAt` is only produced when the source determines one unambiguous instant: an ISO value with `Z`/explicit offset, or a local date+time mapped into the station IANA zone. A bare wall-clock value (`14:30`), an ambiguous/non-existent local time (DST transitions) or an invalid date never becomes `startedAt`; the raw value is kept as `sourceLocalTime` with quality `local-only`. When neither exists, only `detectedAt` remains and quality is `detected`. Station time is rendered in the station zone, never in the browser/device zone.

## Listening history

History is local-only (`localStorage` key `efirio.trackHistory.v1`, no telemetry) and is written through a single gated path:

- a station must be selected;
- playback must be confirmed (audio `playing` event), and the event must belong to the current playback session: playback intent intact, element not paused, `readyState` at least `HAVE_CURRENT_DATA`, and the element `src` equal to the stream assigned for the session — events queued before a pause, stop, station switch or cancelled start are ignored;
- the metadata must belong to the currently selected station: responses and errors that settle after a station switch are dropped by a session-liveness check, so stale responses from a previously selected station are rejected;
- the item must differ from the last recorded item of the current session, so repeated metadata does not duplicate records.

Selecting a station without successful playback, pausing, stopping or an error during playback never add records. Loading tolerates corrupted legacy records: bad entries are skipped individually and never break rendering or discard the healthy history.

Retention applies both limits simultaneously:

- at most the newest **100** records;
- no records older than **48 hours**, measured by `detectedAt` (the moment EFIRIO actually observed the item during listening);
- records whose `detectedAt` is invalid are removed instead of being guessed.

Cleanup runs when history is loaded (and the cleaned payload is written back) and after every new record is added. `startedAt`/`sourceLocalTime` are never used for ageing.

## Playback state

Both clients should converge on the same conceptual state machine:

```text
idle
→ connecting
→ playing
↔ paused
→ reconnecting
→ fallback
→ unavailable
```

Transient network errors must not immediately mark a station unavailable.

## PWA constraints

Media Session is progressive enhancement. The application must remain playable when Media Session metadata/actions are partially unsupported.

Real iPhone testing is a release gate for:

- screen locked playback
- switching apps
- Play/Pause from system UI
- metadata/artwork on lock screen
- interruption and reconnection behaviour

## Android constraints

Background playback must use Media3 `MediaSessionService`. The service owns ExoPlayer and MediaSession. System notification/lock-screen state derives from the session metadata.

## Backend policy

Alpha has no application backend.

A small proxy/backend may only be introduced after a concrete browser limitation is demonstrated, for example a metadata endpoint that cannot be accessed client-side because of CORS. Such a component must not become a radio relay by default.

## Next implementation sequence

1. Validate catalogue schema.
2. Build Saint Petersburg research ledger.
3. Add verified station records.
4. PWA playback proof with one verified station.
5. Android Media3 playback proof with the same catalogue entry.
6. Implement primary/fallback recovery.
7. Implement normalized metadata.
8. Implement local history and favourites.
9. Device QA and Alpha 0.1 packaging.
