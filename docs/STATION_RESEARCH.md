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
