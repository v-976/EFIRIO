# AGENTS — EFIRIO

## Development model

EFIRIO uses a dynamic agent workflow:

```text
User requirement
→ Lead
→ only the specialist roles actually needed
→ QA
→ build / verification
```

Do not spawn a fixed set of agents for every task.

For a small change, the Lead may handle the work directly.

For a larger task, the Lead selects the minimum useful set of specialists.

## Potential specialist roles

- **Web/PWA** — browser UI, installability, service worker, Media Session, iOS Safari behaviour.
- **Android** — native application, foreground/background playback, MediaSession, notifications, lifecycle.
- **Audio/Streaming** — HLS/AAC/MP3 compatibility, reconnect logic, stream fallback, buffering.
- **Catalogue Research** — station existence, frequencies, official sites, stream verification.
- **Metadata** — Now Playing adapters, history normalization, timestamps.
- **QA/Build** — regression checks, target-device validation, release packaging.

These are roles, not mandatory permanent agents.

## Lead responsibilities

The Lead must:

1. read `PROJECT_CONTEXT.md`
2. read `PROJECT_MEMORY.md`
3. inspect current repository state before changing code
4. determine the minimum specialist set required
5. preserve platform separation while sharing data/contracts where sensible
6. keep the station catalogue independent from client code
7. update project memory after material decisions
8. require QA for user-facing build milestones

## Engineering rules

- Do not hard-code the architecture to Saint Petersburg.
- Do not duplicate station data in Android and web clients.
- Treat stream and metadata endpoints as data/configuration where practical.
- Keep user history/favourites local-first in Alpha.
- Gracefully handle missing metadata.
- Gracefully handle primary stream failure and fallback.
- Do not introduce a backend unless a demonstrated client-side limitation requires one.
- Avoid unnecessary frameworks and infrastructure.
- Prefer reproducible builds and clear setup instructions.
- Never claim iOS/PWA background behaviour is supported until tested on real hardware.

## Research rules

For catalogue entries, record evidence and verification date.

A station must not be marked usable solely because an aggregator lists a stream.

Prefer:

1. station official website/API
2. official network/owner infrastructure
3. authoritative distribution endpoint

Third-party aggregators may be used only for discovery and cross-checking.

## QA rules

At minimum, verify:

- app starts cleanly
- catalogue parses
- station selection works
- stream starts
- Pause/Resume works
- station switching works
- network interruption does not crash the app
- fallback behaviour works where configured
- metadata updates do not duplicate endlessly
- history timestamps are sane
- favourites persist
- small icon assets remain legible
- PWA installability
- Android background playback

Platform-specific QA must be explicit.

## Documentation discipline

Material architectural and product decisions belong in:

- `PROJECT_CONTEXT.md` — stable project definition
- `PROJECT_MEMORY.md` — chronological decisions/state
- `README.md` — public overview and basic setup

Keep these usable on both home and work computers after a fresh Git clone.
