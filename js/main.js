// KLAB 홈페이지 데모 - 공통 스크립트

document.addEventListener("DOMContentLoaded", () => {
  initFilterTabs();
  initSort();
  initRequestModal();
  initOpenCardToast();
  initWipModal();
  initContactModal();
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

// ---------- 바로보기(오픈) 카드 클릭 시 데모 안내 ----------
function initOpenCardToast() {
  document.querySelectorAll('.news-card[data-gated="false"]').forEach((card) => {
    card.addEventListener("click", (e) => {
      e.preventDefault();
      showToast("데모 화면입니다 — 실제 서비스에서는 상세 페이지로 연결됩니다.");
    });
  });
}

// ---------- 작업중(WIP) 안내 모달 ----------
// class="js-wip" data-wip="안내 문구에 쓸 이름" 을 가진 모든 요소에 공통 적용됩니다.

// 한글 단어의 마지막 글자 받침 유무에 따라 "은/는" 조사를 붙여줍니다.
function withTopicParticle(word) {
  const lastChar = word[word.length - 1];
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${word}는`; // 한글이 아니면 기본값
  const hasBatchim = (code - 0xac00) % 28 !== 0;
  return `${word}${hasBatchim ? "은" : "는"}`;
}

function initWipModal() {
  const modal = document.getElementById("wipModal");
  const titleEl = document.getElementById("wipModalTitle");
  const closeBtn = document.getElementById("wipModalClose");
  if (!modal) return;

  function openModal(label) {
    titleEl.textContent = withTopicParticle(label || "이 기능");
    modal.classList.add("is-open");
  }
  function closeModal() {
    modal.classList.remove("is-open");
  }

  document.querySelectorAll(".js-wip").forEach((el) => {
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.hasAttribute("role") && el.tagName !== "A" && el.tagName !== "BUTTON") {
      el.setAttribute("role", "button");
    }

    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal(el.dataset.wip);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openModal(el.dataset.wip);
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
