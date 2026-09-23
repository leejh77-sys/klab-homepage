// 홈 "최신정보 미리보기": 하드코딩된 예시 대신 실제 데이터 소스(reports.json, industry-news.json,
// mailing-brief.json)를 읽어 날짜순 최신 3건을 카드로 보여준다. news.html의 개별 스크립트들과
// 달리 각 소스를 한 번씩만 fetch해서 합친 뒤 정렬한다.
const HOME_PREVIEW_META = {
  tech: { label: 'KLAB 레포트', color: '#2f6fed' },
  trip: { label: '해외출장', color: '#5b6472' },
  company: { label: '신규업체정보', color: '#3c8f6e' },
  global: { label: '글로벌 뉴스', color: '#0f1f3d' },
  domestic: { label: '국내 뉴스', color: '#c2453d' },
  mailing: { label: '메일링 브리프', color: '#7c4568' },
};

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('homeNewsPreview');
  if (!grid) return;
  loadHomePreview(grid);
});

async function loadHomePreview(grid) {
  const [reports, industryNews, mailingBrief] = await Promise.all([
    fetchJsonSafe('data/reports.json'),
    fetchJsonSafe('data/industry-news.json'),
    fetchJsonSafe('data/mailing-brief.json'),
  ]);

  const items = [];

  (reports?.items || []).forEach((item) => {
    items.push({
      date: item.date,
      url: item.url,
      external: true,
      metaKey: item.category,
      title: item.title,
      summary: '클릭하면 새 탭에서 PDF로 열립니다.',
      source: item.categoryLabel || HOME_PREVIEW_META[item.category]?.label || item.category,
    });
  });

  const eligibleNews = (typeof KlabNewsPolicy !== 'undefined' && industryNews)
    ? KlabNewsPolicy.select(industryNews)
    : [];
  eligibleNews.forEach((item) => {
    items.push({
      date: item.date,
      url: 'news.html',
      external: false,
      metaKey: item.region,
      title: item.title,
      summary: item.summary,
      source: item.source,
    });
  });

  (mailingBrief?.items || []).forEach((item) => {
    items.push({
      date: item.date,
      url: 'news.html',
      external: false,
      metaKey: 'mailing',
      title: item.title,
      summary: item.summary || '',
      source: item.source,
    });
  });

  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  const latest = items.slice(0, 3);

  if (!latest.length) {
    grid.innerHTML = '<p class="modal-sub">최신정보를 불러오지 못했습니다.</p>';
    return;
  }

  grid.removeAttribute('data-loading');
  grid.innerHTML = latest.map(buildHomePreviewCardHtml).join('');
}

function buildHomePreviewCardHtml(item) {
  const meta = HOME_PREVIEW_META[item.metaKey] || { label: item.metaKey, color: '#5b6472' };
  const attrs = item.external ? 'target="_blank" rel="noopener"' : '';
  return `
    <a href="${escapeHomeHtml(item.url)}" ${attrs} class="news-card">
      <div class="news-thumb" style="background:${meta.color};">${escapeHomeHtml(meta.label)}</div>
      <div class="news-body">
        <span class="news-cat">${escapeHomeHtml(meta.label)}</span>
        <h4>${escapeHomeHtml(item.title)}</h4>
        <p>${escapeHomeHtml(item.summary)}</p>
        <div class="news-meta"><span>${escapeHomeHtml(item.source)}</span><span>${formatHomeDate(item.date)}</span></div>
      </div>
    </a>`;
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function formatHomeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function escapeHomeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
