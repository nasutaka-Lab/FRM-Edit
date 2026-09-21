// マニュアルの図（SVG）を組み立てる。
//
// 図は、index.html の <figure class="manual-figure" data-figure="..."> の中に、マニュアルを開いたときに入れる（js/app.js の buildManualFigures()）。
// data-figure が "tutorial:○○" のものは、チュートリアル（js/tutorial.js）のスライド（題名に ○○ を含むもの）の図を、そのまま使う。
// ここでは、それ以外の図（画面の構成・分岐・路線図の向き）を描く。
// 道路の線・点のマーク・IC記号は、凡例（js/legend.js の window.legendFigures）と同じ描き方を使うので、実際の見た目と揃う。
// 画面のボタン名や見た目を変えたときは、該当する図も合わせて直すこと。
(function () {
  "use strict";

  const GREEN = "#2e7d32";
  const RED = "#e53935";
  const PRIMARY = "#1b7a3d";
  const MUTED = "#5b6270";
  const INK = "#1f2328";

  function F() {
    return window.legendFigures;
  }

  function svgWrap(w, h, inner) {
    return `<svg class="tutorial-svg" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">${inner}</svg>`;
  }

  // 暗い地に白文字の注釈
  function chip(cx, cy, str) {
    const w = Math.round(F().textWidth(str, 10.5) + 14);
    return (
      `<rect x="${cx - w / 2}" y="${cy - 9}" width="${w}" height="18" rx="4" fill="${INK}" fill-opacity="0.9"/>` +
      F().text(cx, cy + 3.8, str, 10.5, "#fff", 700, "middle")
    );
  }

  // 画面のボタンを模した四角
  function btn(x, y, w, h, label, o) {
    o = o || {};
    const fill = o.primary ? PRIMARY : "#fff";
    const stroke = o.primary ? PRIMARY : "#c9ccd1";
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${stroke}"/>` +
      F().text(x + w / 2, y + h / 2 + 3.4, label, o.size || 9, o.primary ? "#fff" : INK, 700, "middle")
    );
  }

  // 地図らしい背景（x, y, w, h の範囲）
  function mapBg(x, y, w, h) {
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#eceee4"/>` +
      `<rect x="${x + w * 0.7}" y="${y + h * 0.5}" width="${w * 0.22}" height="${h * 0.24}" rx="6" fill="#d3e6c4"/>` +
      `<path d="M${x},${y + h * 0.9} C${x + w * 0.2},${y + h * 0.8} ${x + w * 0.3},${y + h} ${x + w * 0.5},${y + h * 0.93} S${x + w * 0.85},${y + h * 0.82} ${x + w},${y + h * 0.93} L${x + w},${y + h} L${x},${y + h}Z" fill="#b9d9ee"/>` +
      `<line x1="${x}" y1="${y + h * 0.3}" x2="${x + w}" y2="${y + h * 0.36}" stroke="#fff" stroke-width="3"/>` +
      `<line x1="${x + w * 0.22}" y1="${y}" x2="${x + w * 0.27}" y2="${y + h}" stroke="#fff" stroke-width="3"/>` +
      `<line x1="${x + w * 0.62}" y1="${y}" x2="${x + w * 0.58}" y2="${y + h}" stroke="#fff" stroke-width="3"/>`
    );
  }

  // 2点 p, q の間に、道路（車線数・区分線つき）を1区間描く
  function road(ctx, p, q, lanes, color) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const r = F().roadSvg(ctx, { parts: [{ lanes, len, provisional: false }], color, x: 0, cy: 0 });
    return `<g transform="translate(${p[0]} ${p[1]}) rotate(${angle})">${r}</g>`;
  }

  // ---- 画面の構成 -----------------------------------------------------------------

  function screenFig(ctx) {
    const f = F();
    const W = 480;
    const H = 270;
    let s = `<rect width="${W}" height="${H}" fill="#fff"/>`;
    // トップバー
    s += `<rect x="9" y="7" width="16" height="16" rx="4" fill="${PRIMARY}"/>`;
    s += f.text(31, 19, "架空道路マップ", 10.5, INK, 700);
    s += `<rect x="118" y="8" width="34" height="14" rx="7" fill="#fff4dc" stroke="#e0b060"/>` + f.text(135, 18, "β 1.50", 8.5, "#8a5300", 700, "middle");
    [
      ["元に戻す", 160, 38],
      ["やり直し", 202, 38],
      ["新規", 244, 26],
      ["開く", 274, 26],
      ["保存", 304, 26, true],
      ["マニュアル", 334, 46],
    ].forEach(([t, x, w, p]) => {
      s += btn(x, 8, w, 15, t, { primary: !!p, size: 8.5 });
    });
    s += `<line x1="0" y1="30" x2="${W}" y2="30" stroke="#e1e4e8"/>`;
    // モードのタブ
    s += f.text(16, 44, "編集", 10.5, PRIMARY, 700) + `<line x1="10" y1="49" x2="42" y2="49" stroke="${PRIMARY}" stroke-width="2.5"/>`;
    s += f.text(58, 44, "路線図", 10.5, MUTED, 700);
    s += `<line x1="0" y1="51" x2="${W}" y2="51" stroke="#e1e4e8"/>`;
    // 地図
    s += mapBg(0, 52, 330, 218);
    const P = [[36, 214], [112, 152], [190, 136], [262, 92]];
    s += road(ctx, P[0], P[1], 2, GREEN) + road(ctx, P[1], P[2], 2, GREEN) + road(ctx, P[2], P[3], 2, GREEN);
    s += f.markerSvg(P[0][0], P[0][1], "start") + f.markerSvg(P[1][0], P[1][1], "vertex") + f.markerSvg(P[2][0], P[2][1], "vertex") + f.markerSvg(P[3][0], P[3][1], "end");
    // 地図の種類の切り替え・拡大縮小・凡例のボタン
    s += `<rect x="298" y="60" width="24" height="24" rx="4" fill="#fff" stroke="#c9ccd1"/>`;
    [70, 73.5, 77].forEach((y) => (s += `<line x1="304" y1="${y}" x2="316" y2="${y}" stroke="${MUTED}" stroke-width="1.5"/>`));
    s += `<rect x="8" y="60" width="18" height="36" rx="3" fill="#fff" stroke="#c9ccd1"/>` + f.text(17, 74, "+", 11, INK, 700, "middle") + f.text(17, 91, "−", 11, INK, 700, "middle");
    s += btn(8, 246, 40, 16, "凡例", { size: 9 });
    // サイドバー
    s += `<rect x="330" y="52" width="150" height="218" fill="#f6f7f8"/><line x1="330" y1="52" x2="330" y2="${H}" stroke="#e1e4e8"/>`;
    ["路線", "見た目", "車線", "点"].forEach((t, i) => {
      const x = 338 + i * 34;
      s += f.text(x, 68, t, 9, i === 0 ? PRIMARY : MUTED, 700);
    });
    s += `<line x1="336" y1="74" x2="364" y2="74" stroke="${PRIMARY}" stroke-width="2"/><line x1="330" y1="75" x2="480" y2="75" stroke="#e1e4e8"/>`;
    s += f.text(338, 90, "一般国道・供用中／2車線", 8.5, MUTED, 400);
    s += `<rect x="338" y="98" width="134" height="72" rx="5" fill="#fff" stroke="#e1e4e8"/>`;
    s += f.text(346, 113, "路線一覧", 8.5, MUTED, 700) + btn(410, 102, 54, 15, "路線を追加", { primary: true, size: 7.5 });
    s += `<rect x="346" y="122" width="118" height="14" rx="3" fill="#dcedc8"/>` + f.text(352, 132, "路線1", 8.5, INK, 700);
    s += `<rect x="338" y="178" width="134" height="84" rx="5" fill="#fff" stroke="#e1e4e8"/>`;
    s += f.text(346, 193, "路線1", 9, INK, 700);
    ["路線種別", "状態", "基本の車線数"].forEach((t, i) => {
      s += f.text(346, 208 + i * 17, t, 7.5, MUTED, 700) + `<rect x="346" y="${211 + i * 17}" width="118" height="7" rx="2" fill="#eceef1"/>`;
    });
    // 名前の注釈
    s += chip(436, 15, "トップバー") + chip(190, 41, "モード（編集／路線図）");
    s += chip(200, 200, "地図") + chip(405, 155, "サイドバー");
    s += chip(94, 254, "凡例ボタン");
    return svgWrap(W, H, s);
  }

  // ---- 分岐（地図の上で見たところ）--------------------------------------------------

  function branchFig(ctx) {
    const f = F();
    const W = 325;
    const H = 162;
    let s = mapBg(0, 0, W, H);
    const a = [14, 122];
    const b = [312, 40];
    const j = [a[0] + (b[0] - a[0]) * 0.46, a[1] + (b[1] - a[1]) * 0.46];
    s += road(ctx, a, b, 2, GREEN);
    s += road(ctx, j, [304, 142], 2, RED);
    s += f.icShape(j[0], j[1], "jct", 16);
    s += chip(64, 138, "分岐元の路線") + chip(j[0], j[1] - 24, "JCT（分岐する場所）") + chip(256, 152, "分岐する路線");
    return svgWrap(W, H, s);
  }

  // ---- 路線図（縦向き・横向き）-------------------------------------------------------

  // 施設の番号の丸
  function numberRing(x, y, n, color) {
    return `<circle cx="${x}" cy="${y}" r="9.5" fill="#fff" stroke="${color}" stroke-width="2"/>` + F().text(x, y + 3.8, String(n), 10.5, INK, 700, "middle");
  }

  // 施設の間の距離の札
  function gapPill(x, y, label) {
    const w = Math.round(F().textWidth(label, 9.5) + 12);
    return `<rect x="${x - w / 2}" y="${y - 8}" width="${w}" height="16" rx="8" fill="#fff" stroke="#e1e4e8"/>` + F().text(x, y + 3.4, label, 9.5, MUTED, 700, "middle");
  }

  function diagramFig() {
    const f = F();
    const W = 640;
    const H = 232;
    let s = `<rect width="${W}" height="${H}" fill="#fff"/><line x1="320" y1="14" x2="320" y2="${H - 14}" stroke="#e1e4e8"/>`;

    // 縦向き: 始点が上、分岐する路線は右の列
    s += f.text(12, 20, "縦向き", 11.5, INK, 700);
    const x0 = 62;
    s += `<circle cx="${x0}" cy="28" r="5" fill="${MUTED}"/>` + f.text(x0 + 11, 32, "始点", 10, MUTED, 700);
    s += `<circle cx="${x0}" cy="216" r="5" fill="${MUTED}"/>` + f.text(x0 + 11, 220, "終点", 10, MUTED, 700);
    // 分岐の線（本線からなめらかに離れ、分岐する路線の列につながる）
    s += `<path d="M${x0},128 A12,12 0 0 0 ${x0 + 12},140 L214,140 A12,12 0 0 1 226,152 L226,210" fill="none" stroke="${RED}" stroke-width="6"/>`;
    s += f.line(x0, 34, x0, 208, GREEN, 8, null); // 分岐元の線は、分岐の線の上に重ねる
    [
      [58, "○○IC", "始点から3.2km", 1, "ic"],
      [100, "××JCT", "始点から8.5km", 2, "jct"],
      [184, "□□IC", "始点から16.6km", 3, "ic"],
    ].forEach(([y, name, sub, n, type]) => {
      s += numberRing(x0 - 40, y, n, GREEN) + f.icShape(x0, y, type, 16);
      s += f.text(x0 + 16, y - 2, name, 11, INK, 700) + f.text(x0 + 16, y + 11, sub, 9, MUTED, 400);
    });
    s += f.text(x0 + 16, 124, "→ 分岐: △△線", 9.5, GREEN, 700);
    s += gapPill(x0, 79, "5.3km") + gapPill(x0, 162, "8.1km");
    // 分岐する路線の列
    s += f.text(238, 160, "△△線（分岐）", 10, RED, 700);
    s += numberRing(200, 184, 1, RED) + f.icShape(226, 184, "ic", 16);
    s += f.text(240, 182, "△△IC", 11, INK, 700) + f.text(240, 195, "分岐点から4.0km", 9, MUTED, 400);

    // 横向き: 始点が左、分岐する路線は下の行
    const ox = 332;
    s += f.text(ox, 20, "横向き", 11.5, INK, 700);
    const y0 = 76;
    s += `<circle cx="${ox + 14}" cy="${y0}" r="5" fill="${MUTED}"/>` + f.text(ox + 14, y0 - 12, "始点", 10, MUTED, 700, "middle");
    s += `<circle cx="${ox + 296}" cy="${y0}" r="5" fill="${MUTED}"/>` + f.text(ox + 296, y0 - 12, "終点", 10, MUTED, 700, "middle");
    s += `<path d="M${ox + 158},${y0} A12,12 0 0 1 ${ox + 170},${y0 + 12} L${ox + 170},146 A12,12 0 0 0 ${ox + 182},158 L${ox + 288},158" fill="none" stroke="${RED}" stroke-width="6"/>`;
    s += f.line(ox + 22, y0, ox + 288, y0, GREEN, 8, null);
    [
      [ox + 60, "○○IC", "3.2km", 1, "ic"],
      [ox + 128, "××JCT", "8.5km", 2, "jct"],
      [ox + 244, "□□IC", "16.6km", 3, "ic"],
    ].forEach(([x, name, sub, n, type]) => {
      s += numberRing(x, y0 - 28, n, GREEN) + f.icShape(x, y0, type, 16);
      s += f.text(x, y0 + 24, name, 11, INK, 700, "middle") + f.text(x, y0 + 37, sub, 9, MUTED, 400, "middle");
    });
    s += f.text(ox + 128, y0 + 51, "→ 分岐: △△線", 9.5, GREEN, 700, "middle");
    s += gapPill(ox + 94, y0, "5.3km") + gapPill(ox + 194, y0, "8.1km");
    s += f.text(ox + 184, 150, "△△線（分岐）", 10, RED, 700);
    s += numberRing(ox + 262, 158 - 28, 1, RED) + f.icShape(ox + 262, 158, "ic", 16);
    s += f.text(ox + 262, 158 + 24, "△△IC", 11, INK, 700, "middle") + f.text(ox + 262, 158 + 37, "分岐点から4.0km", 9, MUTED, 400, "middle");
    return svgWrap(W, H, s);
  }

  // name: data-figure の値（"tutorial:" で始まるもの以外）
  window.buildManualFigure = function (name, ctx) {
    if (!window.legendFigures) return "";
    if (name === "screen") return screenFig(ctx);
    if (name === "branch") return branchFig(ctx);
    if (name === "diagram") return diagramFig();
    return "";
  };
})();
