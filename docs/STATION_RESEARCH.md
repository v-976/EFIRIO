# Saint Petersburg Station Research Ledger

This document is the evidence ledger for the first EFIRIO catalogue.

A station is not promoted to `active` in `data/stations.json` until its current existence, FM frequency and at least one playable stream have been verified.

## Verification states

- `DISCOVERED` — candidate found, not verified.
- `FREQUENCY_VERIFIED` — current city frequency confirmed.
- `STREAM_VERIFIED` — stream tested and playable.
- `METADATA_VERIFIED` — Now Playing source tested.
- `READY` — sufficient evidence for Alpha catalogue.
- `BLOCKED` — station exists but a required Alpha path is currently unusable.

## Required evidence per station

| Field | Requirement |
|---|---|
| Station | Current existence confirmed |
| FM | Current Saint Petersburg frequency confirmed |
| Website | Official site recorded |
| Primary stream | Tested, format recorded |
| Finland | Playback tested from Finland |
| Metadata | Source/type recorded, or explicitly `none` |
| History | Availability recorded |
| Fallback | Tested where an official alternative exists |
| Date | Verification date recorded |

## Candidates

Do not treat this table as catalogue truth until evidence is added.

| Station | FM MHz | State | Official site | Primary stream | Metadata | History | Notes |
|---|---:|---|---|---|---|---|---|
| TBD | — | DISCOVERED | — | — | — | — | Populate through current-source research |

## Research rules

1. Search/aggregator results are discovery aids, not proof of a working stream.
2. Prefer official station/network pages and endpoints.
3. Open/test the actual stream endpoint.
4. Record redirects and final stream format where relevant.
5. Test geoblocking from Finland.
6. Do not invent a fallback URL.
7. Record exact verification date.
8. If metadata is scraped from HTML, document fragility and expected parser fields.

---

# R2 — География России (2026-10-14)

R2 widened the catalogue from Saint Petersburg to 35 cities across 33 Russian regions. The rules above were applied unchanged; this section records the R2 evidence and the decisions it forced.

## Sources

| Purpose | Source | Role |
|---|---|---|
| FM frequency lists, 34 city pages | `https://topradio.me/<city-slug>` | Aggregator. Same source already used for Saint Petersburg. Discovery + frequency only, never proof of a stream. |
| Per-station stream URLs | `https://topradio.me/<city-slug>/<station-slug>` | Discovery. Every URL re-tested independently before use. |
| Cross-check of stream ownership | `https://de1.api.radio-browser.info/json/stations/…` | Cross-check only. Used to confirm which network owns a URL, and to discover feeds for stations whose city page exposed none. |
| Official stream directories | VGTRK (`icecast-vgtrk.cdnvideo.ru`), GPM/hostingradio, emgsound, DFM, Hit FM, Studio 21, Orpheus, Radio Vanya | Direct verification of shared feeds. |

All R2 stream and metadata checks were run on **2026-10-14**. A stream was kept only if it returned HTTP 2xx plus an HLS manifest or an audio content type.

## Coverage

- 970 station rows fetched across 34 city pages.
- 810 rows carried a verified, browser-playable stream and reached the catalogue.
- 160 rows were dropped because no stream could be verified. No `research` entries were created for them: an unverifiable stream is omitted, never invented.
- 277 of the 810 were filled from a pre-verified central feed because the city page exposed none.
- 347 stations have a working `air` Now Playing log.
- Only FM-band rows were kept; УКВ rows were skipped.

## Evidence discipline applied

- **Frequency source is always recorded and is separate from stream source.** Frequencies come from the aggregator city list; streams come from direct probes. A station is never described as locally broadcast on the strength of an aggregator alone.
- **Shared feeds are labelled, not disguised.** A station whose stream is the same URL serving many cities carries `"feed": "federal"` and a quiet *federal feed* tag in the UI, so it is never read back as that city's own FM broadcast. Absence of the field means local. Saint Petersburg entries predate the field and are all local.
- **`feed` is inferred from evidence, not from a name list**: a URL is shared when it serves three or more cities. Moscow's own central/MSK channels are the documented exception — in Moscow they are that city's actual air, so they stay local.
- **No invented affiliations.** Station id is `<topradio-slug>-<cityId>`; display names come from a canonical map keyed by slug, with the source name as fallback.
- **HTTPS only.** Every `http://` feed candidate was re-probed over `https://` and upgraded where the server supported it. Three VGTRK feeds required the `icecast-vgtrk.cdnvideo.ru` host rather than `icecast.vgtrk.cdnvideo.ru`.

## Known gaps (deliberately empty, not filled with guesses)

- **Радио Дача** (present in 31 city lists) and **Love Radio** (28 city lists) are omitted. Radio Browser pairs the Дача stream with the official site, but the official player page does not reference that endpoint, so the association could not be confirmed from the owner's own infrastructure. Love Radio serves per-region streams behind a region-id mapping EFIRIO cannot resolve, and its reachable feed reports a placeholder `icy-name`. Neither met the bar for a working entry.
- **ПИ FM, Радио Ваня, Мега FM, Такси FM, Москва FM, Восток FM, Первое Спортивное** and other city-local stations without a verified stream are likewise absent.
- Small cities (Махачкала 12, Архангельск 13, Якутск 13) have thinner coverage than the capitals because fewer of their local stations publish a reachable stream.

## Time zones

Each city carries an IANA zone, validated with `Intl.DateTimeFormat`. `Asia/Khabarovsk`, `Asia/Kemerovo` and `Asia/Saratov` are rejected by Node ICU, so those cities use `Asia/Vladivostok`, `Asia/Novosibirsk` and `Europe/Saratov` respectively. `Asia/Tomsk`, `Asia/Barnaul` and `Europe/Volgograd` are accepted as-is.

## United Kingdom internet catalogue (R3.1)

The UK catalogue is a separate static file, `data/internet/united-kingdom.json`, loaded on demand. It does not touch the Russian data or the `countries[].regions[].cities[]` shape, so no Russian city or stream depends on it. The index lives at `data/internet-index.json`, outside the folder that `import.meta.glob` scans, so the glob only ever sees per-country chunks and the index stays a small static import.

### Numbers (verified 2026-10-14)

- 2526 unique GB-labelled candidates discovered via the Radio Browser API.
- 1744 after merging duplicate channel entries (116 collapsed by brand-plus-bitrate normalisation).
- 1254 confirmed as UK-affiliated: 855 by Wikipedia, 336 by first-party page content, 63 by page plus location agreement.
- 1076 published with a working stream (1075 from the R3.1 run plus Dance Attack FM, recovered from the official site the same day — see the post-run addition below); 179 confirmed but dropped for lack of any verified HTTPS stream.
- 1120 distinct stream URLs; 779 mp3, 208 aac, 89 hls.
- Region known for 424 (England 352, Scotland 45, Wales 17, Northern Ireland 10); city known for 162; genre for 632; language for 629; website for 1049.
- 111 HLS manifests scanned: no DRM, no encryption.

### Evidence tiers

Radio Browser supplied the candidate list only, never the affiliation. Each candidate had to earn one of three tiers:

1. **Wikipedia** — the name matched an article from the UK licence-area list or a UK radio category.
2. **Page content** — the station's own site carried a UK nation, Ofcom mention, UK postcode or UK phone number.
3. **Page plus location** — the site named a place that agrees with the Radio Browser location record.

No station is inferred from server location, TLD or hostname, and no FM frequency is ever attached to an internet-only station (`frequencyMHz` is `null` by construction). Crown Dependencies, Gibraltar and the Republic of Ireland are excluded; the Isle of Man, Jersey and Guernsey veto four otherwise-matching entries.

### Method decisions worth recording

- **JavaScript-shell homepages needed a second pass.** Hundreds of UK independents render their front page from a client-side shell carrying no location text at all. A follow-up pass read each station's own `/contact` and `/about` pages, which is where a UK address actually lives, and recovered 420 confirmations.
- **The Wikipedia parser captured 32 group headings** ("Sussex", "Midlands", "Greater London") as if they were station rows. Left in the index they would confirm any station merely mentioning the county, so they are stripped before matching.
- **A single generic word is the one weak case.** A category-crawl title that is one generic word no longer confirms a station on its own; it must be the exact brand or be backed by another signal. A licence-table row is the station's own licence entry and is never treated as loose. This cost nothing: 48 single-word matches remain, 42 from the licence table, and the 6 category-only ones are all exact brand matches.
- **Only HTTPS streams ship.** An `http://` URL is blocked as mixed content from an HTTPS origin, so http-only groups are excluded; a dedicated retry pass recovered 58 that did serve the same path over HTTPS.
- **Genre tags are filtered before they become filters.** Radio Browser tags include the station's own frequency, its bitrate and internal markers such as `##browserfriendly`; all are dropped. Decade spellings (`80s`, `80's`, `80\u2019s`) fold into one value. Only genres shared by at least four stations are offered in the dropdown — 103 of 571 distinct tags — while every station keeps its full tag set for display.

### Known gaps

- **Now Playing: 0 of 1076.** 3057 candidate endpoints were probed with the real Pages origin. Nothing returned an open CORS header: 135 answered `Access-Control-Allow-Origin: null`, 185 returned HTML rather than JSON, and the rest 404, 401, 403 or 502. Metadata is configured only where the browser can actually read it, so rather than fabricate titles, these stations ship without a Now Playing adapter. This is a CORS limit at the station, not a parsing limit in EFIRIO.
- **199 confirmed stations have no HTTPS stream** and are therefore absent from the catalogue.
- **City is known for only 162 of 1076.** Most entries are national or brand-level with no reliable city, and none was guessed.
- Genre coverage is uneven: 468 distinct tags appear on fewer than four stations and so are searchable by name but not selectable as filters.

### Post-run addition: Dance Attack FM (2026-10-14)

The station was absent from the R3.1 run for two independent reasons. Its only Radio Browser stream, `http://streaming04.liveboxstream.uk:8045/1`, was pure HTTP with no HTTPS variant — the probe found it alive at 200 `audio/mpeg`, but http-only groups are excluded as mixed content and the dedicated HTTPS retry did not recover it. Affiliation-wise the automated evidence stopped at a homepage-place match that could not agree with any location record (Radio Browser's `state` field is empty), so no tier was earned and the classifier recorded `placeOnlyRejected` alongside `noStream`.

A targeted verification against the official site resolved both, by declaration rather than by pattern match: `https://www.danceattack.fm/` states the station is "a U.K. focussed non-profit station" paying PPL & PRS, and its own player configuration carries an active HTTPS stream, `https://s6.autopo.st/proxy/gqfwzcil?mp=/1` — MP3 192 kbps, `Access-Control-Allow-Origin: *`, 540 kB delivered over 12 s of sustained playback from the probe origin. Genres are the site's own self-description (Dance, Trance, House, Progressive, Psytrance); no city is stated, so `city` stays `null`; the stream exposes no `icy-metaint` and the site's `ownmetadataurl` is empty, so Now Playing remains unconfigured rather than guessed. Checked in the EFIRIO player on a dev server: the row click reaches `Live` with a clean console. The catalogue now publishes 1076 stations.

## Finland (R3.2) — numbers (verified 2026-10-15)

- 367 candidate records after cross-source deduplication; 21 further duplicates merged into parents; 236 excluded with a recorded reason each; **115 published** — 91 terrestrial (`data/finland.json`) plus 24 internet-only (`data/internet/finland.json`).
- Terrestrial split: 7 nationwide (POPfm, Radio Nova, Yle Radio 1, Yle Radio Suomi, Yle Radio Vega, Yle X3M, YleX), 78 regional, 6 local. Geography: 19 regions, 133 cities, including Åland (Ahvenanmaa) as part of Finland.
- Streams: 91/91 terrestrial and 24/24 internet entries validated by actual audio delivery from Finland (content-type plus head bytes: MPEG frame sync, AAC or HLS manifest), never by HTTP status alone. HTTPS only.
- Now Playing: 11 of 115 — the Radio Dei windows, one JSON endpoint per mount, mount-scoped with `Access-Control-Allow-Origin: *`. No other Finnish entry exposed a browser-readable endpoint; absence never blocks publication.
- Exclusions (236): 139 no active FM and no stream; 59 closed or historical; 30 active with FM presence but no confirmed stream; 5 geography unconfirmed; 3 foreign broadcasters. Per-station reasons, sources and websites are in `data/research/finland.json`.

## Finland — evidence tiers

Radio Browser was discovery only, as for the UK. Affiliation and geography were earned from:

1. **radioasemat.fi** — the Finnish FM station list built on the Traficom register, refreshed 15.10.2026. The primary source for every FM frequency and its locality; each locality was mapped to its region through a municipality table (317 keys, Åland included). POPfm's own 65-row footprint was cross-checked against the raw page.
2. **Yle itself** — official `yle.fi` icecast mounts (validated per channel) and the wiki Yle Radio Suomi transmitter table (77 rows, office and site per locality) for regional variants.
3. **Official station sites** — stream URLs were taken from the stations' own players where Radio Browser carried only a stale HTTP link; a station was never excluded for a stale aggregator URL if its own site still played.

No station's geography was inferred from server location, TLD or site language, and internet accessibility was never treated as membership in the internet-only category.

## Finland — method decisions worth recording

- **Regional variants are windows of one station, not copies.** Yle Radio Suomi, Yle Radio Vega and Radio Dei publish per-city streams under one brand. Each verified variant is a registry record whose `frequencies[]` rows carry the transmitter locality and region; the window appears when the user's region or city matches, and a multi-city coverage zone never fabricates extra copies. Nationwide stations are never duplicated into region or city lists.
- **Coverage outranks catalogue tier.** A station broadcasting on many confirmed localities (Sandels on 16, Sea FM on 13, Radio Kaleva on 9) is classified `regional` by footprint even when a wiki list called it local; only the seven confirmed single-programme national networks are `nationwide`.
- **Åland stays Finnish.** Ahvenanmaa is a normal region: Mix Megapol, Rockklassiker and Steel FM carry their Åland FM rows, Ålands Radio publishes as a local station with a stream but no confirmed FM row, and all original-language names (Sámi included) are preserved as written.
- **Wiki transmitter cells use comma decimals.** The first parser pass matched only two digits before the comma, so `100,3` read as 0.3 and thirteen 100–107 MHz rows lost their frequency while still creating their city bucket — which is how the Sund row of the Turku window surfaced the bug. The parser now takes two or three digits; all thirteen rows are restored with correct values.
- **POPfm came back by one bounded player capture.** Its official site is a Blazor app whose `<audio>` src arrives over the SignalR circuit, invisible to a static hunt; one scripted click on the site's own play button yielded `https://stream.rcs.revma.com/hr92cvyzz2nwv` — a stable base that redirects to a token'd edge — validated as `audio/mpeg` with MPEG frame sync and now published as the primary stream of a nationwide station.
- **Yle Mondo stays in diagnostics.** A bounded browser attempt found no live channel in 2026: Areena's search returns nothing for "mondo", `yle.fi/radio` has no Mondo entry and the historical icecast mount 404s. Recorded as stream-not-confirmed rather than invented.
- **Jouluradio is seasonal,** its nelonenmedia host dead on 2026-10-15 off-season — excluded with a seasonal reason. **Soft FM** remains permanently excluded: wiki mention only, no site, no stream.

## Finland — known gaps

- Now Playing works for 11 of 115 entries; the rest expose nothing browser-readable and ship without an adapter rather than with a guessed one.
- 30 entries with confirmed FM presence have no confirmed stream as of 2026-10-15 and wait in `data/research/finland.json`.
- Åland's own FM frequencies could not be confirmed from an authoritative Finnish source; Ålands Radio therefore ships with an `FI` country chip and no MHz.
- Desktop browser verification only — not tested on real iPhone Safari hardware; no iOS background-playback claims.
