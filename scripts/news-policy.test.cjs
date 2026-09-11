const { test } = require('node:test');
const assert = require('node:assert/strict');
const { select, day } = require('../js/news-policy.js');
const updatedAt = '2026-09-11T07:00:00+09:00';
function item(date, extra = {}) {
  return { region: 'global', rank: 1, date, verified: true, issueKey: date,
    title: 'Issue', summary: 'Summary', source: 'Source', url: `https://example.com/${date}`, ...extra };
}
const run = (items, now = updatedAt) => select({updatedAt, items}, now);
test('seven KST calendar dates, no old or future publication dates', () => {
  assert.deepEqual(run(['2026-09-04','2026-09-05','2026-09-11','2026-09-12'].map(d => item(d))).map(i => i.date), ['2026-09-05','2026-09-11']);
});
test('invalid dates and unverified entries are rejected', () => {
  assert.ok(Number.isNaN(day('2026-02-30')));
  assert.equal(run([item('2026-09-10', {verified: false}),item('invalid')]).length, 0);
});
test('future edition is rejected and an expired edition does not appear as current', () => {
  assert.equal(run([item('2026-09-11')], '2026-09-10T14:59:59Z').length, 0);
  assert.equal(run([item('2026-09-11')], '2026-09-18T00:00:00+09:00').length, 0);
});
test('KST rollover works independently of viewer timezone', () => {
  assert.equal(run([item('2026-09-05')], '2026-09-17T14:59:59Z').length, 1);
  assert.equal(run([item('2026-09-05')], '2026-09-17T15:00:00Z').length, 0);
});
test('same issue or URL cannot occupy multiple slots, even across regions', () => {
  const a = item('2026-09-10');
  assert.equal(run([a, {...a, region:'domestic'}, {...a, issueKey:'other'}]).length, 1);
});
test('domestic top 10 is ranked without limiting global articles', () => {
  const items = Array.from({length:12}, (_, i) => item('2026-09-10', {region:'domestic', rank:12-i, issueKey:String(i), url:`https://example.com/${i}`}));
  const result = run([...items, item('2026-09-09')]);
  assert.deepEqual(result.filter(i => i.region === 'domestic').map(i => i.rank), [1,2,3,4,5,6,7,8,9,10]);
  assert.equal(result.filter(i => i.region === 'global').length, 1);
});
test('unsafe links cannot be published', () => {
  assert.equal(run([item('2026-09-10', {url:'javascript:alert(1)'})]).length, 0);
});
