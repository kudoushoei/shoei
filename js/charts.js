// 外部ライブラリ無しの軽量SVG折れ線グラフ。
const Charts = (() => {
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /**
   * @param {{label:string, value:number|null}[]} points
   * @param {{unit?:string, target?:number, height?:number, color?:string, valueFormat?:(n:number)=>string}} opts
   */
  function lineChart(points, opts = {}) {
    const width = 320;
    const height = opts.height || 140;
    const padL = 4;
    const padR = 4;
    const padT = 14;
    const padB = 20;
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const color = opts.color || "var(--accent)";
    const fmt = opts.valueFormat || ((n) => String(Math.round(n * 10) / 10));

    const values = points.map((p) => p.value).filter((v) => v != null && !Number.isNaN(v));
    if (values.length === 0) {
      return `<div class="empty-state">まだデータがありません</div>`;
    }
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (opts.target != null) {
      min = Math.min(min, opts.target);
      max = Math.max(max, opts.target);
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const spanPad = (max - min) * 0.12;
    min -= spanPad;
    max += spanPad;

    const n = points.length;
    const x = (i) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const y = (v) => padT + innerH - ((v - min) / (max - min)) * innerH;

    let d = "";
    let areaD = "";
    let drawing = false;
    let lastX = null;
    points.forEach((p, i) => {
      if (p.value == null || Number.isNaN(p.value)) {
        drawing = false;
        return;
      }
      const px = x(i);
      const py = y(p.value);
      if (!drawing) {
        d += `M${px.toFixed(1)},${py.toFixed(1)} `;
        areaD += `M${px.toFixed(1)},${(padT + innerH).toFixed(1)} L${px.toFixed(1)},${py.toFixed(1)} `;
        drawing = true;
      } else {
        d += `L${px.toFixed(1)},${py.toFixed(1)} `;
        areaD += `L${px.toFixed(1)},${py.toFixed(1)} `;
      }
      lastX = px;
    });
    if (lastX != null) areaD += `L${lastX.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

    // グリッド線 (上端・下端の2本のみ、控えめに)
    const gridY = [padT, padT + innerH / 2, padT + innerH];

    // ラベルは最初と最後の日付のみ表示
    const firstLabel = points[0]?.label || "";
    const lastLabel = points[points.length - 1]?.label || "";

    const lastPoint = [...points].reverse().find((p) => p.value != null);
    const targetLineY = opts.target != null ? y(opts.target) : null;

    const gridLines = gridY
      .map((gy) => `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${width - padR}" y2="${gy.toFixed(1)}" class="grid-line"/>`)
      .join("");

    const targetLine =
      targetLineY != null
        ? `<line x1="${padL}" y1="${targetLineY.toFixed(1)}" x2="${width - padR}" y2="${targetLineY.toFixed(1)}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3,3"/>`
        : "";

    const endDot = lastPoint
      ? `<circle cx="${x(points.indexOf(lastPoint)).toFixed(1)}" cy="${y(lastPoint.value).toFixed(1)}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`
      : "";

    const valueLabel = lastPoint
      ? `<text x="${width - padR}" y="10" text-anchor="end" class="t-val">${esc(fmt(lastPoint.value))}${opts.unit ? " " + esc(opts.unit) : ""}</text>`
      : "";

    const svg = `
<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="推移グラフ" preserveAspectRatio="none" style="overflow:visible">
  <style>
    .grid-line { stroke: var(--border); stroke-width: 1; }
    .t-val { font-size: 11px; fill: var(--text-secondary); font-weight: 500; }
    .t-axis { font-size: 10px; fill: var(--text-muted); }
  </style>
  ${gridLines}
  ${targetLine}
  <path d="${areaD}" fill="${color}" opacity="0.10" stroke="none"/>
  <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  ${endDot}
  ${valueLabel}
  <text x="${padL}" y="${height - 4}" class="t-axis">${esc(firstLabel)}</text>
  <text x="${width - padR}" y="${height - 4}" text-anchor="end" class="t-axis">${esc(lastLabel)}</text>
</svg>`;
    return svg;
  }

  /**
   * @param {number} score 0-100
   * @param {{size?:number, stroke?:number, trackColor?:string, progressColor?:string, textColor?:string}} opts
   */
  function scoreRing(score, opts = {}) {
    const size = opts.size || 128;
    const stroke = opts.stroke || 11;
    const r = (size - stroke) / 2;
    const c = size / 2;
    const circumference = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, score)) / 100;
    const dash = circumference * pct;
    const trackColor = opts.trackColor || "rgba(212,175,55,0.16)";
    const gradFrom = opts.gradFrom || "#d4af37";
    const gradTo = opts.gradTo || "#f6e2a1";
    const textColor = opts.textColor || "#f3ead9";
    const gradId = `ringGrad${Math.round(score)}_${size}`;

    return `
<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="今日の採点 ${score}点">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${gradFrom}"/>
      <stop offset="100%" stop-color="${gradTo}"/>
    </linearGradient>
  </defs>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${trackColor}" stroke-width="${stroke}"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#${gradId})" stroke-width="${stroke}"
    stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}"
    transform="rotate(-90 ${c} ${c})"/>
  <text x="${c}" y="${c - 1}" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, 'Hiragino Mincho ProN', serif" font-size="${Math.round(size * 0.32)}" font-weight="700" fill="${textColor}">${Math.round(score)}</text>
  <text x="${c}" y="${c + size * 0.19}" text-anchor="middle" font-size="${Math.round(size * 0.09)}" fill="${gradFrom}" opacity="0.85">/ 100</text>
</svg>`;
  }

  return { lineChart, scoreRing };
})();
