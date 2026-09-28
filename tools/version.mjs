#!/usr/bin/env node
// Writes version.json ({ sha, date, branch, builder }) into the site root.
// Runs automatically as wrangler's custom build (see wrangler.jsonc), so every
// deploy — Cloudflare Workers Builds or local `npm run deploy` — is stamped.
// Workers Builds provides WORKERS_CI_* env vars; locally we ask git.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const git = (cmd) => { try { return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const ci = !!process.env.WORKERS_CI;
let sha = (process.env.WORKERS_CI_COMMIT_SHA || git('rev-parse HEAD') || 'unknown').slice(0, 7);
if (!ci && git('status --porcelain')) sha += '-dirty';
const info = {
  sha,
  date: new Date().toISOString(),
  branch: process.env.WORKERS_CI_BRANCH || git('rev-parse --abbrev-ref HEAD') || 'unknown',
  builder: ci ? 'workers-builds' : 'local',
};
writeFileSync(new URL('../version.json', import.meta.url), JSON.stringify(info, null, 2) + '\n');
console.log(`version.json: ${info.sha} ${info.date} (${info.builder})`);
