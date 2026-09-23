(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // 定数定義: 道路法・道路構造令の区分に基づく種別/状態/IC種別プリセット
  // ---------------------------------------------------------------------
  const CATEGORIES = {
    expressway: { label: "高速自動車国道", color: "#2e7d32", lanes: 4 },
    urban_expressway: { label: "都市高速道路", color: "#1565c0", lanes: 4 },
    regional_highstandard: { label: "地域高規格道路", color: "#8bc34a", lanes: 2 },
    national: { label: "一般国道", color: "#e53935", lanes: 2 },
    prefectural: { label: "都道府県道", color: "#fb8c00", lanes: 2 },
    municipal: { label: "市町村道", color: "#9e9e9e", lanes: 1 },
  };

  // 車線数に応じた線の太さ（1車線あたりのpx幅）
  //
  // 道路構造令 第5条は「車線数は、往復の方向別に、それぞれ同数とする」を原則とし
  // （地形等やむを得ない場合を除く）、車線数は基本的に偶数となる。
  // 例外として、小規模な道路（第4種第5級 等）では対面通行の1車線も認められる。
  // そのため選択肢は、原則の偶数（2/4/6/8）＋例外の1車線に限定する。
  const LANE_WIDTH_PX = 4;
  const LANE_OPTIONS = [1, 2, 4, 6, 8];

  function nearestValidLanes(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return LANE_OPTIONS[0];
    return LANE_OPTIONS.reduce((best, cur) => (Math.abs(cur - n) < Math.abs(best - n) ? cur : best));
  }

  function laneWeight(lanes) {
    return nearestValidLanes(lanes) * LANE_WIDTH_PX;
  }

  // 区間別車線数: route.laneSegments = [{ id, fromIdx, toIdx, lanes }, ...]
  // 区間別の状態:  route.statusSegments = [{ id, fromIdx, toIdx, status }, ...]（v1.40.0）
  // 区間別の色:    route.colorSegments = [{ id, fromIdx, toIdx, color }, ...]（v1.52.0-beta。ユーザー指定）
  // 区間別の供用形態: route.provisionalSegments = [{ id, fromIdx, toIdx, provisional }, ...]（v1.53.0-beta。ユーザー指定）
  // 「始点」「終点」の2点を選んで指定した区間（点 fromIdx から点 toIdx までの間）だけ、基本の値
  // （route.lanes / route.status / route.color / route.provisional）を上書きする。複数区間が重なる場合は、
  // 後から追加したものを優先する（配列の後ろほど優先）。値は、点 k から点 k+1 までの区間（ステップ）ごとに決める。
  function segmentValueOfStep(segments, k, key, fallback) {
    const list = segments || [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (k >= list[i].fromIdx && k + 1 <= list[i].toIdx) return list[i][key];
    }
    return fallback;
  }
  const laneOfStep = (route, k) => segmentValueOfStep(route.laneSegments, k, "lanes", route.lanes);
  const statusOfStep = (route, k) => segmentValueOfStep(route.statusSegments, k, "status", route.status || "inservice");
  const colorOfStep = (route, k) => segmentValueOfStep(route.colorSegments, k, "color", route.color);
  // 区間別の供用形態は、明示的に設定されていれば、それを使う。設定されていなければ、これまでどおり
  // 「路線全体が暫定で、かつ、この区間の車線数が基本の車線数と同じ」ときだけ暫定として扱う（v1.45.0からの規則を維持）。
  function provisionalOfStep(route, k) {
    const explicit = segmentValueOfStep(route.provisionalSegments, k, "provisional", undefined);
    if (explicit !== undefined) return explicit;
    return !!route.provisional && nearestValidLanes(laneOfStep(route, k)) === nearestValidLanes(route.lanes);
  }
  // 区間別の設定のリスト（点の追加・削除・向き反転で、インデックスをそろえて直すときに使う）
  const segmentLists = (route) => [route.laneSegments, route.statusSegments, route.colorSegments, route.provisionalSegments].filter(Array.isArray);

  // route.points（PI）を「車線数・状態・色・供用形態がすべて同じ区間が続く区間」に分割する。
  // 戻り値: [{ startIdx, endIdx, lanes, status, color, provisional }, ...]（endIdxは次区間のstartIdxと共有）
  function buildLaneRanges(route) {
    const pts = route.points;
    if (pts.length < 2) return [];
    const ranges = [];
    let rangeStart = 0;
    let rangeLanes = laneOfStep(route, 0);
    let rangeStatus = statusOfStep(route, 0);
    let rangeColor = colorOfStep(route, 0);
    let rangeProv = provisionalOfStep(route, 0);
    for (let k = 1; k < pts.length - 1; k++) {
      const lanesHere = laneOfStep(route, k);
      const statusHere = statusOfStep(route, k);
      const colorHere = colorOfStep(route, k);
      const provHere = provisionalOfStep(route, k);
      if (lanesHere !== rangeLanes || statusHere !== rangeStatus || colorHere !== rangeColor || provHere !== rangeProv) {
        ranges.push({ startIdx: rangeStart, endIdx: k, lanes: rangeLanes, status: rangeStatus, color: rangeColor, provisional: rangeProv });
        rangeStart = k;
        rangeLanes = lanesHere;
        rangeStatus = statusHere;
        rangeColor = colorHere;
        rangeProv = provHere;
      }
    }
    ranges.push({ startIdx: rangeStart, endIdx: pts.length - 1, lanes: rangeLanes, status: rangeStatus, color: rangeColor, provisional: rangeProv });
    return ranges;
  }

  // dashArrayは太さ（車線数）に応じて可変にする。固定のダッシュ長のままだと、
  // 車線数が多く太い道路では丸い線端（lineCap）が隣のダッシュと重なり、
  // 点線・破線が潰れて実線のように見えてしまう不具合があったため。
  const STATUSES = {
    inservice: { label: "供用中", dashArray: () => null },
    construction: { label: "事業中・建設中", dashArray: (w) => `${Math.round(w * 1.4)},${Math.round(w * 0.9)}` },
    planned: { label: "計画・構想中", dashArray: (w) => `${Math.max(2, Math.round(w * 0.35))},${Math.round(w * 1.3)}` },
  };

  // short: 分岐の選択肢（facLabel()）など、狭い場所で使う短い種別名
  const IC_TYPES = {
    ic: { label: "IC（インターチェンジ）", short: "IC", shape: "circle", size: 16 },
    jct: { label: "JCT（ジャンクション）", short: "JCT", shape: "diamond", size: 16 },
    sapa: { label: "SA・PA", short: "SA・PA", shape: "pentagon", size: 16 },
    toll: { label: "本線料金所", short: "料金所", shape: "square", size: 14 },
    entrance: { label: "一般道 出入口・交差点", short: "出入口", shape: "circle", size: 10 },
    // その他: 既存の種別に当てはまらない、自由な施設（v1.51.0-beta）。地図上の図形は、OTHER_SHAPES から
    // 選べる（ic.shape に保存。未設定・不明な値は既定の "triangle" を使う）。名称は、ほかの種別と同じ自由記述。
    other: { label: "その他", short: "その他", shape: "triangle", size: 16 },
  };

  // 「その他」施設で選べる図形（5種類。既存のIC/JCT/SA・PA/本線料金所の丸・ひし形・五角形・四角形と被らない形にする）
  const OTHER_SHAPES = [
    { key: "triangle", label: "三角" },
    { key: "hexagon", label: "六角形" },
    { key: "star", label: "星" },
    { key: "cross", label: "十字" },
    { key: "octagon", label: "八角形" },
  ];
  function otherShapeOf(ic) {
    return OTHER_SHAPES.some((s) => s.key === ic.shape) ? ic.shape : OTHER_SHAPES[0].key;
  }
  // 施設のマークの図形（IC_TYPESの既定に加え、「その他」は ic.shape で個別に選ぶ）
  function icShapeOf(ic) {
    return ic.type === "other" ? otherShapeOf(ic) : (IC_TYPES[ic.type] || IC_TYPES.ic).shape;
  }

  const STORAGE_KEY = "koukikaku_road_tool_maps";

  // 2点間の直線距離（メートル、Haversine）
  function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------------------------------------------------------------------
  // アプリケーション状態
  // ---------------------------------------------------------------------
  let currentMap = { name: "", routes: [] };

  // 未保存の変更の判定（ページを閉じる・再読み込みするときの警告用）。最後に保存・書き出し・読み込み・新規作成した時点の
  // 内容（JSON）と比べる。元に戻すで保存時の内容に戻したときは、変更なしとして扱う。
  let savedSnapshot = null;
  // 地図名称（currentMap.name）は、保存するときに付けるものなので、比べるのは路線の内容だけにする
  function markSaved() {
    savedSnapshot = JSON.stringify(currentMap.routes);
    updateUnsavedIndicator();
  }
  // 未保存の変更があるとき、地図名称の横に「未保存」を出し、タブのタイトルの先頭に「* 」を付ける
  const BASE_TITLE = document.title;
  function updateUnsavedIndicator() {
    const dirty = hasUnsavedChanges();
    const badge = document.getElementById("unsaved-badge");
    if (badge) badge.hidden = !dirty;
    document.title = (dirty ? "* " : "") + BASE_TITLE;
  }
  function hasUnsavedChanges() {
    return savedSnapshot !== null && JSON.stringify(currentMap.routes) !== savedSnapshot;
  }
  window.addEventListener("beforeunload", (e) => {
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    e.returnValue = ""; // ブラウザ標準の確認画面を出す（文言はブラウザが決める）
  });
  let activeRouteId = null;
  // 選択中の点。selectedPointIndex は「主となる点」（最後に選んだ点。曲線ハンドルや
  // 入力欄の表示対象）、selectedSet は複数選択（Ctrl+クリック）を含む全選択点。
  let selectedPointIndex = null;
  let selectedSet = new Set();
  let currentMode = "edit"; // "edit" | "diagram"

  function uid() {
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getActiveRoute() {
    return currentMap.routes.find((r) => r.id === activeRouteId) || null;
  }

  // サイドバーで、いま開いているタブ（"route" / "facility"。編集モードは "route" 固定）。
  let sidebarTab = "route";

  function clearSelection() {
    selectedPointIndex = null;
    selectedSet = new Set();
  }

  function selectOnly(idx) {
    selectedPointIndex = idx;
    selectedSet = new Set([idx]);
  }

  function toggleSelect(idx) {
    const next = new Set(selectedSet);
    if (next.has(idx)) {
      next.delete(idx);
      selectedPointIndex = next.size ? Array.from(next).pop() : null;
    } else {
      next.add(idx);
      selectedPointIndex = idx;
    }
    selectedSet = next;
  }

  // 点のロック。ロック中の点は移動・削除ができない。次の2種類がある。
  //  - 各点のロック（point.locked。地図上の「選択中の点」ツールバーで切り替える）
  //  - 終点のロック（route.endLocked）。「終点を決定」（終点のスイッチをオン）にしたときにロックされる。
  //    路線パネルのスイッチで解除・再ロックできる。
  //    始点は、v1.53.2-betaで自動ロックを廃止し、他の点と同様に扱う（個別にロックしたいときは、
  //    地図上の「選択中の点」ツールバーでロックする）。
  // 終点は点が2つ以上のときだけ存在する（1点だけのときは始点のみ）。
  function isEndsLockedIdx(route, idx) {
    const n = route.points.length;
    return idx === n - 1 && n >= 2 && !!route.endLocked;
  }

  function isLockedSelfIdx(route, idx) {
    const pt = route.points[idx];
    return !!(pt && pt.locked) || isEndsLockedIdx(route, idx);
  }

  // 分岐でつないだ点（同じ位置に重ねてある点）のどれかがロック中なら、まとめて動かせない。
  function isLockedIdx(route, idx) {
    return isLockedSelfIdx(route, idx) || jointCluster(route, idx).some((p) => isLockedSelfIdx(p.route, p.idx));
  }

  // ---------------------------------------------------------------------
  // JCTでの分岐（v1.26.0で、路線グループ（終点と始点の連結）は廃止した）
  //  - 分岐: route.branchFrom = { routeId, icId, at, mode }。この路線の始点（at: "start"）または終点（"end"）を、
  //    別の路線（routeId）のJCT（施設 icId。ic.id）から分岐させる。mode は "branch"（分岐。既定）／"straight"
  //    （順接。v1.55.0-beta。分岐元の路線と同じ直線の続きとして路線図に表示する。始点・終点の施設からだけ設定できる）。
  //  分岐でつないだ点どうしは同じ位置に重ねて置く（つなぐ操作で、分岐する路線の端の点を、JCTの位置に合わせる）。
  //  片方をドラッグすると、もう片方も一緒に動く（jointCluster）。関係の判定は、保存された参照＋「同じ位置にあること」。
  // ---------------------------------------------------------------------
  const JOINT_TOL_M = 0.5;

  function routeById(id) {
    return currentMap.routes.find((r) => r.id === id) || null;
  }

  function icById(route, icId) {
    return route && icId ? route.ics.find((ic) => ic.id === icId) || null : null;
  }

  function ensureIcId(ic) {
    if (!ic.id) ic.id = uid();
    return ic.id;
  }

  function samePos(a, b) {
    return !!a && !!b && distanceMeters(a, b) < JOINT_TOL_M;
  }

  // この点と、同じ位置でつながっている点（分岐元のJCT、そこから分岐する路線の端点）
  function jointPartners(route, idx) {
    const res = [];
    const pt = route.points[idx];
    if (!pt) return res;
    const n = route.points.length;
    const bf = route.branchFrom;
    if (bf && idx === (bf.at === "end" ? n - 1 : 0)) {
      const trunk = routeById(bf.routeId);
      const ic = icById(trunk, bf.icId);
      if (ic && samePos(trunk.points[ic.pointIndex], pt)) res.push({ route: trunk, idx: ic.pointIndex });
    }
    currentMap.routes.forEach((r) => {
      const b = r.branchFrom;
      if (!b || b.routeId !== route.id || r === route) return;
      const ic = icById(route, b.icId);
      if (!ic || ic.pointIndex !== idx || !r.points.length) return;
      const bi = b.at === "end" ? r.points.length - 1 : 0;
      if (samePos(r.points[bi], pt)) res.push({ route: r, idx: bi });
    });
    return res;
  }

  // つながっている点すべて（自分を除く。つながりの先の点も含む）
  function jointCluster(route, idx) {
    const seen = new Set([route.id + ":" + idx]);
    const out = [];
    const queue = [{ route, idx }];
    while (queue.length) {
      const cur = queue.shift();
      jointPartners(cur.route, cur.idx).forEach((p) => {
        const key = p.route.id + ":" + p.idx;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(p);
        queue.push(p);
      });
    }
    return out;
  }

  // ドラッグ中に、つながっている点を、動かす点と同じ位置へ動かす（線の表示も更新する）
  function moveFollowers(followers, lat, lng) {
    const touched = new Set();
    followers.forEach((f) => {
      const p = f.route.points[f.idx];
      if (!p) return;
      p.lat = lat;
      p.lng = lng;
      touched.add(f.route);
    });
    touched.forEach((r) => updateRouteGeometry(r));
  }

  // 存在しない路線・JCTを指す分岐を取り除く（路線やJCTの削除のあと）
  function pruneLinks() {
    currentMap.routes.forEach((r) => {
      const bf = r.branchFrom;
      if (!bf) return;
      const trunk = routeById(bf.routeId);
      if (!trunk || trunk === r || !icById(trunk, bf.icId)) delete r.branchFrom;
    });
  }

  // 操作対象の点のインデックス（昇順）。未選択のときは末尾点。
  function targetIndices(route) {
    if (selectedSet.size > 0) return Array.from(selectedSet).sort((a, b) => a - b);
    return route && route.points.length ? [route.points.length - 1] : [];
  }

  // ---------------------------------------------------------------------
  // 元に戻す / やり直し（編集内容 currentMap のスナップショット履歴）
  // render() のたびに変更を検出して自動記録する。入力欄の連続入力などは
  // recordHistory(true) で短時間の変更を1つの履歴にまとめる。
  // ---------------------------------------------------------------------
  const HISTORY_LIMIT = 100;
  let history = [];
  let historyIndex = -1;
  let lastHistoryTime = 0;
  let lastHistoryCoalesced = false;

  function resetHistory() {
    history = [JSON.stringify(currentMap)];
    historyIndex = 0;
    lastHistoryTime = 0;
    lastHistoryCoalesced = false;
    updateHistoryButtons();
  }

  function recordHistory(coalesce) {
    const snap = JSON.stringify(currentMap);
    if (snap === history[historyIndex]) return;
    const now = Date.now();
    history = history.slice(0, historyIndex + 1);
    if (coalesce && lastHistoryCoalesced && now - lastHistoryTime < 800 && historyIndex > 0) {
      history[historyIndex] = snap;
    } else {
      history.push(snap);
      if (history.length > HISTORY_LIMIT) history.shift();
      historyIndex = history.length - 1;
    }
    lastHistoryTime = now;
    lastHistoryCoalesced = !!coalesce;
    updateHistoryButtons();
  }

  function restoreHistory(newIndex) {
    historyIndex = newIndex;
    currentMap = JSON.parse(history[historyIndex]);
    if (!currentMap.routes.some((r) => r.id === activeRouteId)) {
      activeRouteId = currentMap.routes.length ? currentMap.routes[0].id : null;
    }
    clearSelection();
    lastHistoryCoalesced = false;
    render();
    updateHistoryButtons();
  }

  function undo() {
    if (historyIndex <= 0) return false;
    restoreHistory(historyIndex - 1);
    toast("元に戻しました");
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    restoreHistory(historyIndex + 1);
    toast("やり直しました");
    return true;
  }

  function updateHistoryButtons() {
    const undoBtn = document.getElementById("btn-undo");
    const redoBtn = document.getElementById("btn-redo");
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
    updateUnsavedIndicator(); // 変更・元に戻す・やり直し・読み込みのたびに、未保存の表示を更新する
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
    const ctx = { CATEGORIES, STATUSES, IC_TYPES, LANE_WIDTH_PX, laneWeight, laneDividerSpecs };
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
        { CATEGORIES, STATUSES, IC_TYPES, LANE_WIDTH_PX, laneWeight, laneDividerSpecs },
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
      tutorialSlides = window.buildTutorialSlides({ CATEGORIES, STATUSES, IC_TYPES, LANE_WIDTH_PX, laneWeight, laneDividerSpecs });
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

  // ---------------------------------------------------------------------
  // 地図初期化
  // ---------------------------------------------------------------------
  const map = L.map("map", { zoomControl: true }).setView([35.681236, 139.767125], 12);

  const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    // 出典は、OpenStreetMap の著作権のページへのリンクにする（OSM の帰属表示のガイドライン）
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
  });

  // 国土地理院の地理院タイル。出典は「地理院タイル」に、タイル一覧ページへのリンクを付けて表示する（国土地理院コンテンツ利用規約）。
  // 縮尺・地図の種類によっては、追加の出所の表示が必要なので、地図の縮尺・位置に合わせて、表示を切り替える（下の updateGsiAttribution()）。
  // タイル自体の attribution は空にして、表示は updateGsiAttribution() が管理する。
  const gsiStd = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { attribution: "", maxZoom: 18 });
  const gsiPale = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", { attribution: "", maxZoom: 18 });
  const gsiBlank = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", { attribution: "", maxZoom: 18 });
  const gsiPhoto = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { attribution: "", maxZoom: 18 });

  osmLayer.addTo(map);

  L.control
    .layers({
      "OpenStreetMap": osmLayer,
      "国土地理院 標準地図": gsiStd,
      "国土地理院 淡色地図": gsiPale,
      "国土地理院 白地図": gsiBlank,
      "国土地理院 写真": gsiPhoto,
    })
    .addTo(map);

  // 地理院タイルの出典（追加の出所は、地理院タイル一覧ページの記載による。2026年9月時点）
  const GSI_LIST_URL = "https://maps.gsi.go.jp/development/ichiran.html";
  const GSI_NOTE_GEBCO =
    "The bathymetric contours are derived from those contained within the GEBCO Digital Atlas, published by the BODC on behalf of IOC and IHO (2003) (https://www.gebco.net) 海上保安庁許可第292502号（水路業務法第25条に基づく類似刊行物）";
  const GSI_NOTE_VMAP0 =
    'Shoreline data is derived from: United States. National Imagery and Mapping Agency. "Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.';
  const GSI_NOTE_LANDSAT = "データソース：Landsat8画像（GSI,TSIC,GEO Grid/AIST）, Landsat8画像（courtesy of the U.S. Geological Survey）, 海底地形（GEBCO）";
  const GSI_NOTE_NASA =
    "Images on 世界衛星モザイク画像 obtained from site https://lpdaac.usgs.gov/data_access maintained by the NASA Land Processes Distributed Active Archive Center (LP DAAC), USGS/Earth Resources Observation and Science (EROS) Center, Sioux Falls, South Dakota, (Year). Source of image data product.";
  const GSI_NOTE_GRUS = "GRUS画像（© Axelspace）";
  const GSI_GRUS_BOUNDS = L.latLngBounds([20.4078, 136.0661], [20.4558, 136.1403]); // GRUS画像の範囲
  // 地図の種類ごとの、追加の出所（ズームレベル z と、表示範囲 bounds で決まる）
  const GSI_LAYERS = [
    { layer: gsiStd, notes: (z) => (z >= 5 && z <= 8 ? [GSI_NOTE_GEBCO, GSI_NOTE_VMAP0] : []) },
    { layer: gsiPale, notes: (z) => (z <= 8 ? [GSI_NOTE_VMAP0] : []) },
    { layer: gsiBlank, notes: () => [] },
    {
      layer: gsiPhoto,
      notes: (z, bounds) => {
        const n = [];
        if (z >= 9 && z <= 13) n.push(GSI_NOTE_LANDSAT);
        if (z <= 8) n.push(GSI_NOTE_NASA);
        if (z >= 14 && bounds.intersects(GSI_GRUS_BOUNDS)) n.push(GSI_NOTE_GRUS);
        return n;
      },
    },
  ];
  let gsiAttributionShown = "";
  function updateGsiAttribution() {
    const active = GSI_LAYERS.find((d) => map.hasLayer(d.layer));
    let html = "";
    if (active) {
      const notes = active.notes(map.getZoom(), map.getBounds());
      html = `<a href="${GSI_LIST_URL}" target="_blank" rel="noopener">地理院タイル</a>` + notes.map((n) => ` ／ ${escapeHtml(n)}`).join("");
    }
    if (html === gsiAttributionShown) return;
    if (gsiAttributionShown) map.attributionControl.removeAttribution(gsiAttributionShown);
    if (html) map.attributionControl.addAttribution(html);
    gsiAttributionShown = html;
  }
  map.on("baselayerchange zoomend moveend", updateGsiAttribution);

  const routesLayer = L.layerGroup().addTo(map);
  const vertexLayer = L.layerGroup().addTo(map);
  const icLayer = L.layerGroup().addTo(map);

  // route.id -> { line, dividers[] } への参照。ドラッグ中はこれらの座標だけを
  // その場で更新し、マーカー自体は破棄・再生成しない（後述）。
  const routeLineRefs = new Map();

  // ドラッグ中はマーカーを再生成せず、既存のポリラインの座標だけを更新する。
  // renderMapLayers()（マーカーの再生成を伴う）をドラッグ中に呼ぶと、ドラッグ対象
  // のマーカー自身が破棄されてしまい、Leafletのドラッグ処理が中断してしまうため。
  function updateRouteGeometry(route) {
    const segments = routeLineRefs.get(route.id);
    if (!segments) return;
    segments.forEach((seg) => {
      const latlngs = buildRenderedLatLngsRange(route, seg.startIdx, seg.endIdx);
      seg.line.setLatLngs(latlngs);
      seg.dividers.forEach((d) => d.setLatLngs(latlngs));
    });
  }

  // route.points の [startIdx, endIdx] 区間の、描画用の緯度経度列（点を、直線で結ぶ）
  function buildRenderedLatLngsRange(route, startIdx, endIdx) {
    return route.points.slice(startIdx, endIdx + 1).map((p) => [p.lat, p.lng]);
  }

  // 頂点・中間点マーカー専用ペイン。IC/JCTマーカー（デフォルトのmarkerPane）より
  // 常に手前に表示し、複数路線が重なってもドラッグ操作を邪魔されないようにする。
  map.createPane("vertexPane");
  map.getPane("vertexPane").style.zIndex = 650;
  // 選択中の路線の IC/JCT（施設点）専用ペイン。操作点（頂点・vertexPane）と重なったときは、施設点を上に表示する。
  // 別の路線の施設点は、操作点の操作を邪魔しないよう、従来どおり操作点の下（markerPane）に置く。
  map.createPane("icPane");
  map.getPane("icPane").style.zIndex = 660;
  const mapHintEl = document.getElementById("map-hint");

  // ---------------------------------------------------------------------
  // 描画（レンダリング）
  // ---------------------------------------------------------------------
  function render() {
    // 路線が選択されていないときは、「路線」タブだけを出す
    // （同じ「路線を選択してください」の空状態が並ぶのを避ける）
    pruneLinks(); // 削除された路線・JCTを指す分岐を取り除く
    renderSidebarTabs();
    renderFacilityList(); // 路線図モードの「施設」タブ（施設の表示設定）
    renderMapLayers();
    renderRouteList();
    renderRouteProps();
    renderLinkPanel(); // サイドバーの「JCT・ICでの分岐」欄（折りたたみ）
    renderFacilitySettings(); // サイドバーの「施設設定」欄（点を選んでいるときだけ）
    renderPointToolbar(); // 地図に重ねる「選択中の点」ツールバー
    renderMapHint();
    if (currentMode === "diagram") renderRouteDiagram();
    recordHistory(false); // 前回の記録から編集内容が変わっていれば履歴に追加する
  }

  function renderMapHint() {
    const route = getActiveRoute();
    if (currentMap.routes.length === 0 && currentMode === "edit") {
      mapHintEl.textContent = "右側の「路線を追加する」を押して、始めましょう";
      mapHintEl.hidden = false;
    } else if (route && route.points.length === 0) {
      mapHintEl.textContent = "地図をクリックして、路線の始点を置いてください";
      mapHintEl.hidden = false;
    } else {
      mapHintEl.hidden = true;
    }
  }

  function renderMapLayers() {
    routesLayer.clearLayers();
    vertexLayer.clearLayers();
    icLayer.clearLayers();
    routeLineRefs.clear();

    currentMap.routes.forEach((route) => {
      if (route.points.length >= 2) {
        // 区間別の車線数・状態・色により、1つの路線を、車線数も状態も色も一定の区間
        // （レンジ）に分割し、区間ごとに太さ・線種・色の異なるポリラインとして描画する。
        const ranges = buildLaneRanges(route);
        const segments = [];

        ranges.forEach((range) => {
          const status = STATUSES[range.status] || STATUSES.inservice;
          const latlngs = buildRenderedLatLngsRange(route, range.startIdx, range.endIdx);
          const weight = laneWeight(range.lanes);
          const dashArray = status.dashArray(weight);
          const line = L.polyline(latlngs, {
            color: range.color,
            weight,
            opacity: route.opacity,
            dashArray: dashArray,
            // 丸い線端だと太い線でダッシュ同士が重なって潰れて見えるため、破線・点線のときは端を角形にする。
            lineCap: dashArray ? "butt" : "round",
          });
          line.on("click", (e) => {
            L.DomEvent.stop(e);
            activeRouteId = route.id;
            clearSelection();
            render();
          });
          line.addTo(routesLayer);

          // 車線区分線: 太さ(=道幅)による表現に加え、線内にオフセットした
          // 区分線を重ねて車線数そのものを視覚化する（供用中の道路のみ）。暫定の枠の色は、この区間の色。
          const dividers = range.status === "inservice" ? drawLaneDividers(latlngs, route, range.lanes, weight, range.color, range.provisional) : [];

          segments.push({ startIdx: range.startIdx, endIdx: range.endIdx, line, dividers });
        });

        routeLineRefs.set(route.id, segments);
      }

      // IC/JCT markers are always visible for every route
      route.ics.forEach((ic) => {
        const pt = route.points[ic.pointIndex];
        if (!pt) return;
        addIcMarker(route, ic, pt);
      });

      if (route.id === activeRouteId) {
        renderActiveRouteVertices(route);
      }
    });
  }

  // 車線数-1本の区分線を、道幅の内側に等間隔でオフセット配置する。
  // 中央（対向車線との境）は、線の本数と色で次のように見分ける。
  //  - 通常の2車線: 白の破線1本
  //  - 2車線（暫定2車線。中央帯なし）: 黄色の実線1本
  //  - 4車線以上（中央帯あり）: 白の太い実線1本
  // 同方向内の車線境界は白の破線。暫定（将来＝現在＋2車線）の場合は、将来の幅を
  // 示す点線の枠（路線色）を道路の両側に重ねる（2・4・6・8車線とも共通）。
  //
  // 区分線の仕様は laneDividerSpecs() に集約している。地図の描画（drawLaneDividers）と
  // マニュアルの凡例（js/legend.js）の両方がこれを使うため、見た目を変えるときは
  // ここだけを変更すれば凡例にも反映される。
  // 戻り値: { dividers: [{offset, color, weight, dashArray}], ghostHalf: 将来幅の片側オフセット（暫定でなければnull） }
  function laneDividerSpecs(lanesForSegment, roadWidth, provisional) {
    const lanes = nearestValidLanes(lanesForSegment);
    const dividers = [];
    if (lanes < 2) return { dividers, ghostHalf: null };
    for (let k = 1; k < lanes; k++) {
      const offset = -roadWidth / 2 + k * (roadWidth / lanes);
      const isCenter = Math.abs(offset) < 0.01;
      if (!isCenter) {
        dividers.push({ offset, color: "#ffffff", weight: 1.5, dashArray: "8,8" });
      } else if (lanes === 2) {
        if (provisional) dividers.push({ offset, color: "#ffd600", weight: 2.5, dashArray: null });
        else dividers.push({ offset, color: "#ffffff", weight: 1.5, dashArray: "8,8" });
      } else {
        dividers.push({ offset, color: "#ffffff", weight: 4, dashArray: null });
      }
    }
    // 将来の車線数（8車線の次は10車線）は選択肢外なので、直接計算する
    const ghostHalf = provisional ? ((lanes + 2) * LANE_WIDTH_PX) / 2 : null;
    return { dividers, ghostHalf };
  }

  // segmentColor: この区間の色（区間別の色が設定されていれば、その色。既定は route.color）。
  // 暫定の枠（ghost）は、路線色ではなく、この区間の色で描く（v1.52.0-beta）。
  // isProvisional: この区間が暫定かどうか（v1.53.0-betaから、呼び出し側〔provisionalOfStep〕が決めた値をそのまま使う）。
  function drawLaneDividers(latlngs, route, lanesForSegment, weightForSegment, segmentColor, isProvisional) {
    const created = [];
    const lanes = nearestValidLanes(lanesForSegment);
    if (lanes < 2) return created;
    const opacity = Math.min(1, route.opacity + 0.1);
    const specs = laneDividerSpecs(lanes, weightForSegment, isProvisional);
    specs.dividers.forEach((d) => {
      const divider = L.polyline(latlngs, {
        offset: d.offset,
        color: d.color,
        weight: d.weight,
        opacity,
        dashArray: d.dashArray,
        interactive: false,
      });
      divider.addTo(routesLayer);
      created.push(divider);
    });
    if (specs.ghostHalf != null) {
      [-specs.ghostHalf, specs.ghostHalf].forEach((off) => {
        const ghost = L.polyline(latlngs, {
          offset: off,
          color: segmentColor || route.color,
          weight: 1.5,
          opacity: Math.min(1, route.opacity),
          dashArray: "4,4",
          interactive: false,
        });
        ghost.addTo(routesLayer);
        created.push(ghost);
      });
    }
    return created;
  }

  function addIcMarker(route, ic, pt) {
    const def = IC_TYPES[ic.type] || IC_TYPES.ic;
    const shape = icShapeOf(ic);
    const icSelected = route.id === activeRouteId && selectedSet.has(ic.pointIndex);
    const html = `<div class="ic-marker-wrap"><div class="ic-shape shape-${shape}${icSelected ? " selected" : ""}" style="width:${def.size}px;height:${def.size}px;"></div></div>`;
    const icon = L.divIcon({
      className: "",
      html,
      iconSize: [def.size, def.size],
      iconAnchor: [def.size / 2, def.size / 2],
    });
    const pos = pt;
    const isActive = route.id === activeRouteId;
    const marker = L.marker([pos.lat, pos.lng], {
      icon,
      draggable: !isLockedIdx(route, ic.pointIndex),
      pane: isActive ? "icPane" : "markerPane",
    });

    if (ic.labelVisible) {
      marker.bindTooltip(escapeHtml(ic.name || ""), {
        permanent: true,
        direction: "right",
        offset: [6, 0],
        className: "ic-label",
      });
    } else if (ic.name) {
      // 常時表示しない場合も、マウスを乗せると名称が見える
      marker.bindTooltip(escapeHtml(ic.name), { direction: "right", offset: [6, 0], className: "ic-label" }); // ツールチップの内容は、HTMLとして扱われるので、エスケープする
    }

    marker.on("click", (e) => {
      L.DomEvent.stop(e);
      if (activeRouteId !== route.id) {
        activeRouteId = route.id;
        clearSelection();
      }
      const oe = e.originalEvent;
      if (oe && (oe.ctrlKey || oe.metaKey)) {
        toggleSelect(ic.pointIndex);
      } else if (selectedSet.size === 1 && selectedSet.has(ic.pointIndex)) {
        clearSelection(); // 操作点と同じく、選択中の点をもう一度クリックすると、選択を解除する
      } else {
        selectOnly(ic.pointIndex);
      }
      render();
    });

    // マーカーは線の上（PIとは別の位置）にあるため、マーカーの移動量をPIに加える
    // 施設点は操作点の上にあるため、選択中の点をまとめて動かす操作（複数選択）も、ここで同じように行う。
    let icStart = null;
    marker.on("dragstart", () => {
      const group =
        isActive && selectedSet.size > 1 && selectedSet.has(ic.pointIndex) ? Array.from(selectedSet) : [ic.pointIndex];
      icStart = { ll: marker.getLatLng(), items: {} };
      group.forEach((k) => {
        if (isLockedIdx(route, k)) return; // ロック中の点は動かさない
        const p = route.points[k];
        // 分岐でつながっている点は、一緒に動かす（ドラッグ開始時に集めておく）
        icStart.items[k] = { pi: { lat: p.lat, lng: p.lng }, followers: jointCluster(route, k) };
      });
    });
    marker.on("drag", (e) => {
      if (!icStart) return;
      const ll = e.target.getLatLng();
      const dLat = ll.lat - icStart.ll.lat;
      const dLng = ll.lng - icStart.ll.lng;
      // オブジェクトを丸ごと置き換えるとロック等の付随情報が失われるため、
      // 緯度経度だけを書き換える。
      Object.keys(icStart.items).forEach((k) => {
        const it = icStart.items[k];
        const p = route.points[k];
        p.lat = it.pi.lat + dLat;
        p.lng = it.pi.lng + dLng;
        moveFollowers(it.followers, p.lat, p.lng);
      });
      updateRouteGeometry(route);
    });
    marker.on("dragend", () => render());

    marker.addTo(icLayer);
  }

  function renderActiveRouteVertices(route) {
    const markersByIdx = {};
    route.points.forEach((pt, idx) => {
      const isSelected = selectedSet.has(idx);
      const isStart = idx === 0;
      const isEnd = idx === route.points.length - 1 && route.points.length > 1;
      const roleClass = isStart ? " start" : isEnd ? " end" : "";
      const locked = isLockedIdx(route, idx);
      const icon = L.divIcon({
        className: "",
        html: `<div class="vertex-marker${roleClass}${isSelected ? " selected" : ""}${locked ? " locked" : ""}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker([pt.lat, pt.lng], { icon, draggable: !locked, pane: "vertexPane" });

      // 始点・終点は、路線の向きの基準になるため、
      // 常時ラベル表示して一目で判別できるようにする。
      if (isStart || isEnd) {
        // 終点は「終点を決定」を押すまでは、まだ動かせる仮の終点として表示する
        marker.bindTooltip(isStart ? "始点" : route.endLocked ? "終点" : "終点（仮）", {
          permanent: true,
          direction: "top",
          offset: [0, -9],
          className: "vertex-label" + (isStart ? " vertex-label-start" : " vertex-label-end"),
        });
      }

      marker.on("click", (e) => {
        L.DomEvent.stop(e);
        const oe = e.originalEvent;
        if (oe && (oe.ctrlKey || oe.metaKey)) {
          toggleSelect(idx); // Ctrl（Mac: Command）+クリックで複数選択
        } else if (selectedSet.size === 1 && selectedSet.has(idx)) {
          clearSelection();
        } else {
          selectOnly(idx);
        }
        render();
      });

      // 複数選択中の点をドラッグしたときは、選択中の点をまとめて同じ量だけ移動する。
      // マーカーの移動量を、そのまま点の位置に加える。
      let dragStart = null; // { ll: ドラッグ開始時のマーカー位置, items: { 点のindex: { pi, ll } } }
      marker.on("dragstart", () => {
        const group = selectedSet.size > 1 && selectedSet.has(idx) ? Array.from(selectedSet) : [idx];
        dragStart = { ll: marker.getLatLng(), items: {} };
        group.forEach((k) => {
          if (isLockedIdx(route, k)) return; // ロック中の始点・終点は動かさない
          const m = markersByIdx[k];
          dragStart.items[k] = {
            pi: { lat: route.points[k].lat, lng: route.points[k].lng },
            ll: m ? m.getLatLng() : marker.getLatLng(),
            followers: jointCluster(route, k), // 分岐でつながっている点も、一緒に動かす
          };
        });
      });

      marker.on("drag", (e) => {
        if (!dragStart) return;
        const ll = e.target.getLatLng();
        const dLat = ll.lat - dragStart.ll.lat;
        const dLng = ll.lng - dragStart.ll.lng;
        // オブジェクトを丸ごと置き換えるとロック等の付随情報が失われるため、
        // 緯度経度だけを書き換える。
        Object.keys(dragStart.items).forEach((k) => {
          const it = dragStart.items[k];
          const p = route.points[k];
          p.lat = it.pi.lat + dLat;
          p.lng = it.pi.lng + dLng;
          moveFollowers(it.followers, p.lat, p.lng);
          if (Number(k) !== idx && markersByIdx[k]) markersByIdx[k].setLatLng([it.ll.lat + dLat, it.ll.lng + dLng]);
        });
        updateRouteGeometry(route);
      });
      marker.on("dragend", () => {
        dragStart = null;
        render();
      });

      markersByIdx[idx] = marker;
      marker.addTo(vertexLayer);
    });

    // 中間点（仮想マーカー）: ドラッグで新しい頂点として挿入
    for (let i = 0; i < route.points.length - 1; i++) {
      const a = route.points[i];
      const b = route.points[i + 1];
      const midLat = (a.lat + b.lat) / 2; // 中間点は、隣り合う2点の真ん中
      const midLng = (a.lng + b.lng) / 2;
      const icon = L.divIcon({
        className: "",
        html: `<div class="midpoint-marker"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const marker = L.marker([midLat, midLng], { icon, draggable: true, opacity: 0.9, pane: "vertexPane" });
      const insertAt = i + 1;

      marker.on("dragend", (e) => {
        const ll = e.target.getLatLng();
        route.points.splice(insertAt, 0, { lat: ll.lat, lng: ll.lng });
        // 挿入位置以降のIC参照インデックス・区間別車線数の境界をずらす
        route.ics.forEach((ic) => {
          if (ic.pointIndex >= insertAt) ic.pointIndex += 1;
        });
        segmentLists(route).forEach((list) =>
          list.forEach((seg) => {
            if (seg.fromIdx >= insertAt) seg.fromIdx += 1;
            if (seg.toIdx >= insertAt) seg.toIdx += 1;
          })
        );
        selectOnly(insertAt);
        render();
      });

      marker.addTo(vertexLayer);
    }
  }

  map.on("click", (e) => {
    if (currentMode !== "edit") return;
    const route = getActiveRoute();
    if (!route) return;
    // 終点が決定（ロック）済みのときは、末尾への点の追加はできない（解除すると追加できる）。
    if (route.endLocked && route.points.length >= 2) {
      toast("終点が決定済みです。サイドバーで終点のロックを解除すると、末尾に点を追加できます", "error");
      return;
    }
    route.points.push({ lat: e.latlng.lat, lng: e.latlng.lng });
    clearSelection();
    render();
  });

  // ---------------------------------------------------------------------
  // サイドバー: 路線一覧
  // ---------------------------------------------------------------------
  const routeListEl = document.getElementById("route-list");

  function renderRouteList() {
    routeListEl.innerHTML = "";
    // 路線が1本もない最初の状態では、小さな「路線を追加」ボタンの代わりに、大きなボタンを出す
    // （同じ機能のボタンを2つ並べない。大きなボタンは、小さいボタンの操作を呼び出すだけ）
    document.getElementById("btn-add-route").hidden = currentMap.routes.length === 0;
    if (currentMap.routes.length === 0) {
      routeListEl.innerHTML =
        '<div class="empty-cta">' +
        '<p class="empty-cta-title">まず、路線を作りましょう</p>' +
        '<button type="button" id="btn-add-route-large" class="btn primary empty-cta-btn">＋ 路線を追加する</button>' +
        '<p class="empty-cta-hint">押すと新しい路線ができ、地図をクリックして始点を置けます</p>' +
        "</div>";
      document.getElementById("btn-add-route-large").addEventListener("click", () => {
        document.getElementById("btn-add-route").click();
      });
      return;
    }
    const addRouteItem = (route) => {
      const div = document.createElement("div");
      div.className = "route-item" + (route.id === activeRouteId ? " active" : "");
      div.title = routeLabel(route); // 長い名前は一覧で2行までに収めるので、全体はマウスオーバーで見られる
      const tag =
        route.provisional && canBeProvisional(route)
          ? `<span class="route-tag">${provisionalLabel(route)}</span>`
          : "";
      const trunk = route.branchFrom ? routeById(route.branchFrom.routeId) : null;
      const branchWord = route.branchFrom && route.branchFrom.mode === "straight" ? "順接" : "分岐";
      const branchTag = trunk ? `<span class="route-tag" title="${escapeHtml(trunk.name || "")}から${branchWord}">${branchWord}</span>` : "";
      div.innerHTML = `<span class="swatch" style="background:${route.color}"></span><span class="name">${escapeHtml(
        route.name || "(無名の路線)"
      )}</span>${tag}${branchTag}`;
      div.addEventListener("click", () => {
        activeRouteId = route.id;
        clearSelection();
        render();
      });
      routeListEl.appendChild(div);
    };
    currentMap.routes.forEach((route) => addRouteItem(route));
    if (!getActiveRoute()) {
      const hint = document.createElement("div");
      hint.className = "empty-msg";
      hint.textContent = "路線を選択すると、設定を編集できます";
      routeListEl.appendChild(hint);
    }
  }

  // 新しい路線の初期名「路線N」。いまの地図の中で使われていない、いちばん小さい番号にする
  // （新規作成・読込・削除のあとも、番号が増え続けないようにするため、地図ごとに数え直す）
  function defaultRouteName() {
    const used = new Set(currentMap.routes.map((r) => r.name));
    let n = 1;
    while (used.has("路線" + n)) n++;
    return "路線" + n;
  }

  // 新しい路線の初期値（点はまだない）。「路線を追加」と、分岐する路線の作成で使う
  function newRouteObject() {
    const lanes = CATEGORIES.national.lanes;
    return {
      id: uid(),
      name: defaultRouteName(),
      category: "national",
      status: "inservice",
      color: CATEGORIES.national.color,
      lanes: lanes,
      provisional: false,
      endLocked: false, // 終点は、「終点を決定」を押すまでロックしない（描画中は末尾に点を追加できる）
      weight: laneWeight(lanes),
      opacity: 1,
      points: [],
      ics: [],
      laneSegments: [],
      statusSegments: [],
      colorSegments: [],
      provisionalSegments: [],
    };
  }

  document.getElementById("btn-add-route").addEventListener("click", () => {
    const route = newRouteObject();
    currentMap.routes.push(route);
    activeRouteId = route.id;
    clearSelection();
    render();
  });

  document.getElementById("btn-reverse-route").addEventListener("click", () => {
    const route = getActiveRoute();
    if (!route) return;
    if (route.branchFrom) route.branchFrom.at = route.branchFrom.at === "end" ? "start" : "end"; // 分岐している端も入れ替わる
    const n = route.points.length;
    route.points.reverse();
    // endLocked は「この路線の描画が完了しているか」を表す路線単位の状態なので、向き反転では変えない
    // （各点の locked は points 配列と一緒に反転されるので、そのまま追従する）
    route.ics.forEach((ic) => {
      ic.pointIndex = n - 1 - ic.pointIndex;
    });
    segmentLists(route).forEach((list) =>
      list.forEach((seg) => {
        const from = n - 1 - seg.toIdx;
        const to = n - 1 - seg.fromIdx;
        seg.fromIdx = from;
        seg.toIdx = to;
      })
    );
    clearSelection();
    render();
  });

  document.getElementById("btn-delete-route").addEventListener("click", async () => {
    const route = getActiveRoute();
    if (!route) return;
    const ok = await confirmModal(`路線「${route.name}」を削除します。よろしいですか？`);
    if (!ok) return;
    currentMap.routes = currentMap.routes.filter((r) => r.id !== route.id);
    activeRouteId = null;
    clearSelection();
    render();
  });

  // ---------------------------------------------------------------------
  // サイドバー: JCT・ICでの分岐（「JCT・ICでの分岐」欄。折りたたみ式。v1.53.2-beta）
  // 分岐する路線の端の点を、分岐元の施設（JCT・IC）の位置に合わせて重ねる。
  // ---------------------------------------------------------------------
  const linkPanelEl = document.getElementById("link-panel");
  const linkSummaryEl = document.getElementById("link-summary");
  const linkBodyEl = document.getElementById("link-body");
  // 分岐の欄の状態。fac: 分岐元の施設（"路線のid#点の番号"）、at: この路線の分岐する端、
  // atAuto: 端を、施設に近い端に自動で決めているか、newFac: 新しい路線を分岐させる施設（この路線の点の番号）、focus: 地図に赤い輪で示す施設（"fac" / "new"）、
  // mode/newMode: 「分岐」／「順接」（v1.55.0-beta。ユーザー指定）
  let linkUi = { fac: "", at: "start", atAuto: true, newFac: "", focus: "fac", mode: "branch", newMode: "branch" };
  // JCT・ICでの分岐欄は折りたたみ式（v1.53.2-beta）。路線を切り替えた直後だけ、分岐の有無で開閉の既定を決め、
  // そのあとはユーザーが自分で開閉した状態を保つ（renderLinkPanel は編集のたびに呼ばれるため、毎回は開閉し直さない）
  let linkPanelOpenForRoute = null;
  // 選んだ施設の場所を、地図に赤い輪で示すレイヤー
  const branchPreviewLayer = L.layerGroup().addTo(map);

  function routeLabel(r) {
    return r.name || "(無名の路線)";
  }

  // 「順接」（v1.55.0-beta。ユーザー指定）: 分岐ではなく、分岐元の路線と同じ直線の続きとして路線図に表示する。
  // 分岐元の施設が、その路線自身の始点または終点そのもの（途中の施設ではない）のときだけ選べる
  // （途中の施設だと、本線自身の続きと、順接した路線の続きが、路線図の同じ位置を取り合ってしまうため）。
  function canBeStraightSource(trunk, ic) {
    return !!ic && (ic.pointIndex === 0 || ic.pointIndex === trunk.points.length - 1);
  }

  // 1つの施設から「順接」できる路線は1本まで（分岐は、これまでどおり複数可）
  function hasStraightChild(trunk, ic, exceptRouteId) {
    return currentMap.routes.some(
      (r) => r.id !== exceptRouteId && r.branchFrom && r.branchFrom.routeId === trunk.id && r.branchFrom.icId === ic.id && r.branchFrom.mode === "straight"
    );
  }

  // route の始点（at: "start"）または終点（"end"）を、trunk の pointIndex 番目のJCTから分岐させる。
  // mode: "branch"（既定）／"straight"（順接）。戻り値: エラーの文（成功なら null）
  function setBranch(route, trunk, jctPointIndex, at, mode) {
    if (route.id === trunk.id) return "同じ路線には分岐できません";
    if (route.points.length === 0) return "点のない路線は分岐させられません";
    const ic = trunk.ics.find((x) => x.pointIndex === jctPointIndex);
    if (!ic) return "分岐元の施設を選んでください";
    if (mode === "straight") {
      if (!canBeStraightSource(trunk, ic)) return "順接は、分岐元の路線の始点または終点の施設からだけ設定できます";
      if (hasStraightChild(trunk, ic)) return "この施設からは、すでに別の路線が順接しています（順接は1つの施設につき1本までです）";
    }
    let cur = trunk;
    for (let guard = 0; cur && cur.branchFrom && guard < 50; guard++) {
      if (cur.branchFrom.routeId === route.id) return "分岐がぐるぐる回る組み合わせにはできません";
      cur = routeById(cur.branchFrom.routeId);
    }
    const tp = trunk.points[ic.pointIndex];
    const p = route.points[at === "end" ? route.points.length - 1 : 0];
    p.lat = tp.lat;
    p.lng = tp.lng;
    route.branchFrom = { routeId: trunk.id, icId: ensureIcId(ic), at, mode: mode === "straight" ? "straight" : "branch" };
    return null;
  }

  // 分岐先・分岐する端は変えず、「分岐」「順接」の種類だけを切り替える。戻り値: エラーの文（成功なら null）
  function setBranchMode(route, mode) {
    const bf = route.branchFrom;
    if (!bf) return "分岐していません";
    const trunk = routeById(bf.routeId);
    const ic = trunk && icById(trunk, bf.icId);
    if (!trunk || !ic) return "分岐元が見つかりません";
    if (mode === "straight") {
      if (!canBeStraightSource(trunk, ic)) return "順接は、分岐元の路線の始点または終点の施設からだけ設定できます";
      if (hasStraightChild(trunk, ic, route.id)) return "この施設からは、すでに別の路線が順接しています（順接は1つの施設につき1本までです）";
    }
    bf.mode = mode === "straight" ? "straight" : "branch";
    return null;
  }

  // 分岐元にできる施設（v1.44.0でJCTだけからJCT・ICに広げ、v1.51.0-betaで、全施設種別〔SA・PA・
  // 本線料金所・一般道出入口・その他を含む〕に広げた。施設として設定していない、ただの点は対象外）
  function branchSourcesOf(route) {
    return route.ics.slice().sort((a, b) => a.pointIndex - b.pointIndex);
  }

  // 分岐元の施設を選ぶ選択肢の値: "路線のid#点の番号"
  const facKey = (r, ic) => `${r.id}#${ic.pointIndex}`;
  function parseFacKey(key) {
    const i = String(key).lastIndexOf("#");
    const r = routeById(String(key).slice(0, i));
    if (!r) return null;
    const ic = r.ics.find((x) => x.pointIndex === Number(String(key).slice(i + 1)));
    return ic ? { route: r, ic } : null;
  }

  // 路線 r の始点から、点 idx までの距離（m）
  function distanceAlongRoute(r, idx) {
    let d = 0;
    for (let k = 1; k <= idx && k < r.points.length; k++) d += distanceMeters(r.points[k - 1], r.points[k]);
    return d;
  }

  // 施設の選択肢の文言（例: 加治木JCT（JCT・始点から58.6km））
  function facLabel(r, ic) {
    const km = (distanceAlongRoute(r, ic.pointIndex) / 1000).toFixed(1);
    const short = (IC_TYPES[ic.type] || IC_TYPES.ic).short;
    return `${ic.name || "(無名)"}（${short}・始点から${km}km）`;
  }

  // route の端のうち、点 tp に近いほう（点が2つ未満なら始点）
  function nearerEnd(route, tp) {
    if (route.points.length < 2) return "start";
    return distanceMeters(route.points[0], tp) <= distanceMeters(route.points[route.points.length - 1], tp) ? "start" : "end";
  }

  // 施設の場所を、地図に赤い輪で示す。pan=true のときは、見える範囲の外なら、その場所へ地図を動かす
  function showBranchRing(r, ic, pan) {
    branchPreviewLayer.clearLayers();
    const p = r && ic ? r.points[ic.pointIndex] : null;
    if (!p) return;
    const ll = [p.lat, p.lng];
    L.circleMarker(ll, { radius: 18, color: "#d50000", weight: 3, fill: false, interactive: false }).addTo(branchPreviewLayer);
    if (pan && !map.getBounds().pad(-0.15).contains(ll)) map.panTo(ll);
  }

  // pan=true: 施設を選び直したときに、その場所を地図で見せる
  function renderLinkPanel(pan) {
    branchPreviewLayer.clearLayers();
    const route = getActiveRoute();
    linkPanelEl.hidden = currentMode !== "edit" || !route;
    if (linkPanelEl.hidden) return;

    let html = "";
    let ringTarget = null; // 赤い輪で示す施設 { route, ic }
    const bf = route.branchFrom;
    const trunkNow = bf ? routeById(bf.routeId) : null;
    const kids = currentMap.routes.filter((r) => r.branchFrom && r.branchFrom.routeId === route.id);
    const hasBranch = !!(bf && trunkNow) || kids.length > 0;
    if (linkPanelOpenForRoute !== route.id) {
      linkPanelOpenForRoute = route.id;
      linkPanelEl.open = hasBranch;
    }
    linkSummaryEl.innerHTML = `JCT・ICでの分岐<span class="acc-summary">${hasBranch ? "分岐あり" : ""}</span>`;
    if (bf && trunkNow) {
      // すでに分岐しているとき
      const ic = icById(trunkNow, bf.icId);
      const mode = bf.mode === "straight" ? "straight" : "branch";
      const canStraight = canBeStraightSource(trunkNow, ic);
      html +=
        `<p class="link-branch-now">「${escapeHtml(routeLabel(trunkNow))}」の「${escapeHtml((ic && ic.name) || "(無名)")}」から${mode === "straight" ? "順接" : "分岐"}しています（この路線の${bf.at === "end" ? "終点" : "始点"}側）</p>` +
        '<div class="field"><label>種類</label><div id="branch-mode-now" class="segmented" role="group">' +
        `<button type="button" data-mode="branch" class="${mode === "branch" ? "active" : ""}">分岐</button>` +
        `<button type="button" data-mode="straight" class="${mode === "straight" ? "active" : ""}"${canStraight ? "" : " disabled"}>順接</button>` +
        "</div>" +
        (canStraight ? "" : '<p class="hint-text">順接は、この施設が、分岐元の路線の始点または終点のときだけ選べます。</p>') +
        "</div>" +
        '<div class="btn-row"><button id="btn-show-branch" type="button" class="btn ghost small">分岐元を地図で見る</button>' +
        '<button id="btn-clear-branch" type="button" class="btn ghost small">分岐を解除する</button></div>';
    } else {
      // 分岐元にできる施設: 他の路線のJCT・IC。路線ごとにまとめて、1つの選択欄に並べる
      const trunks = currentMap.routes.filter((r) => r !== route && branchSourcesOf(r).length > 0);
      const options = [];
      trunks.forEach((r) => branchSourcesOf(r).forEach((ic) => options.push({ key: facKey(r, ic), r, ic })));
      if (options.length) {
        if (!options.some((o) => o.key === linkUi.fac)) {
          linkUi.fac = options[0].key;
          linkUi.atAuto = true;
        }
        const cur = parseFacKey(linkUi.fac);
        if (linkUi.atAuto && cur) linkUi.at = nearerEnd(route, cur.route.points[cur.ic.pointIndex]);
        if (cur && linkUi.focus === "fac") ringTarget = cur;
        const canStraight = !!cur && canBeStraightSource(cur.route, cur.ic) && !hasStraightChild(cur.route, cur.ic);
        if (!canStraight) linkUi.mode = "branch"; // 選べないときは「分岐」に戻す
        const endName = (v) => (v === "start" ? "始点" : "終点");
        const twoPoints = route.points.length >= 2;
        html +=
          '<p class="hint-text">この路線の端を、別の路線の施設につなぎます（分岐させます）。選んだ施設の場所は、地図に赤い輪で示されます。</p>' +
          '<div class="field"><label>分岐元の施設</label><select id="branch-fac">' +
          trunks
            .map(
              (r) =>
                `<optgroup label="${escapeHtml(routeLabel(r))}">` +
                branchSourcesOf(r)
                  .map((ic) => `<option value="${escapeHtml(facKey(r, ic))}"${facKey(r, ic) === linkUi.fac ? " selected" : ""}>${escapeHtml(facLabel(r, ic))}</option>`)
                  .join("") +
                "</optgroup>"
            )
            .join("") +
          "</select></div>" +
          '<div class="field"><label>この路線の分岐する端</label><div id="branch-at" class="segmented">' +
          ["start", "end"].map((v) => `<button type="button" data-at="${v}" class="${linkUi.at === v ? "active" : ""}">${endName(v)}</button>`).join("") +
          "</div>" +
          (twoPoints && linkUi.atAuto ? `<p class="hint-text link-at-note">施設に近い${endName(linkUi.at)}を選んでいます。変えるときは、押してください。</p>` : "") +
          "</div>" +
          '<div class="field"><label>種類</label><div id="branch-mode" class="segmented" role="group">' +
          `<button type="button" data-mode="branch" class="${linkUi.mode === "branch" ? "active" : ""}">分岐</button>` +
          `<button type="button" data-mode="straight" class="${linkUi.mode === "straight" ? "active" : ""}"${canStraight ? "" : " disabled"}>順接</button>` +
          "</div>" +
          (canStraight ? "" : '<p class="hint-text">順接は、選んだ施設が、その路線の始点または終点で、まだ他の路線が順接していないときだけ選べます。</p>') +
          "</div>" +
          `<button id="btn-set-branch" type="button" class="btn primary small full">この路線をこの施設${linkUi.mode === "straight" ? "に順接させる" : "から分岐させる"}</button>`;
      } else {
        html += '<p class="hint-text">分岐元にできる施設がありません。別の路線の点を選ぶと開く「施設設定」で、施設を設定してください。</p>';
      }
    }

    // この路線のJCT・ICから、新しい路線を分岐させる
    const own = branchSourcesOf(route);
    if (own.length) {
      if (!own.some((ic) => String(ic.pointIndex) === String(linkUi.newFac))) linkUi.newFac = String(own[0].pointIndex);
      const ownCur = own.find((ic) => String(ic.pointIndex) === String(linkUi.newFac));
      if (ownCur && linkUi.focus === "new") ringTarget = { route, ic: ownCur };
      const newCanStraight = !!ownCur && canBeStraightSource(route, ownCur) && !hasStraightChild(route, ownCur);
      if (!newCanStraight) linkUi.newMode = "branch";
      html +=
        '<div class="link-sub"><div class="link-sub-title">この路線から、新しい路線を分岐させる</div>' +
        '<p class="hint-text">選んだ施設を始点にした、新しい路線を作ります。作ったあと、地図をクリックして、路線を描いてください。</p>' +
        '<div class="field"><label>分岐させる施設</label><select id="newbranch-fac">' +
        own.map((ic) => `<option value="${ic.pointIndex}"${String(ic.pointIndex) === String(linkUi.newFac) ? " selected" : ""}>${escapeHtml(facLabel(route, ic))}</option>`).join("") +
        "</select></div>" +
        '<div class="field"><label>種類</label><div id="newbranch-mode" class="segmented" role="group">' +
        `<button type="button" data-mode="branch" class="${linkUi.newMode === "branch" ? "active" : ""}">分岐</button>` +
        `<button type="button" data-mode="straight" class="${linkUi.newMode === "straight" ? "active" : ""}"${newCanStraight ? "" : " disabled"}>順接</button>` +
        "</div>" +
        (newCanStraight ? "" : '<p class="hint-text">順接は、選んだ施設が、この路線の始点または終点で、まだ他の路線が順接していないときだけ選べます。</p>') +
        "</div>" +
        '<button id="btn-new-branch" type="button" class="btn ghost small full">この施設から、新しい路線を作る</button></div>';
    }

    if (kids.length) {
      html +=
        '<div class="link-kids"><div class="muted">この路線から分岐している路線</div>' +
        kids
          .map((r) => {
            const ic = icById(route, r.branchFrom.icId);
            return `<button type="button" class="btn ghost small link-kid" data-route-id="${escapeHtml(r.id)}">${escapeHtml((ic && ic.name) || "(無名)")} → ${escapeHtml(routeLabel(r))}</button>`;
          })
          .join("") +
        "</div>";
    }
    linkBodyEl.innerHTML = html;
    linkFieldLabels(linkBodyEl);
    if (ringTarget) showBranchRing(ringTarget.route, ringTarget.ic, !!pan);

    // ---- 操作
    const $ = (sel) => linkBodyEl.querySelector(sel);
    if ($("#btn-clear-branch")) {
      $("#btn-clear-branch").addEventListener("click", () => {
        delete route.branchFrom;
        render();
      });
      $("#btn-show-branch").addEventListener("click", () => {
        const ic = icById(trunkNow, bf.icId);
        if (!ic) return;
        const p = trunkNow.points[ic.pointIndex];
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 13));
        showBranchRing(trunkNow, ic, false);
      });
    }
    if ($("#branch-mode-now")) {
      linkBodyEl.querySelectorAll("#branch-mode-now button").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          const err = setBranchMode(route, btn.dataset.mode);
          if (err) return toast(err, "error");
          render();
        });
      });
    }
    if ($("#branch-fac")) {
      $("#branch-fac").addEventListener("change", (e) => {
        linkUi.fac = e.target.value;
        linkUi.atAuto = true; // 施設を選び直したら、端も、近いほうに選び直す
        linkUi.focus = "fac";
        renderLinkPanel(true);
      });
      linkBodyEl.querySelectorAll("#branch-at button").forEach((btn) => {
        btn.addEventListener("click", () => {
          linkUi.at = btn.dataset.at;
          linkUi.atAuto = false;
          renderLinkPanel();
        });
      });
      linkBodyEl.querySelectorAll("#branch-mode button").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          linkUi.mode = btn.dataset.mode;
          renderLinkPanel();
        });
      });
      $("#btn-set-branch").addEventListener("click", () => {
        const t = parseFacKey(linkUi.fac);
        if (!t) return;
        const err = setBranch(route, t.route, t.ic.pointIndex, linkUi.at, linkUi.mode);
        if (err) return toast(err, "error");
        toast(
          linkUi.mode === "straight"
            ? "順接を設定しました（この路線の端の点を、分岐元の施設の位置に合わせました）"
            : "分岐を設定しました（この路線の端の点を、分岐元の施設の位置に合わせました）"
        );
        render();
      });
    }
    if ($("#newbranch-fac")) {
      $("#newbranch-fac").addEventListener("change", (e) => {
        linkUi.newFac = e.target.value;
        linkUi.focus = "new";
        renderLinkPanel(true);
      });
      linkBodyEl.querySelectorAll("#newbranch-mode button").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          linkUi.newMode = btn.dataset.mode;
          renderLinkPanel();
        });
      });
      $("#btn-new-branch").addEventListener("click", () => {
        const ic = own.find((x) => String(x.pointIndex) === String(linkUi.newFac));
        const p = ic && route.points[ic.pointIndex];
        if (!p) return;
        if (linkUi.newMode === "straight" && hasStraightChild(route, ic)) {
          return toast("この施設からは、すでに別の路線が順接しています（順接は1つの施設につき1本までです）", "error");
        }
        const child = newRouteObject();
        child.points = [{ lat: p.lat, lng: p.lng }]; // 始点は、分岐元の施設の位置
        child.branchFrom = { routeId: route.id, icId: ensureIcId(ic), at: "start", mode: linkUi.newMode === "straight" ? "straight" : "branch" };
        currentMap.routes.push(child);
        activeRouteId = child.id;
        clearSelection();
        sidebarTab = "route";
        render();
        toast(`「${child.name}」を、${ic.name || "(無名)"}から${linkUi.newMode === "straight" ? "順接させました" : "分岐させました"}。地図をクリックして、路線を描いてください`);
      });
    }
    linkBodyEl.querySelectorAll(".link-kid").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeRouteId = btn.dataset.routeId;
        clearSelection();
        render();
      });
    });
  }

  // ---------------------------------------------------------------------
  // サイドバー: 路線プロパティ
  // ---------------------------------------------------------------------
  const routePropsEmptyEl = document.getElementById("route-props-empty");
  const routePropsEl = document.getElementById("route-props");
  const routeNameInput = document.getElementById("route-name");
  const categoryPresetsEl = document.getElementById("category-presets");
  const statusPresetsEl = document.getElementById("status-presets");
  const lanesSegmentedEl = document.getElementById("lanes-segmented");
  const provisionalSegmentedEl = document.getElementById("provisional-segmented");
  const provisionalSummaryEl = document.getElementById("provisional-summary");
  const routeColorInput = document.getElementById("route-color");
  const routeOpacityInput = document.getElementById("route-opacity");
  const routeOpacityVal = document.getElementById("route-opacity-val");

  // 路線種別は、常に路線全体の設定（区間ごとには変えられない。ユーザー指定）。
  Object.entries(CATEGORIES).forEach(([key, def]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.dataset.category = key;
    btn.innerHTML = `<span class="swatch-line" style="background:${def.color}"></span>${def.label}`;
    btn.addEventListener("click", () => {
      const route = getActiveRoute();
      if (!route) return;
      route.category = key;
      route.color = def.color;
      route.lanes = def.lanes;
      route.weight = laneWeight(route.lanes);
      render();
    });
    categoryPresetsEl.appendChild(btn);
  });

  // 状態・基本の車線数・供用形態は、v1.53.0-betaから、2点以上（Ctrl+クリック）を選んでいる間は、
  // その区間だけの設定になる（ユーザー指定。区間の選び方は「区間ごとの設定一覧」を参照）。
  // 選んでいないときは、これまでどおり路線全体の設定（route.status / route.lanes / route.provisional）。
  function applyStatusValue(value) {
    const route = getActiveRoute();
    const range = currentRangeSelection();
    if (!route) return;
    if (range) {
      route.statusSegments = (route.statusSegments || []).filter((s) => !(s.fromIdx === range.fromIdx && s.toIdx === range.toIdx));
      if (value != null) route.statusSegments.push({ id: uid(), fromIdx: range.fromIdx, toIdx: range.toIdx, status: value });
    } else if (value != null) {
      route.status = value;
    }
    render();
  }
  Object.entries(STATUSES).forEach(([key, def]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.status = key;
    btn.textContent = def.label;
    btn.addEventListener("click", () => applyStatusValue(key));
    statusPresetsEl.appendChild(btn);
  });
  const statusNoneBtn = document.createElement("button");
  statusNoneBtn.type = "button";
  statusNoneBtn.dataset.status = "";
  statusNoneBtn.textContent = "変更しない";
  statusNoneBtn.hidden = true; // 区間を選んでいるときだけ表示する
  statusNoneBtn.addEventListener("click", () => applyStatusValue(null));
  statusPresetsEl.insertBefore(statusNoneBtn, statusPresetsEl.firstChild);

  function applyLanesValue(value) {
    const route = getActiveRoute();
    const range = currentRangeSelection();
    if (!route) return;
    if (range) {
      route.laneSegments = route.laneSegments.filter((s) => !(s.fromIdx === range.fromIdx && s.toIdx === range.toIdx));
      if (value != null) route.laneSegments.push({ id: uid(), fromIdx: range.fromIdx, toIdx: range.toIdx, lanes: value });
    } else if (value != null) {
      route.lanes = value;
      route.weight = laneWeight(value);
    }
    render();
  }
  LANE_OPTIONS.forEach((n) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.lanes = n;
    btn.textContent = n;
    btn.title = n === 1 ? "1車線（対面通行・小規模道路の例外）" : `${n}車線（往復${n / 2}車線ずつ）`;
    btn.addEventListener("click", () => applyLanesValue(n));
    lanesSegmentedEl.appendChild(btn);
  });
  const lanesNoneBtn = document.createElement("button");
  lanesNoneBtn.type = "button";
  lanesNoneBtn.dataset.lanes = "";
  lanesNoneBtn.textContent = "変更しない";
  lanesNoneBtn.hidden = true; // 区間を選んでいるときだけ表示する
  lanesNoneBtn.addEventListener("click", () => applyLanesValue(null));
  lanesSegmentedEl.insertBefore(lanesNoneBtn, lanesSegmentedEl.firstChild);

  // 供用形態（完成形／暫定形／区間モードでは変更しない）。暫定は「将来（現在＋2車線）に対し、当面は現在の車線数で供用」。
  provisionalSegmentedEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const route = getActiveRoute();
      const range = currentRangeSelection();
      if (!route || btn.disabled) return;
      const val = btn.dataset.provisional; // "" = 変更しない（区間モードだけ）／"0" = 完成形／"1" = 暫定形
      if (range) {
        route.provisionalSegments = (route.provisionalSegments || []).filter((s) => !(s.fromIdx === range.fromIdx && s.toIdx === range.toIdx));
        if (val !== "") route.provisionalSegments.push({ id: uid(), fromIdx: range.fromIdx, toIdx: range.toIdx, provisional: val === "1" });
        render();
        return;
      }
      if (val === "") return; // 「変更しない」は区間モードのときだけ意味を持つ
      route.provisional = val === "1";
      render();
    });
  });

  // 始点を置く → 路線を順に描く → 終点を決定、の流れのうち、「終点を決定」のロックの切替。
  // （始点は、v1.53.2-betaで自動ロックを廃止したので、専用のスイッチはない）
  const decideEndBtn = document.getElementById("btn-decide-end");

  decideEndBtn.addEventListener("click", () => {
    const route = getActiveRoute();
    if (!route) return;
    if (route.endLocked) {
      route.endLocked = false;
    } else {
      if (route.points.length < 2) return;
      route.endLocked = true;
      toast("終点を決定しました（ロックされました）");
    }
    render();
  });

  // どのタブを見ていても設定内容が分かるよう、タブの下の1行に、選んでいる路線の見た目と車線数をまとめて出す
  // （例: 一般国道・供用中／4車線・暫定・区間2）
  function renderSidebarSummary(route) {
    const cat = CATEGORIES[route.category];
    const st = STATUSES[route.status] || STATUSES.inservice;
    const lanes = nearestValidLanes(route.lanes);
    const segs = (route.laneSegments || []).length;
    const stSegs = (route.statusSegments || []).length;
    sidebarSummaryEl.textContent =
      `${cat ? cat.label : ""}・${st.label}` + (stSegs ? `（区間別${stSegs}）` : "") + `／${lanes}車線` + (route.provisional && lanes >= 2 ? "・暫定" : "") + (segs ? `・区間${segs}` : "");
  }

  function renderLockControls(route) {
    const n = route.points.length;
    const endState = n < 2 ? "未設定" : route.endLocked ? "決定済み（ロック中）" : "未決定（描画中）";
    const setState = (id, text, cls) => {
      const el = document.getElementById(id);
      el.textContent = text;
      el.className = "ep-state" + (cls ? " " + cls : "");
    };
    setState("ep-end-state", endState, route.endLocked && n >= 2 ? "locked" : n >= 2 ? "pending" : "");
    // オン＝決定済み。トグルスイッチ（role="switch"）で切り替える
    decideEndBtn.setAttribute("aria-checked", String(!!route.endLocked));
    decideEndBtn.disabled = !route.endLocked && n < 2; // 点が2つ未満のときは、終点を決定できない
    decideEndBtn.title = route.endLocked ? "オフにすると、終点のロックを解除します" : n < 2 ? "点を2つ以上置くと、終点を決定できます" : "オンにすると、最後の点を終点として決定（ロック）します";
  }

  // 暫定にできるのは2車線以上（1車線は対象外）。
  function canBeProvisionalLanes(lanes) {
    return nearestValidLanes(lanes) >= 2;
  }
  function canBeProvisional(route) {
    return canBeProvisionalLanes(route.lanes);
  }

  function provisionalLabel(route) {
    const lanes = nearestValidLanes(route.lanes);
    return `暫定${lanes}車線`;
  }

  // range があるときは、その区間の供用形態（route.provisionalSegments の、その区間の設定）を表示・操作する。
  // ない（未選択、または選択が1点以下）ときは、これまでどおり路線全体（route.provisional）。
  function renderProvisionalControls(route, range) {
    if (range) {
      const laneSeg = route.laneSegments.find((s) => s.fromIdx === range.fromIdx && s.toIdx === range.toIdx);
      const provSeg = (route.provisionalSegments || []).find((s) => s.fromIdx === range.fromIdx && s.toIdx === range.toIdx);
      const effLanes = laneSeg ? laneSeg.lanes : route.lanes;
      const canProv = canBeProvisionalLanes(effLanes);
      provisionalSegmentedEl.querySelectorAll("button").forEach((btn) => {
        const val = btn.dataset.provisional;
        btn.hidden = false;
        btn.classList.toggle("active", provSeg ? val === (provSeg.provisional ? "1" : "0") : val === "");
        if (val === "1") btn.disabled = !canProv;
      });
      if (!canProv) {
        provisionalSummaryEl.textContent = "1車線には暫定の設定はありません";
      } else if (!provSeg) {
        provisionalSummaryEl.textContent = "この区間の供用形態は、路線全体の設定のままです";
      } else if (provSeg.provisional) {
        provisionalSummaryEl.textContent = `この区間は、暫定${effLanes}車線として供用中。将来は${effLanes + 2}車線`;
      } else {
        provisionalSummaryEl.textContent = `この区間は、完成形（${effLanes}車線）です`;
      }
      return;
    }
    const provisional = !!route.provisional && canBeProvisional(route);
    provisionalSegmentedEl.querySelectorAll("button").forEach((btn) => {
      const val = btn.dataset.provisional;
      btn.hidden = val === ""; // 「変更しない」は、路線全体の設定では意味を持たないので隠す
      if (val === "") return;
      const isProv = val === "1";
      btn.classList.toggle("active", isProv === provisional);
      if (isProv) btn.disabled = !canBeProvisional(route);
    });
    const lanes = nearestValidLanes(route.lanes);
    if (!canBeProvisional(route)) {
      provisionalSummaryEl.textContent = "1車線には暫定の設定はありません";
    } else if (provisional) {
      provisionalSummaryEl.textContent = `${provisionalLabel(route)}として供用中。将来は${lanes + 2}車線（地図上の点線の枠が将来の幅）`;
    } else {
      provisionalSummaryEl.textContent = `完成形（${lanes}車線）。暫定にすると、将来${lanes + 2}車線の幅を点線の枠で表示します`;
    }
  }

  routeNameInput.addEventListener("input", () => {
    const route = getActiveRoute();
    if (!route) return;
    route.name = routeNameInput.value;
    renderRouteList();
    recordHistory(true);
  });

  // 色は、区間モード（2点以上を選んでいる間）は、チェックなどを挟まず、選ぶとその場で区間の色
  // （route.colorSegments）に反映する（v1.54.1-beta。ユーザー指定。状態・車線数・供用形態と同じ操作感にした）。
  // 区間の色を外す（路線全体の色に戻す）ときは、「区間ごとの設定一覧」の「削除」を使う。

  // input[type=color] のドラッグ中に何度も呼ばれうるので、重い render() は呼ばず、
  // 地図・路線図の再描画と「区間ごとの設定一覧」だけを更新する。
  function applyColorLive(route, range, color) {
    if (!Array.isArray(route.colorSegments)) route.colorSegments = [];
    let seg = route.colorSegments.find((s) => s.fromIdx === range.fromIdx && s.toIdx === range.toIdx);
    if (seg) seg.color = color;
    else route.colorSegments.push({ id: uid(), fromIdx: range.fromIdx, toIdx: range.toIdx, color });
    renderMapLayers();
    if (currentMode === "diagram") renderRouteDiagram();
    renderRangeSegmentsList();
    recordHistory(true);
  }

  routeColorInput.addEventListener("input", () => {
    const route = getActiveRoute();
    if (!route) return;
    const range = currentRangeSelection();
    if (range) {
      applyColorLive(route, range, routeColorInput.value);
      return;
    }
    route.color = routeColorInput.value;
    renderMapLayers();
    renderRouteList();
    recordHistory(true);
  });

  routeOpacityInput.addEventListener("input", () => {
    const route = getActiveRoute();
    if (!route) return;
    route.opacity = Number(routeOpacityInput.value);
    routeOpacityVal.textContent = route.opacity;
    renderMapLayers();
    recordHistory(true);
  });

  // 状態・車線数・色・供用形態のフォームは、始点・終点・選んだ値のような「保留中の状態」を持たず、
  // いま選択中の点（selectedSet）と、いまの路線のデータから、毎回そのまま作り直す（v1.52.1-beta）。
  // そのため、路線を切り替えても、別の路線の点番号が残って誤って適用される心配がない
  // （v1.50.1-betaで直した不具合は、保留中の状態を持っていたことが原因だったが、この設計変更で、そもそも起きなくなった）。
  const rangeModeBannerEl = document.getElementById("range-mode-banner");

  function renderRouteProps() {
    const route = getActiveRoute();
    if (!route) {
      routePropsEmptyEl.hidden = false;
      routePropsEl.hidden = true;
      rangeModeBannerEl.hidden = true;
      renderRangeSegmentsList();
      return;
    }
    routePropsEmptyEl.hidden = true;
    routePropsEl.hidden = false;

    routeNameInput.value = route.name;
    routeNameInput.title = route.name || ""; // 長い名前は入力欄で切れるので、全体はマウスオーバーで見られる
    routeOpacityInput.value = route.opacity;
    routeOpacityVal.textContent = route.opacity;
    renderLockControls(route);
    renderSidebarSummary(route);

    categoryPresetsEl.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.category === route.category);
    });

    // 状態・色・基本の車線数・供用形態は、2点以上（Ctrl+クリック）を選んでいる間、その区間だけの設定になる
    // （v1.53.0-beta。ユーザー指定。路線種別・透過は、常に路線全体の設定のまま）
    const range = currentRangeSelection();
    rangeModeBannerEl.hidden = !range;
    if (range) {
      rangeModeBannerEl.textContent = `点${range.fromIdx + 1}〜点${range.toIdx + 1} の区間を編集しています（種別・透過は、路線全体の設定のままです）`;
    }

    statusNoneBtn.hidden = !range;
    const statusSeg = range ? (route.statusSegments || []).find((s) => s.fromIdx === range.fromIdx && s.toIdx === range.toIdx) : null;
    statusPresetsEl.querySelectorAll("button").forEach((btn) => {
      const val = btn.dataset.status;
      if (val === "") return; // statusNoneBtn 自身（active切替は下で行う）
      btn.classList.toggle("active", range ? val === (statusSeg ? statusSeg.status : " ") : val === route.status);
    });
    statusNoneBtn.classList.toggle("active", !!range && !statusSeg);

    lanesNoneBtn.hidden = !range;
    const laneSeg = range ? route.laneSegments.find((s) => s.fromIdx === range.fromIdx && s.toIdx === range.toIdx) : null;
    lanesSegmentedEl.querySelectorAll("button").forEach((btn) => {
      if (btn.dataset.lanes === "") return; // lanesNoneBtn 自身
      const n = Number(btn.dataset.lanes);
      btn.classList.toggle("active", range ? !!laneSeg && n === nearestValidLanes(laneSeg.lanes) : n === nearestValidLanes(route.lanes));
    });
    lanesNoneBtn.classList.toggle("active", !!range && !laneSeg);

    renderProvisionalControls(route, range);

    // 色: 区間モードのときは、その区間の色（設定済みならその色、なければ路線全体の色）を表示する
    const colorSeg = range ? (route.colorSegments || []).find((s) => s.fromIdx === range.fromIdx && s.toIdx === range.toIdx) : null;
    routeColorInput.value = colorSeg ? colorSeg.color : route.color;

    renderRangeSegmentsList();
  }

  // ---------------------------------------------------------------------
  // サイドバー: 点・施設設定（旧「点」タブ。v1.51.0-beta で「設定」タブに統合、v1.53.2-beta でさらにサイドバー本体に統合した）
  // ---------------------------------------------------------------------
  const facilitySettingsSectionEl = document.getElementById("facility-settings-section");
  const facilitySettingsHintEl = document.getElementById("facility-settings-hint");
  const icTypeSelect = document.getElementById("ic-type");
  const icNameInput = document.getElementById("ic-name");
  const icShapeFieldEl = document.getElementById("ic-shape-field");
  const icShapePickerEl = document.getElementById("ic-shape-picker");

  Object.entries(IC_TYPES).forEach(([key, def]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = def.label;
    icTypeSelect.appendChild(opt);
  });

  // 「その他」施設で選ぶ図形。選択中の値は、施設設定を表示するたびに、選択点の設定に合わせて作り直す
  let pendingOtherShape = OTHER_SHAPES[0].key;
  OTHER_SHAPES.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.shape = s.key;
    btn.textContent = s.label;
    btn.addEventListener("click", () => {
      pendingOtherShape = s.key;
      updateIcShapePicker();
    });
    icShapePickerEl.appendChild(btn);
  });
  function updateIcShapePicker() {
    icShapeFieldEl.hidden = icTypeSelect.value !== "other";
    icShapePickerEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.shape === pendingOtherShape));
  }
  icTypeSelect.addEventListener("change", updateIcShapePicker);

  // 1点を削除し、IC・区間別車線数のインデックスを詰める。
  function deletePointAt(route, idx) {
    route.points.splice(idx, 1);
    route.ics = route.ics
      .filter((ic) => ic.pointIndex !== idx)
      .map((ic) => ({ ...ic, pointIndex: ic.pointIndex > idx ? ic.pointIndex - 1 : ic.pointIndex }));
    const fixSegments = (list) =>
      (list || [])
        .map((seg) => ({
          ...seg,
          fromIdx: idx < seg.fromIdx ? seg.fromIdx - 1 : seg.fromIdx,
          toIdx: idx <= seg.toIdx ? seg.toIdx - 1 : seg.toIdx,
        }))
        .filter((seg) => seg.fromIdx >= 0 && seg.fromIdx < seg.toIdx);
    route.laneSegments = fixSegments(route.laneSegments);
    route.statusSegments = fixSegments(route.statusSegments);
    route.colorSegments = fixSegments(route.colorSegments);
    route.provisionalSegments = fixSegments(route.provisionalSegments);
  }

  // 選択中の点（複数選択可。未選択なら末尾点）をまとめて削除する。
  function deleteSelectedPoints() {
    const route = getActiveRoute();
    if (!route || route.points.length === 0) return;
    const targets = targetIndices(route).sort((a, b) => b - a);
    const deletable = targets.filter((idx) => !isLockedIdx(route, idx));
    if (deletable.length < targets.length) {
      toast(
        deletable.length === 0
          ? "ロック中の点は削除できません"
          : "ロック中の点は削除せず、それ以外の点を削除しました",
        deletable.length === 0 ? "error" : undefined
      );
    }
    if (deletable.length === 0) return;
    deletable.forEach((idx) => deletePointAt(route, idx));
    clearSelection();
    render();
  }

  document.getElementById("btn-clear-selection").addEventListener("click", () => {
    clearSelection();
    render();
  });

  document.getElementById("btn-set-ic").addEventListener("click", () => {
    const route = getActiveRoute();
    if (!route || route.points.length === 0) return;
    const type = icTypeSelect.value;
    const name = icNameInput.value.trim();
    const shape = type === "other" ? pendingOtherShape : undefined;
    targetIndices(route).forEach((idx) => {
      const existing = route.ics.find((ic) => ic.pointIndex === idx);
      if (existing) {
        existing.type = type;
        existing.name = name;
        if (shape) existing.shape = shape;
        else delete existing.shape;
      } else {
        const ic = { pointIndex: idx, type, name, labelVisible: true };
        if (shape) ic.shape = shape;
        route.ics.push(ic);
      }
    });
    render();
  });

  document.getElementById("btn-unset-ic").addEventListener("click", () => {
    const route = getActiveRoute();
    if (!route) return;
    const targets = targetIndices(route);
    route.ics = route.ics.filter((ic) => !targets.includes(ic.pointIndex));
    render();
  });

  // ---------------------------------------------------------------------
  // サイドバー: 区間ごとの設定一覧（車線数・状態・色・供用形態）。
  // v1.52.1-beta で、Ctrl+クリックで選んだ点（最小・最大の2点）を区間にする方式にした。
  // v1.53.0-beta で、専用の選択欄をやめ、路線全体の設定（状態・色・車線数・供用形態）を、
  // 区間を選んでいる間はその区間の設定として使うようにした（ユーザー指定。各フィールドの
  // クリックハンドラは、それぞれの定義箇所〔applyStatusValue 等〕にある）。ここには、
  // 登録済みの区間の一覧と削除ボタンだけを置く。
  // ---------------------------------------------------------------------
  // いま選択中の点（selectedSet）から、区間の [fromIdx, toIdx] を求める。2点未満なら null。
  function currentRangeSelection() {
    if (selectedSet.size < 2) return null;
    const sorted = Array.from(selectedSet).sort((a, b) => a - b);
    const fromIdx = sorted[0];
    const toIdx = sorted[sorted.length - 1];
    return fromIdx === toIdx ? null : { fromIdx, toIdx };
  }

  function renderRangeSegmentsList() {
    const route = getActiveRoute();
    const list = document.getElementById("range-segments-list");
    list.innerHTML = "";
    if (!route) return;
    // 区間別の車線数・状態・色・供用形態を、区間（fromIdx〜toIdx）が同じものどうしでまとめて、1行に表示する
    // （別々に登録されていても、両端が同じなら1行にする）。
    const rows = new Map();
    const rowOf = (fromIdx, toIdx) => {
      const key = `${fromIdx}-${toIdx}`;
      if (!rows.has(key))
        rows.set(key, {
          fromIdx,
          toIdx,
          laneId: null,
          laneText: null,
          statusId: null,
          statusText: null,
          colorId: null,
          color: null,
          provId: null,
          provText: null,
        });
      return rows.get(key);
    };
    route.laneSegments.forEach((seg) => {
      const row = rowOf(seg.fromIdx, seg.toIdx);
      row.laneId = seg.id;
      row.laneText = `${seg.lanes}車線`;
    });
    (route.statusSegments || []).forEach((seg) => {
      const row = rowOf(seg.fromIdx, seg.toIdx);
      row.statusId = seg.id;
      row.statusText = (STATUSES[seg.status] || STATUSES.inservice).label;
    });
    (route.colorSegments || []).forEach((seg) => {
      const row = rowOf(seg.fromIdx, seg.toIdx);
      row.colorId = seg.id;
      row.color = seg.color;
    });
    (route.provisionalSegments || []).forEach((seg) => {
      const row = rowOf(seg.fromIdx, seg.toIdx);
      row.provId = seg.id;
      row.provText = seg.provisional ? "暫定形" : "完成形";
    });
    const items = Array.from(rows.values()).sort((a, b) => a.fromIdx - b.fromIdx || a.toIdx - b.toIdx);
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-msg">区間ごとの設定は未設定です</div>';
      return;
    }
    // 区間の両端は、施設（IC・JCTなど）があればその名前、なければ「点N」で表す（地図上に点の番号は出ないため）
    const endLabel = (idx) => {
      const ic = route.ics.find((x) => x.pointIndex === idx);
      return ic && ic.name ? ic.name : `点${idx + 1}`;
    };
    items.forEach((item) => {
      const text = [item.laneText, item.statusText, item.provText, item.color ? "色" : null].filter(Boolean).join("・");
      const swatch = item.color ? `<span class="range-segment-swatch" style="background:${escapeHtml(item.color)}"></span>` : "";
      const div = document.createElement("div");
      div.className = "list-item";
      div.title = `点${item.fromIdx + 1}〜点${item.toIdx + 1}`;
      div.innerHTML = `<span class="name">${swatch}${escapeHtml(endLabel(item.fromIdx))}〜${escapeHtml(endLabel(item.toIdx))}: ${escapeHtml(text)}</span>`;
      const delBtn = document.createElement("button");
      delBtn.className = "btn small danger-outline";
      delBtn.title = "この区間を削除";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (item.laneId) route.laneSegments = route.laneSegments.filter((s) => s.id !== item.laneId);
        if (item.statusId) route.statusSegments = (route.statusSegments || []).filter((s) => s.id !== item.statusId);
        if (item.colorId) route.colorSegments = (route.colorSegments || []).filter((s) => s.id !== item.colorId);
        if (item.provId) route.provisionalSegments = (route.provisionalSegments || []).filter((s) => s.id !== item.provId);
        render();
      });
      const actions = document.createElement("span");
      actions.className = "row-actions";
      actions.appendChild(delBtn);
      div.appendChild(actions);
      list.appendChild(div);
    });
  }

  // サイドバーの「施設設定」欄（旧「点」タブ・旧「IC・JCTを設定」）。
  // v1.51.0-beta で、右クリックメニューを廃止し、点を選んでいるときだけ、常設のタブに表示するように変更した。
  function renderFacilitySettings() {
    const route = getActiveRoute();
    if (!route || selectedSet.size === 0) {
      facilitySettingsSectionEl.hidden = true;
      return;
    }
    facilitySettingsSectionEl.hidden = false;

    if (selectedSet.size > 1) {
      const nums = Array.from(selectedSet).sort((a, b) => a - b).map((i) => i + 1).join("、");
      facilitySettingsHintEl.textContent = `${selectedSet.size}点を選択中（点${nums}）。設定は選択中の点すべてに適用されます`;
    } else {
      facilitySettingsHintEl.textContent =
        `選択中の点: ${selectedPointIndex + 1} / ${route.points.length}` +
        (isLockedIdx(route, selectedPointIndex) ? "。ロック中のため移動・削除できません" : "");
    }

    // 選択中の点に既にIC/JCTが設定されていれば、編集しやすいようフォームに反映する。
    const targetIdx = selectedPointIndex !== null ? selectedPointIndex : route.points.length - 1;
    const existingIc = route.ics.find((ic) => ic.pointIndex === targetIdx);
    icTypeSelect.value = existingIc ? existingIc.type : "ic";
    icNameInput.value = existingIc ? existingIc.name || "" : "";
    pendingOtherShape = existingIc && existingIc.type === "other" ? otherShapeOf(existingIc) : OTHER_SHAPES[0].key;
    updateIcShapePicker();
  }

  // ---------------------------------------------------------------------
  // モード切替（編集モード / 路線図モード）
  // ---------------------------------------------------------------------
  const modeTabEdit = document.getElementById("mode-tab-edit");
  const modeTabDiagram = document.getElementById("mode-tab-diagram");
  const mapEl = document.getElementById("map");
  const diagramAreaEl = document.getElementById("diagram-area");

  function setMode(mode) {
    currentMode = mode;
    modeTabEdit.classList.toggle("active", mode === "edit");
    modeTabDiagram.classList.toggle("active", mode === "diagram");
    modeTabEdit.setAttribute("aria-selected", String(mode === "edit"));
    modeTabDiagram.setAttribute("aria-selected", String(mode === "diagram"));
    mapEl.hidden = mode !== "edit";
    diagramAreaEl.hidden = mode !== "diagram";
    if (mode === "edit") {
      // 路線図表示中は地図が非表示になっており、Leafletがサイズ変更を検知
      // できていないため、再表示時にサイズを再計算させる。
      setTimeout(() => map.invalidateSize(), 0);
    } else {
      lastDiagramActiveId = null; // 路線図を開いたときは、選択中の路線の図へスクロールする
      renderRouteDiagram();
      if (phoneQuery.matches) setSheetOpen(false); // スマホでは、図を広く見られるよう、シートを閉じる
    }
    render();
  }

  modeTabEdit.addEventListener("click", () => setMode("edit"));
  modeTabDiagram.addEventListener("click", () => setMode("diagram"));

  // ---------------------------------------------------------------------
  // 狭い画面（スマホ。幅760px以下）: サイドバーは、画面の下から出るシートになる。
  // 開閉は、シートの上端のボタン（#sheet-toggle）。広い画面では、このボタンは出ず、開閉の状態も見た目に影響しない
  // ---------------------------------------------------------------------
  const appEl = document.getElementById("app");
  const sheetToggleEl = document.getElementById("sheet-toggle");
  const sheetToggleLabelEl = document.getElementById("sheet-toggle-label");
  const phoneQuery = window.matchMedia("(max-width: 760px)");
  function setSheetOpen(open) {
    appEl.classList.toggle("sheet-open", open);
    sheetToggleEl.setAttribute("aria-expanded", String(open));
    sheetToggleLabelEl.textContent = open ? "設定を閉じる" : "設定を開く";
  }
  sheetToggleEl.addEventListener("click", () => {
    const opening = !appEl.classList.contains("sheet-open");
    setSheetOpen(opening);
    if (opening) keepSelectionAboveSheet(); // 選んでいる点が、開いたシートに隠れないよう地図を動かす
  });
  // シートが開くと、下のほうの地図が隠れる。選んでいる点が隠れたら、見える所まで地図を動かす
  function keepSelectionAboveSheet() {
    setTimeout(() => {
      const route = getActiveRoute();
      if (!route || selectedPointIndex == null || !route.points[selectedPointIndex]) return;
      const ll = route.points[selectedPointIndex];
      const y = map.latLngToContainerPoint(ll).y;
      const visibleBottom = document.getElementById("sidebar").getBoundingClientRect().top - mapEl.getBoundingClientRect().top;
      const margin = 48;
      if (y > visibleBottom - margin) map.panBy([0, y - visibleBottom / 2], { animate: false });
    }, 50); // シートの高さが変わったあとに測る
  }

  // ---------------------------------------------------------------------
  // サイドバーのタブ（横向きの下線タブ。一度に、選んだタブの内容だけを表示する）
  //  編集モード: 路線／設定（見た目・車線・区間別の設定・施設設定をまとめたタブ。v1.51.0-beta で統合）
  //  路線図モード: 路線／施設
  //  路線を選んでいないときは「路線」だけを表示する。
  // ---------------------------------------------------------------------
  function visibleSidebarTabs(route) {
    if (!route) return ["route"];
    if (currentMode === "diagram") return ["route", "facility"];
    return ["route"]; // 編集モードは、v1.53.2-betaで「路線」「設定」タブを1つに統合した（タブが1つだけなので帯ごと出さない）
  }
  const sidebarTabsEl = document.getElementById("sidebar-tabs");
  const sidebarSummaryEl = document.getElementById("sidebar-summary");
  const routeDetailPanelEl = document.getElementById("route-detail-panel");
  const routeSettingsEl = document.getElementById("route-settings");

  function renderSidebarTabs() {
    const route = getActiveRoute();
    const tabs = visibleSidebarTabs(route);
    if (!tabs.includes(sidebarTab)) sidebarTab = "route";
    // タブが「路線」の1つだけのとき（路線がまだないとき）は、タブの帯ごと出さない
    document.getElementById("sidebar-head").hidden = tabs.length <= 1;
    sidebarTabsEl.querySelectorAll(".sidebar-tab").forEach((btn) => {
      const on = btn.dataset.tab === sidebarTab;
      btn.hidden = !tabs.includes(btn.dataset.tab);
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
      btn.id = "sidebar-tab-" + btn.dataset.tab;
      btn.setAttribute("aria-controls", "sidebar-pane-" + btn.dataset.tab);
      btn.tabIndex = on ? 0 : -1; // 矢印キーで移る（タブの並びの中では、選んでいるタブだけがTabキーの対象）
    });
    document.querySelectorAll("#sidebar .tab-pane").forEach((pane) => {
      pane.hidden = pane.dataset.pane !== sidebarTab;
      pane.id = "sidebar-pane-" + pane.dataset.pane;
      pane.setAttribute("role", "tabpanel");
      pane.setAttribute("aria-labelledby", "sidebar-tab-" + pane.dataset.pane);
    });
    routeDetailPanelEl.hidden = currentMode !== "edit" || !route; // 路線の名前・向き反転・削除・終点の状態は、編集モードで路線を選んでいるときだけ
    routeSettingsEl.hidden = currentMode !== "edit" || !route; // 見た目・車線・区間別の設定・施設設定も同様
    sidebarSummaryEl.hidden = !(route && currentMode === "edit");
  }

  // 矢印キー（← →、Home、End）で、タブを移る。移った先のタブを開く
  function enableTabKeys(tablistEl, tabSelector) {
    tablistEl.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      const tabs = Array.from(tablistEl.querySelectorAll(tabSelector)).filter((b) => !b.hidden);
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      const target = tablistEl.querySelector(tabSelector + '[aria-selected="true"]');
      if (target) target.focus();
    });
  }
  enableTabKeys(sidebarTabsEl, ".sidebar-tab");
  enableTabKeys(document.querySelector(".mode-tabs"), ".mode-tab");

  sidebarTabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".sidebar-tab");
    if (!btn || btn.hidden) return;
    sidebarTab = btn.dataset.tab;
    render();
  });

  // ---------------------------------------------------------------------
  // 路線図（模式図）モード
  // ---------------------------------------------------------------------
  const diagramEmptyEl = document.getElementById("diagram-empty");
  const routeDiagramEl = document.getElementById("route-diagram");

  // 施設番号を付けるのは、IC と JCT だけ（SA・PA、本線料金所、一般道の出入口には付けない）。
  // IC・JCT の設定: 未設定は「自動」。ほかの種類は、保存データに numMode が残っていても「表記しない」として扱う。
  function isNumberedType(ic) {
    return ic.type === "ic" || ic.type === "jct";
  }

  function facNumMode(ic) {
    return isNumberedType(ic) ? ic.numMode || "auto" : "none";
  }

  // 路線図に載せる路線（点が2つ以上ある選択中の路線）
  function diagramRoutesOf(route) {
    return route.points.length >= 2 ? [route] : [];
  }

  // 路線図（と「施設」タブ）の施設の並びと、施設番号・始点からの距離。
  // 施設番号: IC・JCT のうち「自動」のものだけに、始点からの並び順で 1, 2, 3… と通し番号を振る（「手動」「表記しない」の
  // ものは、自動の連番を消費しない。SA・PA・本線料金所・出入口は、番号を付けないので連番を消費しない）。「手動」は入力した文字
  // （例: 9-1）をそのまま表示する。
  // 戻り値: { entries: 並び順の[{route,ic,dist,displayNo}]、totalDist }
  function buildDiagramData(routes) {
    let offset = 0;
    const entries = [];
    routes.forEach((r) => {
      const cum = [0];
      for (let i = 1; i < r.points.length; i++) cum.push(cum[i - 1] + distanceMeters(r.points[i - 1], r.points[i]));
      r.ics
        .slice()
        .sort((a, b) => a.pointIndex - b.pointIndex)
        .forEach((ic) => entries.push({ route: r, ic, dist: offset + cum[ic.pointIndex], displayNo: "" }));
      offset += cum[cum.length - 1];
    });
    let autoNo = 0;
    entries.forEach((e) => {
      const mode = facNumMode(e.ic);
      if (mode === "auto") e.displayNo = String(++autoNo);
      else if (mode === "custom") e.displayNo = (e.ic.numText || "").trim();
    });
    return { entries, totalDist: offset };
  }

  // 路線図モードのサイドバーの「施設」タブ（施設の表示設定）。施設ごとに、施設番号（自動／手動／表記しない）と、
  // 地図上の名称ラベルの常時表示を設定する。編集のサイドバーを長くしないため、編集ではなくここで行う。
  const facilityListEl = document.getElementById("facility-list");

  function renderFacilityList() {
    const route = getActiveRoute();
    facilityListEl.innerHTML = "";
    if (currentMode !== "diagram" || !route) return;
    const routes = diagramRoutesOf(route);
    const data = buildDiagramData(routes);
    // 路線図には全路線が出るが、施設の設定は選択中の路線だけが対象。混同しないよう、対象の路線を示す
    const scope = document.createElement("p");
    scope.className = "facility-scope";
    scope.innerHTML = `対象の路線: <b>${escapeHtml(routeLabel(route))}</b><br>他の路線の施設は、路線図の見出しをクリックして、その路線を選ぶと設定できます`;
    facilityListEl.appendChild(scope);
    if (data.entries.length === 0) {
      facilityListEl.insertAdjacentHTML("beforeend", '<div class="empty-msg">施設（IC・JCT・SA/PAなど）が未設定です。編集モードで点を選ぶと開く「施設設定」で設定してください</div>');
      return;
    }
    data.entries.forEach((fac) => {
      const ic = fac.ic;
      const def = IC_TYPES[ic.type] || IC_TYPES.ic;
      const mode = facNumMode(ic);
      const numbered = isNumberedType(ic);
      const item = document.createElement("div");
      item.className = "facility-item";
      item.innerHTML =
        `<div class="facility-head"><span class="facility-no${fac.displayNo ? "" : " none"}">${escapeHtml(fac.displayNo || "―")}</span>` +
        `<span class="facility-name">${escapeHtml(ic.name || "(無名)")}</span><span class="muted">${escapeHtml(def.label.replace(/（.*$/, ""))}</span></div>` +
        (numbered
          ? `<div class="facility-controls">` +
            `<select class="fac-num-mode" aria-label="施設番号">` +
            `<option value="auto"${mode === "auto" ? " selected" : ""}>番号: 自動</option>` +
            `<option value="custom"${mode === "custom" ? " selected" : ""}>番号: 手動入力</option>` +
            `<option value="none"${mode === "none" ? " selected" : ""}>番号: 表記しない</option></select>` +
            `<input type="text" class="fac-num-text" maxlength="6" placeholder="例: 9-1" value="${escapeHtml(ic.numText || "")}"${mode === "custom" ? "" : " hidden"}>` +
            `</div>`
          : '<p class="hint-text">番号を付けるのは、IC・JCTだけです（この種類には付きません）</p>') +
        `<div class="facility-controls">` +
        `<label class="checkbox-field"><input type="checkbox" class="fac-label"${ic.labelVisible ? " checked" : ""}> 地図に名称を常時表示</label>` +
        `<button type="button" class="btn ghost small fac-goto" title="編集モードに切り替えて、この施設の点を選びます">地図で選択</button>` +
        `</div>`;
      const noEl = item.querySelector(".facility-no");
      if (numbered) {
        item.querySelector(".fac-num-mode").addEventListener("change", (e) => {
          ic.numMode = e.target.value;
          render();
        });
        item.querySelector(".fac-num-text").addEventListener("input", (e) => {
          ic.numText = e.target.value.trim();
          renderRouteDiagram();
          const now = buildDiagramData(diagramRoutesOf(getActiveRoute())).entries.find((x) => x.ic === ic);
          noEl.textContent = (now && now.displayNo) || "―";
          noEl.classList.toggle("none", !(now && now.displayNo));
          recordHistory(true);
        });
      }
      item.querySelector(".fac-label").addEventListener("change", (e) => {
        ic.labelVisible = e.target.checked;
        render();
      });
      item.querySelector(".fac-goto").addEventListener("click", () => {
        setMode("edit");
        selectOnly(ic.pointIndex);
        sidebarTab = "route"; // 施設設定は、点を選ぶとサイドバーに自動で表示される
        const pt = fac.route.points[ic.pointIndex];
        if (pt) map.panTo([pt.lat, pt.lng]);
        render();
      });
      facilityListEl.appendChild(item);
    });
  }

  // 路線名から、末尾の（…）を除いた短い名前（例: 東九州自動車道（北九州JCT〜加治木JCT） → 東九州自動車道）
  function shortRouteName(r) {
    return routeLabel(r).replace(/[（(][^）)]*[）)]\s*$/, "").trim() || routeLabel(r);
  }

  // 路線図: いま開いている地図の全路線を表示する（v1.29.0。従来は選択中の1路線だけ）。
  // JCTで分岐している路線は、本線の横の列に並べて反映し（分岐の分岐も、右へ列を足していく）、
  // 分岐していない（独立した）路線は、独立した図として横に並べる。選択中の路線を含む図は強調し、選択を変えたら画面内へスクロールする。
  let lastDiagramActiveId = null;

  // 分岐する路線の列の見出しの高さ（路線名が長くて折り返すと、1行のときより高くなる）。
  // 描いたあとに実際の高さを測り、足りなければ、この値を直して描き直す（路線のid → px）
  const branchHeadPx = { v: {}, h: {} }; // 向き（縦・横）ごとに持つ（見出しの幅が違うため）

  // 路線図の向き: "v"（縦。始点が上、終点が下）／ "h"（横。始点が左、終点が右）。v1.43.0。選んだ向きは、ブラウザに覚えておく
  const DIAGRAM_ORIENT_KEY = "koukikaku_road_tool_diagram_orient";
  let diagramOrient = "v";
  try {
    if (localStorage.getItem(DIAGRAM_ORIENT_KEY) === "h") diagramOrient = "h";
  } catch (e) {
    /* 読めなくても、縦向きで動く */
  }

  // 路線図の拡大・縮小・移動（v1.42.0）。拡大・縮小は #route-diagram の transform: scale() で行い、
  // 外側の #route-diagram-wrap に、（図の大きさ × 倍率）を指定する（そうすると、領域のスクロールが、拡大後の大きさに合う）。
  // 移動は、領域（#diagram-area）のスクロール位置を、ドラッグで動かす。
  const diagramWrapEl = document.getElementById("route-diagram-wrap");
  const diagramZoomAnchorEl = document.getElementById("diagram-zoom-anchor");
  const DIAGRAM_SCALE_MIN = 0.2;
  const DIAGRAM_SCALE_MAX = 2.5;
  let diagramScale = 1;

  function applyDiagramZoom() {
    const w = routeDiagramEl.offsetWidth; // 拡大前の大きさ（transform の影響を受けない）
    const h = routeDiagramEl.offsetHeight;
    routeDiagramEl.style.transform = diagramScale === 1 ? "" : `scale(${diagramScale})`;
    diagramWrapEl.style.width = Math.ceil(w * diagramScale) + "px";
    diagramWrapEl.style.height = Math.ceil(h * diagramScale) + "px";
  }

  // 倍率を変える。(clientX, clientY) の下にある図の位置を、動かさない（省略時は、領域の中央）
  function setDiagramScale(next, clientX, clientY) {
    next = Math.min(DIAGRAM_SCALE_MAX, Math.max(DIAGRAM_SCALE_MIN, next));
    if (Math.abs(next - diagramScale) < 0.0005) return;
    const a = diagramAreaEl.getBoundingClientRect();
    const ax = (clientX != null ? clientX : a.left + a.width / 2) - a.left;
    const ay = (clientY != null ? clientY : a.top + a.height / 2) - a.top;
    const before = diagramScale;
    const px = (diagramAreaEl.scrollLeft + ax - diagramWrapEl.offsetLeft) / before; // 図の中の位置（拡大前の大きさで）
    const py = (diagramAreaEl.scrollTop + ay - diagramWrapEl.offsetTop) / before;
    diagramScale = next;
    applyDiagramZoom();
    diagramAreaEl.scrollLeft = px * next + diagramWrapEl.offsetLeft - ax;
    diagramAreaEl.scrollTop = py * next + diagramWrapEl.offsetTop - ay;
  }

  // 図の全体が、領域に入る大きさにする
  function fitDiagram() {
    const w = routeDiagramEl.offsetWidth;
    const h = routeDiagramEl.offsetHeight;
    if (!w || !h) return;
    diagramScale = Math.min(DIAGRAM_SCALE_MAX, Math.max(DIAGRAM_SCALE_MIN, Math.min((diagramAreaEl.clientWidth - 16) / w, (diagramAreaEl.clientHeight - 16) / h)));
    applyDiagramZoom();
    diagramAreaEl.scrollLeft = 0;
    diagramAreaEl.scrollTop = 0;
  }

  document.getElementById("btn-diagram-zoom-in").addEventListener("click", () => setDiagramScale(diagramScale * 1.25));
  document.getElementById("btn-diagram-zoom-out").addEventListener("click", () => setDiagramScale(diagramScale / 1.25));
  document.getElementById("btn-diagram-zoom-fit").addEventListener("click", fitDiagram);
  document.getElementById("btn-diagram-orient").addEventListener("click", () => {
    diagramOrient = diagramOrient === "v" ? "h" : "v";
    try {
      localStorage.setItem(DIAGRAM_ORIENT_KEY, diagramOrient);
    } catch (e) {
      /* 保存できなくても、この画面では切り替わる */
    }
    lastDiagramActiveId = null; // 向きを変えたら、選択中の路線へ、あらためてスクロールする
    renderRouteDiagram();
    diagramAreaEl.scrollLeft = 0;
    diagramAreaEl.scrollTop = 0;
    scrollDiagramToRoute(activeRouteId);
  });

  // Ctrl（Macは Command）+ホイール、トラックパッドのピンチ: カーソルの位置を中心に拡大・縮小
  diagramAreaEl.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return; // ふつうのホイールは、スクロール
      e.preventDefault();
      setDiagramScale(diagramScale * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    },
    { passive: false }
  );

  // ドラッグで移動（マウス・ペン・指）、指2本のピンチで拡大・縮小
  (function enableDiagramPanZoom() {
    const pointers = new Map(); // pointerId → { x, y }
    let pan = null; // { x, y, left, top, moved }
    let pinch = null; // { dist, scale }
    let suppressClick = false;
    const interactive = (el) => !!el.closest("button, a, input, select, .diagram-select");
    const distance = () => {
      const [p, q] = [...pointers.values()];
      return Math.hypot(p.x - q.x, p.y - q.y);
    };

    diagramAreaEl.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && (e.button !== 0 || interactive(e.target))) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        pan = { x: e.clientX, y: e.clientY, left: diagramAreaEl.scrollLeft, top: diagramAreaEl.scrollTop, moved: false };
        if (e.pointerType === "mouse") e.preventDefault(); // 文字の選択を始めない
      } else if (pointers.size === 2) {
        pan = null;
        pinch = { dist: distance() || 1, scale: diagramScale };
      }
    });
    diagramAreaEl.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [p, q] = [...pointers.values()];
        setDiagramScale(pinch.scale * (distance() / pinch.dist), (p.x + q.x) / 2, (p.y + q.y) / 2);
        suppressClick = true;
      } else if (pan) {
        const dx = e.clientX - pan.x;
        const dy = e.clientY - pan.y;
        if (!pan.moved && Math.hypot(dx, dy) > 4) {
          pan.moved = true;
          diagramAreaEl.classList.add("panning");
          try {
            diagramAreaEl.setPointerCapture(e.pointerId); // 動かし始めてから捕まえる（押しただけのときは、ボタンのクリックを邪魔しない）
          } catch (err) {
            /* 捕まえられなくても、移動はできる */
          }
        }
        if (pan.moved) {
          diagramAreaEl.scrollLeft = pan.left - dx;
          diagramAreaEl.scrollTop = pan.top - dy;
        }
      }
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        if ((pan && pan.moved) || suppressClick) {
          suppressClick = true; // 動かしたあとの、ボタン・見出しへのクリックは、無視する
          setTimeout(() => (suppressClick = false), 80);
        }
        pan = null;
        diagramAreaEl.classList.remove("panning");
      }
    };
    diagramAreaEl.addEventListener("pointerup", end);
    diagramAreaEl.addEventListener("pointercancel", end);
    diagramAreaEl.addEventListener(
      "click",
      (e) => {
        if (!suppressClick) return;
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );
  })();

  // 路線図の道路の太さ（px）。地図と同じく車線数に比例する（1車線あたり、地図の1.25倍）
  const DIAGRAM_LANE_PX = 5;
  const diagramLineWidth = (lanes) => nearestValidLanes(lanes) * DIAGRAM_LANE_PX;

  // 道路の上に重ねる、車線の区分線と、暫定の枠（地図と同じ。区分線の仕様は laneDividerSpecs() を使う）。
  // 道路（w px の太さ）の要素の中に置く。alongX=true: 道路が横向き（横向きの図の線、縦向きの図の分岐の線）
  function diagramLaneDecorHtml(lanes, provisional, w, alongX) {
    lanes = nearestValidLanes(lanes);
    if (lanes < 2) return "";
    const specs = laneDividerSpecs(lanes, w, provisional);
    const dash = (color, on, off) => `repeating-linear-gradient(${alongX ? "to right" : "to bottom"},${color} 0 ${on}px,transparent ${on}px ${on + off}px)`;
    const bar = (offset, thick, bg) =>
      alongX
        ? `<i class="diagram-lane-line" style="left:0;right:0;top:${w / 2 + offset - thick / 2}px;height:${thick}px;background:${bg};"></i>`
        : `<i class="diagram-lane-line" style="top:0;bottom:0;left:${w / 2 + offset - thick / 2}px;width:${thick}px;background:${bg};"></i>`;
    let html = specs.dividers.map((d) => bar(d.offset, d.weight, d.dashArray ? dash(d.color, 8, 8) : d.color)).join("");
    if (provisional) {
      const half = ((lanes + 2) * DIAGRAM_LANE_PX) / 2; // 将来の幅（現在＋2車線）の、点線の枠
      html += [-half, half].map((o) => bar(o, 1.5, dash("var(--diagram-color, #1565c0)", 4, 4))).join("");
    }
    return html;
  }
  // 分岐の線（本線から分岐する路線の始点側へつなぐ線）。本線からなめらかに離れ（円弧）、直線で進み、円弧で分岐する路線の線へつながる。
  // 縦向きの図の座標で作る（x0: 本線の線の中心、x1: 分岐する路線の線の中心、yj: 分岐の線の位置、R: 角の丸みの半径）。
  // swap=true のときは、x と y を入れ替える（横向きの図。本線が横の線、分岐する路線が下の行）。
  // 区分線・暫定の枠は、線の中心から o だけずらした線で、円弧の半径は R±o になる
  function diagramConnectorSvg(c, x0, x1, yj, R, swap) {
    const P = (x, y) => (swap ? `${y} ${x}` : `${x} ${y}`);
    const pathD = (o) => {
      const r1 = R + o;
      const r2 = R - o;
      return `M${P(x0 - o, yj - R)}A${r1} ${r1} 0 0 ${swap ? 1 : 0} ${P(x0 + R, yj + o)}L${P(x1 - R, yj + o)}A${r2} ${r2} 0 0 ${swap ? 0 : 1} ${P(x1 - o, yj + R)}`;
    };
    const stroke = (o, width, color, dash) => `<path d="${pathD(o)}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
    let html = stroke(0, c.width, c.color, c.status === "construction" ? "11,6" : c.status === "planned" ? "4,7" : null);
    if (c.status === "inservice" && c.lanes >= 2) {
      const specs = laneDividerSpecs(c.lanes, c.width, c.prov);
      html += specs.dividers.map((d) => stroke(d.offset, d.weight, d.color, d.dashArray)).join("");
      if (c.prov) {
        const half = ((c.lanes + 2) * DIAGRAM_LANE_PX) / 2;
        html += [-half, half].map((o) => stroke(o, 1.5, c.color, "4,4")).join("");
      }
    }
    return `<svg class="diagram-connector-svg" aria-hidden="true">${html}</svg>`;
  }

  // 路線図に出す、状態のバッジ（供用中は出さない。事業中・計画中だけ）
  const STATUS_SHORT = { construction: "事業中", planned: "計画中" };
  const STATUS_NAME = { inservice: "供用中", construction: "事業中", planned: "計画中" };

  // 路線の状態の一覧（基本の状態と、区間別の状態のうち、実際に使われているもの。点の順）
  function routeStatuses(r) {
    const set = [];
    for (let k = 0; k < r.points.length - 1; k++) {
      const s = statusOfStep(r, k);
      if (!set.includes(s)) set.push(s);
    }
    if (set.length === 0) set.push(r.status || "inservice");
    return set;
  }
  // 状態のバッジ。全体が供用中なら出さない。一部だけ事業中・計画中のときは「一部事業中」など
  function statusBadgeHtml(r) {
    const set = routeStatuses(r);
    const other = set.filter((s) => STATUS_SHORT[s]);
    if (other.length === 0) return "";
    const partial = set.includes("inservice");
    const text = (partial ? "一部" : "") + other.map((s) => STATUS_SHORT[s]).join("・");
    return `<span class="diagram-status ${other[0]}">${text}</span>`;
  }
  // 見出しの下の1行に出す状態の文言（全体が同じ状態ならその名前、区間別に違うときは「供用中・事業中（区間別）」）
  function routeStatusText(r) {
    const set = routeStatuses(r);
    if (set.length === 1) return (STATUSES[set[0]] || STATUSES.inservice).label;
    return set.map((s) => STATUS_NAME[s] || s).join("・") + "（区間別）";
  }

  // 路線図に出す車線数（例: 暫定2車線 / 4車線）。区間別の車線数があるときは「・区間別あり」
  function diagramLaneText(r) {
    const lanes = nearestValidLanes(r.lanes);
    const prov = r.provisional && lanes >= 2;
    return (prov ? `暫定${lanes}車線` : `${lanes}車線`) + ((r.laneSegments || []).length ? "・区間別あり" : "");
  }

  // 施設 i〜j（点のインデックス）の間の車線数。すべて同じときだけ返す（途中で変わるときは null）
  function spanLanes(r, i, j) {
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const first = nearestValidLanes(laneOfStep(r, a));
    for (let k = a + 1; k < b; k++) if (nearestValidLanes(laneOfStep(r, k)) !== first) return null;
    return first;
  }

  function renderRouteDiagram(depth) {
    depth = depth || 0;
    const drawable = currentMap.routes.filter((r) => r.points.length >= 2); // 図にできるのは、点が2つ以上ある路線
    if (drawable.length === 0) {
      diagramEmptyEl.hidden = false;
      routeDiagramEl.hidden = true;
      diagramWrapEl.hidden = true;
      diagramZoomAnchorEl.hidden = true;
      routeDiagramEl.innerHTML = "";
      return;
    }
    diagramEmptyEl.hidden = true;
    routeDiagramEl.hidden = false;
    diagramWrapEl.hidden = false;
    diagramZoomAnchorEl.hidden = false;

    const colorOf = (r) => r.color || (CATEGORIES[r.category] && CATEGORIES[r.category].color) || "#1565c0";
    // 向き。縦: 路線の長さの向きが「上から下」、分岐する路線は右の列。横: 「左から右」、分岐する路線は下の行。
    // 以下の長さは、路線の長さの向き（主軸）の長さ。横向きは、施設の名前を線の下に横書きするので、施設どうしの間隔を広くとる
    const H = diagramOrient === "h";
    const headPxMap = branchHeadPx[diagramOrient];
    const trackPx = H ? 1200 : 770; // 全長を表す基準の長さ（px）。分岐する路線は、分岐元の路線と同じ縮尺（px/m）で描く
    const minGapPx = H ? 150 : 53; // ノード同士の最低間隔
    const PITCH = 470; // （縦）分岐する路線の列の間隔（px。本線の文字と、分岐する路線の番号の丸が近づきすぎないように）
    const BRANCH_ROOM = H ? 110 : 46; // 分岐する路線があるJCTの次のノードとの間に、分岐の線を通すために空ける余白（px）
    // JCTのノードの位置から、分岐の線を出す位置まで（px）。v1.55.0-betaで、JCTの記号のすぐそばから
    // 分岐するように縮めた（ユーザー指定。以前は90/76pxと、記号からかなり離れた位置から出ていた）
    const CONNECT_Y = H ? 30 : 26;
    const BRANCH_HEAD = H ? 60 : 34; // 分岐する路線の列（行）の端から、最初のノードまで（px。縦は、路線名の見出しの高さ）
    // 分岐の線の、角の丸みの半径（px）。細い道路は小さく（最小14px）、太い道路・暫定の枠は、内側の線が潰れないよう、半幅＋4pxにする
    const CORNER_MIN = 14;
    const cornerRadiusOf = (k) => {
      const step = k.branchFrom.at === "end" ? k.points.length - 2 : 0; // 分岐する路線の、分岐点側の区間
      const lanes = nearestValidLanes(laneOfStep(k, step));
      const prov = statusOfStep(k, step) === "inservice" && provisionalOfStep(k, step);
      const half = ((prov ? lanes + 2 : lanes) * DIAGRAM_LANE_PX) / 2;
      return Math.max(CORNER_MIN, half + 4);
    };
    const H_LINE = 52; // （横）行の、見出しの下から、線の中心まで（px。上に施設番号の丸が入る）
    const H_ROW_BODY = 158; // （横）行の、線の中心から下の高さ（施設の名前・種類・距離が入る）
    const H_ROW_GAP = 24; // （横）行と行の間（px）
    const H_HEAD_MIN = 48; // （横）分岐する路線の見出しの、最低の高さ

    // 分岐している路線すべて（点の数によらない。ノードの注記用）
    const branchesOf = (ic) => (ic.id ? currentMap.routes.filter((b) => b.branchFrom && b.branchFrom.icId === ic.id) : []);
    // 分岐元として図に描ける（分岐元の路線に点が2つ以上あり、分岐元のJCTがある）分岐
    const isDrawnBranch = (r) => {
      const bf = r.branchFrom;
      const trunk = bf ? routeById(bf.routeId) : null;
      return !!trunk && trunk.points.length >= 2 && !!icById(trunk, bf.icId);
    };

    // 「順接」（route.branchFrom.mode === "straight"）でつながった路線を、1本の路線であるかのように、
    // 同じ列（トラック）の続きとして描く（v1.55.0-beta。ユーザー指定）。
    // route の pointIndex 番目の施設から、順接している路線（1つだけ。setBranch() で1施設1本に制限している）
    const straightChildAt = (route, pointIndex) => {
      const ic = route.ics.find((x) => x.pointIndex === pointIndex);
      if (!ic || !ic.id) return null;
      return drawable.find((r) => r.branchFrom && r.branchFrom.mode === "straight" && r.branchFrom.routeId === route.id && r.branchFrom.icId === ic.id) || null;
    };
    // entryRoute を基準に、順接でつながる路線の並びを作る。要素は { route, dir }
    // （dir: true は始点→終点のまま、false は終点→始点の逆向きで読む）。
    // allowBackward のときだけ、entryRoute より前（entryRoute自身が誰かに順接している側）にも延ばす
    // （分岐で入ってきた列は、その分岐の接続点自体が「前」にあたるため、延ばさない）
    const buildStraightChain = (entryRoute, entryDir, allowBackward) => {
      const chain = [{ route: entryRoute, dir: entryDir }];
      for (;;) {
        const last = chain[chain.length - 1];
        const outIdx = last.dir ? last.route.points.length - 1 : 0;
        const child = straightChildAt(last.route, outIdx);
        if (!child || chain.some((c) => c.route === child)) break;
        chain.push({ route: child, dir: child.branchFrom.at === "start" });
      }
      if (allowBackward) {
        for (;;) {
          const first = chain[0];
          const bf = first.route.branchFrom;
          if (!bf || bf.mode !== "straight") break;
          const parent = routeById(bf.routeId);
          const icOnParent = parent && icById(parent, bf.icId);
          if (!parent || !icOnParent || chain.some((c) => c.route === parent)) break;
          chain.unshift({ route: parent, dir: icOnParent.pointIndex === parent.points.length - 1 });
        }
      }
      return chain;
    };
    // buildStraightChain() の並びから、通し距離・通し番号の施設一覧を作る（buildDiagramData() の、向き対応版）
    const buildChainDiagramData = (chain) => {
      let offset = 0;
      const entries = [];
      chain.forEach(({ route: cr, dir }) => {
        const n = cr.points.length;
        const cum = [0];
        for (let i = 1; i < n; i++) cum.push(cum[i - 1] + distanceMeters(cr.points[i - 1], cr.points[i]));
        const distAt = (pointIndex) => (dir ? cum[pointIndex] : cum[n - 1] - cum[pointIndex]);
        cr.ics
          .slice()
          .sort((a, b) => distAt(a.pointIndex) - distAt(b.pointIndex))
          .forEach((ic) => entries.push({ route: cr, ic, dist: offset + distAt(ic.pointIndex), displayNo: "" }));
        offset += cum[n - 1];
      });
      let autoNo = 0;
      entries.forEach((e) => {
        const mode = facNumMode(e.ic);
        if (mode === "auto") e.displayNo = String(++autoNo);
        else if (mode === "custom") e.displayNo = (e.ic.numText || "").trim();
      });
      return { entries, totalDist: offset };
    };

    // 1つのノード（施設）のHTML。distText は「始点から◯km」など
    const nodeHtml = (e, pos, distText, colorStyle) => {
      const ic = e.ic;
      const def = IC_TYPES[ic.type] || IC_TYPES.ic;
      // 「分岐」（順接は除く。順接は列を作らないので、テキストの案内は不要）
      const kids = branchesOf(ic).filter((b) => b.branchFrom.routeId === e.route.id && (b.branchFrom.mode || "branch") === "branch");
      const branchHtml = kids.length
        ? `<div class="diagram-node-branch">→ 分岐: ${kids
            .map((b) => `<button type="button" class="diagram-branch-link" data-route-id="${escapeHtml(b.id)}" title="${escapeHtml(routeLabel(b))}を選ぶ">${escapeHtml(shortRouteName(b))}</button>`)
            .join("、")}</div>`
        : "";
      // 分岐がある施設は、施設名・番号を、分岐の線と反対側に表示する（v1.55.0-beta。ユーザー指定。重ならないように）
      const flip = kids.length > 0;
      return `
          <div class="diagram-node${H ? " h" : ""}${flip ? " flip" : ""}" style="${H ? "left" : "top"}:${pos}px;${colorStyle || ""}">
            ${
              e.displayNo
                ? `<div class="diagram-node-number${e.displayNo.length >= 5 ? " len5" : e.displayNo.length >= 3 ? " len3" : ""}">${escapeHtml(e.displayNo)}</div>`
                : ""
            }
            <div class="diagram-node-marker shape-${icShapeOf(ic)}"></div>
            <div class="diagram-node-info">
              <div class="diagram-node-name">${escapeHtml(ic.name || "(無名)")}</div>
              <div class="diagram-node-sub">${escapeHtml(H ? def.label.replace(/（.*$/, "") : def.label)} ・ ${escapeHtml(distText)}</div>
              ${branchHtml}
            </div>
          </div>`;
    };

    // 施設どうしの間の距離（IC間距離）: 隣り合う施設の中間の、線の上に表示する。
    // 距離は実際の距離（距離の差）。表示位置は、間隔を確保した後の位置（pos）の中間。
    // 車線数が、路線の基本の車線数と違う区間（区間別の車線数）には、距離のあとに車線数を付ける
    const gapHtml = (a, b, lineY) => {
      // 車線数の注記は、両端が同じ路線（順接でつながる路線の境をまたがない）ときだけ意味を持つ
      let lanesHtml = "";
      if (a.route && a.route === b.route && a.pi != null && b.pi != null) {
        const l = spanLanes(a.route, a.pi, b.pi);
        if (l != null && l !== nearestValidLanes(a.route.lanes)) lanesHtml = `<span class="diagram-gap-lanes">・${l}車線</span>`;
      }
      const at = H ? `left:${(a.pos + b.pos) / 2}px;top:${lineY}px;` : `top:${(a.pos + b.pos) / 2 + 14.3}px;`;
      return `<div class="diagram-gap" style="${at}" title="${escapeHtml(a.name || "(無名)")} 〜 ${escapeHtml(b.name || "(無名)")}">${(Math.abs(b.d - a.d) / 1000).toFixed(1)}km${lanesHtml}</div>`;
    };

    const visited = new Set();

    // 1つの図（独立した路線1本と、そこから分岐している路線すべて）を作る
    const buildGroup = (root) => {
      const parts = []; // 列ごとのHTML（1つめが root の列）
      const connectors = [];
      let bottom = 0;
      let colCounter = 0;
      let rootPpm = 0;
      let rootTotal = 0; // root（順接でつながる路線があれば、その通し距離）の全長

      // r の列を作る。top は、図の上端からの位置。isBranch=false は root（縦の線が図の本体）
      const emit = (r, colIdx, top, ppm, isBranch, at, junction) => {
        // 「順接」でつながる路線があれば、1本の路線であるかのように、同じ列にまとめて描く（v1.55.0-beta）。
        // 分岐で入ってきた列（isBranch）は、後方（この列に入ってくる側）へは延ばさない
        const entryDir = !(isBranch && at === "end");
        const chain = buildStraightChain(r, entryDir, !isBranch);
        chain.forEach((c) => visited.add(c.route.id));
        const bd = buildChainDiagramData(chain);
        const total = bd.totalDist;
        const rppm = ppm != null ? ppm : total > 0 ? trackPx / total : 0;
        if (!isBranch) {
          rootPpm = rppm;
          rootTotal = total;
        }
        // 主軸方向の、最初のノードまでの長さ（縦: 見出しの高さ。横: 決まった長さ）と、
        // （横）行の見出しの高さ・線の位置
        const head = isBranch ? (H ? BRANCH_HEAD : Math.max(BRANCH_HEAD, headPxMap[r.id] || 0)) : 0;
        const headH = H && isBranch ? Math.max(H_HEAD_MIN, headPxMap[r.id] || 0) : 0;
        const lineY = headH + H_LINE;
        // 通し距離の順に並べる（buildChainDiagramData() が、向き・順接の並びを踏まえた通し距離を計算済み）
        const items = bd.entries.map((e) => ({ e, d: e.dist })).sort((x, y) => x.d - y.d);
        // e.route（チェーンの中の、その施設がある路線）を基準に、まだ描いていない「分岐」の子を探す
        // （「順接」は、すでにチェーンに取り込んでいるので対象外）
        const kidsOf = (ic, icRoute) =>
          ic.id
            ? drawable.filter(
                (b) => b.branchFrom && b.branchFrom.routeId === icRoute.id && b.branchFrom.icId === ic.id && (b.branchFrom.mode || "branch") === "branch" && !visited.has(b.id)
              )
            : [];
        let prevPos = -Infinity;
        let prevHasKids = false;
        const ns = items.map(({ e, d }) => {
          const kids = kidsOf(e.ic, e.route);
          const pos = Math.max(head + d * rppm, prevPos + minGapPx + (prevHasKids ? BRANCH_ROOM : 0));
          prevPos = pos;
          prevHasKids = kids.length > 0;
          return { e, d, pos, kids };
        });
        // 施設から分岐する路線がある（分岐の線を出す）ときは、その線を出す位置まで、路線の線を延ばす。
        // 路線の端の施設（終点の鹿児島ICなど）から分岐するとき、線が施設の下で終わると、分岐の線が、線の外に浮き、「終点」の印と重なるため
        const tail = Math.max(0, ...ns.filter((n) => n.kids.length > 0).map((n) => n.pos + CONNECT_Y + 10));
        const height = Math.max(Math.max(head + total * rppm, prevPos) + 8, tail);
        bottom = Math.max(bottom, top + height);

        const colorStyle = `--diagram-color:${colorOf(r)};`;
        const nodesHtml = ns.map(({ e, d, pos }) => nodeHtml(e, pos, `${isBranch ? "分岐点" : "始点"}から${(d / 1000).toFixed(1)}km`, isBranch ? colorStyle : "")).join("");
        const gapsHtml = ns
          .slice(1)
          .map((x, i) =>
            gapHtml(
              { pos: ns[i].pos, d: ns[i].d, name: ns[i].e.ic.name, pi: ns[i].e.ic.pointIndex, route: ns[i].e.route },
              { pos: x.pos, d: x.d, name: x.e.ic.name, pi: x.e.ic.pointIndex, route: x.e.route },
              lineY
            )
          )
          .join("");
        let headHtml = "";
        if (isBranch) {
          headHtml =
            `<div class="diagram-branch-head" data-route-id="${escapeHtml(r.id)}">${statusBadgeHtml(r)}<button type="button" class="diagram-branch-link" data-route-id="${escapeHtml(r.id)}" title="この路線を選ぶ">${escapeHtml(routeLabel(r))}</button>` +
            `<div class="muted">${escapeHtml(junction)}から分岐（この路線の${at === "end" ? "終点" : "始点"}側）</div>` +
            `<div class="muted">${escapeHtml(diagramLaneText(r))}${routeStatuses(r).some((x) => x !== "inservice") ? "・" + escapeHtml(routeStatusText(r)) : ""}</div></div>`;
        }
        // 路線の線: 状態・車線数・暫定が同じ区間ごとの線を並べる（太さ・線種・区分線・暫定の枠は、区間ごとに決まる）。
        // 順接でつながる路線があれば、そのぶんもまとめて、1本の線の並びとして描く
        let lineHtml = "";
        {
          const anchors = ns.map((n) => ({ d: n.d, y: n.pos + (H ? 0 : 14.3) })); // 施設のマークの中心の、主軸方向の位置
          const yAt = (d) => {
            if (anchors.length === 0) return head + d * rppm;
            const first = anchors[0];
            const last = anchors[anchors.length - 1];
            if (d <= first.d) return Math.max(0, first.y - (first.d - d) * rppm);
            if (d >= last.d) return Math.min(height, last.y + (d - last.d) * rppm);
            for (let q = 0; q < anchors.length - 1; q++) {
              const A = anchors[q];
              const B = anchors[q + 1];
              if (d >= A.d && d <= B.d) return B.d === A.d ? A.y : A.y + ((d - A.d) / (B.d - A.d)) * (B.y - A.y);
            }
            return last.y;
          };
          const pieces = [];
          let chainOffset = 0;
          chain.forEach(({ route: cr, dir: crDir }) => {
            const n = cr.points.length;
            const cum = [0];
            for (let i = 1; i < n; i++) cum.push(cum[i - 1] + distanceMeters(cr.points[i - 1], cr.points[i]));
            const distAt = (q) => chainOffset + (crDir ? cum[q] : cum[n - 1] - cum[q]);
            for (let q = 0; q < n - 1; q++) {
              const da = distAt(q);
              const db = distAt(q + 1);
              pieces.push({
                y1: yAt(Math.min(da, db)),
                y2: yAt(Math.max(da, db)),
                status: statusOfStep(cr, q),
                lanes: nearestValidLanes(laneOfStep(cr, q)),
                prov: provisionalOfStep(cr, q),
                color: colorOfStep(cr, q),
              });
            }
            chainOffset += cum[n - 1];
          });
          pieces.sort((a, b) => a.y1 - b.y1);
          const merged = [];
          pieces.forEach((p) => {
            const lastP = merged[merged.length - 1];
            if (lastP && lastP.status === p.status && lastP.lanes === p.lanes && lastP.prov === p.prov && lastP.color === p.color) lastP.y2 = Math.max(lastP.y2, p.y2);
            else merged.push({ ...p });
          });
          merged.forEach((m, q) => {
            if (q === 0) m.y1 = isBranch ? cornerRadiusOf(r) : 0; // 分岐する路線の線は、角の丸み（分岐の線）のあとから始める
            if (q === merged.length - 1) m.y2 = height;
            else m.y2 = merged[q + 1].y1;
          });
          lineHtml = merged
            .map((m) => {
              const w = diagramLineWidth(m.lanes);
              const len = Math.max(0, m.y2 - m.y1);
              const decor = m.status === "inservice" ? diagramLaneDecorHtml(m.lanes, m.prov, w, H) : ""; // 区分線と暫定の枠は、供用中の区間だけ（地図と同じ）
              const colorStyle = `--diagram-color:${escapeHtml(m.color)};`; // 区間別の色（v1.52.0-beta。未設定なら route.color のまま）
              if (H) return `<div class="diagram-line-seg h status-${escapeHtml(m.status)}" style="left:${m.y1}px;width:${len}px;top:${lineY - w / 2}px;height:${w}px;${colorStyle}">${decor}</div>`;
              return `<div class="diagram-line-seg status-${escapeHtml(m.status)}" style="top:${m.y1}px;height:${len}px;left:${33 - w / 2}px;width:${w}px;${colorStyle}">${decor}</div>`;
            })
            .join("");
        }
        const chainIds = new Set(chain.map((c) => c.route.id));
        parts[colIdx] = { html: headHtml + lineHtml + nodesHtml + gapsHtml, top, height, colorStyle, color: colorOf(r), isBranch, route: r, chainIds, headH, lineY };

        // このルートから分岐している路線を、右の列に置く。下のJCTから分岐する路線ほど近くに置く
        // （上のJCTからの横線が、下の列の施設を横切らないため）
        const childList = [];
        ns.forEach((n) => n.kids.forEach((k) => childList.push({ k, n })));
        childList.sort((a, b) => b.n.pos - a.n.pos);
        childList.forEach(({ k, n }) => {
          if (visited.has(k.id)) return;
          const childCol = ++colCounter;
          const childTop = top + n.pos + CONNECT_Y;
          const kStep = k.branchFrom.at === "end" ? k.points.length - 2 : 0; // 分岐する路線の、分岐点側の区間
          const kStatus = statusOfStep(k, kStep);
          const kLanes = nearestValidLanes(laneOfStep(k, kStep));
          const kWidth = diagramLineWidth(kLanes);
          connectors.push({ from: colIdx, to: childCol, top: childTop, color: colorOf(k), status: kStatus, width: kWidth, lanes: kLanes, prov: provisionalOfStep(k, kStep), r: cornerRadiusOf(k) });
          emit(k, childCol, childTop, rppm, true, k.branchFrom.at === "end" ? "end" : "start", n.e.ic.name || "(無名)");
        });
      };
      emit(root, 0, 0, null, false, "start", "");

      const cols = parts.length;
      const rootPart = parts[0];
      const cat = CATEGORIES[root.category];
      const meta = `${(cat && cat.label) || ""} ／ ${routeStatusText(root)} ／ ${diagramLaneText(root)} ／ 全長 約${(rootTotal / 1000).toFixed(1)}km${cols > 1 ? ` ／ 分岐 ${cols - 1}路線` : ""}`;

      if (H) {
        // 横向き: 行（路線ごとの横の線）を、上から順に重ね、分岐の線（縦）でつなぐ
        let y = 0;
        parts.forEach((p) => {
          p.rowTop = y;
          y += p.headH + H_LINE + H_ROW_BODY + H_ROW_GAP;
        });
        const bodyH = y - H_ROW_GAP;
        const bodyW = Math.max(...parts.map((p) => p.top + p.height));
        const rowsHtml = parts
          .map(
            (p) =>
              `<div class="diagram-row${p.isBranch ? " diagram-branch-col" : ""}${p.isBranch && p.chainIds.has(activeRouteId) ? " selected-route" : ""}" data-route-id="${escapeHtml(p.route.id)}" style="left:${p.top}px;top:${p.rowTop}px;width:${p.height}px;height:${p.headH + H_LINE + H_ROW_BODY}px;${p.colorStyle}--row-head:${p.headH}px;">${p.html}</div>`
          )
          .join("");
        const hConnectors = connectors
          .map((c) => {
            const y1 = parts[c.from].rowTop + parts[c.from].lineY;
            const y2 = parts[c.to].rowTop + parts[c.to].lineY;
            return diagramConnectorSvg(c, y1, y2, c.top, c.r, true);
          })
          .join("");
        // 選択中の路線の背景（分岐の線・路線の線より下の層に置く）
        const hHl = parts
          .map((p) =>
            p.isBranch && p.chainIds.has(activeRouteId)
              ? `<div class="diagram-hl" style="left:${p.top - 66}px;top:${p.rowTop - 8}px;width:${p.height + 146}px;height:${p.headH + H_LINE + H_ROW_BODY + 16}px;"></div>`
              : ""
          )
          .join("");
        const rl = rootPart.lineY;
        const endpoints =
          `<div class="diagram-endpoint h" style="left:-64px;top:${rl - 11}px;"><span class="diagram-dot"></span>始点</div>` +
          `<div class="diagram-endpoint h" style="left:${rootPart.height + 12}px;top:${rl - 11}px;"><span class="diagram-dot"></span>終点</div>`;
        return { root, cols, meta, horizontal: true, hHtml: hHl + hConnectors + rowsHtml + endpoints, bodyW, bodyH };
      }

      const branchHtml = parts
        .map((p, idx) =>
          idx === 0
            ? ""
            : `<div class="diagram-track diagram-branch-col${p.chainIds.has(activeRouteId) ? " selected-route" : ""}" data-route-id="${escapeHtml(p.route.id)}" style="left:${idx * PITCH}px;top:${p.top}px;height:${p.height}px;${p.colorStyle}">${p.html}</div>`
        )
        .join("");
      // 選択中の路線の背景（分岐の線・路線の線より下の層に置く）
      const hlHtml = parts
        .map((p, idx) =>
          idx > 0 && p.chainIds.has(activeRouteId) ? `<div class="diagram-hl" style="left:${idx * PITCH - 72}px;top:${p.top - 8}px;width:464px;height:${p.height + 16}px;"></div>` : ""
        )
        .join("");
      // 同じ高さから出る横線は、長いものを先に描く（短いものが上に重なり、近い列へ分かれる線が見える）
      const connectorHtml = connectors
        .slice()
        .sort((x, y) => y.to - y.from - (x.to - x.from))
        .map((c) => diagramConnectorSvg(c, c.from * PITCH + 33, c.to * PITCH + 33, c.top, c.r, false))
        .join("");
      const extraBottom = Math.max(0, bottom - rootPart.height);
      return { root, cols, rootPart, branchHtml, connectorHtml, hlHtml, extraBottom, meta };
    };

    // 図ごとに、含まれる路線のidを集めるため、visited の増え方を見る
    const groups = [];
    const roots = drawable.filter((r) => !isDrawnBranch(r));
    const buildOne = (root) => {
      const before = new Set(visited);
      const g = buildGroup(root);
      g.routeIds = new Set([...visited].filter((id) => !before.has(id)));
      groups.push(g);
    };
    roots.forEach((r) => {
      if (!visited.has(r.id)) buildOne(r);
    });
    // 分岐が循環していて、どの路線も分岐元でない場合の保険: 描かれなかった路線も、独立した図にする
    drawable.forEach((r) => {
      if (!visited.has(r.id)) buildOne(r);
    });

    routeDiagramEl.style.removeProperty("max-width");
    routeDiagramEl.style.removeProperty("padding-bottom");
    routeDiagramEl.classList.toggle("multi-groups", groups.length > 1); // 図が複数あるときだけ、選択中の図を色づける
    routeDiagramEl.classList.toggle("orient-h", H);
    const orientBtn = document.getElementById("btn-diagram-orient");
    orientBtn.textContent = H ? "縦向きにする" : "横向きにする";
    orientBtn.setAttribute("aria-pressed", String(H));
    routeDiagramEl.innerHTML = groups
      .map((g) => {
        const selected = g.routeIds.has(activeRouteId);
        if (g.horizontal) {
          return `
      <section class="diagram-group h${selected ? " selected" : ""}" data-root-id="${escapeHtml(g.root.id)}" style="width:${Math.max(540, 74 + g.bodyW + 110)}px;--diagram-color:${colorOf(g.root)};">
        <div class="route-diagram-title diagram-select${g.root.id === activeRouteId ? " selected-route" : ""}" role="button" tabindex="0" data-route-id="${escapeHtml(g.root.id)}" title="この路線を選ぶ">${statusBadgeHtml(g.root)}${escapeHtml(routeLabel(g.root))}</div>
        <div class="route-diagram-meta">${escapeHtml(g.meta)}</div>
        <div class="diagram-hbody" style="width:${g.bodyW}px;height:${g.bodyH}px;">${g.hHtml}</div>
      </section>`;
        }
        const width = Math.max(540, 74 + (g.cols - 1) * PITCH + 400);
        return `
      <section class="diagram-group${selected ? " selected" : ""}" data-root-id="${escapeHtml(g.root.id)}" style="width:${width}px;margin-bottom:${g.extraBottom}px;--diagram-color:${colorOf(g.root)};">
        <div class="route-diagram-title diagram-select${g.root.id === activeRouteId ? " selected-route" : ""}" role="button" tabindex="0" data-route-id="${escapeHtml(g.root.id)}" title="この路線を選ぶ">${statusBadgeHtml(g.root)}${escapeHtml(routeLabel(g.root))}</div>
        <div class="route-diagram-meta">${escapeHtml(g.meta)}</div>
        <div class="diagram-endpoint"><span class="diagram-dot"></span>始点</div>
        <div class="diagram-track" style="height:${g.rootPart.height}px;">${g.hlHtml}${g.connectorHtml}${g.rootPart.html}${g.branchHtml}</div>
        <div class="diagram-endpoint"><span class="diagram-dot"></span>終点</div>
      </section>`;
      })
      .join("");

    applyDiagramZoom(); // 描き直したので、図の大きさに、倍率をかけ直す

    // 分岐する路線の見出しの高さを測る。路線名が長くて折り返すと、最初の施設と重なるので、高さを直して1度だけ描き直す
    if (depth < 2 && routeDiagramEl.offsetParent !== null) {
      let changed = false;
      routeDiagramEl.querySelectorAll(".diagram-branch-head").forEach((h) => {
        const minHead = H ? H_HEAD_MIN : BRANCH_HEAD;
        const need = Math.max(minHead, Math.ceil(h.offsetHeight) + 8);
        const cur = Math.max(minHead, headPxMap[h.dataset.routeId] || 0);
        if (need !== cur) {
          headPxMap[h.dataset.routeId] = need;
          changed = true;
        }
      });
      if (changed) {
        renderRouteDiagram(depth + 1);
        return;
      }
    }

    // 選択中の路線を変えたときだけ、その路線（分岐する路線なら、その列）を画面内へスクロールする（編集中の再描画では動かさない）
    if (activeRouteId !== lastDiagramActiveId) {
      lastDiagramActiveId = activeRouteId;
      scrollDiagramToRoute(activeRouteId);
    }
  }

  // 路線 id の図（分岐する路線は、その列）を、見える位置へスクロールする。すでに見えているときは動かさない
  function scrollDiagramToRoute(id) {
    if (!id) return;
    const col = routeDiagramEl.querySelector('.diagram-branch-col[data-route-id="' + id + '"]');
    const group = col ? col.closest(".diagram-group") : routeDiagramEl.querySelector(".diagram-group.selected");
    const target = col || routeDiagramEl.querySelector('.route-diagram-title[data-route-id="' + id + '"]');
    if (!target || !group) return;
    const a = diagramAreaEl.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const seen = r.left >= a.left && Math.min(r.right, r.left + 320 * diagramScale) <= a.right && r.top >= a.top && r.top + Math.min(r.height, 60 * diagramScale) <= a.bottom;
    if (seen) return;
    if (col) {
      // 分岐する路線: 列の見出しが見える位置へ（左に、施設番号の丸が入る余白を空ける）
      col.scrollIntoView({ block: "start", inline: "start" });
    } else {
      // 図が領域より広いときに中央へ寄せると、左の施設名が切れて見えなくなるので、左端に合わせる
      group.scrollIntoView({ block: "start", inline: group.offsetWidth > diagramAreaEl.clientWidth ? "start" : "center" });
    }
  }

  // 路線図の路線名（図の見出し・分岐する路線の名前）をクリックすると、その路線を選ぶ
  function selectRouteFromDiagram(btn) {
    activeRouteId = btn.dataset.routeId;
    clearSelection();
    render();
  }
  routeDiagramEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".diagram-branch-link, .diagram-select");
    if (btn) selectRouteFromDiagram(btn);
  });
  // 図の見出し（role="button"）は、Enter・スペースキーでも選べる（分岐する路線の名前は、本物のボタン）
  routeDiagramEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest(".diagram-select");
    if (!el || el !== e.target) return;
    e.preventDefault();
    selectRouteFromDiagram(el);
  });

  // ---------------------------------------------------------------------
  // 地図の保存・読込（localStorage）/ エクスポート・インポート
  // ---------------------------------------------------------------------
  const mapNameInput = document.getElementById("map-name");
  const savedMapsListEl = document.getElementById("saved-maps-list");

  function loadSavedMapsIndex() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function renderSavedMapsList() {
    const all = loadSavedMapsIndex();
    const names = Object.keys(all).sort();
    savedMapsListEl.innerHTML = "";
    if (names.length === 0) {
      savedMapsListEl.innerHTML = '<div class="empty-msg">保存済みの地図はありません</div>';
      return;
    }
    names.forEach((name) => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `<span class="name">${escapeHtml(name)}</span>`;

      const actions = document.createElement("span");
      actions.className = "row-actions";
      const delBtn = document.createElement("button");
      delBtn.className = "btn small danger-outline";
      delBtn.title = "この地図を削除";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await confirmModal(`「${name}」を削除します。よろしいですか？`);
        if (!ok) return;
        const idx = loadSavedMapsIndex();
        delete idx[name];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(idx));
        renderSavedMapsList();
      });
      actions.appendChild(delBtn);

      div.addEventListener("click", () => {
        const idx = loadSavedMapsIndex();
        loadMapData(idx[name]);
        closeAllPopovers();
      });

      div.appendChild(actions);
      savedMapsListEl.appendChild(div);
    });
  }

  // v1.0.0の「この点から車線数を変更」（point.lanesOverride: その点から次の変更点まで）で
  // 保存されたデータを、v1.1.0以降の区間指定（route.laneSegments）へ変換する。
  function migrateLanesOverride(route) {
    const idxs = [];
    route.points.forEach((p, i) => {
      if (p.lanesOverride != null) idxs.push(i);
    });
    idxs.forEach((from, k) => {
      const to = k + 1 < idxs.length ? idxs[k + 1] : route.points.length - 1;
      if (from < to) {
        route.laneSegments.push({ id: uid(), fromIdx: from, toIdx: to, lanes: nearestValidLanes(route.points[from].lanesOverride) });
      }
    });
    route.points.forEach((p) => delete p.lanesOverride);
  }

  // 読み込むデータ（保存済み・JSONのインポート）の検査。
  // JSONは他の人と共有できるため、色の欄などに入れられたHTMLが画面に入らないよう、型と値を確かめて、正しい形に整える。
  // 直せない路線（点の座標が数値でないなど）は、読み込まない。知らない項目は、そのまま残す（新しい版のデータを壊さないため）
  const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
  const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
  const cleanString = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  function sanitizeRoute(r, usedIds) {
    if (!r || typeof r !== "object" || !Array.isArray(r.points)) return null;
    if (!r.points.every((p) => p && isFiniteNumber(p.lat) && isFiniteNumber(p.lng))) return null;
    const n = r.points.length;
    const out = { ...r };
    let id = cleanString(r.id, 80);
    if (!id || usedIds.has(id)) id = uid();
    usedIds.add(id);
    out.id = id;
    out.name = cleanString(r.name, 100);
    out.category = CATEGORIES[r.category] ? r.category : "national";
    out.color = COLOR_PATTERN.test(r.color) ? r.color : CATEGORIES[out.category].color;
    out.status = STATUSES[r.status] ? r.status : "inservice";
    out.opacity = isFiniteNumber(r.opacity) ? Math.min(1, Math.max(0, r.opacity)) : 1;
    if (isFiniteNumber(r.lanes)) out.lanes = nearestValidLanes(r.lanes);
    else delete out.lanes;
    out.provisional = !!r.provisional;
    out.points = r.points.map((p) => ({ ...p, lat: p.lat, lng: p.lng }));
    const validIdx = (v) => Number.isInteger(v) && v >= 0 && v < n;
    out.ics = (Array.isArray(r.ics) ? r.ics : [])
      .filter((ic) => ic && typeof ic === "object" && validIdx(ic.pointIndex))
      .map((ic) => {
        const c = { ...ic };
        c.type = IC_TYPES[ic.type] || ic.type === "half_ic" ? ic.type : "ic";
        c.name = cleanString(ic.name, 100);
        c.labelVisible = !!ic.labelVisible;
        // 「その他」施設の図形（ic.shape）は、既知の値だけを許す（HTMLのclass属性に、そのまま入るため）
        if ("shape" in c && !OTHER_SHAPES.some((s) => s.key === c.shape)) delete c.shape;
        if ("id" in c) c.id = cleanString(ic.id, 80) || undefined;
        if ("numText" in c) c.numText = cleanString(ic.numText, 6);
        if ("numMode" in c && !["auto", "custom", "none"].includes(c.numMode)) delete c.numMode;
        return c;
      });
    const segs = (list, fix) =>
      (Array.isArray(list) ? list : [])
        .filter((s) => s && validIdx(s.fromIdx) && validIdx(s.toIdx))
        .map((s) => ({ ...s, id: cleanString(s.id, 80) || uid(), ...fix(s) }));
    out.laneSegments = segs(r.laneSegments, (s) => ({ lanes: nearestValidLanes(isFiniteNumber(s.lanes) ? s.lanes : 2) }));
    out.statusSegments = segs(r.statusSegments, (s) => ({ status: STATUSES[s.status] ? s.status : "inservice" }));
    out.colorSegments = segs(r.colorSegments, (s) => ({ color: COLOR_PATTERN.test(s.color) ? s.color : out.color }));
    out.provisionalSegments = segs(r.provisionalSegments, (s) => ({ provisional: !!s.provisional }));
    const bf = r.branchFrom;
    if (bf && typeof bf === "object" && typeof bf.routeId === "string" && typeof bf.icId === "string" && (bf.at === "start" || bf.at === "end")) {
      out.branchFrom = { routeId: cleanString(bf.routeId, 80), icId: cleanString(bf.icId, 80), at: bf.at, mode: bf.mode === "straight" ? "straight" : "branch" };
    } else {
      delete out.branchFrom;
    }
    return out;
  }

  function loadMapData(data) {
    if (!data || !Array.isArray(data.routes)) {
      toast("読み込めるデータではありません", "error");
      return;
    }
    const usedIds = new Set();
    const cleaned = data.routes.map((r) => sanitizeRoute(r, usedIds)).filter(Boolean);
    const dropped = data.routes.length - cleaned.length;
    data = { ...data, name: cleanString(data.name, 200), routes: cleaned };
    if (dropped > 0) toast(`データが壊れている路線（${dropped}本）は、読み込めませんでした`, "error");
    currentMap = data;
    delete currentMap.groups; // v1.26.0で廃止した路線グループ（旧データのグループ情報は捨てる。路線と点はそのまま）
    currentMap.routes.forEach((r) => {
      if (r.lanes == null) {
        r.lanes = nearestValidLanes((r.weight || LANE_WIDTH_PX * 2) / LANE_WIDTH_PX);
        r.weight = laneWeight(r.lanes);
      }
      delete r.alignment; // v1.49.0で廃止した「設計条件」（種・級・設計速度・地域区分）は、読み込むときに捨てる
      // v1.46.0で廃止した「線形」（点ごとの曲線半径・片勾配・標高）の入力値は、読み込むときに捨てる（点の位置はそのまま。線は、点を直線で結ぶ）
      (r.points || []).forEach((p) => {
        delete p.radius;
        delete p.cant;
        delete p.elevation;
      });
      if (!Array.isArray(r.laneSegments)) r.laneSegments = [];
      if (!Array.isArray(r.statusSegments)) r.statusSegments = []; // 区間別の状態（v1.40.0。それ以前の保存データにはない）
      if (!Array.isArray(r.colorSegments)) r.colorSegments = []; // 区間別の色（v1.52.0-beta。それ以前の保存データにはない）
      if (!Array.isArray(r.provisionalSegments)) r.provisionalSegments = []; // 区間別の供用形態（v1.53.0-beta。それ以前の保存データにはない）
      migrateLanesOverride(r);
      // v1.22.0で廃止した「ハーフIC」（type: "half_ic"、halfDirection）は、通常のICに変換する
      (r.ics || []).forEach((ic) => {
        if (ic.type === "half_ic") ic.type = "ic";
        delete ic.halfDirection;
      });
      // v1.5.0〜v1.12.0 の lockEnds（始点・終点をまとめてロック）を、終点のロックへ変換する
      if (r.lockEnds !== undefined) {
        r.endLocked = !!r.lockEnds;
        delete r.lockEnds;
      }
      // 終点のロックが未定義の保存データは、置いてある点を「決定済み」として扱う。
      // 終点が未決定のままだと、地図の何もない所をクリックしただけで、路線の末尾に点が追加されてしまうため。
      // 明示的に未決定（false）で保存された路線は、そのまま（描き続けられる）
      if (r.endLocked === undefined) r.endLocked = r.points.length >= 2;
      delete r.startLocked; // v1.53.2-betaで、始点の自動ロックを廃止した（保存データに残っていても無視する）
    });
    mapNameInput.value = currentMap.name || "";
    activeRouteId = currentMap.routes.length > 0 ? currentMap.routes[0].id : null;
    clearSelection();
    render();
    resetHistory();
    markSaved();
    fitToBounds();
  }

  function fitToBounds() {
    const allPoints = [];
    currentMap.routes.forEach((r) => r.points.forEach((p) => allPoints.push([p.lat, p.lng])));
    if (allPoints.length > 0) {
      map.fitBounds(allPoints, { padding: [40, 40] });
    }
  }

  document.getElementById("btn-new-map").addEventListener("click", async () => {
    const ok = await confirmModal("現在の編集内容は破棄されます。新規作成しますか？");
    if (!ok) return;
    currentMap = { name: "", routes: [] };
    mapNameInput.value = "";
    activeRouteId = null;
    clearSelection();
    render();
    resetHistory();
    markSaved();
  });

  document.getElementById("btn-save-map").addEventListener("click", async () => {
    closeAllPopovers();
    const name = (mapNameInput.value || "").trim();
    if (!name) {
      toast("地図名称を入力してください", "error");
      mapNameInput.focus();
      return;
    }
    const idx = loadSavedMapsIndex();
    if (idx[name]) {
      const ok = await confirmModal(`「${name}」は既に存在します。上書きしますか？`);
      if (!ok) return;
    }
    currentMap.name = name;
    idx[name] = currentMap;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(idx));
    } catch (err) {
      // 容量がいっぱいなど。保存できていないので、保存済みにはしない
      toast("保存できませんでした（ブラウザの保存容量がいっぱいの可能性があります）。JSONで書き出してください", "error");
      return;
    }
    markSaved();
    renderSavedMapsList();
    toast("保存しました");
  });

  document.getElementById("btn-export").addEventListener("click", () => {
    const name = (mapNameInput.value || currentMap.name || "map").trim() || "map";
    currentMap.name = name;
    const blob = new Blob([JSON.stringify(currentMap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markSaved(); // ファイルに残したので、未保存ではなくなる
    closeAllPopovers();
  });

  document.getElementById("input-import").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        loadMapData(data);
        closeAllPopovers();
      } catch (err) {
        toast("JSONの読み込みに失敗しました: " + err.message, "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  setupDropdown("btn-toggle-saved", "saved-maps-popover", renderSavedMapsList);
  setupDropdown("btn-toggle-save", "save-popover");

  // ---------------------------------------------------------------------
  // ユーティリティ
  // ---------------------------------------------------------------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------
  // 選択中の点のツールバー（地図の上に重ねて表示。v1.51.0-beta で、右クリックメニューを廃止した代わりに追加）
  //   ロック・解除 / 削除 / 選択の解除。施設設定は、サイドバーに常設する（renderFacilitySettings）
  // ---------------------------------------------------------------------
  const pointToolbarEl = document.getElementById("point-toolbar");
  const pointToolbarLabelEl = document.getElementById("point-toolbar-label");
  const btnTogglePointLock = document.getElementById("btn-toggle-point-lock");
  const btnDeletePoints = document.getElementById("btn-delete-points");

  function renderPointToolbar() {
    const route = getActiveRoute();
    if (currentMode !== "edit" || !route || selectedSet.size === 0) {
      pointToolbarEl.hidden = true;
      return;
    }
    pointToolbarEl.hidden = false;
    const targets = Array.from(selectedSet);
    const multi = targets.length > 1;
    pointToolbarLabelEl.textContent = multi ? `選択中の${targets.length}点` : `点${targets[0] + 1}`;
    const allLocked = targets.every((i) => isLockedIdx(route, i));
    const lockedByEnds = targets.every((i) => isEndsLockedIdx(route, i));
    const anyPointLock = targets.some((i) => route.points[i] && route.points[i].locked);
    btnTogglePointLock.textContent = anyPointLock ? "ロック解除" : "ロック";
    btnTogglePointLock.disabled = lockedByEnds && !anyPointLock;
    btnTogglePointLock.title = lockedByEnds && !anyPointLock ? "終点のロックは、サイドバーで解除します" : "";
    btnDeletePoints.disabled = allLocked;
    btnDeletePoints.title = allLocked ? "ロック中の点は削除できません" : "";
  }

  btnTogglePointLock.addEventListener("click", () => {
    const route = getActiveRoute();
    if (!route) return;
    const targets = Array.from(selectedSet);
    const anyPointLock = targets.some((i) => route.points[i] && route.points[i].locked);
    const lockOn = !anyPointLock;
    targets.forEach((i) => {
      if (lockOn) route.points[i].locked = true;
      else delete route.points[i].locked;
    });
    render();
  });

  btnDeletePoints.addEventListener("click", () => deleteSelectedPoints());

  // ---------------------------------------------------------------------
  // キーボードショートカット
  //   Ctrl+Z: 元に戻す / Ctrl+Y・Ctrl+Shift+Z: やり直し
  //   Delete・Backspace: 選択中の点を削除 / Esc: 選択解除・区間選択の取り消し
  // 入力欄・セレクト・モーダル表示中は、ブラウザ標準の動作を妨げないよう無視する。
  // ---------------------------------------------------------------------
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function anyModalOpen() {
    return Array.from(document.querySelectorAll(".modal-overlay")).some((m) => !m.hidden);
  }

  document.addEventListener("keydown", (e) => {
    if (!tutorialModalEl.hidden) {
      // チュートリアル表示中: ←→でめくる、Escで閉じる（ほかのショートカットは無効）
      if (e.key === "ArrowRight") {
        e.preventDefault();
        tutorialGo(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        tutorialGo(-1);
      } else if (e.key === "Escape") {
        closeTutorial();
      }
      return;
    }
    if (anyModalOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && (key === "z" || key === "y")) {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (currentMode !== "edit") return;
      if (key === "y" || e.shiftKey) redo();
      else undo();
      return;
    }
    if (isTypingTarget(e.target) || mod || e.altKey) return;
    if (currentMode !== "edit") return;
    if (e.key === "Escape") {
      if (selectedSet.size > 0) {
        clearSelection();
        render();
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const route = getActiveRoute();
      if (route && selectedSet.size > 0) {
        e.preventDefault();
        deleteSelectedPoints();
      }
    }
  });

  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);

  // 見出し（label）と入力欄を関連付ける（見出しを押すと入力欄に移動し、スクリーンリーダーが入力欄の名前を読める）。
  // 入力欄が1つでなく、ボタンの並び（車線数・状態など）のときは、並びのまとまり（group）に見出しの名前を付ける
  function linkFieldLabels(root) {
    root.querySelectorAll(".field").forEach((field) => {
      const label = field.querySelector(":scope > label");
      if (!label || label.htmlFor || label.querySelector("input, select, textarea")) return;
      const ctrl = field.querySelector("input[id], select[id], textarea[id]");
      if (ctrl) {
        label.htmlFor = ctrl.id;
        return;
      }
      const group = field.querySelector(".segmented[id], .preset-grid[id], .list-box[id], dl[id]");
      if (group) {
        if (!label.id) label.id = group.id + "-label";
        group.setAttribute("role", "group");
        group.setAttribute("aria-labelledby", label.id);
      }
    });
  }
  linkFieldLabels(document);

  // 初期表示
  renderSavedMapsList();
  render();
  resetHistory();
  markSaved();
  // ページを開いたときに、チュートリアルを自動で表示する（「次回から自動で表示しない」でオフにできる）
  if (!readTutorialHidden()) openTutorial(0);
})();
