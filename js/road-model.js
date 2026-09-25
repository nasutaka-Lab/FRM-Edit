// 路線・施設のデータ定義と、DOM・状態に依存しない計算（app.js から分けた。v1.56.1-beta）。
// window.RoadModel に公開する。app.js より先に読み込むこと。
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


  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.RoadModel = {
    escapeHtml,
    CATEGORIES,
    LANE_WIDTH_PX,
    LANE_OPTIONS,
    nearestValidLanes,
    laneWeight,
    segmentValueOfStep,
    laneOfStep,
    statusOfStep,
    colorOfStep,
    provisionalOfStep,
    segmentLists,
    buildLaneRanges,
    STATUSES,
    IC_TYPES,
    OTHER_SHAPES,
    otherShapeOf,
    icShapeOf,
    STORAGE_KEY,
    distanceMeters,
  };
})();
