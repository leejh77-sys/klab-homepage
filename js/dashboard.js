// KLAB 무신사 트렌드 대시보드 - data/*.json을 fetch해 렌더링

const DISPLAY_COUNT = 20;

document.addEventListener("DOMContentLoaded", () => {
  initPeriodTabs();
  loadDashboard();
});

function initPeriodTabs() {
  const tabs = document.querySelectorAll("#periodTabs button");
  const grids = {
    weekly: document.getElementById("weeklyGrid"),
    monthly: document.getElementById("monthlyGrid"),
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const period = tab.dataset.period;
      Object.entries(grids).forEach(([key, el]) => {
        el.hidden = key !== period;
      });
    });
  });
}

async function loadDashboard() {
  try {
    const [weekly, monthly, content] = await Promise.all([
      fetchJson("data/weekly.json"),
      fetchJson("data/monthly.json"),
      fetchJson("data/content.json"),
    ]);

    renderRankGrid(document.getElementById("weeklyGrid"), weekly.items);
    renderRankGrid(document.getElementById("monthlyGrid"), monthly.items);
    renderContentGrid(document.getElementById("contentGrid"), content.items);
    renderUpdatedAt(weekly.updatedAt);
  } catch (err) {
    document.getElementById("updatedAtLine").textContent =
      "데이터를 불러오지 못했습니다. 잠시 후 새로고침 해주세요.";
    console.error(err);
  }
}

function fetchJson(path) {
  return fetch(path, { cache: "no-store" }).then((res) => {
    if (!res.ok) throw new Error(`${path} 요청 실패 (${res.status})`);
    return res.json();
  });
}

function renderUpdatedAt(isoString) {
  const el = document.getElementById("updatedAtLine");
  if (!isoString) {
    el.textContent = "";
    return;
  }
  const d = new Date(isoString);
  const formatted = d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  el.textContent = `${formatted} 기준 · 매주 월요일 07:00 자동 갱신`;
}

function renderRankGrid(container, items) {
  if (!container) return;
  container.innerHTML = "";
  items.slice(0, DISPLAY_COUNT).forEach((item) => {
    container.appendChild(buildRankCard(item));
  });
}

function buildRankCard(item) {
  const card = document.createElement("div");
  card.className = "rank-card";

  const numberClass = item.rank <= 3 ? "rank-number top3" : "rank-number";
  const change = formatRankChange(item);

  card.innerHTML = `
    <a href="${item.url}" target="_blank" rel="noopener">
      <div class="rank-thumb">
        <span class="${numberClass}">${item.rank}</span>
        ${change ? `<span class="rank-change ${change.cls}">${change.label}</span>` : ""}
        <img src="${item.imageUrl}" alt="${escapeHtml(item.name)}" loading="lazy">
      </div>
      <div class="rank-body">
        <span class="rank-brand">${escapeHtml(item.brand)}</span>
        <p class="rank-name">${escapeHtml(item.name)}</p>
        <div class="rank-price-row">
          ${item.discountRatio ? `<span class="rank-discount">${item.discountRatio}%</span>` : ""}
          <span class="rank-price">${item.price != null ? item.price.toLocaleString("ko-KR") + "원" : "-"}</span>
        </div>
      </div>
    </a>
  `;
  return card;
}

function formatRankChange(item) {
  if (item.isNew) return { cls: "new", label: "NEW" };
  if (item.rankChange == null) return null;
  if (item.rankChange > 0) return { cls: "up", label: `▲${item.rankChange}` };
  if (item.rankChange < 0) return { cls: "down", label: `▼${Math.abs(item.rankChange)}` };
  return { cls: "flat", label: "-" };
}

function renderContentGrid(container, items) {
  if (!container) return;
  container.innerHTML = "";
  items.forEach((item) => {
    container.appendChild(buildContentCard(item));
  });
}

function buildContentCard(item) {
  const a = document.createElement("a");
  a.href = item.url;
  a.target = "_blank";
  a.rel = "noopener";
  a.className = "news-card dash-content";

  const dateLabel = formatDate(item.date);

  a.innerHTML = `
    <div class="news-thumb has-image">
      <img src="${item.thumbnailUrl}" alt="${escapeHtml(item.title)}" loading="lazy">
    </div>
    <div class="news-body">
      <span class="news-cat">${escapeHtml(item.category || "무신사 콘텐츠")}</span>
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.summary || "")}</p>
      <div class="news-meta"><span>👁 ${item.viewCount ?? 0}</span><span>${dateLabel}</span></div>
    </div>
  `;
  return a;
}

function formatDate(isoString) {
  if (!isoString) return "";
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
