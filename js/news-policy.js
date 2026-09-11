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
  function select(data, now = new Date()) {
    const end = kstDay(data.updatedAt);
    const today = kstDay(now);
    if (!Number.isFinite(end) || Date.parse(data.updatedAt) > new Date(now).getTime() || today - end >= 7 * DAY) return [];
    const start = end - 6 * DAY;
    const seen = new Set();
    let domesticCount = 0;
    return (Array.isArray(data.items) ? data.items : [])
      .filter(item => item && ['global', 'domestic'].includes(item.region))
      .sort((a, b) => (a.rank || 999) - (b.rank || 999))
      .filter(item => {
        const published = day(item.date);
        let url;
        try { url = new URL(item.url); } catch { return false; }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
        if (!(published >= start && published <= end) || item.verified !== true || !item.issueKey ||
            !item.title || !item.summary || !item.source) return false;
        url.hash = '';
        if (seen.has(item.issueKey) || seen.has(url.href)) return false;
        if (item.region === 'domestic' && domesticCount >= 10) return false;
        seen.add(item.issueKey); seen.add(url.href);
        if (item.region === 'domestic') domesticCount++;
        return true;
      });
  }
  const api = { select, day, kstDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KlabNewsPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
