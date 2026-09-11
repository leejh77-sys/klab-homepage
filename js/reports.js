// 최신정보 - reports/{tech,trend,trip,company} 폴더에서 자동 생성된 data/reports.json을 읽어
// 뉴스 카드로 렌더링한다. 클릭하면 새 탭에서 PDF가 바로 열린다(별도 뷰어/요청 절차 없음).

const REPORT_CATEGORY_COLORS = {
  tech: "#2f6fed",
  trip: "#5b6472",
  company: "#3c8f6e",
};

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.querySelector(".news-grid");
  if (!grid) return;
  loadReports(grid);
});

async function loadReports(grid) {
  try {
    const res = await fetch("data/reports.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`data/reports.json 요청 실패 (${res.status})`);
    const data = await res.json();
    const cardsHtml = data.items.map(buildReportCardHtml).join("");
    grid.insertAdjacentHTML("afterbegin", cardsHtml);
    document.getElementById("sortSelect")?.dispatchEvent(new Event("change"));
    if (typeof applyNewsFilters === "function") applyNewsFilters();
  } catch (err) {
    console.error(err);
  }
}

function buildReportCardHtml(item) {
  const color = REPORT_CATEGORY_COLORS[item.category] || "#5b6472";
  const dateLabel = formatDate(item.date);
  return `
    <a class="news-card" href="${item.url}" target="_blank" rel="noopener"
       data-category="${item.category}" data-date="${item.date.slice(0, 10)}" data-views="0">
      <div class="news-thumb" style="background:${color};">${escapeHtml(item.categoryLabel)}</div>
      <div class="news-body">
        <span class="news-cat">${escapeHtml(item.categoryLabel)}</span>
        <h4>${escapeHtml(item.title)}</h4>
        <p>클릭하면 새 탭에서 PDF로 열립니다.</p>
        <div class="news-meta"><span>PDF</span><span>${dateLabel}</span></div>
      </div>
    </a>
  `;
}

function formatDate(isoString) {
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
