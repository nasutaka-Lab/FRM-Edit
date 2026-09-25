// 共通UI（DOMだけに依存する、トースト・確認・マニュアル・凡例・チュートリアル・リリースノート・ポップオーバー）。
// app.js から分けた（v1.56.1-beta）。window.CommonUI に公開する。app.js より先に読み込むこと。
// 凡例・マニュアル・チュートリアルの図が使う部品（laneDividerSpecs など）は、app.js が setContextProvider() で渡す。
(function () {
  "use strict";

  const { escapeHtml, CATEGORIES, STATUSES, IC_TYPES, LANE_WIDTH_PX, laneWeight } = window.RoadModel;

  let getCtx = () => ({ CATEGORIES, STATUSES, IC_TYPES, LANE_WIDTH_PX, laneWeight });
  function setContextProvider(fn) {
    getCtx = fn;
  }
  // ---------------------------------------------------------------------
  // 共通UI: トースト通知 / 確認モーダル（alert・confirmの代替）
  // ---------------------------------------------------------------------
  const toastContainerEl = document.getElementById("toast-container");

  function toast(message, type) {
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " error" : "");
    el.textContent = message;
    toastContainerEl.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  const confirmModalEl = document.getElementById("confirm-modal");
  const confirmModalMessageEl = document.getElementById("confirm-modal-message");
  const confirmModalOkBtn = document.getElementById("confirm-modal-ok");
  const confirmModalCancelBtn = document.getElementById("confirm-modal-cancel");
  let confirmResolve = null;

  function confirmModal(message) {
    confirmModalMessageEl.textContent = message;
    confirmModalEl.hidden = false;
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  function closeConfirmModal(result) {
    confirmModalEl.hidden = true;
    if (confirmResolve) {
      confirmResolve(result);
      confirmResolve = null;
    }
  }

  confirmModalOkBtn.addEventListener("click", () => closeConfirmModal(true));
  confirmModalCancelBtn.addEventListener("click", () => closeConfirmModal(false));
  confirmModalEl.addEventListener("click", (e) => {
    if (e.target === confirmModalEl) closeConfirmModal(false);
  });

  // ---------------------------------------------------------------------
  // 共通UI: マニュアル
  // ---------------------------------------------------------------------
  const manualModalEl = document.getElementById("manual-modal");
  const manualPanelHowto = document.getElementById("manual-panel-howto");
  const manualBodyEl = manualModalEl.querySelector(".modal-body");

  // マニュアルの図（<figure data-figure="...">）に、SVGを入れる（初めて開いたときに1度だけ）。
  // "tutorial:○○" は、チュートリアルの、題名に ○○ を含むスライドの図。それ以外は js/manual-figures.js の図
  let manualFiguresBuilt = false;
  function buildManualFigures() {
    if (manualFiguresBuilt) return;
    manualFiguresBuilt = true;
    const ctx = getCtx();
    const slides = window.buildTutorialSlides ? window.buildTutorialSlides(ctx) : [];
    manualPanelHowto.querySelectorAll("figure[data-figure]").forEach((fig) => {
      const key = fig.dataset.figure;
      let svg = "";
      if (key.startsWith("tutorial:")) {
        const slide = slides.find((s) => s.title.includes(key.slice("tutorial:".length)));
        svg = slide ? slide.figure : "";
      } else if (window.buildManualFigure) {
        svg = window.buildManualFigure(key, ctx);
      }
      if (svg) fig.insertAdjacentHTML("afterbegin", svg);
      else fig.hidden = true;
    });
  }

  function openManual() {
    buildManualFigures();
    manualModalEl.hidden = false;
    manualBodyEl.scrollTop = 0;
  }
  document.getElementById("btn-open-manual").addEventListener("click", openManual);

  // 目次（上部に固定）で、いま読んでいる節を強調する。scroller はスクロールする要素、
  // getPanel は目次（.manual-nav）を含む、いま表示中の領域を返す関数。
  function attachNavSpy(scroller, getPanel) {
    scroller.addEventListener("scroll", () => {
      const panel = getPanel();
      if (!panel) return;
      const links = Array.from(panel.querySelectorAll(".manual-nav a"));
      const top = scroller.getBoundingClientRect().top;
      let currentId = null;
      links.forEach((a) => {
        const target = document.getElementById(a.getAttribute("href").slice(1));
        if (target && target.getBoundingClientRect().top - top <= 90) currentId = a.getAttribute("href");
      });
      // 最後の節が短く、スクロールが下端で止まって基準の位置に届かないときは、最後の節を強調する
      if (links.length && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) currentId = links[links.length - 1].getAttribute("href");
      links.forEach((a) => a.classList.toggle("current", a.getAttribute("href") === currentId));
    });
  }
  attachNavSpy(manualBodyEl, () => manualPanelHowto);

  // ---------------------------------------------------------------------
  // 共通UI: 凡例（地図の左下のボタンで開閉する、地図の上に重ねる小さなパネル）
  // 地図・路線図の描画と同じ定数・規則から組み立てる（js/legend.js）。初めて開くときに生成する。
  // ---------------------------------------------------------------------
  const legendPanelEl = document.getElementById("legend-panel");
  const legendBodyEl = document.getElementById("legend-panel-body");
  const legendToggleBtn = document.getElementById("btn-toggle-legend");
  let legendBuilt = false;

  function setLegendOpen(open) {
    if (open && !legendBuilt) {
      legendBodyEl.innerHTML = window.buildLegendHtml(
        getCtx(),
        { zoom: 1.3 }
      );
      legendBuilt = true;
    }
    legendPanelEl.hidden = !open;
    legendToggleBtn.classList.toggle("active-toggle", open);
    legendToggleBtn.setAttribute("aria-expanded", String(open));
    legendToggleBtn.textContent = open ? "凡例を閉じる" : "凡例";
  }

  legendToggleBtn.addEventListener("click", () => setLegendOpen(legendPanelEl.hidden));
  document.getElementById("legend-close").addEventListener("click", () => setLegendOpen(false));
  attachNavSpy(legendBodyEl, () => legendBodyEl);
  // 目次のリンクは、ページ全体ではなくパネル内でスクロールさせる
  legendBodyEl.addEventListener("click", (e) => {
    const a = e.target.closest(".manual-nav a");
    if (!a) return;
    e.preventDefault();
    const target = document.getElementById(a.getAttribute("href").slice(1));
    if (target) {
      const nav = legendBodyEl.querySelector(".manual-nav");
      const offset = target.getBoundingClientRect().top - legendBodyEl.getBoundingClientRect().top;
      legendBodyEl.scrollTo({ top: legendBodyEl.scrollTop + offset - (nav ? nav.offsetHeight : 0) - 4 });
    }
  });

  document.getElementById("manual-modal-close").addEventListener("click", () => (manualModalEl.hidden = true));
  manualModalEl.addEventListener("click", (e) => {
    if (e.target === manualModalEl) manualModalEl.hidden = true;
  });

  // ---------------------------------------------------------------------
  // 共通UI: チュートリアル（画像と説明を1枚ずつめくる。js/tutorial.js のスライドを表示する）
  // ページを開いたときに自動で表示する（「次回から自動で表示しない」にチェックすると出なくなる）。
  // トップバーのボタンはない（v1.20.2で廃止）。ページを開いたときの自動表示だけ。
  // ---------------------------------------------------------------------
  const TUTORIAL_HIDE_KEY = "koukikaku_road_tool_tutorial_hidden";
  const tutorialModalEl = document.getElementById("tutorial-modal");
  const tutorialFigureEl = document.getElementById("tutorial-figure");
  const tutorialTitleEl = document.getElementById("tutorial-title");
  const tutorialTextEl = document.getElementById("tutorial-text");
  const tutorialProgressEl = document.getElementById("tutorial-progress");
  const tutorialDotsEl = document.getElementById("tutorial-dots");
  const tutorialPrevBtn = document.getElementById("tutorial-prev");
  const tutorialNextBtn = document.getElementById("tutorial-next");
  const tutorialHideNextInput = document.getElementById("tutorial-hide-next");
  let tutorialSlides = null;
  let tutorialIndex = 0;

  function readTutorialHidden() {
    try {
      return localStorage.getItem(TUTORIAL_HIDE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function writeTutorialHidden(hidden) {
    try {
      if (hidden) localStorage.setItem(TUTORIAL_HIDE_KEY, "1");
      else localStorage.removeItem(TUTORIAL_HIDE_KEY);
    } catch (e) {
      /* 保存できない環境では、毎回表示する */
    }
  }

  function renderTutorial() {
    const slide = tutorialSlides[tutorialIndex];
    const last = tutorialIndex === tutorialSlides.length - 1;
    tutorialFigureEl.innerHTML = slide.figure;
    tutorialTitleEl.textContent = slide.title;
    tutorialTextEl.innerHTML = slide.body;
    tutorialProgressEl.textContent = `${tutorialIndex + 1} / ${tutorialSlides.length}`;
    tutorialPrevBtn.disabled = tutorialIndex === 0;
    tutorialNextBtn.textContent = last ? "はじめる" : "次へ";
    tutorialDotsEl.innerHTML = tutorialSlides
      .map(
        (s, i) =>
          `<button type="button" class="tutorial-dot${i === tutorialIndex ? " active" : ""}" data-index="${i}" role="tab" aria-selected="${i === tutorialIndex}" aria-label="${i + 1}枚目: ${escapeHtml(s.title)}"></button>`
      )
      .join("");
  }

  function openTutorial(index) {
    if (!tutorialSlides) {
      tutorialSlides = window.buildTutorialSlides(getCtx());
    }
    tutorialIndex = index || 0;
    tutorialHideNextInput.checked = readTutorialHidden();
    renderTutorial();
    tutorialModalEl.hidden = false;
    tutorialNextBtn.focus();
  }

  function closeTutorial() {
    writeTutorialHidden(tutorialHideNextInput.checked);
    tutorialModalEl.hidden = true;
  }

  function tutorialGo(delta) {
    const next = tutorialIndex + delta;
    if (next < 0) return;
    if (next >= tutorialSlides.length) {
      closeTutorial(); // 最後の「はじめる」
      return;
    }
    tutorialIndex = next;
    renderTutorial();
  }

  tutorialPrevBtn.addEventListener("click", () => tutorialGo(-1));
  tutorialNextBtn.addEventListener("click", () => tutorialGo(1));
  document.getElementById("tutorial-skip").addEventListener("click", closeTutorial);
  tutorialDotsEl.addEventListener("click", (e) => {
    const dot = e.target.closest(".tutorial-dot");
    if (!dot) return;
    tutorialIndex = Number(dot.dataset.index);
    renderTutorial();
  });
  tutorialModalEl.addEventListener("click", (e) => {
    if (e.target === tutorialModalEl) closeTutorial();
  });
  tutorialHideNextInput.addEventListener("change", () => writeTutorialHidden(tutorialHideNextInput.checked));

  // ---------------------------------------------------------------------
  // 共通UI: リリースノート（js/release-notes.js のデータを表示）
  // ---------------------------------------------------------------------
  const releaseNotesModalEl = document.getElementById("release-notes-modal");
  const releaseNotesListEl = document.getElementById("release-notes-list");

  // バージョンの表記（例: "1.50.0-beta" → 「β版 v1.50.0-beta」、バッジは「β 1.50.0」）。
  // 〜1.49.9 は α版（-alpha）、1.50.0 から β版（-beta）。正式版（2.0.0）は、接尾辞なし
  const STAGES = { alpha: { mark: "α", label: "α版" }, beta: { mark: "β", label: "β版" } };
  function versionParts(v) {
    const m = /^(\d+\.\d+\.\d+)(?:-(\w+))?$/.exec(v || "");
    const stage = m && m[2] ? STAGES[m[2]] : null;
    return { base: m ? m[1] : v, stage };
  }
  (function renderBrandVersion() {
    const badge = document.getElementById("brand-version");
    if (!badge) return;
    const { base, stage } = versionParts(window.APP_VERSION);
    badge.textContent = (stage ? stage.mark + " " : "") + base;
    badge.title = `${stage ? stage.label + " " : ""}v${window.APP_VERSION}。クリックでリリースノートを開く`;
    // リリースノートを開く入口は、このバッジだけ（トップバーの「リリースノート」ボタンは廃止）
    badge.addEventListener("click", () => {
      renderReleaseNotes();
      releaseNotesModalEl.hidden = false;
    });
  })();

  function renderReleaseNotes() {
    const cur = versionParts(window.APP_VERSION);
    document.getElementById("release-notes-current").textContent = (cur.stage ? cur.stage.label + " " : "") + "v" + window.APP_VERSION;
    const entries = window.RELEASE_NOTES
      .map((rel, i) => {
        const sections = rel.sections
          .map(
            (sec) =>
              `<h4>${escapeHtml(sec.title)}</h4><ul>${sec.items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</ul>`
          )
          .join("");
        const latest = i === 0 ? '<span class="version-badge latest">最新</span>' : "";
        return `<section class="release-entry"><h3>v${escapeHtml(rel.version)} ${latest}<span class="release-date">${escapeHtml(rel.date)}</span></h3>${sections}</section>`;
      });
    // 最新版だけを表示し、それ以前の版は「過去のバージョンを確認する」のアコーディオン（初期は閉じた状態）にまとめる
    const past = window.RELEASE_NOTES.slice(1);
    const pastHtml = past.length
      ? `<details class="accordion release-past"><summary>過去のバージョンを確認する<span class="acc-summary">${past.length}件（v${escapeHtml(
          past[0].version
        )} 〜 v${escapeHtml(past[past.length - 1].version)}）</span></summary><div class="accordion-body">${entries.slice(1).join("")}</div></details>`
      : "";
    releaseNotesListEl.innerHTML = (entries[0] || "") + pastHtml;
  }

  document.getElementById("release-notes-close").addEventListener("click", () => (releaseNotesModalEl.hidden = true));
  releaseNotesModalEl.addEventListener("click", (e) => {
    if (e.target === releaseNotesModalEl) releaseNotesModalEl.hidden = true;
  });

  // ---------------------------------------------------------------------
  // 共通UI: ドロップダウン（ポップオーバー）
  // ---------------------------------------------------------------------
  function setupDropdown(buttonId, popoverId, onOpen) {
    const btn = document.getElementById(buttonId);
    const pop = document.getElementById(popoverId);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = pop.hidden;
      closeAllPopovers();
      if (willOpen) {
        pop.hidden = false;
        if (onOpen) onOpen();
        keepPopoverInView(pop);
      }
    });
    pop.addEventListener("click", (e) => e.stopPropagation());
  }

  // ポップオーバーが画面の左右にはみ出さないよう、位置をずらす（ボタンの位置や画面の幅によらず、全体が見えるように）。
  // 内容（保存済みマップの数など）が変わっても、開くたびに測り直す
  function keepPopoverInView(pop) {
    const MARGIN = 8;
    pop.style.left = "";
    pop.style.right = "";
    const base = pop.getBoundingClientRect();
    let shift = 0;
    if (base.right > window.innerWidth - MARGIN) shift = window.innerWidth - MARGIN - base.right;
    if (base.left + shift < MARGIN) shift = MARGIN - base.left;
    if (shift !== 0) {
      // 親（.dropdown）の左端を基準にした位置。CSSの right 指定（狭い画面）と両立しないよう、right は解除する
      const parentLeft = pop.offsetParent ? pop.offsetParent.getBoundingClientRect().left : 0;
      pop.style.left = base.left + shift - parentLeft + "px";
      pop.style.right = "auto";
    }
  }

  function closeAllPopovers() {
    document.querySelectorAll(".popover").forEach((p) => (p.hidden = true));
  }

  document.addEventListener("click", closeAllPopovers);
  window.CommonUI = {
    setContextProvider,
    toast,
    confirmModal,
    tutorialModalEl,
    readTutorialHidden,
    openTutorial,
    closeTutorial,
    tutorialGo,
    setupDropdown,
    closeAllPopovers,
  };
})();
