// 글로벌 산업뉴스 - data/industry-news.json을 읽어 뉴스 카드로 렌더링한다.
// 매주 월요일 오전 7시(KST)에 예약된 리서치 루틴이 신발·의류 업계 해외 매체를 조사해
// data/industry-news.json을 자동 갱신한다. 카드를 클릭하면 새 탭에서 원문 기사가 열린다.

const INDUSTRY_CATEGORY_META = {
  "신모델": { label: "신모델 출시", color: "#2f6fed" },
  "신규브랜드": { label: "신규 브랜드", color: "#7a3ff2" },
  "글로벌비즈니스": { label: "글로벌 비즈니스", color: "#0f1f3d" },
  "신소재": { label: "신소재", color: "#3c8f6e" },
  "유행아이템": { label: "유행 아이템", color: "#c2453d" },
  "거시트렌드": { label: "거시 트렌드", color: "#5b6472" },
  "미시트렌드": { label: "미시 트렌드", color: "#b3541e" },
};

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.querySelector(".news-grid");
  if (!grid) return;
  loadIndustryNews(grid);
  initGlobalNewsSubTabs();
});

async function loadIndustryNews(grid) {
  try {
    const res = await fetch("data/industry-news.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`data/industry-news.json 요청 실패 (${res.status})`);
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) return;
    const cardsHtml = items.map(buildIndustryNewsCardHtml).join("");
    grid.insertAdjacentHTML("afterbegin", cardsHtml);
    renderIndustryNewsUpdatedAt(data.updatedAt);
  } catch (err) {
    console.error(err);
  }
}

function buildIndustryNewsCardHtml(item) {
  const meta = INDUSTRY_CATEGORY_META[item.category] || { label: item.category || "산업뉴스", color: "#5b6472" };
  const dateLabel = formatIndustryDate(item.date);
  return `
    <a class="news-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener"
       data-category="global" data-subcat="${escapeHtml(item.category || "")}" data-date="${escapeHtml((item.date || "").slice(0, 10))}" data-views="0">
      <div class="news-thumb" style="background:${meta.color};">${escapeHtml(meta.label)}</div>
      <div class="news-body">
        <span class="news-cat">${escapeHtml(meta.label)}</span>
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.summary || "")}</p>
        <div class="news-meta"><span>${escapeHtml(item.source || "")}</span><span>${dateLabel}</span></div>
        <span class="btn-view">원문 보기 →</span>
      </div>
    </a>
  `;
}

// ---------- 글로벌 산업뉴스 하위 카테고리 탭 ----------
// "글로벌 산업뉴스" 메인 탭이 활성화될 때만 보여지는 2차 필터. 메인 탭 클릭은
// main.js의 initFilterTabs가 처리하므로, 여기서는 그 결과(활성 탭)를 관찰해
// 서브탭 표시 여부만 맞춰준다.
function initGlobalNewsSubTabs() {
  const subTabs = document.getElementById("globalNewsSubTabs");
  const mainTabs = document.querySelectorAll(".filter-tabs button");
  if (!subTabs || !mainTabs.length) return;

  mainTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const isGlobal = tab.dataset.filter === "global";
      subTabs.hidden = !isGlobal;
      if (isGlobal) resetGlobalSubFilter(subTabs);
    });
  });

  subTabs.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      subTabs.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.subfilter;
      document.querySelectorAll('[data-category="global"]').forEach((card) => {
        card.style.display = target === "all" || card.dataset.subcat === target ? "" : "none";
      });
    });
  });
}

function resetGlobalSubFilter(subTabs) {
  subTabs.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  subTabs.querySelector('[data-subfilter="all"]')?.classList.add("active");
  document.querySelectorAll('[data-category="global"]').forEach((card) => {
    card.style.display = "";
  });
}

function renderIndustryNewsUpdatedAt(updatedAt) {
  const note = document.getElementById("industryNewsUpdatedAt");
  if (!note || !updatedAt) return;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return;
  note.textContent = `글로벌 산업뉴스 마지막 업데이트: ${d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })}`;
}

function formatIndustryDate(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\. /g, ".").replace(/\.$/, "");
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
