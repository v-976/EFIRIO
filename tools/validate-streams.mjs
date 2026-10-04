#!/usr/bin/env node
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const INPUT = new URL('../data/stream-candidates.json', import.meta.url);
const OUTPUT = new URL('../data/stream-validation.json', import.meta.url);
const TIMEOUT_MS = 8000;
const CONCURRENCY = 6;

const ledger = JSON.parse(await fs.readFile(INPUT, 'utf8'));
const jobs = ledger.candidates.flatMap(station =>
  station.audio.map((stream, index) => ({ stationId: station.stationId, index, ...stream }))
);

async function probe(job) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const headers = { 'User-Agent': 'EFIRIO-StreamValidator/0.1', 'Icy-MetaData': '1', Range: 'bytes=0-4095' };
    const response = await fetch(job.url, { method: 'GET', headers, redirect: 'follow', signal: controller.signal });
    const type = response.headers.get('content-type');
    const icyName = response.headers.get('icy-name');
    const icyMetaInt = response.headers.get('icy-metaint');
    let sample = '';
    if (job.format === 'hls' || type?.includes('mpegurl')) sample = (await response.text()).slice(0, 1024);
    else {
      const reader = response.body?.getReader();
      if (reader) { await reader.read(); await reader.cancel(); }
    }
    return {
      stationId: job.stationId, candidateIndex: job.index, url: job.url, expectedFormat: job.format,
      ok: response.ok, status: response.status, finalUrl: response.url, contentType: type,
      icyName, icyMetaInt, hlsManifest: sample.startsWith('#EXTM3U'), latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(), error: null
    };
  } catch (error) {
    return {
      stationId: job.stationId, candidateIndex: job.index, url: job.url, expectedFormat: job.format,
      ok: false, status: null, finalUrl: null, contentType: null, icyName: null, icyMetaInt: null,
      hlsManifest: false, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(),
      error: error?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS} ms` : String(error)
    };
  } finally { clearTimeout(timer); }
}

const results = [];
for (let i = 0; i < jobs.length; i += CONCURRENCY) {
  const batch = jobs.slice(i, i + CONCURRENCY);
  results.push(...await Promise.all(batch.map(probe)));
  if (i + CONCURRENCY < jobs.length) await sleep(150);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  timeoutMs: TIMEOUT_MS,
  totals: { candidates: jobs.length, reachable: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length },
  results
};
await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n');
console.log(`EFIRIO: ${report.totals.reachable}/${report.totals.candidates} stream candidates reachable`);
console.log(`Report: ${OUTPUT.pathname}`);
process.exitCode = report.totals.failed ? 2 : 0;
