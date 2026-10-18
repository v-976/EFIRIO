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

## 2026-10-12 — Now Playing: hostingradio/emgsound air logs

### Finding

Browser audit from the deployed PWA origin (`https://v-976.github.io`) showed that the MTS JSON endpoints (`music.mts.ru/radio_proxy_…`) used for Europa Plus, Novoe Radio and Radio Shanson **do not allow cross-origin reads**, so they never worked in the PWA. The official HTML playlist pages are blocked the same way.

The streaming providers themselves publish a CORS-readable air log next to each HLS channel: `https://hls-01-<host>.hostingradio.ru/<channel>/metadata.json` and `https://hls-0N-<host>.emgsound.ru/<n>/metadata.json`. Shape: `{ generatedTime, previous[20], current, next[] }`; items carry `startTime` (ISO with +03:00 offset → exact), `artist`, `title`, cover URLs and a numeric `type`: 1 advert, 2 station ID/jingle, 3 music, 4 programme. The same service answers `?format=fmgid&subformat=current` with a flatter, less precise payload. HTTP 404 with `{"error":"Not found","is_live":true}` means the channel exists but no current item is known (common between songs on some channels).

Channel suffix `495` = Moscow/central feed, `812` = Saint Petersburg. GPM has `812` channels for Humor FM, Relax FM, Like FM, Detskoe, Avtoradio and Comedy Radio, but only `relaxfm812` publishes an air log.

### Decisions

- New metadata type `air` (catalogue schema + `normalizeAir` in `web/src/metadata.ts`). Only `current` is ever Now Playing; `previous`/`next` are never substituted.
- **Scope rule:** metadata must describe the stream EFIRIO actually plays. Where EFIRIO plays a central online channel, its air log is correct for what the listener hears, even if the FM 812 broadcast differs; the catalogue notes say so per station.
- Relax FM primary stream switched to the Saint Petersburg channel `relaxfm812` (it has an air log); `relaxfm7` kept as fallback.
- New air kind `advert`. Adverts and station IDs/jingles are displayed in Now Playing but are not written to the listening history.
- Cover art (`coverImageUrl300`, https only) is shown in Now Playing and passed to Media Session artwork.
- Fixed: the JSON normalizer searched into `prev_tracks`/`previous`, so a station ID without an artist borrowed the artist of the previous song. fmgid `date` + `time` now combine into an exact station-local start.
- Novoe Radio and Radio Shanson set back to `unknown` until a browser-readable source is found.

Now Playing coverage of stations with a stream: 7 configured (of which only 1–2 really worked in the browser) → 14: Дорожное, Ретро FM, Юмор FM, Хит FM, Радио Вера, Relax FM, Like FM, Европа Плюс, MAXIMUM, DFM, Детское, Monte Carlo, Русское Радио (intermittent).

Still without metadata: Вести FM, Радио Ваня, Новое Радио, Радио Гордость, Studio 21, Радио JAZZ, Орфей, Питер FM, НАШЕ, Шансон, Маяк (icecast servers do not expose status JSON cross-origin).

Verified with `npm test` (63 tests).

## 2026-10-14 — R2: География России (region → city → stations)

EFIRIO went from one city to 35 cities across 33 Russian regions. Saint Petersburg is unchanged: its catalogue block is byte-identical to `cdafc4a`, and the only edit to pre-existing data is the root `updatedAt` bump.

### Data

- `data/stations.json`: 846 stations (42 in Saint Petersburg, unchanged + 804 new). Frequencies from `topradio.me` city lists, streams independently probed and kept only on HTTP 2xx with an HLS manifest or audio content type. 160 rows with no verifiable stream were dropped rather than filled with guesses — there are no new `research` entries. All evidence and dates in `docs/STATION_RESEARCH.md`.
- Schema gained one **optional** station field, `feed: "local" | "federal"` (713 of 846 are federal). Absent means local, so Saint Petersburg needed no edits.
- 347 stations now carry an `air` Now Playing log, reusing the M1-era air-log contract — `metadata.ts`, `history.ts` and the player are untouched.

### Decision: shared feeds must not pass as local broadcasts

Most Russian networks stream one central feed to every city. Publishing that URL under a city's FM frequency would tell the listener they are hearing Novosibirsk's 93.8 when they are hearing the Moscow channel. So:

- `feed` is **inferred from evidence, not a name list** — a URL is shared when it serves three or more cities.
- Moscow is the documented exception: in Moscow those central/MSK channels *are* that city's actual air, so they stay `local`. Without this, Moscow would have been mislabelled wholesale.
- The UI shows a quiet muted *federal feed* tag. Deliberately not a warning colour: the stream works and is the right station, it just may not be the local FM programme.

### Decision: single statically-imported catalogue, no lazy loading

Adding 1.3 MB of pretty JSON would normally argue for per-region dynamic import. Rejected for Alpha: it would complicate the one component that owns playback, persistence and metadata for a size cost that gzip absorbs well. The shipped JS is 976 kB raw / **113 kB gzip**. Worth revisiting only with measured evidence of a slow first load.

### Decision: one recorder per city time zone

`HistoryRecorder.defaultTimeZone` is fixed at construction. Rather than mutate history internals, the recorder is rebuilt when the city's zone changes — history itself is global and survives, only the fallback zone follows the city. `recorder.selectStation(null)` ends the listening session so a track from the old city can never be attributed to the new one.

### UI

Region select → city select → city search, all derived from the catalogue so a new city is a data-only change. Search matches Cyrillic and Latin spellings case-insensitively. `cityId` persists in `localStorage` (`efirio.cityId`); a new install, an unknown or a removed id falls back to Saint Petersburg without touching the stored value. Changing city tears down playback, the metadata watcher, runtime badges, audit results and Media Session together. Region colours, logo, layout and the existing station row are unchanged.

Fixed during QA: an out-of-range city id used to silently reset the user to Saint Petersburg; `changeCity` now ignores ids it cannot resolve.

### Verification

`tsc -b` clean, 63 tests pass, production build succeeds. Browser: default Saint Petersburg (42 stations); Cyrillic search → Москва (42, all local); Новосибирск (28, 25 tagged federal); Якутск via region select (13); playback reaches `Live` on the city-specific `kpradio…novosibirsk.radiokp64.mp3` with Media Session reading "98.3 FM · Новосибирск"; `cityId` survives a reload; a corrupt `cityId` falls back to Saint Petersburg; city change stops playback and clears Media Session; zero console errors.

## R3.1: internet scope (United Kingdom)

### Decision: internet catalogue kept structurally separate from the Russian tree

`data/internet/united-kingdom.json` sits outside `countries[].regions[].cities[]`, so the Russian catalogue stays byte-identical and no Russian code path reads the new shape. The index is a small static import; each country is a separate static file loaded on demand through `import.meta.glob`, which makes Vite code-split it: the UK chunk is 1,058 kB raw / **93 kB gzip**, and it is never fetched while the user is in Russian scope. The index sits at `data/internet-index.json`, outside the globbed folder, so the glob only sees country files and nothing is double-bundled. Verified in the network log: one chunk request on entering the scope, zero while in Russian scope.

### Decision: the scope picker is a field, not a new screen

A `Category` field was added to the existing `cityPicker` and the breadcrumb becomes `Интернет › country › Радиостанции`. Region, city and city-search are preserved untouched for Russian scope; internet scope swaps in country, station-name search and genre/city filters. This keeps the layout, palette, brand and station row the user already knows, and it means a second country is a data file plus one index entry — no component change.

### Decision: persistence is a separate key, and the Russian key is never rewritten

`efirio.scope` and `efirio.internetCountryId` sit alongside `efirio.cityId`. Entering the internet scope tears playback down through the same shared teardown used by a Russian city change and clears the last-station key, so a track from one scope can never be attributed to the other. The country is loaded lazily and falls back to the first entry in the index if the stored id is unknown.

### Decision: no Now Playing adapter is shipped for the UK

3057 candidate endpoints were probed with the real Pages origin and none returned an open CORS header — 135 answered `Access-Control-Allow-Origin: null`, 185 returned HTML instead of JSON, the rest failed outright. Because EFIRIO must never invent a track title, and only browser-readable JSON is configurable, the UK stations ship with no metadata adapter. The Russian `air`/`json`/`html` handling is untouched.

### Genre filters are derived, not dumped

Raw Radio Browser tags run to 570 distinct values including each station's own frequency, its bitrate and internal markers. Frequencies, bitrates and codec words are dropped, decade spellings fold into one value, and only genres on at least four stations (103) are offered as filters. Every station still displays its full tag set.

### Verification

`tsc -b` clean, 63 tests pass, production build succeeds. `data/stations.json` is unchanged. Browser: Russian scope first, 42 Saint Petersburg rows, all with FM frequencies and no internet chrome; `Category › Интернет` loads the UK catalogue with the GB chip, country subline and no frequency; search and the genre filter narrow correctly; chunked rendering caps the list at 60 mounted rows with a working `Show more` (955 remaining after one click); **BBC Radio 2 plays** — HLS manifest plus segments returned 206 and the player reached `Live`; scope and country survive a reload while `efirio.cityId` stays intact, and switching back to Russia restores the 42 local rows.

Fixed during this work: 32 Wikipedia group headings were matching as stations; a leaked page title was reaching the territory check; 420 UK stations were invisible because their homepages are JavaScript shells; the genre dropdown offered 570 unusable values.

### Post-run addition: Dance Attack FM (2026-10-14)

A targeted request re-checked one station the run had missed, and it had failed twice over: Radio Browser's only stream was http-only (`http://streaming04.liveboxstream.uk:8045/1` — alive, but mixed content, and unrecovered by the HTTPS retry), while the affiliation evidence stopped at a homepage-place match against an empty Radio Browser `state`, so the station never earned a tier. The official site settles both by declaration — "a U.K. focussed non-profit station" paying PPL & PRS — and its player configuration supplies a working HTTPS MP3, `https://s6.autopo.st/proxy/gqfwzcil?mp=/1` (`ACAO: *`, sustained 540 kB over 12 s). Genres are the site's own five (Dance, Trance, House, Progressive, Psytrance); city stays `null` because the site states no city; Now Playing stays off because `ownmetadataurl` is empty and the stream carries no `icy-metaint`. Verified against a dev server in the browser: the search finds the row, the click reaches `Live`, the console is clean. The catalogue now publishes 1076. The change is data-only — `data/internet/united-kingdom.json` plus these docs — with `data/stations.json`, the player, the styling and the other 1075 British stations untouched.

### Decision: Finland is two more data files and two more scope values (R3.2, 2026-10-15)

`Scope` gains `finland` and `finland-internet`. Terrestrial Finland lives in `data/finland.json` (registry + `nationwide[]` ids + `regions[]` + `cities[]`, every frequency row tagged with its locality and region); internet-only Finland lives in `data/internet/finland.json` in the exact UK shape, loaded directly by id — `data/internet-index.json` stays UK-only so the existing index contract is untouched. Both load on demand through `import.meta.glob` and code-split: 203 kB raw / 21.9 kB gzip for terrestrial, 20.5 kB / 3.1 kB for internet, never fetched while the user is in Russian or UK scope. The Finnish geography persists on its own keys, `efirio.finlandRegionId` and `efirio.finlandCityId` (values include `'all'`), so `efirio.cityId` and `efirio.internetCountryId` are never rewritten; unknown stored ids fall back to «Вся страна» without crashing. Entering either scope, and every Finland region/city change, tears playback down through the same shared teardown as a Russian city change. The UI reuses the existing picker, breadcrumb, station row and filters — one Category option each — with chunked rendering extended to the Finland lists and frequency chips showing the row of the matched place (city, then region, then search match). No colour, palette, branding or Russian/British behaviour changed; no new dependencies.

### Decision: Finland classification and evidence rules (R3.2)

Nationwide is a manual, evidence-checked list of seven single-programme national networks (POPfm, Radio Nova, Yle Radio 1, Yle Radio Suomi, Yle Radio Vega, Yle X3M, YleX); they are never duplicated into region or city lists. Verified regional variants of one network (Yle Radio Suomi/Vega windows, Radio Dei windows) are separate registry records whose frequency rows carry transmitter locality and region — a window appears only when the user's geography matches, and multi-city coverage zones never create fake copies. Otherwise coverage outranks catalogue tier: two or more confirmed towns make a station regional regardless of how a wiki list titled it. Geography comes only from the Traficom-derived radioasemat.fi locality rows (mapped to regions through a 317-key municipality table, Åland included), the wiki Yle transmitter table or the station's own statements — never from server location, TLD or site language. Radio Browser remained discovery-only. Streams are official HTTPS endpoints validated by real audio bytes from Finland; stale aggregator HTTP links never condemned a station whose own site still plays. `data/research/finland.json` records every exclusion (236) with reason code, sources and website. Verification date: 2026-10-15.

### Verification (R3.2)

`tsc -b` clean, production build succeeds with the Finland chunks split off; `data/stations.json` byte-identical (0-line diff). Browser: «Вся страна» shows exactly the 7 nationwide entries with FM chips; Uusimaa lists 32 regional/local stations with 12 city options and no nationwide duplicates; Helsinki shows city-specific chips (Loop 101.8 vs 96.5 on the region, NRJ 96.8 vs 88.8); search by city (Tampere, 34 hits) and by region (Pirkanmaa) labels each row with the matched place and chips the matched-place frequency, including «Вся страна · Tampere» for nationwide hits; Åland (Ahvenanmaa) lists its five stations and the Turku window with the Sund 100.3 row. POPfm plays from its official Revma stream; Radio Dei reaches `Live` with 11 working JSON metadata fetches and a graceful «No track metadata» elsewhere. Scope and geography survive reloads; corrupt stored ids degrade to «Вся страна»; a no-match search shows the empty note. Teardown between the two Finland scopes stops the previous stream, clears `efirio.lastStationId` and leaves no stale `Live` badge. The one «Дорожное радио» playback seen during testing was a manual click by the user, not an application defect. Desktop browser only — not tested on real iPhone hardware.

## R3.4: Estonia (Эстония / Эстония — Интернет, 2026-10-16)

### Decision: Estonia is the R3.2 pattern with one schema addition (`band`)

`Scope` gains `estonia` and `estonia-internet`. Terrestrial Estonia lives in `data/finland.json`'s twin `data/estonia.json` (registry + `nationwide[]` + `regions[]` + `cities[]`, every frequency row tagged with locality and region); internet-only Estonia lives in `data/internet/estonia.json` in the exact UK/Finland shape, loaded directly by id — `data/internet-index.json` stays UK-only. Both load on demand through `import.meta.glob` and code-split: 44.4 kB raw / 3.3 kB gzip for terrestrial, 60.1 kB / 7.4 kB for internet, never fetched while the user is in another scope. Estonian geography persists on its own keys, `efirio.estoniaRegionId` and `efirio.estoniaCityId` (values include `'all'`), so `efirio.cityId`, `efirio.internetCountryId` and the Finland keys are never rewritten. Entering either scope, and every Estonia region/city change, tears playback down through the same shared teardown as a city change. The UI reuses the existing picker, breadcrumb, station row and filters — one Category option each — with chunked rendering extended to the Estonia lists and the search matching station names, cities, regions and the territory of confirmed frequency rows (so a nationwide station is findable by its transmitter town without being copied into city buckets).

The one schema addition: a frequency row may carry `band: 'AM'`. Estonia has exactly one AM station — Radio Eli, 1035 kHz from Kavastu, Tartu maakond, on air since 03.10.2001 — encoded as `frequencyMHz: 1.035` with `band: 'AM'`; the UI renders «1035 кГц» instead of an invented FM number, and the Media Session subtitle prints kHz for any sub-10-MHz value. Finland and Russia rows never carry `band`, so their behaviour is unchanged.

### Decision: classification comes from the TTJA licence register, corrected where the register is stale

The authoritative FM source is the TTJA «FM raadiojaamade saatejaamad» PDF (04.07.2025): 34 licences, 242 transmitters. Type is derived mechanically from the licence's transmitter footprint: ≥10 maakonnad → `nationwide`, 2–9 maakonnad or 1 maakond spanning several localities → `regional`, 1 maakond with a single locality → `local`. The register predates two events that official media and the operators' own sites confirm: **Tre Raadio closed** (last broadcast 16.01.2026, sold to NUVOLA 07.01.2026), so **XFM inherits all ten transmitters** (6 Tre + 4 Tre plus) and is published as nationwide from xfm.ee's own «üle-Eestiline raadiojaam» description; and the TTJA's own alias spellings (Sky Raadio → «Sky Radio», Super Raadio → «Super Radio», Radio drUzi → «drUzi») are normalised to the programme's canonical names. Radio Eli and Semeinoje Radio are separate records: Radio Eli has no FM row anywhere (its 98.2 neighbour is Semeinoje, confirmed by both stations' official coverage maps and the TTJA register), and Semeinoje's two transmitters (Narva 95.6, Ahtme 98.2) match the register exactly. Pereraadio stays one record: its official map equals the register, and the Tallinn/Kuressaare feed splits carry no officially distributed frequencies, so no per-feed copies were invented.

Result: 34 terrestrial stations — 11 nationwide (Vikerraadio, Raadio 2, Klassikaraadio, Raadio 4, Sky Plus, Retro FM, Star FM, Raadio Kuku, Raadio Elmar, Pereraadio, XFM), 16 regional, 7 local — across all 15 maakonnad and 39 cities.

### Decision: DAB+ stays documentation

`dabplus.ee` documents two DAB networks (R1, R3), ~80% population coverage and a rollout dated 01.09.2025 with multiplexes through 11.2025, but the full channel list is rendered by a JavaScript widget and could not be extracted machine-readably. ERR's R2 ALTPop is marked «(DAB)» by ERR itself. Nothing DAB-only was published as a user category; the findings live in `data/research/estonia.json` and `docs/STATION_RESEARCH.md` (exclusion code `dab-only-documented` for the one DAB-only candidate).

### Decision: no Now Playing adapter is shipped for Estonia

All 72 published entries carry `metadata.type: 'none'`. No Estonian station exposed a browser-readable (CORS-open) metadata endpoint in the probe passes; the icy stream name is a station name, not a track. As with the UK, absence never blocks publication and nothing is guessed.

### Verification (R3.4)

`tsc -b` clean, 63 tests pass, production build succeeds with the Estonia chunks split off; `data/stations.json`, the Finland/UK/Russia catalogues and the audio/metadata/history modules are untouched. Browser (desktop, dev server): «Эстония» shows exactly the 11 nationwide entries with FM chips; Tartu maakond lists its regional/local stations with city options Luunja/Tartu and Tartu-matched frequency chips (Sky Raadio 107.2, Super Raadio 101.2); **Radio Eli renders «1035 кГц» and plays Live** from `https://icecast.pereraadio.ee:9000/RadioEli`; search by name («radio eli») and by geography («narva» → Semeinoje Radio 95.6, «Региональная · Narva») both work; «Эстония — Интернет» lists 38 stations with genre/city filters and EE chips, and **R2 Pop plays Live** from the ERR stream; `efirio.estoniaRegionId`/`efirio.estoniaCityId` persist with `'all'` while the Russian and Finland keys stay intact; switching back to Финляндия and Россия restores their scopes unchanged. Desktop browser only — not tested on real iPhone hardware.

Known limitations recorded, not hidden: the TTJA PDF (2025-07-04) predates the Tre→XFM change and was corrected from ERR/xfm.ee/et.wikipedia; Kaguraadio's HLS playlist name carries a rotating chunklist id (`playlist.m3u8` 404s, risk noted in its catalogue notes); Kuku High's website is `null` (kuku.ee/kuku.pleier.ee serve a generic «Kuula Postimees» page); DAB+ channel list remains partially documented. Not committed — working tree holds the change awaiting review.

## R3.3: Многоязычный интерфейс (2026-10-16)

### Decision: seven local dictionaries, English inline, everything else lazy

The UI speaks `ru`, `en`, `fi`, `sv`, `et`, `ro`, `el` through one typed dictionary in `web/src/i18n.ts`; English ships in the main bundle as the per-key fallback, the other six are lazy chunks behind `import.meta.glob` (1.2–1.7 kB gzip each). Detection reads `navigator.languages` (regional variant → base code, unsupported → `en`), the manual choice persists under `efirio.uiLanguage` and outranks the browser list; the auto-detected language is never written to storage and no geo/IP/country-of-station is consulted. Catalogue data (stations, cities, regions, artists, tracks) and endonyms are never translated; player/metadata statuses hold a `MessageKey` so a switch re-renders them live, and `document.title`/`html lang` re-run off a version counter so a late dictionary load still lands. A missing key or an unloaded dictionary always renders English.

### Verification (R3.3)

`typecheck` 0, `node --test` 77/77, `vite build` 0. Browser: `['fi','ru']` → fi; a saved `ru` survives reload; a stored `de` falls back to auto-detection; switching el → et during playback does not stop it; placeholder `{...}` and hardcoded UI-phrase scans clean. Committed `281c656`, pushed, Actions run #19 success, Pages serves `index-CdlrJFbp.js`. (Recorded retroactively during R3.3.1 — the entry was missing from this file.)

## R3.3.1: Единый Internet-каталог и эндонимы стран (2026-10-16)

### Decision: one Internet category with a country selector, no per-country scopes

`Scope` collapses from six values to four: `russia | internet | finland | estonia`. The `finland-internet` and `estonia-internet` scopes are gone; `data/internet-index.json` becomes the single country list of the Internet category (`united-kingdom`, `finland`, `estonia` added beside the untouched UK entry — no second index), and every country keeps loading its own `data/internet/<id>.json` chunk through the existing glob. Switching country inside Internet behaves like every other geography change: playback is torn down, the choice persists under the existing `efirio.internetCountryId`, the search/genre/city filters are cleared, and an empty list is shown (never the previous country's rows) until the new file arrives. The terrestrial `russia`/`finland`/`estonia` scopes, catalogues and geography keys are untouched.

### Decision: country names are endonyms, held in one small reference

`web/src/countries.ts` holds the approved table keyed by the stable catalogue ids — `russia` → Россия, `finland` → Suomi, `estonia` → Eesti, `united-kingdom` → United Kingdom, `romania` → România, `greece` → Ελλάδα — and `countryEndonym(id, fallback)` deliberately takes no language argument (a country name cannot depend on the UI language), degrading to the catalogue's own name for an unknown id. The endonym is applied in the category picker, the Internet country selector, the breadcrumb, station-card subtitles, loading notes and the player's place line; `t(...)` still serves every other UI string. Ten country-name keys were removed from all seven dictionaries (`scopeRussia/scopeFinland/scopeEstonia`, the two `— Internet` scopes, `placeRussia/placeFinland/placeEstonia`, the two `err…InternetLoad` messages), and the Internet category label is the language-neutral `Internet` everywhere (ru `scopeInternet`/`crumbInternet` changed from «Интернет» — user-approved).

### Decision: legacy scopes migrate once, idempotently, touching nothing else

`web/src/scope.ts` owns `efirio.scope`/`efirio.internetCountryId` and `bootScope(storage)`: a stored `finland-internet`/`estonia-internet` is rewritten to `internet` + the country it meant (overwriting a stale country choice), while `internet` keeps its stored country, `russia`/`finland`/`estonia` pass through byte-identical, and an unknown value falls back to `russia` without a write. Storage access is injected, so the nine `scope.test.ts` cases exercise migration, idempotency and key preservation without a DOM; `countries.test.ts` pins the approved endonyms and proves they do not follow `setLanguage`. The migration never touches `efirio.uiLanguage`, city/region keys, history or `efirio.lastStationId`.

### Verification (R3.3.1)

`tsc -b` clean; targeted `node --test` (scope + countries + i18n) 26/26 — the full regression suite was deliberately not re-run, only the modules changed by this stage were tested; production build succeeds with the per-country chunks still split (UK 93 kB gzip, internet-FI 3.1 kB, internet-EE 7.4 kB, terrestrial FI/EE 21.9/3.3 kB). Browser (desktop, production preview): the category picker reads Россия / Internet / Suomi / Eesti and the Internet selector United Kingdom / Suomi / Eesti — byte-identical under fi, ru and et; UK → 60 mounted rows «United Kingdom …», Suomi → 24 «Suomi …», Eesti → 38 «Eesti …», with zero rows of the outgoing country at the moment of each switch and filters cleared on country change; no «Великобритания/Финляндия/Эстония» anywhere in the rendered page; breadcrumb `Internet › Suomi › Radiojaamad`, footer place `Suomi · Alpha 0.1`. Seeded `finland-internet` (+ stale `united-kingdom`) boots as internet+finland and seeded `estonia-internet` (+ stale `finland`) as internet+estonia, each auto-loading its country; a second reload changes nothing (idempotent), `efirio.uiLanguage`/`efirio.cityId`/`efirio.lastStationId` survive both migrations, and no station is bound to the wrong country on boot. Manual language `et` survives reloads; switching ru → et while **R2 Pop plays** keeps playback (button Ⅱ, badge «Eetris»); terrestrial Россия (42 rows), Suomi (7 nationwide with FM chips) and Eesti (11 nationwide) load as before. Desktop browser only — not tested on real iPhone hardware.

Final fix round (same date) closed both limitations: `errFinlandLoad`/`errEstoniaLoad` and the two search aria-labels now take a `{country}` parameter fed by `countryEndonym(...)` at the four render sites — country tokens are endonyms in all seven UI languages while the surrounding prose stays localized per language; the index `stationCount` for the UK was corrected 1075→1076 after verifying the catalogue holds 1076 unique, active, stream-carrying entries (stations untouched). Verified minimally: typecheck green; targeted check — placeholder parity 7×4, all 28 golden renders through the real `translate()` path, index counts match all three country files. No audio, MediaSession, Now Playing, history or catalogue-data behaviour changed. Not committed — working tree holds the change awaiting review.

## R3.5: Румыния (Румыния / România, 2026-10-17)

### Decision: Romania is the R3.2/R3.4 pattern — one `romania` scope, one `romania` internet country, endonym from the shared table

`Scope` gains `romania`. Terrestrial Romania lives in `data/romania.json` (registry + `nationwide[]` + `regions[]` + `cities[]`, every frequency row tagged with locality and region, AM rows carrying `band: 'AM'`); internet-only Romania lives in `data/internet/romania.json` in the exact UK/Finland/Estonia shape and is reached through the existing `data/internet-index.json` country list — no second index. Both load on demand through `import.meta.glob` and code-split: 78.76 kB raw / 11.77 kB gzip terrestrial, 6.76 kB / 1.50 kB internet, never fetched while the user is in another scope. `România` is the endonym read from `web/src/countries.ts`; no country-name key was added to any of the seven dictionaries, and both the category picker and the Internet country selector render it identically in every UI language. Romanian geography persists on its own keys, `efirio.romaniaRegionId` and `efirio.romaniaCityId` (values include `'all'`), so `efirio.cityId`, `efirio.internetCountryId` and the Finland/Estonia keys are never rewritten. The `main.tsx` types mirror the Estonia block one field at a time (`RomaniaFrequency` reuses `band?: 'FM' | 'AM'`, AM stored as MHz so the UI prints «603 kHz»).

### Decision: footprint decides type, and the umbrella brand never ships as a station

16 nationwide, 10 regional, 1 local across 22 județe and 27 cities — 623 frequency rows (586 FM, 37 AM). Nationwide is the broadcaster's own footprint across județe (RFI România: București 93.5, Craiova 94, Cluj-Napoca 91.7, Iași 97.9, Timișoara 96.9, Sibiu 89.0 — five județe; Radio ZU: 50 cities); regional is one județ; local is one city (București FM). **Radio România Regional is excluded although its mount works**: `stream4.srr.ro:8443/radio-ro-regio-100ro` returns `mpeg` 320 kbps with icy-name «Radio România Regional 100% Românesc» and is first in the operator's own playlist, but the brand owns no frequencies of its own — the wiki table lists its ten studios, which already publish as the ten regional records, so a brand record would duplicate them. The previously recorded reason ("no HTTPS stream") was factually wrong and is corrected here, together with the domain fact that `radioregional.ro` is a private Activ FM (Suceava) domain, not SRR: the brand lives at `romaniaregional.ro` via a redirect from `radioromaniaregional.ro`.

### Decision: a stale CDN cache is not a working stream — Romantic FM stays out

The user's selection included Romantic FM, and its HLS chain passed a naive check (manifest `#EXTM3U`, no DRM, real ADTS AAC in the fetched segment). A liveness check failed it: the playlist held `MEDIA-SEQUENCE 24128023` with `PROGRAM-DATE-TIME 2025-03-24T12:25:44Z`, did not advance over 25 s under cache-bust and `Cache-Control: no-cache`, and the very next segment `12065/seg48000-24128033.aac` returned 404 — a player would stall after ~50 s. The station's own player bundle (`romanticfm.ro/js/app.js`) sets `playbackURL: "http://ivm.antenaplay.ro/liveaudio/radioromantic/playlist.m3u8"`, whose master playlist carries exactly one variant — the same dead channel; `premium.romanticfm.ro/live` serves HTML. The broadcast itself is alive, but only over HTTP (`http://zuicast.digitalag.ro:9420/romanticfm`, 200, `audio/aacp`, icy-name «RomanticFM Live», 56 kbps; that host answers no HTTPS at all). The user was re-asked with this evidence and chose exclusion with a documented reason, so the catalogue ships 27 terrestrial stations, not 28. HLS verification from now on requires the media sequence to advance *and* the next segment to resolve.

### Decision: HLS ships where it is the only HTTPS, and the engine is left alone

Radio ZU's direct mounts are HTTP-only, so its AntenaPlay playlist (48 kbps AAC segments, no `#EXT-X-KEY`, confirmed live) is the only public HTTPS; the UK catalogue's 117 HLS entries are the accepted precedent and `tools/validate-streams.mjs` already understands HLS. The player stayed a plain `<audio>` (`new Audio()`), with no hls.js and no new dependency inside a catalogue stage.

### Decision: no Now Playing adapter is shipped for Romania

All 32 published entries carry `metadata.type: 'none'`, `url: null`, `historyAvailable: false`. RFI's icy-name is «RFI» and Radio Bacău's is «RADIO ROMÂNIA BACĂU» — stream names, not tracks. Absence never blocks publication and nothing is guessed.

### Verification (R3.5)

The catalogue validator (ID uniqueness, schema, region↔rows, city↔locality, band/sort, https-only streams, index counts) PASSED with 0 errors and the 3 known documented warnings (radiobacau without frequencies, trinitas `frequencyMHz: null`, mehedinti without cities). `tsc -b` clean; `node --test` 89/89; one production build, exit 0, with `romania-DVod9ScE.js` (78.76 kB / 11.77 kB gzip) and `romania-YA-VeB0P.js` (6.76 kB / 1.50 kB gzip) split off as lazy chunks — the pre-existing 500 kB warning is unchanged (main 1,004 kB, UK 1,060 kB).

Browser (desktop, production preview, Electron 44 / Chromium 152): the category picker reads Россия / Internet / Suomi / Eesti / România, and «România» opens exactly the 16 nationwide entries — RRA 105.3, Cultural 101.3, Muzical 104.8, Antena Satelor **603 kHz** (AM rendering), Trinitas **RO** (null-frequency chip), Kiss 96.1, Europa 106.7, Digi 97.9, Virgin 100.2, Rock 100.6, Magic 90.8, PRO 102.8, Guerrilla 94.8, Impuls 88.0, **RFI România 93.5**, **Radio ZU 89.0**. The region picker lists Koko maa plus the 22 județe with diacritics, and the footer reads `România · Alpha 0.1`. Playback was verified over real network requests, never by status alone: **RFI România plays** (`asculta.radiorfi.ro/live.aac` → 200, `media`, live); **Radio ZU plays** (`radiozu-48000.m3u8` → 206, then 17 sequential `.aac` segments 34191747→34191761, ≈70 s of progressive audio); **Radio Bacău plays** with the `;stream/1` fix (`stream1.srr.ro:8208/;stream/1` → 200, `media`, live) — the single failing entry of the earlier 32-stream browser check is now a passing one. Search matches station names and frequency-row geography («Bacău» returns Radio Bacău plus every nationwide station with a Bacău row, including Radio ZU 90.3; «craiova» returns RFI România 94.0). Internet › România lists all 5 internet-only stations and **Pescobar Radio plays** (`play.radioking.io/pescobar` → 302 → `listen.radioking.com/…` → 200, live). Desktop browser only — not tested on real iPhone Safari hardware.

Known limitations recorded, not hidden: HLS playback works in this Electron build (`canPlayType('application/vnd.apple.mpegurl')` → "maybe") but is unverified on plain desktop Chrome/Firefox and on real iPhone Safari; search is not diacritic-insensitive (`«bacau»` misses «Bacău», `«Bacău»` finds it) — pre-existing and byte-identical in the Finland and Estonia search paths, not introduced here; Radio Bacău is reachable only through search, since a station without frequency rows belongs to no region; Romantic FM stays excluded while its HTTPS encoder is dead and becomes publishable the moment a fresh mount appears. Not committed — working tree holds the change awaiting review.

## R3.6: Latvija (Latvija, 2026-10-18)

### Decision: Latvia is the R3.2/R3.4/R3.5 pattern — one `latvia` scope, endonym `Latvija` from the shared table, FM only

`Scope` gains `latvia`. Terrestrial Latvia lives in `data/latvia.json` (registry + `nationwide[]` + `regions[]` + `cities[]`, every frequency row tagged with locality and region); no internet-only catalogue is created (R3.6 is FM-only). Loads on demand through `import.meta.glob` and code-splits: 20.26 kB raw / 2.51 kB gzip. `Latvija` is the endonym read from `web/src/countries.ts`; no country-name key was added to any of the seven dictionaries. Latvian geography persists on its own keys, `efirio.latviaRegionId` and `efirio.latviaCityId` (values include `'all'`).

### Decision: only verified HTTPS streams ship; unverified FM stations are excluded, not guessed

16 terrestrial stations: 3 nationwide (Latvijas Radio 1/2/3), 6 regional, 7 local — across 5 regions (Rīga, Kurzeme, Vidzeme, Latgale, Zemgale) and 9 cities. 16 working HTTPS streams (4 HLS, 9 AAC, 3 MP3). All 16 carry `metadata.type: 'none'`. Stream sources: tiesraide.lv embedded player (`data-stations`) — official HTTPS endpoints. Frequencies from lv.wikipedia.org/wiki/Radiostacijas_Latvijā. LR5 and LR6 HLS mounts returned 404 from Finland; European Hit Radio, N-Joy/NJoy and XO FM lack a confirmed FM frequency or verified stream and are excluded (documented in `data/research/latvia.json`, 6 exclusions).

### Verification (R3.6)

`tsc -b` clean; `node --test` 89/89; one production build, exit 0, with `latvia-t__Kl33l.js` (20.26 kB / 2.51 kB gzip) split off as a lazy chunk. Not committed — working tree holds the change awaiting review.

## R3.7: Lietuva (Lietuva, 2026-10-18)

### Decision: Lithuania is the R3.6 pattern — one `lithuania` scope, endonym `Lietuva`, FM only

`Scope` gains `lithuania`. Terrestrial Lithuania lives in `data/lithuania.json` (registry + `nationwide[]` + `regions[]` + `cities[]`); no internet-only catalogue (FM only). Loads on demand: 29.28 kB raw / 3.21 kB gzip. `Lietuva` is the endonym from `web/src/countries.ts`. Lithuanian geography persists on `efirio.lithuaniaRegionId/CityId`.

### Decision: 23 FM stations with verified HTTPS streams

11 nationwide (LRT Radijas/Klasika/Opus, M-1, Lietus, Power Hit Radio, Relax FM, Radiocentras, Žinių radijas, GOLD FM, Marijos radijas), 9 regional, 3 local — across 6 regions (Vilniaus, Kauno, Klaipėdos, Šiaulių, Panevėžio, Alytaus) and 7 cities. 23 working HTTPS streams (3 HLS, 18 MP3, 2 AAC). All `metadata.type: 'none'`. Stream sources: radijas.eu embedded player + official sites. 7 exclusions (Beveik Radijas internet-only, M-1 Plius/M-1 Dance/Laluna/XXL FM no verified stream, Pūkas HTTP-only, small regional stations no stream) documented in `data/research/lithuania.json`.

### Verification (R3.7)

`tsc -b` clean; `node --test` 89/89; one production build, exit 0, with `lithuania-CcrJxJ55.js` (29.28 kB / 3.21 kB gzip) split off as a lazy chunk. Not committed — working tree holds the change awaiting review.

## R3.8: Shqipëria (Shqipëria, 2026-10-18)

### Decision: Albania is the R3.7 pattern — one `albania` scope, endonym `Shqipëria`, FM only

`Scope` gains `albania`. Terrestrial Albania lives in `data/albania.json` (registry + `nationwide[]` + `regions[]` + `cities[]`); no internet-only catalogue (FM only). Loads on demand: 7.12 kB raw / 1.29 kB gzip. `Shqipëria` is the endonym from `web/src/countries.ts`. Albanian geography persists on `efirio.albaniaRegionId/CityId`.

### Decision: 6 RTSH channels with verified HTTPS streams; frequencies mostly unconfirmed

6 FM stations: 5 nationwide (Radio Tirana 1/2/3, Fëmijë, Internacional) + 1 local (Radio Tirana Klasik, 101.2 MHz in Tiranë) — across 1 region (Tiranë) and 1 city (Tiranë). 6 working HTTPS streams (3 MP3, 3 AAC). All `metadata.type: 'none'`. Stream sources: rtsh.al embedded player (data-radio-url). Only Radio Tirana Klasik has a confirmed FM frequency (101.2 MHz, en.wikipedia). Other RTSH channels broadcast on FM (confirmed by regulator AMA) but exact frequency values were not machine-extractable from the AMA registry (dynamically loaded table) — frequencyMHz: null, frequencies: []. 7 exclusions documented in `data/research/albania.json` (Radio Tirana Jazz digital-only; Kukësi/Shkodra/Korça/Gjirokastra no HTTPS stream; Top Albania Radio / Club FM / Radio Klan / ~50 local stations no verified HTTPS stream).

### Verification (R3.8)

`tsc -b` clean; `node --test` 89/89; one production build, exit 0, with `albania-DeOTLTTN.js` (7.12 kB / 1.29 kB gzip) split off as a lazy chunk. Not committed — working tree holds the change awaiting review.

## R3.9: Kosova (Kosova, 2026-10-18)

### Decision: Kosovo is the R3.8 pattern — one `kosovo` scope, endonym `Kosova`, FM only

`Scope` gains `kosovo`. Terrestrial Kosovo lives in `data/kosovo.json` (registry + `nationwide[]` + `regions[]` + `cities[]`); no internet-only catalogue (FM only). Loads on demand: 10.70 kB raw / 1.69 kB gzip. `Kosova` is the endonym from `web/src/countries.ts`. Kosovo geography persists on `efirio.kosovoRegionId/CityId`.

### Decision: 9 FM stations with verified HTTPS streams

4 nationwide (RTK Radio Kosova 1/2, Klan Kosova FM, Radio KFOR), 2 regional (Radio Kosova e Lirë, Urban FM), 3 local (Glam Radio, Radio Plus, Radio Prishtina) — across 3 regions (Prishtina, Ferizaj, Prizren) and 3 cities (Prishtina, Ferizaj, Prizren). 9 working HTTPS streams (2 HLS, 7 MP3, 1 OGG). All `metadata.type: 'none'`. Stream sources: radiomap.eu (play pages). Frequencies from en.wikipedia.org (List of radio stations in Kosovo) and radiomap.eu. 6 exclusions documented in `data/research/kosovo.json` (Radio 21, Dukagjini, Capital FM, Vala Rinore, Paper Radio, Radio Llapi — no verified HTTPS stream; ~50 local stations no verified HTTPS stream).

### Verification (R3.9)

`tsc -b` clean; `node --test` 89/89; one production build, exit 0, with `kosovo-CIo0ntj2.js` (10.70 kB / 1.69 kB gzip) split off as a lazy chunk. Not committed — working tree holds the change awaiting review.
