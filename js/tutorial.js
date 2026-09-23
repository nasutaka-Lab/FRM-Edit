// チュートリアル（画像と説明を1枚ずつめくっていく）のスライドを組み立てる。
//
// 画像はSVG。道路の線・区分線・点のマーク・IC記号は、凡例（js/legend.js の window.legendFigures）と
// 同じ描き方を使うので、実際の地図の見た目と揃う。スライドを増減するときは、下の SLIDES を編集する。
// 画面（css/style.css）のボタンや文言を変えたときは、該当するスライドの図・説明も合わせて直すこと。
(function () {
  "use strict";

  const W = 325;
  const H = 162;
  const GREEN = "#2e7d32";
  const PRIMARY = "#1b7a3d";

  // ---- 図の部品 -------------------------------------------------------------

  function F() {
    return window.legendFigures;
  }

  function svgWrap(inner) {
    return `<svg class="tutorial-svg" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">${inner}</svg>`;
  }

  // 地図らしい背景（川・公園・街路）
  function bg() {
    return (
      `<rect width="${W}" height="${H}" fill="#eceee4"/>` +
      `<rect x="232" y="98" width="70" height="42" rx="6" fill="#d3e6c4"/>` +
      `<path d="M0,146 C60,126 92,158 152,148 S262,128 325,148 L325,162 L0,162Z" fill="#b9d9ee"/>` +
      `<line x1="0" y1="30" x2="325" y2="46" stroke="#fff" stroke-width="3"/>` +
      `<line x1="0" y1="96" x2="325" y2="84" stroke="#fff" stroke-width="3"/>` +
      `<line x1="70" y1="0" x2="86" y2="162" stroke="#fff" stroke-width="3"/>` +
      `<line x1="196" y1="0" x2="182" y2="162" stroke="#fff" stroke-width="3"/>` +
      `<line x1="0" y1="62" x2="325" y2="66" stroke="#dcdcd2" stroke-width="1.5"/>` +
      `<line x1="130" y1="0" x2="138" y2="162" stroke="#dcdcd2" stroke-width="1.5"/>`
    );
  }

  // 2点 p, q の間に、道路（線種・車線数・区分線つき）を1区間描く
  function seg(ctx, p, q, lanes, o) {
    o = o || {};
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const road = F().roadSvg(ctx, {
      parts: [{ lanes, len, provisional: !!o.provisional }],
      color: o.color || GREEN,
      status: o.status,
      noDividers: o.noDividers,
      x: 0,
      cy: 0,
    });
    return `<g transform="translate(${p[0]} ${p[1]}) rotate(${angle})">${road}</g>`;
  }

  function marker(x, y, kind) {
    return F().markerSvg(x, y, kind);
  }

  // 吹き出し風の注釈（暗い地に白文字）
  function tip(cx, cy, str, o) {
    o = o || {};
    const w = Math.round(F().textWidth(str, 10) + 12);
    const h = 16;
    const fill = o.fill || "#1f2328";
    return (
      `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="4" fill="${fill}" fill-opacity="0.92"/>` +
      F().text(cx, cy + 3.6, str, 10, "#fff", 700, "middle")
    );
  }

  // 手順の番号バッジ
  function badge(x, y, n) {
    return `<circle cx="${x}" cy="${y}" r="7.5" fill="${PRIMARY}" stroke="#fff" stroke-width="1.5"/>` + F().text(x, y + 3.4, String(n), 9.5, "#fff", 700, "middle");
  }

  // ボタンの見た目（画面のボタンを模したもの）
  function button(x, y, w, h, label, o) {
    o = o || {};
    const fill = o.primary ? PRIMARY : "#fff";
    const stroke = o.primary ? PRIMARY : "#c9ccd1";
    const color = o.primary ? "#fff" : "#1f2328";
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1"/>` +
      F().text(x + w / 2, y + h / 2 + 3.4, label, o.size || 9, color, 700, "middle")
    );
  }

  function ring(x, y, w, h) {
    return `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="6" fill="none" stroke="#d50000" stroke-width="2"/>`;
  }

  function key(x, y, label) {
    const w = Math.round(F().textWidth(label, 10) + 12);
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="16" rx="3" fill="#fff" stroke="#c9ccd1" stroke-width="1"/>` +
      `<line x1="${x + 2}" y1="${y + 16}" x2="${x + w - 2}" y2="${y + 16}" stroke="#9aa0a6" stroke-width="1.5"/>` +
      F().text(x + w / 2, y + 11.4, label, 10, "#1f2328", 700, "middle")
    );
  }

  // ---- スライド ---------------------------------------------------------------

  function slides(ctx) {
    const f = F();
    const list = [];

    // 1. ようこそ
    list.push({
      title: "ようこそ",
      body:
        "<p>実在の地図の上に、<b>架空の高速道路・国道など</b>を作るツールです。IC・JCT、車線数、事業中・計画中などの状態まで設定できます。</p>" +
        "<p>機能が多いので、基本の流れを<b>10枚</b>で紹介します。「次へ」で進んでください（矢印キーでも操作できます）。</p>",
      figure: () => {
        const a = [16, 132];
        const b = [196, 54];
        const c = [300, 22];
        let s = bg();
        s += seg(ctx, a, b, 4);
        s += seg(ctx, b, c, 4, { status: "construction" });
        const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const p1 = at(0.38);
        const p2 = at(0.72);
        // JCTからは、別の路線（2車線）が分岐する
        const q = [296, 120];
        s += seg(ctx, p2, q, 2, { color: "#00796b" });
        s += f.icShape(p1[0], p1[1], "ic", 16) + f.labelBox(p1[0] + 34, p1[1] + 16, "○○IC", "#1f2328", "#999", false, 12.1);
        s += f.icShape(p2[0], p2[1], "jct", 16) + f.labelBox(p2[0] - 30, p2[1] - 18, "××JCT", "#1f2328", "#999", false, 12.1);
        s += tip(246, 92, "JCTで分岐");
        s += f.icShape(b[0], b[1], "sapa", 16) + f.labelBox(b[0] - 26, b[1] - 16, "●●PA", "#1f2328", "#999", false, 12.1);
        s += tip(258, 60, "事業中（破線）");
        return s;
      },
    });

    // 2. 路線を追加
    list.push({
      title: "路線を追加する",
      body:
        "<p>画面の右側にある<b>サイドバー</b>の「<b>路線を追加</b>」を押すと、新しい路線ができます。</p>" +
        "<ul><li>路線名・路線種別・状態（供用中／事業中／計画中）・色・車線数は、選んだ路線のサイドバーで設定します</li><li>路線は何本でも作れ、一覧をクリックして切り替えます</li><li>別の路線の施設から枝分かれする路線は、サイドバーの「JCT・ICでの分岐」欄で設定します</li></ul>",
      figure: () => {
        let s = bg();
        s += `<rect x="202" y="0" width="123" height="${H}" fill="#f6f7f8"/><line x1="202" y1="0" x2="202" y2="${H}" stroke="#e1e4e8"/>`;
        s += `<rect x="210" y="10" width="107" height="44" rx="5" fill="#fff" stroke="#e1e4e8"/>`;
        s += f.text(218, 26, "路線", 9, "#5b6270", 700);
        s += button(256, 15, 54, 16, "路線を追加", { primary: true, size: 8 });
        s += `<rect x="216" y="36" width="94" height="12" rx="3" fill="#dcedc8"/>` + f.text(222, 45, "路線1", 8, "#1f2328", 700);
        s += ring(256, 15, 54, 16);
        s += `<rect x="210" y="62" width="107" height="90" rx="5" fill="#fff" stroke="#e1e4e8"/>`;
        s += f.text(218, 78, "路線1", 9, "#1f2328", 700);
        ["路線種別", "状態", "基本の車線数"].forEach((t, i) => {
          s += f.text(218, 94 + i * 18, t, 7.5, "#5b6270", 700) + `<rect x="218" y="${97 + i * 18}" width="90" height="8" rx="2" fill="#eceef1"/>`;
        });
        s += tip(100, 80, "ここは地図（クリックで点を置く）");
        s += badge(247, 23, 1);
        return s;
      },
    });

    // 3. 始点→順次→終点決定
    list.push({
      title: "始点から順に描き、終点を決める",
      body:
        "<ol><li><b>始点を置く</b>：地図をクリックします</li>" +
        "<li><b>路線を順に描く</b>：地図を順にクリックして点を追加。最後の点は「終点（仮）」で、まだ動かせます</li>" +
        "<li><b>終点を決定</b>：最後の点を置いたら、サイドバーの終点の「決定」スイッチをオンにします</li></ol>" +
        "<p>終点のロックは、サイドバーの「決定」スイッチをオフにして解除できます。</p>",
      figure: () => {
        const P = [
          [28, 118],
          [84, 62],
          [140, 96],
          [204, 44],
          [262, 88],
        ];
        let s = bg();
        for (let i = 0; i < P.length - 1; i++) s += seg(ctx, P[i], P[i + 1], 2, { color: "#e53935" });
        s += marker(P[0][0], P[0][1], "start");
        [1, 2, 3].forEach((i) => (s += marker(P[i][0], P[i][1], "vertex")));
        s += marker(P[4][0], P[4][1], "end");
        s += badge(P[0][0] - 20, P[0][1] + 8, 1);
        s += badge(P[2][0] + 2, P[2][1] + 20, 2);
        s += badge(P[4][0] + 20, P[4][1] + 8, 3);
        // 終点の「決定」スイッチ（オン）
        s += `<rect x="212" y="128" width="38" height="20" rx="10" fill="${PRIMARY}"/><circle cx="240" cy="138" r="8" fill="#fff"/>`;
        s += f.text(258, 142, "終点：決定", 10, "#1f2328", 700);
        return s;
      },
    });

    // 4. 点を動かす・選ぶ
    list.push({
      title: "点を動かす・選ぶ",
      body:
        "<ul><li>点を<b>ドラッグ</b>して移動します</li>" +
        "<li>点と点の間の<b>半透明の小さな点（中間点）</b>をドラッグすると、その位置に新しい点が追加されます</li>" +
        "<li>点をクリックすると選択（<b>黄色＋赤い縁</b>）。<b>Ctrl+クリック</b>で複数選択できます</li>" +
        "<li>Deleteキーで選択中の点を削除します（ロック中の点を除く）</li></ul>",
      figure: () => {
        const y = 84;
        let s = bg();
        s += seg(ctx, [18, y], [310, y], 2, { color: "#e53935" });
        s += marker(50, y, "vertex") + tip(50, y - 24, "ドラッグで移動");
        s += marker(118, y, "mid") + tip(118, y + 26, "中間点をドラッグ→点が増える");
        s += marker(196, y, "selected") + tip(196, y - 30, "選択中");
        s += marker(262, y, "selected") + tip(262, y + 28, "Ctrl+クリックで複数選択");
        return s;
      },
    });

    // 5. 点を選んで設定する
    list.push({
      title: "点を選んで設定する",
      body:
        "<p>点を<b>クリック</b>すると選ばれ、右側のサイドバーに<b>施設設定</b>欄が開きます（IC・JCTなどを設定できます）。</p>" +
        "<ul><li>地図の上には、選んだ点を操作する小さなツールバーが表示されます</li>" +
        "<li><b>ロック</b>（動かせなくする）／<b>削除</b>／<b>選択を解除</b></li></ul>",
      figure: () => {
        let s = bg();
        s += seg(ctx, [20, 132], [120, 60], 2, { color: "#e53935" });
        s += seg(ctx, [120, 60], [230, 96], 2, { color: "#e53935" });
        s += marker(120, 60, "selected") + tip(120, 40, "クリックして選択");
        // 選択中の点のツールバー（地図の右下に重ねて表示）
        const items = ["ロック", "削除", "選択を解除"];
        const x = 118;
        const y = 108;
        let bx = x;
        s += `<rect x="${x - 6}" y="${y - 12}" width="216" height="26" rx="6" fill="#fff" stroke="#d0d4d9"/>`;
        items.forEach((t) => {
          const w = t.length * 9.5 + 12;
          s += `<rect x="${bx}" y="${y - 6}" width="${w}" height="14" rx="4" fill="#f6f7f8" stroke="#d0d4d9"/>`;
          s += f.text(bx + w / 2, y + 3.6, t, 8, "#1f2328", 700, "middle");
          bx += w + 6;
        });
        return s;
      },
    });

    // 6. 路線の見た目
    list.push({
      title: "路線の見た目を設定する",
      body:
        "<p>サイドバーで、次を選びます。</p>" +
        "<ul><li><b>状態</b>：供用中（実線）／事業中（破線）／計画中（点線）。点を2つ以上選んでいる間は、その区間だけの状態にできます</li>" +
        "<li><b>基本の車線数</b>：1・2・4・6・8車線（線の太さが変わります）</li>" +
        "<li><b>供用形態</b>：「暫定形」にすると、将来の幅が点線の枠で表示されます（暫定2車線は黄色の実線）</li></ul>" +
        "<p>地図左下の「<b>凡例</b>」ボタンで、線の見方を図で確認できます。</p>",
      figure: () => {
        let s = bg();
        const rows = [
          [26, "供用中（実線）", { status: "inservice", noDividers: true }, 2],
          [70, "事業中（破線）", { status: "construction", noDividers: true }, 2],
          [114, "計画中（点線）", { status: "planned", noDividers: true }, 2],
        ];
        rows.forEach(([y, label, o, lanes]) => {
          s += seg(ctx, [14, y], [116, y], lanes, o) + f.text(14, y - 12, label, 9, "#1f2328", 700);
        });
        const rows2 = [
          [26, "2車線", 2, false],
          [70, "暫定2車線", 2, true],
          [114, "4車線", 4, false],
        ];
        rows2.forEach(([y, label, lanes, prov]) => {
          s += seg(ctx, [176, y], [312, y], lanes, { provisional: prov }) + f.text(176, y - 14 - (prov ? 4 : 0), label, 9, "#1f2328", 700);
        });
        return s;
      },
    });

    // 7. 区間別の車線数
    list.push({
      title: "区間ごとに車線数を変える",
      body:
        "<p>1本の路線の中で、一部の区間だけ車線数を変えられます（例：暫定2車線の路線の一部だけ4車線）。状態・色・供用形態も、同じ操作で区間ごとに変えられます。</p>" +
        "<ol><li>地図上で、<b>Ctrl</b>+クリックで、区間の両端にする2点を選ぶ</li>" +
        "<li>いつもの状態・色・車線数・供用形態を選ぶと、その場ですぐに反映される</li></ol>",
      figure: () => {
        const y = 84;
        let s = bg();
        s += seg(ctx, [16, y], [104, y], 2);
        s += seg(ctx, [104, y], [216, y], 4);
        s += seg(ctx, [216, y], [310, y], 2);
        s += marker(104, y, "selected") + marker(216, y, "selected");
        s += tip(104, y - 30, "Ctrl+クリック") + tip(216, y - 30, "Ctrl+クリック");
        s += `<path d="M104,${y + 22} L104,${y + 28} L216,${y + 28} L216,${y + 22}" fill="none" stroke="${PRIMARY}" stroke-width="2"/>`;
        s += tip(160, y + 42, "この区間だけ4車線", { fill: PRIMARY });
        return s;
      },
    });

    // 8. IC・JCT
    list.push({
      title: "IC・JCT を設定する",
      body:
        "<ul><li><b>施設設定</b>：点を選ぶと、サイドバーに開きます。種類（IC／JCT／SA・PA／本線料金所／出入口／その他）と名称を入力</li>" +
        "<li>施設は、別の路線を分岐させる位置にもなります（サイドバーの「JCT・ICでの分岐」）</li></ul>" +
        "<p>設定した施設は、地図に印が付き、「路線図」にも並びます。</p>",
      figure: () => {
        let s = bg();
        const types = [
          ["ic", "IC", 34],
          ["jct", "JCT", 62],
          ["sapa", "SA・PA", 90],
          ["toll", "本線料金所", 118],
        ];
        s += `<rect x="10" y="14" width="98" height="${types.length * 28 + 6}" rx="6" fill="#fff" fill-opacity="0.9" stroke="#d0d4d9"/>`;
        types.forEach(([t, label, y]) => {
          s += f.icShape(30, y, t, 16) + f.text(46, y + 3.6, label, 10, "#1f2328", 700);
        });
        // 道路と、その上のIC（名称を入力した施設）
        s += seg(ctx, [130, 132], [314, 56], 4);
        s += f.icShape(222, 94, "ic", 16);
        s += tip(250, 122, "名称を入力（例: ○○IC）");
        return s;
      },
    });

    // 9. 路線図・保存
    list.push({
      title: "路線図・保存",
      body:
        "<ul><li><b>路線図</b>タブ：開いている全路線を、直線の模式図で表示（JCTで分岐している路線は本線の横に並び、独立した路線は別の図になります。IC・JCTには施設番号が付きます）。サイドバーの「施設」タブ（施設の表示設定）で、番号を手動入力したり「表記しない」にしたりできます</li>" +
        "<li><b>保存</b>：地図名を入れて「保存」メニューの「保存する」を押すと、ブラウザに残ります（「開く」から読み込み）。同じメニューから、JSONファイルの書き出し・読み込みもできます（共有・バックアップ用）</li>"  + "</ul>",
      figure: () => {
        let s = `<rect width="${W}" height="${H}" fill="#fff"/>`;
        // 路線図
        const tx = 56;
        s += f.line(tx, 26, tx, 138, GREEN, 5, null);
        s += `<circle cx="${tx}" cy="18" r="5" fill="#5b6270"/>` + f.text(tx + 11, 21.5, "始点", 9, "#5b6270", 700);
        s += `<circle cx="${tx}" cy="146" r="5" fill="#5b6270"/>` + f.text(tx + 11, 149.5, "終点", 9, "#5b6270", 700);
        // JCTから分岐する路線は、本線の横に列として並ぶ（横線でつなぐ）
        const BR = "#00796b";
        const bxTrack = 150;
        s += `<rect x="${tx}" y="96" width="${bxTrack - tx}" height="4.4" fill="${BR}"/>`;
        s += f.line(bxTrack, 98, bxTrack, 144, BR, 5, null);
        s += `<circle cx="${bxTrack - 22}" cy="122" r="10" fill="#fff" stroke="${BR}" stroke-width="1.5"/>` + f.text(bxTrack - 22, 125.5, "1", 9.5, BR, 700, "middle");
        s += f.icShape(bxTrack, 122, "ic", 12) + f.text(bxTrack + 16, 125.5, "△△IC", 10, "#1f2328", 700);
        [["ic", 50, "○○IC"], ["jct", 84, "××JCT"], ["sapa", 118, "●●PA"]].forEach(([t, y, name], i) => {
          if (t !== "sapa") s += `<circle cx="20" cy="${y}" r="10" fill="#fff" stroke="${GREEN}" stroke-width="1.5"/>` + f.text(20, y + 3.5, String(i + 1), 9.5, GREEN, 700, "middle");
          s += f.icShape(tx, y, t, 12) + f.text(tx + 16, y + 3.5, name, 10, "#1f2328", 700);
        });
        // ボタン
        const bx = 206;
        s += button(bx, 22, 46, 18, "保存", { primary: true, size: 10 }) + f.text(bx + 52, 35, "保存・書き出し", 8.5, "#1f2328", 400);
        s += button(bx, 50, 46, 18, "開く", { size: 10 }) + f.text(bx + 52, 63, "保存済みの地図", 8.5, "#1f2328", 400);
        s += button(bx, 78, 46, 18, "路線図", { size: 10 }) + f.text(bx + 52, 91, "模式図で確認", 8.5, "#1f2328", 400);
        return s;
      },
    });

    // 10. 困ったときは
    list.push({
      title: "困ったときは",
      body:
        "<ul><li><b>元に戻す</b>：Ctrl+Z（やり直しはCtrl+Y）。トップバーのボタンでも操作できます</li>" +
        "<li><b>凡例</b>：地図左下のボタンで、線・点・記号の見方を確認</li>" +
        "<li><b>マニュアル</b>：詳しい使い方（トップバーの「マニュアル」から、いつでも開けます）</li></ul>",
      figure: () => {
        let s = bg();
        s += `<rect x="14" y="12" width="297" height="118" rx="8" fill="#fff" fill-opacity="0.94" stroke="#d0d4d9"/>`;
        const rows = [
          [["Ctrl", "Z"], "元に戻す"],
          [["Ctrl", "Y"], "やり直し"],
          [["Delete"], "選択した点を削除"],
          [["Esc"], "選択を解除"],
        ];
        rows.forEach(([keys, label], i) => {
          const y = 22 + i * 24;
          let x = 26;
          keys.forEach((k, j) => {
            if (j > 0) {
              s += f.text(x + 1, y + 11, "+", 10, "#5b6270", 700);
              x += 11;
            }
            s += key(x, y, k);
            x += Math.round(f.textWidth(k, 10) + 12) + 4;
          });
          s += f.text(150, y + 11.5, label, 10.5, "#1f2328", 700);
        });
        s += button(14, 138, 40, 18, "凡例", { size: 10 }) + tip(84, 147, "地図の左下", { fill: PRIMARY });
        s += button(224, 138, 88, 18, "マニュアル", { size: 9.5 });
        return s;
      },
    });

    return list.map((s) => ({ title: s.title, body: s.body, figure: svgWrap(s.figure()) }));
  }

  // ctx は buildLegendHtml と同じもの（app.js が渡す）
  window.buildTutorialSlides = function (ctx) {
    return slides(ctx);
  };
})();
