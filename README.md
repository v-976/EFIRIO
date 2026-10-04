# EFIRIO

**The radio of your city**

EFIRIO is a city-focused internet radio project. Instead of presenting an undifferentiated catalogue of thousands of streams, EFIRIO is designed around the real radio landscape of a selected city.

Initial Alpha target: **Saint Petersburg, Russia**.

## Clients

- **PWA** — primary iPhone delivery path, also usable on Android and desktop.
- **Android** — native APK with background playback, MediaSession and lock-screen / notification controls.

## Core concept

```text
Country
└── Region
    └── City
        └── Station
```

The station catalogue is kept separate from client code so station data, streams and metadata sources can be updated independently.

## Alpha 0.1 goals

- Saint Petersburg station catalogue
- Verified current FM frequencies
- Verified working internet streams
- Primary + fallback stream support
- Play / Pause and station switching
- Now Playing metadata
- Artist + Title + timestamp
- Listening history
- Favourite stations
- Favourite tracks
- Local-first storage
- PWA and Android builds

## Repository layout

```text
EFIRIO/
├── android/
├── web/
├── data/
│   └── stations.json
├── assets/
│   ├── branding/
│   └── station-logos/
├── docs/
├── AGENTS.md
├── PROJECT_CONTEXT.md
├── PROJECT_MEMORY.md
└── README.md
```

## Project principles

- No advertising.
- No account required for basic use.
- No unnecessary collection of user data.
- Prefer official public station streams; do not run our own relay unless clearly necessary.
- PWA remains an independent distribution path.
- Android APK may be distributed directly.
- Architecture must not be hard-coded to Saint Petersburg or Russia.
- Validate real behaviour on target devices, especially Safari/iOS background playback and Media Session support.

## Status

Project bootstrap started. Application code has not yet been implemented.
