const { test } = require('node:test');
const assert = require('node:assert/strict');
const { select, day } = require('../js/news-policy.js');
const now = '2026-09-23T07:00:00+09:00';
function item(date, extra = {}) {
  return { region: 'global', rank: 1, date, verified: true, issueKey: date,
    title: 'Issue', summary: 'Summary', source: 'Source', url: `https://example.com/${date}`, ...extra };
}
const run = (items, opts = {}, nowValue = now) => select({ windowDays: 28, items, ...opts }, nowValue);
test('28-day rolling window: items older than windowDays or from the future are excluded', () => {
  assert.deepEqual(run([item('2026-08-20'), item('2026-08-27'), item('2026-09-23'), item('2026-09-24')]).map(i => i.date),
    ['2026-09-23', '2026-08-27']);
});
test('invalid dates and unverified entries are rejected', () => {
  assert.ok(Number.isNaN(day('2026-02-30')));
  assert.equal(run([item('2026-09-20', { verified: false }), item('invalid')]).length, 0);
});
test('KST rollover works independently of viewer timezone', () => {
  assert.equal(run([item('2026-08-27')], {}, '2026-09-23T14:59:59Z').length, 1);
  assert.equal(run([item('2026-08-27')], {}, '2026-09-23T15:00:00Z').length, 0);
});
test('same issue or URL cannot occupy multiple slots, even across regions', () => {
  const a = item('2026-09-20');
  assert.equal(run([a, { ...a, region: 'domestic' }, { ...a, issueKey: 'other' }]).length, 1);
});
test('domestic issues accumulate across editions and are not capped at 10', () => {
  const items = Array.from({ length: 12 }, (_, i) =>
    item('2026-09-20', { region: 'domestic', rank: i + 1, issueKey: String(i), url: `https://example.com/${i}` }));
  assert.equal(run(items).filter(i => i.region === 'domestic').length, 12);
});
test('windowDays is configurable and defaults to 28 when missing', () => {
  assert.equal(run([item('2026-08-30')], { windowDays: 7 }).length, 0);
  assert.equal(run([item('2026-08-30')], { windowDays: undefined }).length, 1);
});
test('unsafe links cannot be published', () => {
  assert.equal(run([item('2026-09-20', { url: 'javascript:alert(1)' })]).length, 0);
});
