const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const policy = require('../js/news-policy.js');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, ''));
const data = read('data/industry-news.json');
const sources = read('data/news-sources.json');

assert.equal(data.period, 'ROLLING');
assert.equal(data.windowDays, 28);
assert.ok(Number.isFinite(Date.parse(data.updatedAt)), 'A valid update timestamp is required');
assert.ok(Date.parse(data.updatedAt) <= Date.now(), 'The update timestamp cannot be in the future');

// Data accumulates across editions now, so stored duplicates (not just displayed ones) must be rejected.
const seenKeys = new Set();
const seenUrls = new Set();
for (const item of data.items) {
  assert.ok(!seenKeys.has(item.issueKey), `Duplicate issueKey in storage: ${item.issueKey}`);
  seenKeys.add(item.issueKey);
  const url = new URL(item.url);
  url.hash = '';
  assert.ok(!seenUrls.has(url.href), `Duplicate URL in storage: ${url.href}`);
  seenUrls.add(url.href);
}

// Every stored item must currently pass the display filter: the automation is expected to
// prune items older than windowDays at write time, not rely on the frontend to hide them.
const eligible = policy.select(data, new Date(data.updatedAt));
assert.equal(eligible.length, data.items.length,
  'Stale (>28d)/future/unverified/invalid article found in storage — prune before publishing');

for (const region of ['global', 'domestic']) {
  const items = eligible.filter(item => item.region === region);
  if (region === 'domestic' && items.length < data.domesticTarget) {
    assert.ok(data.shortfallReason, 'Explain a domestic shortfall; never fill it with old news');
  }
}
for (const item of data.items) {
  const host = new URL(item.url).hostname.replace(/^www\./, '');
  assert.ok(sources.sources.some(source => source.domain === host &&
    (source.status === 'active' || source.allowedArticleUrls?.includes(item.url))), `Source is not approved: ${host}`);
  assert.ok(item.significance, 'Each issue needs an editorial significance note');
  assert.ok(Number.isInteger(item.rank) && item.rank > 0, 'rank must be a positive integer (importance order within its own edition)');
}
console.log(`Validated ${data.items.length} stored issues (${eligible.filter(i => i.region === 'global').length} global / ${eligible.filter(i => i.region === 'domestic').length} domestic within ${data.windowDays}-day window).`);
