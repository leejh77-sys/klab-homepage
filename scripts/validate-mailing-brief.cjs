const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { day, kstDay } = require('../js/news-policy.js');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, ''));
const data = read('data/mailing-brief.json');

assert.equal(data.period, 'ROLLING');
assert.equal(data.windowDays, 28);
assert.ok(Number.isFinite(Date.parse(data.updatedAt)), 'A valid update timestamp is required');
assert.ok(Date.parse(data.updatedAt) <= Date.now(), 'The update timestamp cannot be in the future');

const validCategories = new Set((data.categories || []).map(c => c.key));
assert.ok(validCategories.size > 0, 'categories list cannot be empty');

const today = kstDay(data.updatedAt);
const start = today - (data.windowDays - 1) * 86400000;
const seenUrls = new Set();

for (const item of data.items) {
  assert.ok(item.title, 'Each item needs a title');
  assert.ok(item.source, 'Each item needs a source name');
  assert.ok(validCategories.has(item.category), `Unknown category: ${item.category}`);
  const published = day(item.date);
  assert.ok(Number.isFinite(published), `Invalid date: ${item.date}`);
  assert.ok(published >= start && published <= today,
    `Item outside the ${data.windowDays}-day retention window (stale or future) — prune before publishing: ${item.title}`);
  let url;
  try { url = new URL(item.sourceUrl); } catch { throw new Error(`Invalid sourceUrl: ${item.sourceUrl}`); }
  assert.ok(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, `Unsafe sourceUrl: ${item.sourceUrl}`);
  // sourceUrl is the sender's homepage, not a per-article link, so the same title can
  // legitimately recur across different weeks; dedupe on title+date instead.
  const dupKey = `${item.title}|${item.date}`;
  assert.ok(!seenUrls.has(dupKey), `Duplicate item (same title, same date): ${dupKey}`);
  seenUrls.add(dupKey);
}
console.log(`Validated ${data.items.length} mailing-brief items within ${data.windowDays}-day window.`);
