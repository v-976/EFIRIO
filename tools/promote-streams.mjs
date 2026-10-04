#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const cataloguePath = path.join(root, 'data', 'stations.json');
const candidatesPath = path.join(root, 'data', 'stream-candidates.json');
const validationPath = path.join(root, 'data', 'stream-validation.json');

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const catalogue = await readJson(cataloguePath);
const candidates = await readJson(candidatesPath);
const validation = await readJson(validationPath);

const validationByKey = new Map(
  validation.results.map((r) => [`${r.stationId}:${r.candidateIndex}`, r]),
);

// Endpoints known to be a different regional/federal programme are not promoted
// as Saint Petersburg production streams even when technically reachable.
const excluded = new Set([
  'nashe-radio-spb:0', // ICY identifies Moscow 101.8 FM
]);

const stations = catalogue.countries
  .flatMap((c) => c.regions ?? [])
  .flatMap((r) => r.cities ?? [])
  .flatMap((c) => c.stations ?? []);
const stationById = new Map(stations.map((s) => [s.id, s]));

let promotedStations = 0;
let promotedStreams = 0;
const skipped = [];

for (const candidate of candidates.candidates) {
  const station = stationById.get(candidate.stationId);
  if (!station) {
    skipped.push({ stationId: candidate.stationId, reason: 'station-not-in-catalogue' });
    continue;
  }

  const live = candidate.audio
    .map((audio, index) => ({ audio, index, check: validationByKey.get(`${candidate.stationId}:${index}`) }))
    .filter(({ index, check }) => check?.ok === true && !excluded.has(`${candidate.stationId}:${index}`));

  if (!live.length) {
    skipped.push({ stationId: candidate.stationId, reason: 'no-validated-production-stream' });
    continue;
  }

  // Prefer a station-specific/regional candidate when it is first in discovery data.
  // Otherwise prefer HTTPS, then HLS/MP3/AAC in discovery order.
  live.sort((a, b) => {
    const aHttps = a.audio.url.startsWith('https://') ? 1 : 0;
    const bHttps = b.audio.url.startsWith('https://') ? 1 : 0;
    if (aHttps !== bHttps) return bHttps - aHttps;
    return a.index - b.index;
  });

  station.streams = live.map(({ audio, check }, i) => ({
    url: audio.url,
    role: i === 0 ? 'primary' : 'fallback',
    format: audio.format,
    verifiedAt: check.checkedAt,
    availableFromFinland: true,
    notes: `Validated from Finland: HTTP ${check.status}; content-type ${check.contentType ?? 'unknown'}${check.finalUrl && check.finalUrl !== audio.url ? `; redirects to ${check.finalUrl}` : ''}.`,
  }));

  station.status = 'active';
  station.verification ??= {};
  station.verification.sources ??= [];
  station.verification.notes = [
    station.verification.notes,
    `Audio stream validated from Finland on ${validation.generatedAt}.`,
  ].filter(Boolean).join(' ');

  if (candidate.metadata) {
    station.metadata ??= {};
    if (!station.metadata.url || station.metadata.type === 'unknown') {
      station.metadata.url = candidate.metadata;
      station.metadata.type = candidate.metadata.includes('.json') || candidate.metadata.includes('/fmgid/') ? 'json' : station.metadata.type;
      station.metadata.notes = [station.metadata.notes, 'Metadata endpoint discovered; metadata semantics still require separate validation.'].filter(Boolean).join(' ');
    }
  }

  promotedStations += 1;
  promotedStreams += station.streams.length;
}

catalogue.updatedAt = new Date().toISOString();
await fs.writeFile(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`, 'utf8');

console.log(`EFIRIO promotion complete`);
console.log(`Stations activated: ${promotedStations}`);
console.log(`Streams promoted: ${promotedStreams}`);
if (skipped.length) {
  console.log(`Skipped: ${skipped.length}`);
  for (const item of skipped) console.log(`  - ${item.stationId}: ${item.reason}`);
}
console.log(`Updated: ${cataloguePath}`);
