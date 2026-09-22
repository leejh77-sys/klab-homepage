// KLAB 홈페이지 - 공통 스크립트

document.addEventListener("DOMContentLoaded", () => {
  initFilterTabs();
  initSort();
  initRequestModal();
  initContactModal();
  initUpdateBadges();
});

// ---------- 토스트 ----------
function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

// ---------- 카테고리 필터 탭 ----------
function initFilterTabs() {
  const tabs = document.querySelectorAll(".filter-tabs button");
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // 매번 새로 조회한다 - fetch로 나중에 추가되는 카드(예: 리포트 뷰어)도 걸러져야 하기 때문.
      const target = tab.dataset.filter;
      document.querySelectorAll("[data-category]").forEach((card) => {
        const match = target === "all" || card.dataset.category === target;
        card.style.display = match ? "" : "none";
      });
    });
  });
}

// ---------- 정렬 (최신순 / 인기순) ----------
function initSort() {
  const sortSelect = document.getElementById("sortSelect");
  const grid = document.querySelector(".news-grid");
  if (!sortSelect || !grid) return;

  sortSelect.addEventListener("change", () => {
    const cards = Array.from(grid.children);
    const key = sortSelect.value;

    cards.sort((a, b) => {
      if (key === "importance") {
        return Number(a.dataset.rank || 999) - Number(b.dataset.rank || 999) ||
          new Date(b.dataset.date) - new Date(a.dataset.date);
      }
      if (key === "popular") {
        return Number(b.dataset.views) - Number(a.dataset.views);
      }
      return new Date(b.dataset.date) - new Date(a.dataset.date);
    });

    cards.forEach((card) => grid.appendChild(card));
  });
}

// ---------- 자료 요청 모달 ----------
function initRequestModal() {
  const modal = document.getElementById("requestModal");
  const modalTitle = document.getElementById("modalTargetTitle");
  const modalForm = document.getElementById("requestForm");
  const modalSuccess = document.getElementById("modalSuccess");
  const modalClose = document.getElementById("modalClose");
  if (!modal) return;

  function openModal(title) {
    modalTitle.textContent = title || "";
    modalForm.hidden = false;
    modalSuccess.hidden = true;
    modalForm.reset();
    modal.classList.add("is-open");
  }
  function closeModal() {
    modal.classList.remove("is-open");
  }

  document.querySelectorAll(".btn-request").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal(btn.dataset.title);
    });
  });

  modalClose?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  modalForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    modalForm.hidden = true;
    modalSuccess.hidden = false;
  });
}


// ---------- 콘텐츠 업데이트 표시 (nav 메뉴 위 빨간 점) ----------
// data/*.json 의 updatedAt 을 localStorage에 저장된 "마지막으로 확인한 시각"과 비교해
// 새 콘텐츠가 있으면 상단 메뉴(최신정보/트렌드)에 점을 표시한다.
// 해당 페이지를 직접 방문하면 그 시점 값으로 "확인함" 처리되어 점이 사라진다.
const UPDATE_SECTIONS = [
  { navHref: "news.html", storageKey: "klab_seen_news", sources: ["data/reports.json", "data/industry-news.json", "data/mailing-brief.json"] },
  { navHref: "dashboard.html", storageKey: "klab_seen_dashboard", sources: ["data/weekly.json", "data/monthly.json", "data/content.json"] },
];

function initUpdateBadges() {
  const nav = document.querySelector(".main-nav");
  if (!nav) return;
  const currentPage = location.pathname.split("/").pop() || "index.html";

  UPDATE_SECTIONS.forEach(async (section) => {
    const latest = await fetchLatestUpdatedAt(section.sources);
    if (!latest) return;

    if (currentPage === section.navHref) {
      localStorage.setItem(section.storageKey, latest);
      return;
    }

    const seen = localStorage.getItem(section.storageKey);
    if (seen && new Date(seen) >= new Date(latest)) return;

    const link = nav.querySelector(`a[href="${section.navHref}"]`);
    if (link && !link.querySelector(".nav-update-dot")) {
      const dot = document.createElement("span");
      dot.className = "nav-update-dot";
      dot.title = "새 콘텐츠가 업데이트되었습니다";
      link.appendChild(dot);
    }
  });
}

async function fetchLatestUpdatedAt(sources) {
  const dates = await Promise.all(sources.map(async (src) => {
    try {
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return data.updatedAt || null;
    } catch {
      return null;
    }
  }));
  const valid = dates
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (!valid.length) return null;
  return new Date(Math.max(...valid.map((d) => d.getTime()))).toISOString();
}

// ---------- 문의 안내 모달 ----------
// class="js-contact" 를 가진 모든 요소에 공통 적용됩니다.
function initContactModal() {
  const modal = document.getElementById("contactModal");
  const closeBtn = document.getElementById("contactModalClose");
  if (!modal) return;

  function openModal() {
    modal.classList.add("is-open");
  }
  function closeModal() {
    modal.classList.remove("is-open");
  }

  document.querySelectorAll(".js-contact").forEach((el) => {
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.hasAttribute("role") && el.tagName !== "A" && el.tagName !== "BUTTON") {
      el.setAttribute("role", "button");
    }

    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openModal();
      }
    });
  });

  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}
