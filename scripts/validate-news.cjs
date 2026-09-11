const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const policy = require('../js/news-policy.js');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
const data = read('data/industry-news.json');
const sources = read('data/news-sources.json');
assert.equal(data.period, 'WEEKLY');
assert.equal(data.windowDays, 7);
assert.equal(data.domesticTarget, 10);
assert.ok(Number.isFinite(Date.parse(data.updatedAt)), 'A valid update timestamp is required');
assert.ok(Date.parse(data.updatedAt) <= Date.now(), 'The update timestamp cannot be in the future');
// Validate against the edition date, independent of when CI is rerun.
const eligible = policy.select(data, new Date(data.updatedAt));
assert.equal(eligible.length, data.items.length, 'Old/future/unverified/duplicate/invalid articles or more than 10 domestic issues');
for (const region of ['global', 'domestic']) {
  const items = eligible.filter(item => item.region === region);
  assert.deepEqual(items.map(item => item.rank), items.map((_, i) => i + 1), 'Ranks must be consecutive within each region');
  if (region === 'domestic' && items.length < 10) assert.ok(data.shortfallReason, 'Explain a domestic shortfall; never fill it with old news');
}
for (const item of data.items) {
  const host = new URL(item.url).hostname.replace(/^www\./, '');
  assert.ok(sources.sources.some(source => source.domain === host &&
    (source.status === 'active' || source.allowedArticleUrls?.includes(item.url))), `Source is not approved: ${host}`);
  assert.ok(item.significance, 'Each issue needs an editorial significance note');
}
console.log(`Validated ${eligible.filter(i => i.region === 'global').length} global / ${eligible.filter(i => i.region === 'domestic').length} domestic issues.`);
