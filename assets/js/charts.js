/* ==========================================================================
 * charts.js —— 轻量可视化（无任何第三方库，纯 DOM + SVG）
 *  · hBar()      横向柱状图（支持以 0 为轴的双向条，红涨绿跌）
 *  · sparkline() 迷你分时走势
 *  · 统一的数字 / 金额 / 百分比格式化
 * ========================================================================== */

(function () {
  /* ---------------- 格式化 ---------------- */
  function fmtNum(n, d) {
    if (n === null || n === undefined || isNaN(n)) return '--';
    return Number(n).toLocaleString('zh-CN', {
      minimumFractionDigits: d === undefined ? 2 : d,
      maximumFractionDigits: d === undefined ? 2 : d
    });
  }

  function fmtPct(n) {
    if (n === null || n === undefined || isNaN(n)) return '--';
    const s = Number(n).toFixed(2);
    return (n > 0 ? '+' : '') + s + '%';
  }

  /** 金额：自动切换 万 / 亿 / 万亿 */
  function fmtMoney(n) {
    if (n === null || n === undefined || isNaN(n)) return '--';
    const abs = Math.abs(n);
    const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
    if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + '万亿';
    if (abs >= 1e8) return sign + (abs / 1e8).toFixed(2) + '亿';
    if (abs >= 1e4) return sign + (abs / 1e4).toFixed(2) + '万';
    return sign + abs.toFixed(0);
  }

  /** 成交额等“只有大小没有正负”的场景：不带符号 */
  function fmtAmt(n) {
    if (n === null || n === undefined || isNaN(n)) return '--';
    const abs = Math.abs(n);
    if (abs >= 1e12) return (abs / 1e12).toFixed(2) + '万亿';
    if (abs >= 1e8) return (abs / 1e8).toFixed(2) + '亿';
    if (abs >= 1e4) return (abs / 1e4).toFixed(2) + '万';
    return abs.toFixed(0);
  }

  /** 涨跌方向：正=up(红) 负=down(绿) 零=flat */
  function dir(n) {
    if (n === null || n === undefined || isNaN(n)) return 'flat';
    if (n > 0) return 'up';
    if (n < 0) return 'down';
    return 'flat';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      // 用数字实体，避免不同来源文本被二次解析
      if (c === '&') return '&#38;';
      if (c === '<') return '&#60;';
      if (c === '>') return '&#62;';
      if (c === '"') return '&#34;';
      return '&#39;';
    });
  }

  /* ---------------- 横向柱状图 ----------------
   * rows: [{ label, value, text, sub }]
   * opts: { mode: 'center' | 'left' }
   */
  function hBar(container, rows, opts) {
    opts = opts || {};
    const mode = opts.mode || 'center';
    if (!container) return;
    if (!rows || !rows.length) {
      container.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }
    container.setAttribute('data-mode', mode);
    const max = Math.max.apply(null, rows.map((r) => Math.abs(r.value || 0))) || 1;

    container.innerHTML = rows.map((r, i) => {
      const v = r.value || 0;
      const d = dir(v);
      const pct = (Math.abs(v) / max) * 100;
      let left, width;
      if (mode === 'center') {
        left = v >= 0 ? 50 : 50 - pct / 2;
        width = pct / 2;
      } else {
        left = 0;
        width = pct;
      }
      return '' +
        '<div class="bar-row" style="animation-delay:' + (i * 35) + 'ms">' +
          '<div class="bar-rank">' + (i + 1) + '</div>' +
          '<div class="bar-label" title="' + escapeHtml(r.label) + '">' + escapeHtml(r.label) + '</div>' +
          '<div class="bar-track">' +
            '<span class="bar-zero"></span>' +
            '<span class="bar-fill ' + d + '" style="left:' + left + '%;width:' + width + '%"></span>' +
            (r.sub ? '<span class="bar-sub ' + d + '">' + escapeHtml(r.sub) + '</span>' : '') +
          '</div>' +
          '<div class="bar-value ' + d + '">' + escapeHtml(r.text) + '</div>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 迷你分时走势 ---------------- */
  function sparkline(container, points, color) {
    if (!container) return;
    if (!points || points.length < 2) {
      container.innerHTML = '';
      return;
    }
    const w = 100, h = 30;
    const vals = points.map((p) => p.value);
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const range = (max - min) || 1;
    const step = w / (points.length - 1);
    const path = points.map((p, i) => {
      const x = (i * step).toFixed(2);
      const y = (h - ((p.value - min) / range) * (h - 2) - 1).toFixed(2);
      return x + ',' + y;
    }).join(' ');

    const stroke = color || (vals[vals.length - 1] >= vals[0] ? '#ff5252' : '#12b886');
    container.innerHTML =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
        '<polyline points="' + path + '" fill="none" stroke="' + stroke +
        '" stroke-width="1.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '</svg>';
  }

  /* ==========================================================================
   * 专业图表：K 线（蜡烛 + 成交量 + 资金流）与 当日分时（价格 + 均价 + 量）
   * 纯 SVG 手写，不依赖任何第三方库
   * ========================================================================== */

  const CV = { W: 900, H: 420, left: 12, right: 826, label: 834 };
  const CV_MAIN = { top: 14, bottom: 246 };    // 价格区
  const CV_VOL = { top: 264, bottom: 320 };    // 成交量区
  const CV_FLOW = { top: 336, bottom: 394 };   // 资金流区
  // 分时图没有资金流区，用更矮的画布，避免底部留一大块空白
  const CV_IT = { H: 336, top: 14, bottom: 246, volTop: 264, volBottom: 320, tickY: 332 };

  function svgScale(min, max, top, bottom) {
    const range = (max - min) || 1;
    return (v) => top + (max - v) / range * (bottom - top);
  }

  /** 通用移动平均：pick(k) 取数值，不足周期返回 null */
  function maSeries(klines, n, pick) {
    pick = pick || ((k) => k.close);
    const out = [];
    let sum = 0;
    for (let i = 0; i < klines.length; i++) {
      sum += pick(klines[i]);
      if (i >= n) sum -= pick(klines[i - n]);
      out.push(i >= n - 1 ? sum / n : null);
    }
    return out;
  }

  const MA_COLORS = ['#f2b544', '#4c8dff', '#b07cff'];

  function tooltipHtml(k, flow, hasFlow) {
    const dir = k.close >= k.open ? 'up' : 'down';
    const row = (label, val, cls) =>
      '<div class="tt-row"><span>' + label + '</span><b class="' + (cls || '') + '">' + val + '</b></div>';
    return '<div class="tt-title">' + escapeHtml(k.date) + '</div>' +
      row('开盘', fmtNum(k.open), dir) +
      row('收盘', fmtNum(k.close), dir) +
      row('最高', fmtNum(k.high), dir) +
      row('最低', fmtNum(k.low), dir) +
      row('涨跌幅', fmtPct(k.pct), dir) +
      row('成交量', fmtAmt(k.volume)) +
      row('成交额', fmtAmt(k.amount)) +
      (k.turnover !== null && k.turnover !== undefined ? row('换手率', fmtNum(k.turnover) + '%') : '') +
      (hasFlow ? row('主力净流入', fmtMoney(flow ? flow.main : null), flow && flow.main > 0 ? 'up' : 'down') : '');
  }

  /**
   * K 线图（支持滚轮缩放 + 拖拽平移）
   * klines: [{date, open, close, high, low, volume, amount, pct, turnover}]
   * opts:   { flows: [{date, main}], ma: [5,10,20] }
   */
  function candlestick(container, klines, opts) {
    opts = opts || {};
    if (!container) return;
    if (!klines || !klines.length) {
      container.innerHTML = '<div class="empty">暂无 K 线数据</div>';
      return;
    }
    const flows = opts.flows || [];
    const hasFlow = flows.length > 0;
    const flowMap = {};
    flows.forEach((f) => { flowMap[f.date] = f; });
    const CV_H = hasFlow ? CV.H : CV_IT.H;
    const TICK_Y = hasFlow ? 412 : CV_IT.tickY;

    const n = klines.length;
    const mas = (opts.ma || [5, 10, 20]).map((p) => ({ period: p, data: maSeries(klines, p) }));
    let min = 0, max = 100, y = null;
    const maxVol = Math.max.apply(null, klines.map((k) => k.volume || 0)) || 1;
    const maxFlow = Math.max.apply(null, flows.map((f) => Math.abs(f.main || 0))) || 1;
    const flowMid = (CV_FLOW.top + CV_FLOW.bottom) / 2;
    const lastK = klines[n - 1];
    const lastCol = lastK.close >= lastK.open ? '#ff4d4f' : '#12b886';

    // ---- 视口状态 ----
    const view = {
      count: Math.min(120, n),
      start: Math.max(0, n - 120)
    };

    // 根据 view.start / view.count 动态画数据层（Y 轴随可视窗口自适应，放大波动）
    function renderData() {
      const s = view.start;
      const c = view.count;
      const bw = (CV.right - CV.left) / c;
      const cx = (i) => CV.left + i * bw + bw / 2;
      const end = Math.min(n, s + c);
      const visibleN = end - s;

      // 按可视窗口算 min/max，padding 收紧到 3%
      let vmin = Infinity, vmax = -Infinity;
      for (let i = s; i < end; i++) {
        if (klines[i].low < vmin) vmin = klines[i].low;
        if (klines[i].high > vmax) vmax = klines[i].high;
        for (let mi = 0; mi < mas.length; mi++) {
          const v = mas[mi].data[i];
          if (v !== null) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
        }
      }
      const pad = (vmax - vmin) * 0.03 || 1;
      min = vmin - pad; max = vmax + pad;
      y = svgScale(min, max, CV_MAIN.top, CV_MAIN.bottom);

      let body = '';
      for (let i = s; i < end; i++) {
        const k = klines[i];
        const up = k.close >= k.open;
        const col = up ? '#ff4d4f' : '#12b886';
        const yo = y(k.open), yc = y(k.close);
        const top = Math.min(yo, yc);
        const h = Math.max(Math.abs(yo - yc), 1);
        const x = cx(i - s);
        body += '<line x1="' + x.toFixed(1) + '" y1="' + y(k.high).toFixed(1) +
          '" x2="' + x.toFixed(1) + '" y2="' + y(k.low).toFixed(1) +
          '" stroke="' + col + '" stroke-width="' + Math.max(bw * 0.12, 0.7) + '"/>';
        body += '<rect x="' + (x - bw * 0.34).toFixed(1) + '" y="' + top.toFixed(1) +
          '" width="' + (bw * 0.68).toFixed(1) + '" height="' + h.toFixed(1) +
          '" fill="' + col + '"/>';
      }
      let maPaths = '';
      mas.forEach((m, idx) => {
        let d = '';
        for (let i = s; i < end; i++) {
          const v = m.data[i];
          if (v === null) continue;
          d += (d ? 'L' : 'M') + cx(i - s).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
        }
        if (d) maPaths += '<path d="' + d + '" fill="none" stroke="' + MA_COLORS[idx % 3] + '" stroke-width="1" opacity="0.85"/>';
      });
      let volBars = '';
      for (let i = s; i < end; i++) {
        const k = klines[i];
        const up = k.close >= k.open;
        const h = ((k.volume || 0) / maxVol) * (CV_VOL.bottom - CV_VOL.top);
        volBars += '<rect x="' + (cx(i - s) - bw * 0.34).toFixed(1) + '" y="' + (CV_VOL.bottom - h).toFixed(1) +
          '" width="' + (bw * 0.68).toFixed(1) + '" height="' + Math.max(h, 0.6).toFixed(1) +
          '" fill="' + (up ? '#ff4d4f' : '#12b886') + '" opacity="0.8"/>';
      }
      let volMa = '';
      [{ p: 5, c: '#f2b544' }, { p: 10, c: '#4c8dff' }].forEach((cfg) => {
        if (n < cfg.p) return;
        const series = maSeries(klines, cfg.p, (k) => k.volume || 0);
        const vy = (v) => CV_VOL.bottom - (v / maxVol) * (CV_VOL.bottom - CV_VOL.top);
        let d = '';
        for (let i = s; i < end; i++) {
          const v = series[i];
          if (v === null) continue;
          d += (d ? 'L' : 'M') + cx(i - s).toFixed(1) + ' ' + vy(v).toFixed(1) + ' ';
        }
        if (d) volMa += '<path d="' + d + '" fill="none" stroke="' + cfg.c + '" stroke-width="0.9" opacity="0.9" stroke-dasharray="3 2"/>';
      });
      let flowBars = '';
      if (hasFlow) {
        flowBars += '<line x1="' + CV.left + '" y1="' + flowMid + '" x2="' + CV.right + '" y2="' + flowMid +
          '" stroke="rgba(255,255,255,0.18)" stroke-width="0.6"/>';
        for (let i = s; i < end; i++) {
          const f = flowMap[klines[i].date];
          if (!f) continue;
          const v = f.main || 0;
          const h = (Math.abs(v) / maxFlow) * ((CV_FLOW.bottom - CV_FLOW.top) / 2 - 2);
          const yy = v >= 0 ? flowMid - h : flowMid;
          flowBars += '<rect x="' + (cx(i - s) - bw * 0.34).toFixed(1) + '" y="' + yy.toFixed(1) +
            '" width="' + (bw * 0.68).toFixed(1) + '" height="' + Math.max(h, 0.6).toFixed(1) +
            '" fill="' + (v >= 0 ? '#ff4d4f' : '#12b886') + '" opacity="0.75"/>';
        }
      }
      // 日期刻度
      let dateTicks = '';
      const step = Math.max(1, Math.floor(visibleN / 5));
      for (let i = s; i < end; i += step) {
        dateTicks += '<text class="cv-tick" x="' + cx(i - s).toFixed(1) + '" y="' + TICK_Y + '" text-anchor="middle">' +
          escapeHtml(String(klines[i].date).slice(5)) + '</text>';
      }
      // 最新价参考线
      const lastY = y(lastK.close);
      const lastMark =
        '<line x1="' + CV.left + '" y1="' + lastY.toFixed(1) + '" x2="' + CV.right + '" y2="' + lastY.toFixed(1) +
          '" stroke="' + lastCol + '" stroke-width="0.7" stroke-dasharray="4 3" opacity="0.7"/>' +
        '<circle cx="' + cx(Math.min(n - 1 - s, visibleN - 1)).toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="2.6" fill="none" stroke="' +
          lastCol + '" stroke-width="1.1"/>';

      const g = container.querySelector('.cv-data');
      if (g) g.innerHTML = body + maPaths + volBars + volMa + flowBars + dateTicks + lastMark;
      // 价格刻度随可视窗口重画
      let t = '';
      for (let i = 0; i <= 4; i++) {
        const v = min + (max - min) * (i / 4);
        const yy = y(v);
        t += '<line x1="' + CV.left + '" y1="' + yy.toFixed(1) + '" x2="' + CV.right +
          '" y2="' + yy.toFixed(1) + '" stroke="rgba(255,255,255,0.07)" stroke-width="0.6"/>';
        t += '<text class="cv-tick" x="' + (CV.right + 6) + '" y="' + (yy + 3.5).toFixed(1) + '">' + fmtNum(v) + '</text>';
      }
      const gt = container.querySelector('.cv-ticks');
      if (gt) gt.innerHTML = t;
      return { bw: bw, cx: cx, s: s, end: end };
    }

    const legend = (opts.ma || []).map((p, i) =>
      '<span class="lg" style="color:' + MA_COLORS[i % 3] + '">MA' + p + '</span>').join('');

    const firstK = klines[0];
    const rangeHigh = Math.max.apply(null, klines.map((k) => k.high));
    const rangeLow = Math.min.apply(null, klines.map((k) => k.low));
    const base = firstK.close || firstK.open || 1;
    const rangePct = (lastK.close - base) / base * 100;
    const sumAmount = klines.reduce((s, k) => s + (k.amount || 0), 0);
    const sumFlow = flows.reduce((s, f) => s + (f.main || 0), 0);
    let rangeStrip = '<div class="cv-range">' +
      '<span class="cr-item">区间<b class="' + (rangePct >= 0 ? 'up' : 'down') + '">' + fmtPct(rangePct) + '</b></span>' +
      '<span class="cr-item">最高<b class="up">' + fmtNum(rangeHigh) + '</b></span>' +
      '<span class="cr-item">最低<b class="down">' + fmtNum(rangeLow) + '</b></span>' +
      '<span class="cr-item">振幅<b>' + fmtNum(base ? (rangeHigh - rangeLow) / base * 100 : 0) + '%</b></span>' +
      '<span class="cr-item">成交额<b>' + fmtAmt(sumAmount) + '</b></span>' +
      (hasFlow ? '<span class="cr-item">主力净流入<b class="' + (sumFlow >= 0 ? 'up' : 'down') + '">' + fmtMoney(sumFlow) + '</b></span>' : '') +
      '<span class="cr-item muted">' + n + ' 根 · 滚轮缩放 / 拖拽平移</span>' +
    '</div>';

    container.innerHTML =
      '<div class="cv-head">' +
        '<div class="cv-legend">' + legend +
          '<span class="lg up">涨</span><span class="lg down">跌</span>' +
          '<span class="lg muted">滚轮缩放 · 拖拽平移</span>' +
        '</div>' + rangeStrip +
      '</div>' +
      '<svg class="cv-svg" viewBox="0 0 ' + CV.W + ' ' + CV_H + '" preserveAspectRatio="none">' +
        '<g class="cv-ticks"></g>' +
        '<g class="cv-data"></g>' +
        '<line class="cv-cross" x1="0" y1="' + CV_MAIN.top + '" x2="0" y2="' +
          (hasFlow ? CV_FLOW.bottom : CV_VOL.bottom) + '" stroke="rgba(255,255,255,0.35)"' +
          ' stroke-width="0.8" stroke-dasharray="3 3" style="display:none"/>' +
        '<line class="cv-cross-h" x1="' + CV.left + '" y1="0" x2="' + CV.right + '" y2="0"' +
          ' stroke="rgba(255,255,255,0.35)" stroke-width="0.8" stroke-dasharray="3 3" style="display:none"/>' +
        '<text class="cv-cross-h-label" x="' + (CV.right - 2) + '" y="0" text-anchor="end" style="display:none"></text>' +
      '</svg>' +
      '<div class="chart-tip" style="display:none"></div>';

    renderData();
    bindCrosshair(container, klines, flows, hasFlow, view, renderData, min, max, CV_MAIN.top, CV_MAIN.bottom, lastK.close);
  }

  function bindCrosshair(container, klines, flows, hasFlow, view, renderData, pMin, pMax, top, bottom, lastClose) {
    const svg = container.querySelector('.cv-svg');
    const tip = container.querySelector('.chart-tip');
    const cross = container.querySelector('.cv-cross');
    const crossH = container.querySelector('.cv-cross-h');
    const crossHLabel = container.querySelector('.cv-cross-h-label');
    if (!svg || !tip) return;
    const flowMap = {};
    flows.forEach((f) => { flowMap[f.date] = f; });
    const priceAt = (vy) => pMax - (vy - top) / (bottom - top) * (pMax - pMin);

    function metrics() {
      const c = view.count;
      const bw = (CV.right - CV.left) / c;
      return { bw: bw, cx: (i) => CV.left + (i - view.start) * bw + bw / 2 };
    }

    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const vx = (e.clientX - rect.left) / rect.width * CV.W;
      const vy = (e.clientY - rect.top) / rect.height * (hasFlow ? CV.H : CV_IT.H);
      const m = metrics();
      let i = Math.floor((vx - CV.left) / m.bw) + view.start;
      i = Math.max(view.start, Math.min(klines.length - 1, i));
      const k = klines[i];
      tip.innerHTML = tooltipHtml(k, flowMap[k.date], hasFlow);
      tip.style.display = 'block';
      if (vx > CV.W / 2) { tip.style.left = '6px'; } else { tip.style.left = (rect.width - 248) + 'px'; }
      tip.style.top = '10px';
      if (cross) {
        cross.setAttribute('x1', m.cx(i));
        cross.setAttribute('x2', m.cx(i));
        cross.style.display = '';
      }
      if (crossH) {
        crossH.setAttribute('y1', vy);
        crossH.setAttribute('y2', vy);
        crossH.style.display = '';
      }
      if (crossHLabel && lastClose) {
        const priceAtY = priceAt(vy);
        const pct = (priceAtY - lastClose) / lastClose * 100;
        const cls = pct >= 0 ? 'up' : 'down';
        crossHLabel.setAttribute('y', vy + 3.5);
        crossHLabel.setAttribute('x', CV.right + 6);
        crossHLabel.setAttribute('text-anchor', 'start');
        crossHLabel.setAttribute('class', 'cv-cross-h-label ' + cls);
        crossHLabel.textContent = fmtNum(priceAtY) + '  ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
        crossHLabel.style.display = '';
      }
    });
    svg.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      if (cross) cross.style.display = 'none';
      if (crossH) crossH.style.display = 'none';
      if (crossHLabel) crossHLabel.style.display = 'none';
    });

    // ---- 滚轮缩放：以鼠标位置为锚点 ----
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const vx = (e.clientX - rect.left) / rect.width * CV.W;
      const m = metrics();
      // 鼠标指向的K线索引
      const hoverIdx = Math.floor((vx - CV.left) / m.bw) + view.start;
      const oldCount = view.count;
      const factor = e.deltaY > 0 ? 1.15 : 0.87;   // 下滚=放大（根数变少），上滚=缩小
      let newCount = Math.round(oldCount * factor);
      newCount = Math.max(20, Math.min(klines.length, newCount));
      // 保持 hoverIdx 位置不变：hoverIdx 在视口内的比例
      const ratio = (hoverIdx - view.start) / oldCount;
      view.count = newCount;
      view.start = Math.round(hoverIdx - ratio * newCount);
      view.start = Math.max(0, Math.min(klines.length - newCount, view.start));
      renderData();
    }, { passive: false });

    // ---- 拖拽平移（抓取模式：抓住图往哪拖，图跟哪走） ----
    let drag = null;
    svg.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, start: view.start, moved: false };
      svg.style.cursor = 'grabbing';
      // 拖动时禁文本选中，避免触发浏览器划词搜索
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const rect = svg.getBoundingClientRect();
      const dx = e.clientX - drag.x;
      const bw = (CV.right - CV.left) / view.count;
      // 鼠标向右拖 dx>0 → start 减小（看到更早的K线），图跟手右移
      const dIdx = Math.round(dx / rect.width * CV.W / bw);
      if (Math.abs(e.clientX - drag.x) > 3) drag.moved = true;
      let ns = drag.start - dIdx;
      ns = Math.max(0, Math.min(klines.length - view.count, ns));
      if (ns !== view.start) { view.start = ns; renderData(); }
    });
    window.addEventListener('mouseup', () => {
      if (drag) {
        drag = null;
        svg.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  /**
   * 当日分时图：价格 + 均价 + 成交量，虚线为昨收
   */
  function intraday(container, points, preClose) {
    if (!container) return;
    if (!points || points.length < 2) {
      container.innerHTML = '<div class="empty">暂无分时数据</div>';
      return;
    }
    const base = preClose || points[0].value;
    const prices = points.map((p) => p.value);
    const avgs = points.map((p) => p.avg).filter((v) => v !== null && v !== undefined);
    let dev = Math.max(
      Math.abs(Math.max.apply(null, prices) - base),
      Math.abs(base - Math.min.apply(null, prices))
    );
    if (avgs.length) {
      dev = Math.max(dev, Math.abs(Math.max.apply(null, avgs) - base));
    }
    dev = dev || base * 0.01;
    const min = base - dev * 1.08;
    const max = base + dev * 1.08;
    const y = svgScale(min, max, CV_IT.top, CV_IT.bottom);

    const n = points.length;
    const bw = (CV.right - CV.left) / n;
    const cx = (i) => CV.left + i * bw + bw / 2;

    let line = '', avgLine = '';
    points.forEach((p, i) => {
      const x = cx(i).toFixed(1), yy = y(p.value).toFixed(1);
      line += (i ? 'L' : 'M') + x + ' ' + yy + ' ';
      if (p.avg !== null && p.avg !== undefined) {
        avgLine += (avgLine ? 'L' : 'M') + x + ' ' + y(p.avg).toFixed(1) + ' ';
      }
    });

    // 价格线下方的填充区域
    let area = 'M' + cx(0).toFixed(1) + ' ' + CV_IT.bottom + ' ';
    points.forEach((p, i) => { area += 'L' + cx(i).toFixed(1) + ' ' + y(p.value).toFixed(1) + ' '; });
    area += 'L' + cx(n - 1).toFixed(1) + ' ' + CV_IT.bottom + ' Z';

    const maxVol = Math.max.apply(null, points.map((p) => p.volume || 0)) || 1;
    let volBars = '';
    points.forEach((p, i) => {
      const h = ((p.volume || 0) / maxVol) * (CV_IT.volBottom - CV_IT.volTop);
      const up = p.value >= base;
      volBars += '<rect x="' + (cx(i) - bw * 0.35).toFixed(1) + '" y="' + (CV_IT.volBottom - h).toFixed(1) +
        '" width="' + Math.max(bw * 0.7, 0.8).toFixed(1) + '" height="' + Math.max(h, 0.6).toFixed(1) +
        '" fill="' + (up ? '#ff4d4f' : '#12b886') + '" opacity="0.8"/>';
    });

    // 昨收基准线 + 上下百分比刻度
    const yBase = y(base);
    let ticks = '<line x1="' + CV.left + '" y1="' + yBase.toFixed(1) + '" x2="' + CV.right +
      '" y2="' + yBase.toFixed(1) + '" stroke="rgba(255,255,255,0.25)" stroke-width="0.6" stroke-dasharray="4 3"/>';
    [max, base + dev * 0.54, base, base - dev * 0.54, min].forEach((v) => {
      const yy = y(v);
      ticks += '<text class="cv-tick" x="' + CV.label + '" y="' + (yy + 3.5).toFixed(1) + '">' + fmtNum(v) + '</text>';
      const pctV = base ? ((v - base) / base * 100) : 0;
      ticks += '<text class="cv-tick ' + (pctV >= 0 ? 'up' : 'down') + '" x="' + CV.left +
        '" y="' + (yy + 3.5).toFixed(1) + '">' + (pctV >= 0 ? '+' : '') + pctV.toFixed(2) + '%</text>';
    });

    // 时间刻度
    let timeTicks = '';
    const marks = [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1];
    marks.forEach((i) => {
      if (i < 0 || i >= n) return;
      timeTicks += '<text class="cv-tick" x="' + cx(i).toFixed(1) + '" y="' + CV_IT.tickY +
        '" text-anchor="middle">' + escapeHtml(points[i].time || '') + '</text>';
    });

    // 盘中概览：最高 / 最低 / 振幅 / 均价 / 成交额
    const hiP = Math.max.apply(null, prices);
    const loP = Math.min.apply(null, prices);
    const lastP = prices[n - 1];
    const curPct = base ? (lastP - base) / base * 100 : 0;
    const sumAmt = points.reduce((s, p) => s + (p.amount || 0), 0);
    const avgNow = avgs.length ? avgs[avgs.length - 1] : null;
    const rangeStrip =
      '<div class="cv-range">' +
        '<span class="cr-item">现价<b class="' + (curPct >= 0 ? 'up' : 'down') + '">' + fmtNum(lastP) + '</b></span>' +
        '<span class="cr-item">涨跌<b class="' + (curPct >= 0 ? 'up' : 'down') + '">' + fmtPct(curPct) + '</b></span>' +
        '<span class="cr-item">最高<b class="up">' + fmtNum(hiP) + '</b></span>' +
        '<span class="cr-item">最低<b class="down">' + fmtNum(loP) + '</b></span>' +
        '<span class="cr-item">振幅<b>' + fmtNum(base ? (hiP - loP) / base * 100 : 0) + '%</b></span>' +
        (avgNow !== null ? '<span class="cr-item">均价<b>' + fmtNum(avgNow) + '</b></span>' : '') +
        '<span class="cr-item">成交额<b>' + fmtAmt(sumAmt) + '</b></span>' +
        '<span class="cr-item muted">昨收 ' + fmtNum(base) + '</span>' +
      '</div>';

    container.innerHTML =
      '<div class="cv-head">' +
        '<div class="cv-legend">' +
          '<span class="lg" style="color:#ff8c8c">价格</span>' +
          '<span class="lg" style="color:#f2b544">均价</span>' +
          '<span class="lg muted">下方为分钟成交量</span>' +
        '</div>' + rangeStrip +
      '</div>' +
      '<svg class="cv-svg" viewBox="0 0 ' + CV.W + ' ' + CV_IT.H + '" preserveAspectRatio="none">' +
        ticks +
        '<path d="' + area + '" fill="rgba(255,77,79,0.10)"/>' +
        '<path d="' + line + '" fill="none" stroke="#ff8c8c" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="' + avgLine + '" fill="none" stroke="#f2b544" stroke-width="1" opacity="0.9"/>' +
        volBars + timeTicks +
        '<line class="cv-cross" x1="0" y1="' + CV_IT.top + '" x2="0" y2="' + CV_IT.volBottom +
        '" stroke="rgba(255,255,255,0.35)" stroke-width="0.8" stroke-dasharray="3 3" style="display:none"/>' +
        '<line class="cv-cross-h" x1="' + CV.left + '" y1="0" x2="' + CV.right + '" y2="0"' +
        ' stroke="rgba(255,255,255,0.35)" stroke-width="0.8" stroke-dasharray="3 3" style="display:none"/>' +
        '<text class="cv-cross-h-label" x="' + (CV.right - 2) + '" y="0" text-anchor="end" style="display:none"></text>' +
      '</svg>' +
      '<div class="chart-tip" style="display:none"></div>';

    // 分时 hover
    const svg = container.querySelector('.cv-svg');
    const tip = container.querySelector('.chart-tip');
    const cross = container.querySelector('.cv-cross');
    const crossH = container.querySelector('.cv-cross-h');
    const crossHLabel = container.querySelector('.cv-cross-h-label');
    if (!svg || !tip) return;
    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const vx = (e.clientX - rect.left) / rect.width * CV.W;
      const vy = (e.clientY - rect.top) / rect.height * CV_IT.H;
      let i = Math.round((vx - CV.left) / bw - 0.5);
      i = Math.max(0, Math.min(n - 1, i));
      const p = points[i];
      const d = p.value >= base ? 'up' : 'down';
      const pctV = base ? ((p.value - base) / base * 100) : 0;
      tip.innerHTML =
        '<div class="tt-title">' + escapeHtml(p.time || '') + '</div>' +
        '<div class="tt-row"><span>价格</span><b class="' + d + '">' + fmtNum(p.value) + '</b></div>' +
        '<div class="tt-row"><span>涨跌</span><b class="' + d + '">' + (pctV >= 0 ? '+' : '') + pctV.toFixed(2) + '%</b></div>' +
        '<div class="tt-row"><span>均价</span><b>' + fmtNum(p.avg) + '</b></div>' +
        '<div class="tt-row"><span>分钟量</span><b>' + fmtAmt(p.volume) + '</b></div>';
      tip.style.display = 'block';
      // 智能避让
      if (vx > CV.W / 2) {
        tip.style.left = '6px';
      } else {
        tip.style.left = (rect.width - 248) + 'px';
      }
      tip.style.top = '10px';
      if (cross) {
        cross.setAttribute('x1', cx(i));
        cross.setAttribute('x2', cx(i));
        cross.style.display = '';
      }
      // 水平十字线：鼠标 Y 价格 + 相对最新价涨跌幅
      if (crossH) {
        crossH.setAttribute('y1', vy);
        crossH.setAttribute('y2', vy);
        crossH.style.display = '';
      }
      if (crossHLabel) {
        // Y -> 价格 反算（分时图价格区）
        const priceAtY = max - (vy - CV_IT.top) / (CV_IT.bottom - CV_IT.top) * (max - min);
        const pctVsLast = lastP ? (priceAtY - lastP) / lastP * 100 : 0;
        const cls = pctVsLast >= 0 ? 'up' : 'down';
        crossHLabel.setAttribute('y', vy + 3.5);
        crossHLabel.setAttribute('x', CV.right + 6);
        crossHLabel.setAttribute('text-anchor', 'start');
        crossHLabel.setAttribute('class', 'cv-cross-h-label ' + cls);
        crossHLabel.textContent = fmtNum(priceAtY) + '  ' + (pctVsLast >= 0 ? '+' : '') + pctVsLast.toFixed(2) + '%';
        crossHLabel.style.display = '';
      }
    });
    svg.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      if (cross) cross.style.display = 'none';
      if (crossH) crossH.style.display = 'none';
      if (crossHLabel) crossHLabel.style.display = 'none';
    });
  }

  window.Charts = {
    candlestick: candlestick,
    intraday: intraday,
    fmtNum: fmtNum,
    fmtPct: fmtPct,
    fmtMoney: fmtMoney,
    fmtAmt: fmtAmt,
    dir: dir,
    escapeHtml: escapeHtml,
    hBar: hBar,
    sparkline: sparkline
  };
})();
