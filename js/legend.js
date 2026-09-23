// マニュアルの「凡例」タブの中身を組み立てる（地図・路線図の実際の描画と同じ数値・同じ規則を使う）。
//
// 図はSVGで、画面表示（1px = 1CSSピクセル）を LEGEND_ZOOM 倍に拡大して描く（buildLegendHtml の opts.zoom で指定）。
// 線の太さ・破線・区分線・色は、app.js が渡す ctx（CATEGORIES / STATUSES / IC_TYPES /
// laneWeight / laneDividerSpecs など）から取得するため、地図の見た目を変えたときに
// 凡例も自動的に追従する。地図マーカー・ラベル・路線図の記号は css/style.css の
// 値（.vertex-marker / .ic-shape / .diagram-* など）を写した固定値なので、それらの
// CSSを変更したときは、このファイルの該当箇所も合わせて変更すること。
(function () {
  "use strict";

  let LEGEND_ZOOM = 2;
  const FONT = 'font-family="inherit"';

  // ---- SVG の共通部品 ------------------------------------------------------

  function fig(w, h, inner, zoom) {
    const z = zoom || LEGEND_ZOOM;
    return `<svg class="legend-fig" viewBox="0 0 ${w} ${h}" width="${w * z}" height="${h * z}" aria-hidden="true">${inner}</svg>`;
  }

  function line(x1, y1, x2, y2, stroke, width, dash, extra) {
    const d = dash ? ` stroke-dasharray="${dash}"` : "";
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"${d}${extra || ""}/>`;
  }

  function text(x, y, str, size, fill, weight, anchor) {
    return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight || 400}" text-anchor="${anchor || "start"}" ${FONT}>${str}</text>`;
  }

  // ---- 道路（線の種類・太さ・区分線・暫定の枠）----------------------------------
  // parts: [{ lanes, len, provisional }] を左から順につなげて描く（区間別の車線数の例に使う）。
  // 戻り値: { svg（要素の文字列）, height（必要な高さ）}
  function roadSvg(ctx, opts) {
    const status = ctx.STATUSES[opts.status || "inservice"];
    const color = opts.color;
    const parts = opts.parts;
    const x0 = opts.x || 0;
    const cy = opts.cy;
    let x = x0;
    let out = "";
    parts.forEach((part) => {
      const weight = ctx.laneWeight(part.lanes);
      const dash = status.dashArray(weight);
      out += line(x, cy, x + part.len, cy, color, weight, dash);
      if (!opts.noDividers && (opts.status === undefined || opts.status === "inservice")) {
        const specs = ctx.laneDividerSpecs(part.lanes, weight, !!part.provisional);
        specs.dividers.forEach((d) => {
          out += line(x, cy + d.offset, x + part.len, cy + d.offset, d.color, d.weight, d.dashArray);
        });
        if (specs.ghostHalf != null) {
          [-specs.ghostHalf, specs.ghostHalf].forEach((off) => {
            out += line(x, cy + off, x + part.len, cy + off, color, 1.5, "4,4", ' opacity="0.8"');
          });
        }
      }
      x += part.len;
    });
    return out;
  }

  // 図の高さ（道路の太さ・将来幅の枠が収まる高さ）
  function roadHeight(ctx, lanes, provisional) {
    const w = provisional ? (lanes + 2) * ctx.LANE_WIDTH_PX : ctx.laneWeight(lanes);
    return Math.ceil(w) + 12;
  }

  function roadFig(ctx, parts, opts) {
    opts = opts || {};
    const len = parts.reduce((a, p) => a + p.len, 0);
    const h = Math.max(...parts.map((p) => roadHeight(ctx, p.lanes, p.provisional)));
    const W = len + 16;
    return fig(W, h, roadSvg(ctx, { parts, color: opts.color || "#2e7d32", status: opts.status, noDividers: opts.noDividers, x: 8, cy: h / 2 }));
  }

  // ---- 地図上の点のマーク（css/style.css の .vertex-marker などと同じ形）--------

  const BLUE = "#1565c0";
  const START = "#1b7a3d";
  const END = "#e65100";
  const END_TEXT = "#c53f00"; // 終点のラベルの文字（白の地で 4.5:1 以上）

  // 文字列の描画幅の目安（全角は文字サイズ、半角は約0.55倍）
  function textWidth(str, size) {
    let w = 0;
    for (const ch of str) w += ch.charCodeAt(0) < 128 ? size * 0.58 : size;
    return w;
  }

  function labelBox(cx, cy, str, color, border, bold, size) {
    const w = Math.round(textWidth(str, size) + 12);
    return (
      `<rect x="${cx - w / 2}" y="${cy - 9}" width="${w}" height="18" rx="3" fill="#fff" fill-opacity="0.95" stroke="${border}" stroke-width="${bold ? 1.5 : 1}"/>` +
      text(cx, cy + size * 0.35, str, size, color, bold ? 700 : 400, "middle")
    );
  }

  // 点のマーク1個分のSVG要素（中心 cx, cy）。チュートリアル（js/tutorial.js）でも使う。
  // kind: start（始点。通常は円。個別にロックすると四角形になる）／end（終点（仮）。まだ動かせる円）／
  //       end-decided（終点（決定済み）。ロックされるため四角形）／vertex／mid／selected／locked
  function markerSvg(cx, cy, kind) {
    const circle = (fill) =>
      `<circle cx="${cx}" cy="${cy}" r="5.75" fill="${fill}" stroke="#fff" stroke-width="2.5"/>` +
      `<circle cx="${cx}" cy="${cy}" r="7.4" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>`;
    // ロック中の点は四角形（css の .vertex-marker.locked）
    const square = (fill) =>
      `<rect x="${cx - 5.75}" y="${cy - 5.75}" width="11.5" height="11.5" rx="1.5" fill="${fill}" stroke="#212121" stroke-width="2.5"/>`;
    if (kind === "start") return circle(START) + labelBox(cx, cy - 20, "始点", START, START, true, 11.6);
    if (kind === "end") return circle(END) + labelBox(cx, cy - 20, "終点（仮）", END_TEXT, END, true, 11.6);
    if (kind === "end-decided") return square(END) + labelBox(cx, cy - 20, "終点", END_TEXT, END, true, 11.6);
    if (kind === "vertex") return circle(BLUE);
    if (kind === "mid") {
      return `<circle cx="${cx}" cy="${cy}" r="4" fill="rgba(21,101,192,0.5)" stroke="rgba(255,255,255,0.85)" stroke-width="1"/>`;
    }
    if (kind === "selected") {
      // css の .vertex-marker.selected（同じ大きさで、黄色に塗り、細い赤い縁）を写したもの
      return `<circle cx="${cx}" cy="${cy}" r="7.75" fill="none" stroke="#d50000" stroke-width="1.5"/>` + circle("#ffb300");
    }
    if (kind === "locked") return square(BLUE);
    return "";
  }

  // 地図上の道路（背景）の上に置く点のマーク
  function vertexMark(kind) {
    const cx = 60;
    const labeled = kind === "start" || kind === "end" || kind === "end-decided"; // ラベルを上に出すため、高さを広げる
    const H = labeled ? 62 : 40;
    const cy = labeled ? 42 : 20;
    const out = line(0, cy, 120, cy, "#9e9e9e", 8, null, ' opacity="0.55"') + markerSvg(cx, cy, kind);
    return fig(120, H, out);
  }

  // ---- IC・JCT などの記号 ---------------------------------------------------

  function icShape(cx, cy, type, size) {
    const r = size / 2;
    if (type === "sapa") {
      const pts = [
        [0.5, 0],
        [1, 0.38],
        [0.82, 1],
        [0.18, 1],
        [0, 0.38],
      ]
        .map(([px, py]) => `${cx - r + px * size},${cy - r + py * size}`)
        .join(" ");
      return `<polygon points="${pts}" fill="#333"/>`;
    }
    if (type === "jct") {
      const s = size - 2;
      return `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="#fff" stroke="#333" stroke-width="2" transform="rotate(45 ${cx} ${cy})"/>`;
    }
    if (type === "toll") {
      return `<rect x="${cx - r + 1}" y="${cy - r + 1}" width="${size - 2}" height="${size - 2}" fill="#fff" stroke="#333" stroke-width="2"/>`;
    }
    if (type === "other") {
      // 「その他」施設は、5種類の図形から選べる（ここでは代表として三角を示す）
      const pts = [[0.5, 0], [1, 1], [0, 1]].map(([px, py]) => `${cx - r + px * size},${cy - r + py * size}`).join(" ");
      return `<polygon points="${pts}" fill="#fff" stroke="#333" stroke-width="2"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="#fff" stroke="#333" stroke-width="2"/>`;
  }

  function icFig(ctx, type, label) {
    const def = ctx.IC_TYPES[type];
    const cx = 40;
    const cy = 30;
    let out = line(0, cy, 240, cy, "#9e9e9e", 8, null, ' opacity="0.55"');
    out += icShape(cx, cy, type, def.size);
    let W = 240;
    if (label) {
      const lw = textWidth(label, 12.1) + 12;
      out += labelBox(cx + 12 + lw / 2, cy, label, "#1f2328", "#999", false, 12.1);
      W = Math.max(W, Math.ceil(cx + 12 + lw + 10));
    }
    out = line(0, cy, W, cy, "#9e9e9e", 8, null, ' opacity="0.55"') + out.replace(/^<line[^>]*\/>/, "");
    return fig(W, 60, out);
  }

  // ---- 路線図（模式図）の記号 ------------------------------------------------

  function diagramFig(ctx) {
    const color = "#2e7d32";
    const trackX = 66;
    const shapes = ["ic", "jct", "sapa"];
    const names = [
      ["○○IC", "IC（インターチェンジ） ・ 始点から3.2km"],
      ["××JCT", "JCT（ジャンクション） ・ 始点から18.5km"],
      ["●●PA", "SA・PA ・ 始点から30.0km"],
    ];
    let out = "";
    out += line(trackX, 26, trackX, 214, color, 6.6, null);
    out += `<circle cx="${trackX}" cy="16" r="6.6" fill="#5b6270"/>` + text(trackX + 16, 21, "始点", 13.2, "#5b6270", 700);
    out += `<circle cx="${trackX}" cy="226" r="6.6" fill="#5b6270"/>` + text(trackX + 16, 231, "終点", 13.2, "#5b6270", 700);
    shapes.forEach((type, i) => {
      const y = 62 + i * 56;
      // 施設番号を付けるのは IC・JCT だけ（SA・PAには付けない。縁はv1.55.0-betaで10%太くした）
      if (type !== "sapa") out += `<circle cx="20" cy="${y}" r="13.3" fill="#fff" stroke="${color}" stroke-width="2.2"/>` + text(20, y + 4.2, String(i + 1), 12.1, color, 700, "middle");
      // 施設のマーク自体は、v1.55.0-betaで20%大きくした
      if (type === "sapa") {
        const s = 18.5;
        const pts = [
          [0.5, 0],
          [1, 0.38],
          [0.82, 1],
          [0.18, 1],
          [0, 0.38],
        ]
          .map(([px, py]) => `${trackX - s / 2 + px * s},${y - s / 2 + py * s}`)
          .join(" ");
        out += `<polygon points="${pts}" fill="#333"/>`;
      } else if (type === "jct") {
        out += `<rect x="${trackX - 6.2}" y="${y - 6.2}" width="12.4" height="12.4" fill="#fff" stroke="#333" stroke-width="2.5" transform="rotate(45 ${trackX} ${y})"/>`;
      } else {
        out += `<circle cx="${trackX}" cy="${y}" r="7.7" fill="#fff" stroke="#333" stroke-width="2.5"/>`;
      }
      out += text(trackX + 30, y - 1, names[i][0], 13.2, "#1f2328", 700) + text(trackX + 30, y + 15, names[i][1], 12.1, "#5b6270", 400);
    });
    // 施設どうしの間の距離（IC間距離）。実際は線の上に白地の小さなラベルで重ねる（.diagram-gap）
    [["15.3km", 90], ["11.5km", 146]].forEach(([label, y]) => {
      const w = Math.round(textWidth(label, 11.5)) + 16;
      out += `<rect x="${trackX - w / 2}" y="${y - 9.5}" width="${w}" height="19" rx="9.5" fill="#fff" stroke="#e1e4e8"/>` + text(trackX, y + 4, label, 11.5, "#5b6270", 700, "middle");
    });
    return fig(380, 246, out, LEGEND_ZOOM * 0.8);
  }

  // 路線図: 車線数（線の太さ・区分線・暫定の枠）と、事業中・計画中の路線（破線・点線とバッジ）の見え方
  // 太さは、車線数 × 5px（app.js の DIAGRAM_LANE_PX）。区分線・暫定の枠は、地図と同じ規則（供用中の区間だけ）
  function diagramStatusFig() {
    const color = "#e53935";
    const x = 40;
    const P = 5; // 1車線あたりの太さ
    let out = "";
    out += `<rect x="6" y="6" width="190" height="20" rx="4" fill="#dcedc8"/>`;
    out += `<rect x="12" y="9" width="66" height="14" rx="7" fill="#fff4dc" stroke="#e0b060"/>` + text(45, 19.4, "一部事業中", 12, "#8a5300", 700, "middle");
    out += text(86, 20, "○○線", 13.2, "#1f2328", 700);
    // 暫定2車線（黄色の実線と、将来の幅を示す点線の枠）
    out += line(x, 40, x, 92, color, 2 * P, null);
    out += line(x, 40, x, 92, "#ffd600", 2.5, null);
    out += line(x - 2 * P, 40, x - 2 * P, 92, color, 1.5, "4,4");
    out += line(x + 2 * P, 40, x + 2 * P, 92, color, 1.5, "4,4");
    // 4車線（太い白の実線と、車線境界の白の破線）
    out += line(x, 92, x, 152, color, 4 * P, null);
    out += line(x, 92, x, 152, "#ffffff", 4, null);
    out += line(x - P, 92, x - P, 152, "#ffffff", 1.5, "8,8");
    out += line(x + P, 92, x + P, 152, "#ffffff", 1.5, "8,8");
    // 事業中の区間（破線。区分線・枠はない）
    out += line(x, 152, x, 190, color, 2 * P, "11,6");
    out += `<circle cx="${x}" cy="92" r="6.4" fill="#fff" stroke="#333" stroke-width="2.5"/>` + text(x + 30, 96, "○○IC", 13.2, "#1f2328", 700);
    out += `<circle cx="${x}" cy="152" r="6.4" fill="#fff" stroke="#333" stroke-width="2.5"/>` + text(x + 30, 156, "△△IC", 13.2, "#1f2328", 700);
    const label = "5.3km・4車線";
    const w = Math.round(textWidth(label, 11.5)) + 16;
    out += `<rect x="${x - w / 2}" y="112.5" width="${w}" height="19" rx="9.5" fill="#fff" stroke="#e1e4e8"/>` + text(x, 126, label, 11.5, "#1f2328", 700, "middle");
    out += text(x + 30, 60, "暫定2車線", 12.1, "#5b6270", 400);
    return fig(200, 200, out, LEGEND_ZOOM * 0.8);
  }

  // ---- 行・節のHTML -----------------------------------------------------------

  function row(figure, title, desc, wide) {
    return `<div class="legend-row${wide ? " legend-row-wide" : ""}"><div class="legend-figure">${figure}</div><div class="legend-text"><b>${title}</b><span>${desc}</span></div></div>`;
  }

  function section(id, title, intro, rows, note) {
    return (
      `<h3 id="${id}">${title}</h3>` +
      (intro ? `<p>${intro}</p>` : "") +
      `<div class="legend-list">${rows.join("")}</div>` +
      (note ? `<p class="manual-note">${note}</p>` : "")
    );
  }

  // ---- 本体 -------------------------------------------------------------------

  // チュートリアルなど、ほかのファイルから同じ描き方を使うための部品
  window.legendFigures = { line, text, textWidth, labelBox, roadSvg, markerSvg, icShape, START, END, BLUE };

  window.buildLegendHtml = function (ctx, opts) {
    LEGEND_ZOOM = (opts && opts.zoom) || 2;
    const G = ctx.CATEGORIES.expressway.color;
    const laneLabel = (n) => (n === 1 ? "1車線（対面通行）" : `${n}車線（往復${n / 2}車線ずつ）`);
    const html = [];

    html.push(
      `<nav class="manual-nav">
        <a href="#legend-h-status">状態（線の種類）</a>
        <a href="#legend-h-lanes">車線数</a>
        <a href="#legend-h-center">中央の線</a>
        <a href="#legend-h-provisional">暫定</a>
        <a href="#legend-h-segment">区間別の車線数</a>
        <a href="#legend-h-color">路線種別の色</a>
        <a href="#legend-h-point">点のマーク</a>
        <a href="#legend-h-ic">IC・JCT</a>
        <a href="#legend-h-diagram">路線図</a>
      </nav>`
    );

    html.push(
      `<p class="manual-note">地図に描かれる道路の見た目を、実際と同じ規則で並べた凡例です。図は<b>実際の画面の約${LEGEND_ZOOM}倍の大きさ</b>で表示しています。<b>路線の色は、路線ごとに、また区間ごとに自由に変えられます</b>（図の色は一例です。「路線種別の色」も参照）。</p>`
    );

    // 1. 状態
    html.push(
      section(
        "legend-h-status",
        "状態（線の種類）",
        "路線の「状態」は、線の種類で見分けます。路線の一部だけ状態が違うときは、地図上で2点以上を選ぶと使える「区間別の設定」で、その区間だけ変えられます（線の種類が、区間ごとに切り替わります）。",
        [
          row(roadFig(ctx, [{ lanes: 2, len: 150 }], { color: G, status: "inservice", noDividers: true }), "供用中（実線）", "すでに開通していて、通行できる区間。"),
          row(roadFig(ctx, [{ lanes: 2, len: 150 }], { color: G, status: "construction", noDividers: true }), "事業中・建設中（破線）", "工事や事業が進んでいる区間（まだ通行できない）。"),
          row(roadFig(ctx, [{ lanes: 2, len: 150 }], { color: G, status: "planned", noDividers: true }), "計画・構想中（点線）", "計画・構想の段階の区間。"),
        ],
        "上の図は、線の種類を見やすくするため区分線を省いています。実際の地図では、<b>供用中の路線だけ</b>、線の上に車線の区分線（下の「車線数」「中央の線」「暫定」）が描かれます。事業中・計画中の路線は、線の種類と太さだけで表します。"
      )
    );

    // 2. 車線数
    html.push(
      section(
        "legend-h-lanes",
        "車線数（線の太さと区分線）",
        `線の太さは車線数に比例します（1車線あたり${ctx.LANE_WIDTH_PX}px）。白い破線は、同じ向きの車線どうしの境界です。`,
        [1, 2, 4, 6, 8].map((n) => row(roadFig(ctx, [{ lanes: n, len: 150 }], { color: G }), laneLabel(n), n === 1 ? "区分線はありません。" : n === 2 ? "中央に白い破線が1本（対向車線との境）。" : `車線境界の白い破線が${n - 2}本と、中央の太い線（次の「中央の線」）。`))
      )
    );

    // 3. 中央の線
    html.push(
      section(
        "legend-h-center",
        "中央の線（対向車線との境）",
        "道路の中央にある線の<b>本数・色・線種</b>で、中央帯（中央分離帯）があるかどうかがわかります。",
        [
          row(roadFig(ctx, [{ lanes: 2, len: 150 }], { color: G }), "白の破線 1本", "通常の2車線。中央帯はなく、対面通行。"),
          row(roadFig(ctx, [{ lanes: 2, len: 150, provisional: true }], { color: G }), "黄色の実線 1本", "<b>暫定2車線</b>。中央帯がなく、対面通行（将来の4車線化に備えた形）。"),
          row(roadFig(ctx, [{ lanes: 4, len: 150 }], { color: G }), "白の太い実線 1本", "<b>4車線以上</b>。中央帯（中央分離帯）がある。暫定の路線でも同じ。"),
        ]
      )
    );

    // 4. 暫定
    html.push(
      section(
        "legend-h-provisional",
        "暫定（将来の幅を点線の枠で表示）",
        "「暫定形」を選んだ路線は、<b>将来の車線数（現在＋2車線）の幅</b>を、路線色の点線の枠で表します。枠の内側に、現在の道路が描かれます。",
        [2, 4, 6, 8].map((n) => row(roadFig(ctx, [{ lanes: n, len: 150, provisional: true }], { color: G }), `暫定${n}車線（将来${n + 2}車線）`, n === 2 ? "黄色の実線＋将来4車線分の枠。" : `中央帯は現在のまま（白の太い実線）。将来${n + 2}車線分の枠が外側に付く。`)),
        "「完成形」の路線には、点線の枠は付きません。1車線には暫定の設定はありません。"
      )
    );

    // 5. 区間別の車線数
    html.push(
      section(
        "legend-h-segment",
        "区間別の車線数",
        "1本の路線の中で、区間ごとに車線数を変えられます。区間の境目で、線の太さが変わります。",
        [
          row(
            roadFig(ctx, [{ lanes: 2, len: 70 }, { lanes: 4, len: 70 }, { lanes: 2, len: 70 }], { color: G }),
            "2車線 → 4車線 → 2車線",
            "一部の区間だけ4車線にした例（路線は「完成形」）。"
          ),
          row(
            roadFig(ctx, [{ lanes: 2, len: 70, provisional: true }, { lanes: 4, len: 70, provisional: true }, { lanes: 2, len: 70, provisional: true }], { color: G }),
            "暫定2車線の路線の一部を4車線に",
            "黄色の線と点線の枠が出るのは、<b>基本の車線数（この例では2車線）の区間だけ</b>。4車線の区間は完成した幅として描かれます。"
          ),
        ]
      )
    );

    // 6. 路線種別の色
    html.push(
      section(
        "legend-h-color",
        "路線種別の色",
        "路線種別を選ぶと、次の色と車線数の初期値が設定されます。<b>色は路線ごとに自由に変更できる</b>ので、実際の地図では、ここにない色の路線もあります。",
        Object.values(ctx.CATEGORIES).map((c) =>
          row(roadFig(ctx, [{ lanes: c.lanes, len: 150 }], { color: c.color }), c.label, `初期値は${c.lanes}車線。`)
        )
      )
    );

    // 7. 点のマーク
    html.push(
      section(
        "legend-h-point",
        "点のマーク（編集モード）",
        "路線を作る・直すときの点です。<b>選択中の路線の点だけ</b>が表示されます。",
        [
          row(vertexMark("start"), "始点（緑・丸）", "路線の最初の点。ドラッグで動かせます（個別にロックすると、動かせなくなり、四角形になります）。"),
          row(vertexMark("end"), "終点（仮）（オレンジ・丸）", "描画中の、いちばん最後の点。まだ動かせます。最後に、終点の「決定」スイッチをオンにするまでは「終点（仮）」と表示されます。"),
          row(vertexMark("end-decided"), "終点（決定済み）（オレンジ・四角形）", "終点の「決定」スイッチをオンにするとロックされ、四角形になります。動かす・点を追加するときは、サイドバーで、スイッチをオフにします。"),
          row(vertexMark("vertex"), "途中の点（青）", "ドラッグで移動。クリックで選択すると、地図上に「選択中の点」ツールバーが表示されます。"),
          row(vertexMark("mid"), "中間点（半透明の小さな点）", "点と点の間にあり、ドラッグすると、その位置に新しい点が追加されます。"),
          row(vertexMark("selected"), "選択中の点（黄色＋赤い縁）", "普通の点（青）と同じ大きさで、黄色に塗られ、細い赤い縁が付きます（始点・終点は色そのままで、同じ縁が付く。IC・JCTなど施設のマークがある点は、マークの周りに黄色と赤の縁が付く）。クリックで選択、もう一度クリックで解除。Ctrl+クリックで複数選択。"),
          row(vertexMark("locked"), "ロック中の点（四角形）", "移動・削除ができません。選択して、地図上の「選択中の点」ツールバーの「ロック」で解除。"),
        ]
      )
    );

    // 8. IC・JCT
    const labelName = { ic: "○○IC", jct: "××JCT", sapa: "●●PA", toll: "△△本線料金所", entrance: "交差点", other: "○○施設" };
    const icDesc = {
      ic: "インターチェンジ。",
      jct: "ジャンクション（道路どうしの分岐・合流）。",
      sapa: "サービスエリア・パーキングエリア。",
      toll: "本線上の料金所（四角）。路線図では、施設番号は付きません（番号を付けるのはIC・JCTだけです）。",
      entrance: "一般道との出入口・交差点（小さい○）。",
      other: "上記に当てはまらない、自由な施設。地図に描くときの図形を、5種類（三角・六角形・星・十字・八角形）から選べます。路線図では、施設番号は付きません。",
    };
    html.push(
      section(
        "legend-h-ic",
        "IC・JCT などの記号",
        "IC・JCT などは、種類ごとに形が違います。名称ラベルの常時表示は、路線図モードのサイドメニュー「施設の表示設定」で切り替えられます（非表示のときも、マウスを乗せると名称が見えます）。",
        Object.keys(ctx.IC_TYPES).map((type) => {
          const name = ctx.IC_TYPES[type].label.replace(/（.*$/, "");
          return row(icFig(ctx, type, labelName[type]), name, icDesc[type]);
        })
      )
    );

    // 9. 路線図
    html.push(
      section(
        "legend-h-diagram",
        "路線図（模式図）の記号",
        "「路線図」タブでは、開いている全路線を、上（始点）から下（終点）へ直線で表します。",
        [
          row(
            diagramFig(ctx),
            "路線図の見方",
            "施設のマークの色は、地図の施設点と同じ（黒い縁の白抜き、SA・PAは黒）です。左の丸数字は施設番号で、<b>IC・JCTだけ</b>に付きます（SA・PA、本線料金所、出入口には付きません）。自動では始点から終点へ 1, 2, 3… と数えますが、路線図モードのサイドバー「施設」タブで、手動（例: 9-1）や「表記しない」にもできます。線上の形は、IC＝○、JCT＝◇、SA・PA＝五角形。名称の下に種類と、始点からの距離を表示します。隣り合う施設の間の線の上には、その間の距離（IC間距離）を表示します。分岐する路線がある施設（JCT・IC）からは横に線が伸び、その路線が本線の横の列に並んで表示されます（その施設には「→ 分岐: ○○線」とも表示）。間隔は実際の距離に比例します。",
            true
          ),
          row(
            diagramStatusFig(),
            "車線数と、事業中・計画中の路線",
            "<b>事業中</b>の路線は破線、<b>計画中</b>の路線は点線で表し（地図と同じ）、見出しに「事業中」「計画中」のバッジを付けます（供用中の路線は実線で、バッジはありません）。路線の一部だけが事業中・計画中のときは、その区間だけ破線・点線になり、バッジは「一部事業中」などになります。図の見出しの下に、路線種別・状態・車線数（例: 暫定2車線）・全長を表示します。<b>線の太さ</b>は、車線数に比例します（1車線から8車線まで。地図の1.25倍）。<b>供用中の区間</b>には、地図と同じ車線の区分線が入ります（通常の2車線は白の破線、暫定2車線は黄色の実線、4車線以上は白の太い実線と車線境界の白の破線）。<b>暫定</b>の区間は、将来の幅（＋2車線）を示す点線の枠（路線の色）が両側に付きます。事業中・計画中の区間には、区分線・枠は付きません。<b>区間別の車線数</b>で、路線の基本の車線数と違う区間は、線の太さが変わり、その区間の距離のあとに車線数（例: 5.3km・4車線）も付きます。選んでいる路線は、見出し（分岐する路線は、その列全体）が緑に色づきます。",
            true
          ),
        ]
      )
    );

    return html.join("");
  };
})();
