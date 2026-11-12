// Read-only connectivity check from this machine. Never purchases or cancels an order.
// Set server environment variables or LMS_URL/LMS_TOKEN in the ignored .dev.vars file.
import { existsSync, readFileSync } from 'node:fs';

const local = {};
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(LMS_URL|LMS_TOKEN)\s*=\s*(.*?)\s*$/);
    if (match) local[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const url = process.env.LMS_URL || local.LMS_URL;
const token = process.env.LMS_TOKEN || local.LMS_TOKEN;
if (!url || !token) {
  console.error('Not tested: configure LMS_URL and LMS_TOKEN in server environment variables or .dev.vars. No token value is printed.');
  process.exit(1);
}
try {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('HTTPS is required');
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ wstoken: token, wsfunction: 'local_lofplatform_erp_catalogue', moodlewsrestformat: 'json' }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data || data.exception || data.errorcode || data.error) throw new Error(`LMS refused catalogue (${data?.errorcode || 'invalid response'}); check token/service/IP restrictions with LOF`);
  const tracks = Array.isArray(data) ? data : data.tracks;
  if (!Array.isArray(tracks)) throw new Error('No Track list found; confirm the catalogue response format with LOF');
  console.log(`Catalogue connection succeeded: ${tracks.length} Track(s) returned. No purchase/cancellation was sent. This verifies the calling machine only; repeat from the deployed backend.`);
} catch (error) {
  // Never echo provider bodies, request URLs, tokens or raw fetch errors.
  const message = String(error.message || 'Connection failed').split(token).join('***');
  console.error(`Catalogue check failed: ${message}`);
  process.exitCode = 1;
}
