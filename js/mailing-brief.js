// 메일링 브리프: 이정호 이사 개인 구독 뉴스레터함(Gmail) 요약, 매주 월요일 08시 자동 갱신.
// data/industry-news.json(docs/news-automation-policy.md 검증 절차)과는 별도로 운영되는 가벼운 소스.
const MAILING_CATEGORY_COLOR = {
  shoe: '#a8552e',
  fashion: '#7c4568',
  industry: '#2e4a8c',
  research: '#3e6b57',
  design: '#8a6a1f',
  gear: '#47636e',
};
let mailingBriefData = null;
let mailingBriefError = false;

document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.news-grid');
  if (!grid) return;
  initMailingSubTabs();
  loadMailingBrief(grid);
});

async function loadMailingBrief(grid) {
  try {
    const res = await fetch('data/mailing-brief.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`메일링 브리프 요청 실패 (${res.status})`);
    mailingBriefData = await res.json();
    grid.querySelectorAll('[data-mailing-brief]').forEach((card) => card.remove());
    grid.insertAdjacentHTML('beforeend', mailingBriefData.items.map(buildMailingCardHtml).join(''));
    document.getElementById('sortSelect')?.dispatchEvent(new Event('change'));
    applyMailingFilters();
  } catch (err) {
    mailingBriefError = true;
    console.error(err);
  }
  renderMailingStatus();
}

function buildMailingCardHtml(item) {
  const categoryMeta = (mailingBriefData.categories || []).find((c) => c.key === item.category);
  const color = MAILING_CATEGORY_COLOR[item.category] || '#5b6472';
  const catLabel = categoryMeta ? categoryMeta.label : item.category;
  return `<a class="news-card" href="${escapeMailingHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer"
    data-mailing-brief data-category="mailing" data-subcat="${escapeMailingHtml(item.category)}"
    data-date="${item.date}" data-views="0">
    <div class="news-thumb" style="background:${color};">${escapeMailingHtml(catLabel)}</div>
    <div class="news-body">
      <span class="news-cat">${escapeMailingHtml(catLabel)}</span>
      <h4>${escapeMailingHtml(item.title)}</h4>
      ${item.summary ? `<p>${escapeMailingHtml(item.summary)}</p>` : ''}
      <div class="news-meta"><span>${escapeMailingHtml(item.source)}</span><span>${formatMailingDate(item.date)}</span></div>
      <span class="btn-view">발신처 홈페이지 →</span>
    </div></a>`;
}

function initMailingSubTabs() {
  const subTabs = document.getElementById('mailingSubTabs');
  document.querySelectorAll('.filter-tabs button').forEach((tab) => tab.addEventListener('click', () => {
    if (subTabs) {
      subTabs.hidden = tab.dataset.filter !== 'mailing';
      subTabs.querySelectorAll('button').forEach((btn) => btn.classList.toggle('active', btn.dataset.subfilter === 'all'));
    }
    applyMailingFilters();
  }));
  subTabs?.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    subTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    applyMailingFilters();
  }));
}

function applyMailingFilters() {
  const target = document.querySelector('.filter-tabs button.active')?.dataset.filter || 'all';
  const sub = document.querySelector('#mailingSubTabs button.active')?.dataset.subfilter || 'all';
  document.querySelectorAll('.news-grid [data-category]').forEach((card) => {
    const match = (target === 'all' || card.dataset.category === target) &&
      (target !== 'mailing' || sub === 'all' || card.dataset.subcat === sub);
    card.style.display = match ? '' : 'none';
  });
  renderMailingStatus();
}

function renderMailingStatus() {
  const note = document.getElementById('industryNewsStatus');
  if (!note) return;
  const target = document.querySelector('.filter-tabs button.active')?.dataset.filter || 'all';
  if (target !== 'mailing') return;
  if (mailingBriefError) { note.textContent = '메일링 브리프를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'; return; }
  if (!mailingBriefData) { note.textContent = '메일링 브리프를 불러오는 중입니다.'; return; }
  const visible = [...document.querySelectorAll('[data-mailing-brief]')].filter((card) => card.style.display !== 'none').length;
  note.hidden = false;
  note.textContent = `구독 메일함 기준 ${visible}건 · 매주 월요일 자동 갱신 · 최근 28일 커버 · 공식 검증 뉴스(글로벌/국내 산업뉴스)와는 별도 운영`;
}

function formatMailingDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function escapeMailingHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
