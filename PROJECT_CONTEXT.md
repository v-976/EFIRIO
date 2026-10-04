# PROJECT_CONTEXT — EFIRIO

## Identity

**Product:** EFIRIO  
**Tagline:** *The radio of your city*

EFIRIO is a city-first internet radio application. The defining product concept is that users can select a country, region and city and then see the stations that actually belong to that city's radio landscape, preferably including their current FM frequencies.

The first Alpha covers **Saint Petersburg only**, but the architecture must support multiple countries from the beginning.

## Platforms

### PWA

Primary use case on iPhone:

- Safari
- Add to Home Screen
- no jailbreak
- no mandatory Apple Developer Program
- should also work on Android and desktop browsers

Investigate and use Media Session API where actually supported. Never infer iOS behaviour merely from API documentation; validate on real iPhone hardware.

### Android

Native APK with:

- reliable background audio
- MediaSession
- notification controls
- lock-screen controls
- correct screen-off behaviour
- recovery after temporary network loss

Android Auto is a future feature, not Alpha scope.

## Catalogue model

```text
Country
└── Region
    └── City
        └── Station
```

Minimum station fields:

```text
id
country
region
city
name
frequency
streamUrl
fallbackStreamUrl
metadataSource
logo
status
```

The schema may grow later without breaking existing clients.

## Stream policy

Prefer official public internet streams provided by stations or their official distribution partners.

For every Alpha station verify:

1. station still exists
2. current FM frequency
3. official website
4. official or authoritative internet stream
5. stream format (HLS/AAC/MP3/etc.)
6. accessibility from Finland
7. metadata availability
8. Now Playing API/page availability
9. programme / track history availability
10. official fallback stream where possible

Do not accept a stream merely because an old directory lists it.

Expected playback strategy:

```text
primary stream
→ fallback stream
→ unavailable
```

## Now Playing and history

This is a core EFIRIO feature.

Persist at minimum:

```text
timestamp
station
city
artist
title
```

If a metadata source exposes the exact track start time, preserve it.

If only current `Artist - Title` is available, record the time at which the client detects the track change.

The history should support practical lookup such as:

> What played today around 14:30?

Users must be able to favourite a track directly from Now Playing or history.

## Local data / privacy

Initial favourites and history may be stored locally.

Principles:

- no account for basic use
- no unnecessary personal data
- no telemetry by default
- no cloud dependency for Alpha

## Branding

Brand: **EFIRIO**

Tagline: **The radio of your city**

Chosen visual direction:

- Modern Gradient E-Signal
- lighter cyan → blue → purple → magenta gradient
- optimized for dark-background visibility
- dedicated monochrome versions required
- icon geometry should remain recognizable at 16–24 px

Brand assets live under `assets/branding/`.

## Out of scope for first Alpha

Do not start with:

- all Russian regions
- account registration
- cloud sync
- own streaming relay/backend
- App Store publication
- Apple Developer membership
- Android Auto
- CarPlay
- complex server infrastructure

## Alpha 0.1 success condition

Two actually usable clients:

- EFIRIO PWA on iPhone
- EFIRIO Android APK

with Saint Petersburg stations, stable playback, Now Playing, artist/title/time history, favourite stations and favourite tracks.
