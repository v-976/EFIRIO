# EFIRIO Architecture

## Alpha technology stack

### Web / PWA

- TypeScript
- React
- Vite
- standards-based HTMLAudioElement playback layer
- Media Session API as progressive enhancement
- IndexedDB for track history
- localStorage for small preferences such as last station and favourites during the first proof
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
startedAt       optional exact source time
detectedAt      client detection time
source
```

If `startedAt` is unavailable, history uses `detectedAt` and marks timing as detected rather than exact.

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
