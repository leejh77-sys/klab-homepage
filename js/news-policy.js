// Shared by browser and publishing validator; calendar dates use Asia/Seoul.
(function (root) {
  const DAY = 86400000;
  function day(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const parsed = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : NaN;
  }
  function kstDay(value) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? day(new Date(parsed + 9 * 3600000).toISOString().slice(0, 10)) : NaN;
  }
  // Rolling window: items accumulate across editions (Mon/Thu updates) and stay visible
  // for data.windowDays (default 28) from their own publish date, independent of updatedAt.
  // The publishing automation is responsible for actually deleting items past the window;
  // this filter is a display-time safety net, not the retention mechanism.
  function select(data, now = new Date()) {
    const windowDays = Number(data.windowDays) > 0 ? Number(data.windowDays) : 28;
    const today = kstDay(now);
    if (!Number.isFinite(today)) return [];
    const start = today - (windowDays - 1) * DAY;
    const seen = new Set();
    return (Array.isArray(data.items) ? data.items : [])
      .filter(item => item && ['global', 'domestic'].includes(item.region))
      .sort((a, b) => (a.rank || 999) - (b.rank || 999) || day(b.date) - day(a.date))
      .filter(item => {
        const published = day(item.date);
        let url;
        try { url = new URL(item.url); } catch { return false; }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
        if (!(published >= start && published <= today) || item.verified !== true || !item.issueKey ||
            !item.title || !item.summary || !item.source) return false;
        url.hash = '';
        if (seen.has(item.issueKey) || seen.has(url.href)) return false;
        seen.add(item.issueKey); seen.add(url.href);
        return true;
      });
  }
  const api = { select, day, kstDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KlabNewsPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
