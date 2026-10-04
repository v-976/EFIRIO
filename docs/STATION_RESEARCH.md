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
