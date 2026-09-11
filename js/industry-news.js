// Editorial cadence and sources: docs/weekly-news-policy.md.
const INDUSTRY_CATEGORY_META = {
  '신모델': { label: '신모델 출시', color: '#2f6fed' },
  '신규브랜드': { label: '신규 브랜드', color: '#7a3ff2' },
  '글로벌비즈니스': { label: '글로벌 비즈니스', color: '#0f1f3d' },
  '국내비즈니스': { label: '국내 비즈니스', color: '#0f1f3d' },
  '신소재': { label: '신소재', color: '#3c8f6e' },
  '생산기술': { label: '생산 기술', color: '#3c8f6e' },
  '유행아이템': { label: '유행 아이템', color: '#c2453d' },
  '거시트렌드': { label: '시장 동향', color: '#5b6472' },
  '미시트렌드': { label: '소비 트렌드', color: '#b3541e' },
};
let industryNewsData = null;
let industryNewsError = false;

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.news-grid');
  if (!grid) return;
  initGlobalNewsSubTabs();
  loadIndustryNews(grid);
});

async function loadIndustryNews(grid) {
  try {
    const res = await fetch('data/industry-news.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`뉴스 요청 실패 (${res.status})`);
    industryNewsData = await res.json();
    const items = KlabNewsPolicy.select(industryNewsData);
    grid.querySelectorAll('[data-industry-news]').forEach(card => card.remove());
    grid.insertAdjacentHTML('afterbegin', items.map(buildIndustryNewsCardHtml).join(''));
    document.getElementById('sortSelect')?.dispatchEvent(new Event('change'));
    applyNewsFilters();
    const date = formatIndustryDate(industryNewsData.updatedAt);
    document.getElementById('industryNewsUpdatedAt').textContent = date ? `마지막 기사 선정: ${date}` : '';
  } catch (err) {
    industryNewsError = true;
    console.error(err);
  }
  renderIndustryNewsStatus();
}

function buildIndustryNewsCardHtml(item) {
  const meta = INDUSTRY_CATEGORY_META[item.category] || { label: item.category, color: '#5b6472' };
  const region = item.region === 'domestic' ? '국내' : '글로벌';
  return `<a class="news-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"
    data-industry-news data-category="${item.region}" data-subcat="${escapeHtml(item.category)}"
    data-date="${item.date}" data-rank="${Number(item.rank) || 999}" data-views="0">
    <div class="news-thumb" style="background:${meta.color};">${region} · ${escapeHtml(meta.label)}</div>
    <div class="news-body">
      <span class="news-cat">${region} 주요 이슈 ${Number(item.rank) || ''} · ${escapeHtml(meta.label)}</span>
      <h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.summary)}</p>
      ${item.significance ? `<p><b>KLAB 관점</b> · ${escapeHtml(item.significance)}</p>` : ''}
      <div class="news-meta"><span>${escapeHtml(item.source)}</span><span>${formatIndustryDate(item.date)}</span></div>
      <span class="btn-view">원문 보기 →</span>
    </div></a>`;
}

function initGlobalNewsSubTabs() {
  const subTabs = document.getElementById('globalNewsSubTabs');
  document.querySelectorAll('.filter-tabs button').forEach(tab => tab.addEventListener('click', () => {
    if (subTabs) {
      subTabs.hidden = tab.dataset.filter !== 'global';
      subTabs.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.subfilter === 'all'));
    }
    applyNewsFilters();
  }));
  subTabs?.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    subTabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    applyNewsFilters();
  }));
}

function applyNewsFilters() {
  const target = document.querySelector('.filter-tabs button.active')?.dataset.filter || 'all';
  const sub = document.querySelector('#globalNewsSubTabs button.active')?.dataset.subfilter || 'all';
  document.querySelectorAll('.news-grid [data-category]').forEach(card => {
    const match = (target === 'all' || card.dataset.category === target) &&
      (target !== 'global' || sub === 'all' || card.dataset.subcat === sub);
    card.style.display = match ? '' : 'none';
  });
  renderIndustryNewsStatus();
}

function renderIndustryNewsStatus() {
  const note = document.getElementById('industryNewsStatus');
  if (!note) return;
  const target = document.querySelector('.filter-tabs button.active')?.dataset.filter || 'all';
  note.hidden = !['all', 'global', 'domestic'].includes(target);
  if (industryNewsError) { note.textContent = '뉴스를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'; return; }
  if (!industryNewsData) { note.textContent = '이번 주 뉴스를 불러오는 중입니다.'; return; }
  const items = KlabNewsPolicy.select(industryNewsData);
  const domestic = items.filter(item => item.region === 'domestic').length;
  const global = items.length - domestic;
  const visible = [...document.querySelectorAll('[data-industry-news]')].filter(card => card.style.display !== 'none').length;
  if (!visible) { note.textContent = '선택한 분류에 최근 7일 이내 발행이 확인된 기사가 없습니다. 다음 주간 정리를 기다려 주세요.'; return; }
  note.textContent = target === 'domestic'
    ? `이번 주 국내 주요 이슈 ${domestic}개 / 목표 10개${domestic < 10 ? ' · 최근 기사만 표시합니다.' : ''}`
    : target === 'global' ? `이번 주 글로벌 주요 이슈 ${visible}개` : `이번 주 글로벌 ${global}개 · 국내 ${domestic}개`;
}

function formatIndustryDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
