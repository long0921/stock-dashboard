/* ==========================================================================
 * app.js —— 看板主逻辑
 * 板块之间彼此独立：任一板块取数失败只影响自己，不会拖垮整页
 * ========================================================================== */

(function () {
  const CFG = window.DASH_CONFIG;
  const DS = window.DataSource;
  const C = window.Charts;

  /* ---------------- 全局状态 ---------------- */
  const state = {
    sectorType: CFG.sectorTypes[0],
    flowDir: 1,        // 1 流入榜 / 0 流出榜
    changeDir: 1,      // 1 涨幅榜 / 0 跌幅榜
    newsIds: {},
    lastSuccess: null,
    loading: false,
    timer: null,
    newsTimer: null,
    countdown: 0,
    auto: true,
    trendsCache: {},
    quoteMap: {},        // 最近一次指数行情，详情面板复用
    prevQuotes: {}       // 上一次价格，用于变动闪烁
  };

  const $ = (sel) => document.querySelector(sel);

  /* ==========================================================================
   * 工具
   * ========================================================================== */
  async function safe(promise, fallback) {
    try { return await promise; } catch (e) { return fallback; }
  }

  function panelError(el, msg) {
    if (el) el.innerHTML = '<div class="empty error">' + C.escapeHtml(msg || '数据获取失败') + '</div>';
  }

  function nowStr() {
    const d = new Date();
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  }

  /** 取指定时区的 时/分/星期 */
  function tzParts(tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    return {
      weekday: get('weekday'),
      hour: parseInt(get('hour'), 10) % 24,
      minute: parseInt(get('minute'), 10)
    };
  }

  function localTime(tz) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(new Date());
    } catch (e) { return '--:--:--'; }
  }

  /** 判断市场状态：trading / break / closed */
  function marketState(group) {
    const p = tzParts(group.tz);
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'closed';
    const mins = p.hour * 60 + p.minute;
    const segs = [];
    for (let i = 0; i < group.session.length; i += 2) {
      segs.push([group.session[i][0] * 60 + group.session[i][1],
                 group.session[i + 1][0] * 60 + group.session[i + 1][1]]);
    }
    for (let i = 0; i < segs.length; i++) {
      if (mins >= segs[i][0] && mins < segs[i][1]) return 'trading';
      // 午休：上一段已结束、下一段还没开始
      if (i < segs.length - 1 && mins >= segs[i][1] && mins < segs[i + 1][0]) return 'break';
    }
    return 'closed';
  }

  const STATE_TEXT = { trading: '交易中', break: '午休', closed: '休市' };

  /* ==========================================================================
   * 板块一：全球指数
   * ========================================================================== */
  async function renderIndices() {
    const box = $('#indices-container');
    const allItems = [];
    CFG.indexGroups.forEach((g) => { allItems.push.apply(allItems, g.core.concat(g.extra)); });

    // core / extra 分两批请求，避免个别无效代码拖垮整批
    const coreItems = [];
    const extraItems = [];
    CFG.indexGroups.forEach((g) => {
      coreItems.push.apply(coreItems, g.core);
      extraItems.push.apply(extraItems, g.extra);
    });

    const results = await Promise.all([
      safe(DS.fetchQuotes(coreItems), { data: [], source: 'none' }),
      safe(DS.fetchQuotes(extraItems), { data: [], source: 'none' })
    ]);

    const map = {};
    results.forEach((r) => {
      (r.data || []).forEach((q) => {
        // 优先用 "市场.代码"（与 config 的 secid 一致），同时保留纯代码作为兜底
        if (q.secid) map[q.secid] = q;
        if (q.code && !map[q.code]) map[q.code] = q;
      });
    });

    if (!Object.keys(map).length) {
      panelError(box, '行情接口暂不可用，请检查网络后点击右上角刷新');
      return;
    }
    state.lastSuccess = Date.now();
    state.quoteMap = map;          // 详情面板直接复用，省一次请求

    box.innerHTML = CFG.indexGroups.map((g) => {
      const st = marketState(g);
      const rows = g.core.concat(g.extra).map((item) => {
        const q = map[item.secid] || map[item.secid.split('.')[1]];
        // 取不到就显式占位，避免整组空白让人以为是看板坏了
        if (!q) {
          return '' +
            '<div class="quote-item na">' +
              '<div class="quote-main">' +
                '<div class="quote-name">' + C.escapeHtml(item.name) + '</div>' +
                '<div class="quote-price flat">--</div>' +
                '<div class="quote-chg flat"><span class="na-tag">暂缺</span></div>' +
              '</div>' +
            '</div>';
        }
        const d = C.dir(q.pct);
        // 数值变动时闪一下，5 秒刷新下能一眼看出哪些数字刚变过
        const prev = state.prevQuotes[item.secid];
        let flash = '';
        if (prev !== undefined && q.price !== null && prev !== q.price) {
          flash = q.price > prev ? ' flash-up' : ' flash-down';
        }
        if (q.price !== null) state.prevQuotes[item.secid] = q.price;
        return '' +
          '<div class="quote-item ' + d + flash + '" data-secid="' + item.secid + '">' +
            '<div class="quote-main">' +
              '<div class="quote-name">' + C.escapeHtml(q.name || item.name) + '</div>' +
              '<div class="quote-price ' + d + '">' + C.fmtNum(q.price) + '</div>' +
              '<div class="quote-chg ' + d + '">' +
                '<span>' + C.fmtNum(q.change) + '</span>' +
                '<span class="pct">' + C.fmtPct(q.pct) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="quote-spark" data-secid="' + item.secid + '"></div>' +
          '</div>';
      }).join('');

      return '' +
        '<div class="index-group">' +
          '<div class="group-head">' +
            '<span class="group-title">' + g.flag + ' ' + C.escapeHtml(g.title) + '</span>' +
            '<span class="group-meta">' +
              '<span class="dot ' + st + '"></span>' + STATE_TEXT[st] +
              '<span class="group-time">' + localTime(g.tz) + '</span>' +
            '</span>' +
          '</div>' +
          '<div class="group-body">' + (rows || '<div class="empty">暂无数据</div>') + '</div>' +
        '</div>';
    }).join('');

    if (window.__restoreLayout) window.__restoreLayout();
    renderSparklines();
  }

  /** 指数卡片里的迷你走势：A股用分时，其他市场（休市/海外）用日K收盘价 */
  async function renderSparklines() {
    const nodes = Array.prototype.slice.call(document.querySelectorAll('.quote-spark[data-secid]'));
    await Promise.all(nodes.map(async (node) => {
      const secid = node.getAttribute('data-secid');
      const isA = /^[01]\./.test(secid);
      const cacheKey = 'kl_' + secid;
      const cached = state.trendsCache[secid] || state.trendsCache[cacheKey];
      let pts = cached && (Date.now() - cached.ts < 60000) ? cached.pts : null;
      if (!pts) {
        if (isA) {
          const q = state.quoteMap ? state.quoteMap[secid] : null;
          const t = await safe(DS.fetchTrends(secid, q ? q.prevClose : null), null);
          if (t && t.points && t.points.length) {
            pts = t.points;
            state.trendsCache[secid] = { ts: Date.now(), pts: pts };
          }
        } else {
          // 海外/港股：拉 60 根日K收盘价画缩略走势
          const kl = await safe(DS.fetchKline(secid, 101, 60), null);
          if (kl && kl.length) {
            pts = kl.map((k) => ({ value: k.close }));
            state.trendsCache[cacheKey] = { ts: Date.now(), pts: pts };
          }
        }
      }
      if (pts && pts.length) C.sparkline(node, pts);
    }));
  }

  /* ==========================================================================
   * 板块二 / 三：板块资金流 & 涨跌幅（横向柱状图）
   * ========================================================================== */
  /** 在线数据取不到时用示例数据兜底，界面会明确标注 */
  function pickRank(online, kind, po) {
    if (online && online.length) return { data: online, demo: false };
    if (CFG.demo && CFG.demo.enabled) return { data: DS.demoRank(kind, po), demo: true };
    return { data: null, demo: false };
  }

  function renderRankChart(chartSel, subSel, picked, toRow) {
    if (!picked.data) {
      panelError($(chartSel), '数据暂不可用：接口被限制或网络不通');
      const el = $(subSel);
      el.textContent = '失败';
      el.className = 'panel-sub demo';
      return;
    }
    C.hBar($(chartSel), picked.data.map(toRow), { mode: 'center' });
    const el = $(subSel);
    el.textContent = (picked.demo ? '示例数据 · ' : '') + '更新于 ' + nowStr();
    el.className = picked.demo ? 'panel-sub demo' : 'panel-sub';
  }

  async function renderRanks() {
    const type = state.sectorType;
    const flowCfg = CFG.ranks.flow;
    const chgCfg = CFG.ranks.change;
    const flowPo = state.flowDir ? 1 : 0;
    const chgPo = state.changeDir ? 1 : 0;

    const [flowRaw, chgRaw] = await Promise.all([
      safe(DS.fetchRank(type.fs, flowCfg.fid, flowPo, flowCfg.limit, flowCfg.fields), null),
      safe(DS.fetchRank(type.fs, chgCfg.fid, chgPo, chgCfg.limit, chgCfg.fields), null)
    ]);

    // 资金流
    renderRankChart('#flow-chart', '#flow-updated', pickRank(flowRaw, 'flow', flowPo), (r) => ({
      label: r.name,
      value: r.netFlow,
      text: C.fmtMoney(r.netFlow),
      sub: r.leader ? ('领涨 ' + r.leader) : ''
    }));

    // 涨跌幅
    renderRankChart('#change-chart', '#change-updated', pickRank(chgRaw, 'change', chgPo), (r) => ({
      label: r.name,
      value: r.pct,
      text: C.fmtPct(r.pct),
      sub: (r.netFlow !== null && r.netFlow !== undefined) ? C.fmtMoney(r.netFlow) : ''
    }));
  }

  /* ==========================================================================
   * 板块四：财经快讯
   * ========================================================================== */
  async function renderNews() {
    const list = await safe(DS.fetchNews(CFG.news.limit), null);
    const box = $('#news-list');
    if (!list || !list.length) {
      if (!box.children.length) panelError(box, '快讯暂不可用');
      return;
    }

    const isFirst = !Object.keys(state.newsIds).length;
    const html = list.map((n) => {
      const isNew = !isFirst && !state.newsIds[n.id];
      const important = CFG.news.keywords.some((k) => n.text.indexOf(k) > -1);
      const tags = (n.tags || []).slice(0, 2)
        .map((t) => '<span class="tag">' + C.escapeHtml(t) + '</span>').join('');
      const time = (n.time || '').slice(11, 16) || '--:--';
      return '' +
        '<li class="news-item' + (isNew ? ' is-new' : '') + (important ? ' important' : '') + '">' +
          '<span class="news-time">' + C.escapeHtml(time) + '</span>' +
          '<div class="news-body">' +
            '<p>' + (important ? '<span class="badge">重要</span>' : '') +
              C.escapeHtml(n.text) + '</p>' +
            '<div class="news-meta">' + tags +
              (n.url ? '<a href="' + C.escapeHtml(n.url) + '" target="_blank" rel="noopener">原文</a>' : '') +
            '</div>' +
          '</div>' +
        '</li>';
    }).join('');

    box.innerHTML = html;
    list.forEach((n) => { state.newsIds[n.id] = true; });
    $('#news-updated').textContent = '更新于 ' + nowStr();
  }

  /* ==========================================================================
   * 板块五：自选股
   * ========================================================================== */
  function getWatchlist() {
    try {
      const raw = localStorage.getItem(CFG.watchlist.storageKey);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 忽略 */ }
    return CFG.watchlist.defaults.slice();
  }

  function saveWatchlist(list) {
    try { localStorage.setItem(CFG.watchlist.storageKey, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
  }

  function getPinned() {
    try { return JSON.parse(localStorage.getItem('watch-pinned') || '[]'); } catch (e) { return []; }
  }
  function savePinned(arr) {
    try { localStorage.setItem('watch-pinned', JSON.stringify(arr)); } catch (e) {}
  }

  /** 600519 -> 1.600519；000001 -> 0.000001；00700 -> 116.00700；AAPL -> 105.AAPL */
  function guessSecid(input) {
    const s = String(input || '').trim().toUpperCase();
    if (s.indexOf('.') > -1) return s;
    if (/^\d{6}$/.test(s)) {
      if (/^6/.test(s)) return '1.' + s;
      if (/^[03]/.test(s)) return '0.' + s;
      if (/^[48]/.test(s)) return '0.' + s;
      return '0.' + s;
    }
    if (/^\d{5}$/.test(s)) return '116.' + s;      // 港股
    if (/^[A-Z.]{1,8}$/.test(s)) return '105.' + s; // 美股
    return null;
  }

  /* 暴露给 drag-layout.js：拖拽后保存新顺序 */
  window.__saveWatchOrder = function (order) {
    // 保留 list 里所有项，按 order 重排（pinned 标记不变）
    const cur = getWatchlist();
    const set = {};
    order.forEach((s) => { set[s] = true; });
    // order 里有的按 order 排，order 里没有的（新加的）追加到末尾
    const merged = order.slice();
    cur.forEach((s) => { if (!set[s]) merged.push(s); });
    saveWatchlist(merged);
  };

  async function renderWatchlist() {
    const list = getWatchlist();
    const box = $('#watch-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty">还没有自选，输入代码添加</div>';
      return;
    }
    const items = list.map((secid) => ({ secid: secid, name: secid.split('.')[1] }));
    const res = await safe(DS.fetchQuotes(items), { data: [] });
    const map = {};
    (res.data || []).forEach((q) => {
      if (q.secid) map[q.secid] = q;
      if (q.code && !map[q.code]) map[q.code] = q;
    });

    const pinned = getPinned();
    // 置顶项排前面，其余保持原顺序
    const ordered = list.slice().sort((a, b) => {
      const pa = pinned.indexOf(a) >= 0 ? 0 : 1;
      const pb = pinned.indexOf(b) >= 0 ? 0 : 1;
      return pa - pb;
    });
    box.innerHTML = ordered.map((secid) => {
      const code = secid.split('.')[1];
      const q = map[secid] || map[code];
      const d = q ? C.dir(q.pct) : 'flat';
      const isPin = pinned.indexOf(secid) >= 0;
      return '' +
        '<div class="watch-row' + (isPin ? ' pinned' : '') + '" data-secid="' + C.escapeHtml(secid) + '" title="点击查看 K 线 / 分时">' +
          '<span class="watch-grip" title="拖动排序">⋮⋮</span>' +
          '<div class="watch-name">' +
            '<span class="wn">' + C.escapeHtml(q ? q.name : code) + '</span>' +
            '<span class="wc">' + C.escapeHtml(code) + '</span>' +
          '</div>' +
          '<div class="watch-spark" data-secid="' + C.escapeHtml(secid) + '"></div>' +
          '<div class="watch-price ' + d + '">' + (q ? C.fmtNum(q.price) : '--') + '</div>' +
          '<div class="watch-pct ' + d + '">' + (q ? C.fmtPct(q.pct) : '--') + '</div>' +
          '<button class="watch-pin' + (isPin ? ' on' : '') + '" data-secid="' + C.escapeHtml(secid) + '" title="置顶/取消置顶">' + (isPin ? '📌' : '📌') + '</button>' +
          '<button class="watch-del" data-secid="' + C.escapeHtml(secid) + '" title="删除">×</button>' +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('.watch-del'), (btn) => {
      btn.onclick = function (e) {
        e.stopPropagation();
        const secid = btn.getAttribute('data-secid');
        saveWatchlist(getWatchlist().filter((s) => s !== secid));
        renderWatchlist();
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll('.watch-pin'), (btn) => {
      btn.onclick = function (e) {
        e.stopPropagation();
        const secid = btn.getAttribute('data-secid');
        const cur = getPinned();
        const i = cur.indexOf(secid);
        if (i >= 0) cur.splice(i, 1); else cur.push(secid);
        savePinned(cur);
        renderWatchlist();
      };
    });
    renderWatchSparks();
  }

  /** 自选股迷你走势：A股分时，其他用日K */
  async function renderWatchSparks() {
    const nodes = Array.prototype.slice.call(document.querySelectorAll('.watch-spark[data-secid]'));
    await Promise.all(nodes.map(async (node) => {
      const secid = node.getAttribute('data-secid');
      const isA = /^[01]\./.test(secid);
      const cacheKey = 'kl_' + secid;
      const cached = state.trendsCache[secid] || state.trendsCache[cacheKey];
      let pts = cached && (Date.now() - cached.ts < 60000) ? cached.pts : null;
      if (!pts) {
        if (isA) {
          const q = state.quoteMap ? state.quoteMap[secid] : null;
          const t = await safe(DS.fetchTrends(secid, q ? q.prevClose : null), null);
          if (t && t.points && t.points.length) {
            pts = t.points;
            state.trendsCache[secid] = { ts: Date.now(), pts: pts };
          }
        } else {
          const kl = await safe(DS.fetchKline(secid, 101, 60), null);
          if (kl && kl.length) {
            pts = kl.map((k) => ({ value: k.close }));
            state.trendsCache[cacheKey] = { ts: Date.now(), pts: pts };
          }
        }
      }
      if (pts && pts.length) C.sparkline(node, pts);
    }));
  }

  /* ==========================================================================
   * 详情面板：K 线 / 分时 / 成交量 / 资金流 / 关键数据
   * ========================================================================== */
  const detail = { secid: null, name: null, period: 'd', busy: false, lastChartAt: 0 };

  function periodById(id) {
    return CFG.periods.filter((p) => p.id === id)[0] || CFG.periods[1];
  }

  function buildPeriodTabs() {
    const box = $('#d-period');
    if (!box) return;
    box.innerHTML = CFG.periods.map((p) =>
      '<button data-period="' + C.escapeHtml(p.id) + '"' +
      (p.id === detail.period ? ' class="active"' : '') + '>' + C.escapeHtml(p.name) + '</button>').join('');
  }

  function openDetail(secid, name) {
    detail.secid = secid;
    detail.name = name || secid;
    detail.period = 'd';
    $('#d-name').textContent = detail.name;
    $('#d-code').textContent = secid;
    $('#detail').hidden = false;
    detail.lastChartAt = 0;
    buildPeriodTabs();
    loadDetail();
  }

  function closeDetail() {
    const el = $('#detail');
    if (el) el.hidden = true;
    detail.secid = null;
  }

  /** 右侧关键数据 */
  function renderStats(q) {
    const box = $('#d-stats');
    if (!box) return;
    if (!q) { box.innerHTML = '<div class="empty">暂无数据</div>'; return; }

    const group = (title, rows) =>
      '<div class="stat-group"><h4>' + title + '</h4><div class="stat-grid">' +
      rows.map((r) => '<span>' + r[0] + '</span><b class="' + (r[2] || '') + '">' + r[1] + '</b>').join('') +
      '</div></div>';

    const d = C.dir(q.pct);
    const pctOrNull = (v) => (v === null || v === undefined) ? '--' : C.fmtNum(v) + '%';
    const numOrNull = (v) => (v === null || v === undefined) ? '--' : C.fmtNum(v);

    box.innerHTML =
      group('价格', [
        ['最新', C.fmtNum(q.price), d],
        ['涨跌', C.fmtNum(q.change), d],
        ['涨跌幅', C.fmtPct(q.pct), d],
        ['今开', C.fmtNum(q.open)],
        ['昨收', C.fmtNum(q.prevClose)],
        ['最高', C.fmtNum(q.high), 'up'],
        ['最低', C.fmtNum(q.low), 'down'],
        ['振幅', pctOrNull(q.amplitude)],
        ['换手率', pctOrNull(q.turnover)],
        ['量比', numOrNull(q.volumeRatio)]
      ]) +
      group('成交', [
        ['成交量', C.fmtAmt(q.volume)],
        ['成交额', C.fmtAmt(q.amount)]
      ]) +
      group('资金流向', [
        ['主力净流入', C.fmtMoney(q.netFlow), C.dir(q.netFlow)],
        ['净占比', q.flowPct === null || q.flowPct === undefined ? '--' : C.fmtPct(q.flowPct), C.dir(q.flowPct)],
        ['超大单', C.fmtMoney(q.superFlow), C.dir(q.superFlow)],
        ['大单', C.fmtMoney(q.bigFlow), C.dir(q.bigFlow)],
        ['中单', C.fmtMoney(q.midFlow), C.dir(q.midFlow)],
        ['小单', C.fmtMoney(q.smallFlow), C.dir(q.smallFlow)]
      ]);
  }

  function updateDetailHead(q) {
    if (!q) return;
    const d = C.dir(q.pct);
    const priceEl = $('#d-price');
    if (priceEl) {
      priceEl.textContent = C.fmtNum(q.price);
      priceEl.className = 'dh-price ' + d;
    }
    const chgEl = $('#d-chg');
    if (chgEl) {
      chgEl.innerHTML = '<span class="' + d + '">' + C.fmtNum(q.change) + '</span>' +
        '<span class="' + d + '">' + C.fmtPct(q.pct) + '</span>';
    }
  }

  async function loadDetail() {
    if (!detail.secid || detail.busy) return;
    detail.busy = true;
    const box = $('#d-chart');
    const p = periodById(detail.period);

    // 头部与关键数据
    const res = await safe(DS.fetchQuotes([{ secid: detail.secid, name: detail.name }]), null);
    const q = res && res.data ? res.data[0] : null;
    if (q && q.name) {
      detail.name = q.name;
      $('#d-name').textContent = q.name;
    }
    updateDetailHead(q);
    renderStats(q);

    if (p.klt === 0) {
      if (box) box.innerHTML = '<div class="empty">加载分时…</div>';
      const t = await safe(DS.fetchTrends(detail.secid, q ? q.prevClose : null), null);
      if (t && t.points && t.points.length) C.intraday(box, t.points, t.preClose);
      else panelError(box, '分时数据暂不可用（东财 / 腾讯均无法访问）');
    } else {
      if (box) box.innerHTML = '<div class="empty">加载 K 线…</div>';
      const [kl, fl] = await Promise.all([
        safe(DS.fetchKline(detail.secid, p.klt, CFG.klineLimit), []),
        safe(DS.fetchFlow(detail.secid, p.klt, CFG.klineLimit), [])
      ]);
      if (kl && kl.length) C.candlestick(box, kl, { flows: fl || [], ma: CFG.klineMa });
      else panelError(box, 'K 线数据暂不可用（东财 / 腾讯历史行情均无法访问）');
    }
    detail.busy = false;
    detail.lastChartAt = Date.now();
  }

  /** 详情图表节流重绘间隔：分时最勤、分钟 K 次之、日/周/月最松 */
  function chartGap() {
    const p = periodById(detail.period);
    const klt = p ? p.klt : 101;
    if (klt === 0) return 15000;      // 分时：15 秒
    if (klt < 100) return 60000;      // 5/15/30/60 分钟 K：1 分钟
    return 300000;                    // 日 / 周 / 月 K：5 分钟
  }

  /* ==========================================================================
   * 顶栏：时钟 / 数据源状态 / 刷新调度
   * ========================================================================== */
  function renderTopbar() {
    const chips = CFG.indexGroups.map((g) => {
      const st = marketState(g);
      return '<span class="chip"><span class="dot ' + st + '"></span>' +
        C.escapeHtml(g.title) + '<b>' + STATE_TEXT[st] + '</b>' +
        '<i>' + localTime(g.tz).slice(0, 5) + '</i></span>';
    }).join('');
    $('#market-chips').innerHTML = chips;
    $('#clock-time').textContent = nowStr();
  }

  function anyMarketOpen() {
    return CFG.indexGroups.some((g) => marketState(g) !== 'closed');
  }

  function schedule() {
    clearTimeout(state.timer);
    const interval = anyMarketOpen() ? CFG.refresh.trading : CFG.refresh.closed;
    state.countdown = Math.round(interval / 1000);
    updateCountdown();
    state.timer = setInterval(() => {
      state.countdown--;
      if (state.countdown <= 0) {
        if (state.loading) {
          state.countdown = 5;                 // 上一轮还没跑完，稍后再试
        } else if (state.auto) {
          refreshAll();
        } else {
          state.countdown = Math.round(interval / 1000);
        }
      }
      if (state.countdown % 5 === 0) renderTopbar();
      updateCountdown();
    }, 1000);
  }

  function updateCountdown() {
    const el = $('#next-refresh');
    if (el) el.textContent = state.auto ? (state.countdown + 's 后刷新') : '已暂停';
  }

  async function refreshAll() {
    if (state.loading) return;
    state.loading = true;
    const btn = $('#btn-refresh');
    if (btn) btn.classList.add('loading');
    await Promise.all([
      renderIndices(),
      renderRanks(),
      renderWatchlist()
    ]);
    state.loading = false;
    $('#last-update').textContent = nowStr();

    // 详情面板开着时同步刷新头部与关键数据；图表按周期节流重绘，避免每次都闪一下
    const overlay = $('#detail');
    if (overlay && !overlay.hidden && detail.secid && state.quoteMap) {
      const q = state.quoteMap[detail.secid];
      if (q) { updateDetailHead(q); renderStats(q); }
      if (!detail.busy && Date.now() - (detail.lastChartAt || 0) > chartGap()) loadDetail();
    }

    if (btn) btn.classList.remove('loading');
    schedule();
  }

  /* ==========================================================================
   * 交互绑定
   * ========================================================================== */
  function bindTabs(selector, attr, onPick) {
    const box = $(selector);
    if (!box) return;
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[' + attr + ']');
      if (!btn) return;
      Array.prototype.forEach.call(box.querySelectorAll('[' + attr + ']'), (b) => b.classList.remove('active'));
      btn.classList.add('active');
      onPick(btn.getAttribute(attr));
    });
  }

  function bindEvents() {
    $('#btn-refresh').onclick = () => refreshAll();

    $('#auto-refresh').onclick = function () {
      state.auto = !state.auto;
      this.classList.toggle('off', !state.auto);
      this.textContent = state.auto ? '自动刷新：开' : '自动刷新：关';
      updateCountdown();
    };

    // 板块类型切换（行业 / 概念 / 地域）
    bindTabs('#flow-type', 'data-type', (v) => {
      state.sectorType = CFG.sectorTypes.find((t) => t.id === v) || CFG.sectorTypes[0];
      syncTypeTabs(v);
      renderRanks();
    });
    bindTabs('#change-type', 'data-type', (v) => {
      state.sectorType = CFG.sectorTypes.find((t) => t.id === v) || CFG.sectorTypes[0];
      syncTypeTabs(v);
      renderRanks();
    });

    // 流入 / 流出
    bindTabs('#flow-dir', 'data-dir', (v) => {
      state.flowDir = parseInt(v, 10);
      renderRanks();
    });
    // 涨幅 / 跌幅
    bindTabs('#change-dir', 'data-dir', (v) => {
      state.changeDir = parseInt(v, 10);
      renderRanks();
    });

    // 自选股添加
    const input = $('#watch-input');
    function addWatch() {
      const secid = guessSecid(input.value);
      if (!secid) { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); return; }
      const list = getWatchlist();
      if (list.indexOf(secid) === -1) { list.push(secid); saveWatchlist(list); }
      input.value = '';
      renderWatchlist();
    }
    $('#watch-add').onclick = addWatch;
    input.onkeydown = (e) => { if (e.key === 'Enter') addWatch(); };

    bindDetailEvents();
  }

  /** 详情面板相关交互 */
  function bindDetailEvents() {
    // 点指数卡片打开详情
    const idxBox = $('#indices-container');
    if (idxBox) {
      idxBox.addEventListener('click', (e) => {
        const el = (e.target && e.target.closest) ? e.target.closest('.quote-item[data-secid]') : null;
        if (!el) return;
        const nm = el.querySelector('.quote-name');
        openDetail(el.getAttribute('data-secid'), nm ? nm.textContent : null);
      });
    }

    // 点自选股（个股）同样打开详情
    const watchBox = $('#watch-list');
    if (watchBox) {
      watchBox.addEventListener('click', (e) => {
        const el = (e.target && e.target.closest) ? e.target.closest('.watch-row[data-secid]') : null;
        if (!el) return;
        const nm = el.querySelector('.wn');
        openDetail(el.getAttribute('data-secid'), nm ? nm.textContent : null);
      });
    }

    // 周期切换
    bindTabs('#d-period', 'data-period', (v) => {
      detail.period = v;
      Array.prototype.forEach.call(document.querySelectorAll('#d-period [data-period]'), (b) => {
        b.classList.toggle('active', b.getAttribute('data-period') === v);
      });
      loadDetail();
    });

    // 关闭：按钮 / 点遮罩 / Esc
    const dClose = $('#d-close');
    if (dClose) dClose.onclick = closeDetail;
    const overlay = $('#detail');
    if (overlay) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDetail(); });
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
  }

  function syncTypeTabs(typeId) {
    ['#flow-type', '#change-type'].forEach((sel) => {
      Array.prototype.forEach.call(document.querySelectorAll(sel + ' [data-type]'), (b) => {
        b.classList.toggle('active', b.getAttribute('data-type') === typeId);
      });
    });
  }

  /** 板块类型按钮由 config 生成，改配置即改界面 */
  function buildTypeTabs() {
    const html = CFG.sectorTypes.map((t, i) =>
      '<button data-type="' + C.escapeHtml(t.id) + '"' + (i === 0 ? ' class="active"' : '') + '>' +
      C.escapeHtml(t.name) + '</button>').join('');
    Array.prototype.forEach.call(document.querySelectorAll('#flow-type, #change-type'), (el) => {
      el.innerHTML = html;
    });
  }

  function bindHealth() {
    DS.onHealth((h) => {
      const map = { em: '东方财富', tx: '腾讯行情', sina: '新浪快讯', sinaGlobal: '新浪全球指数' };
      const html = Object.keys(h).map((k) =>
        '<span class="chip src"><span class="dot ' + h[k] + '"></span>' + map[k] + '</span>').join('');
      $('#health-bar').innerHTML = html;

      // 主源不通时把影响说清楚，避免误以为看板坏了
      const hint = $('#source-hint');
      if (!hint) return;
      if (h.em === 'error') {
        hint.textContent = '主源不通：日韩指数 / 板块资金流不可用';
        hint.className = 'status-text warn';
      } else if (h.em === 'ok') {
        hint.textContent = '';
        hint.className = 'status-text';
      }
    });
    // 点击健康灯区域弹出节点测速面板
    const bar = $('#health-bar');
    if (bar) bar.style.cursor = 'pointer';
    if (bar && !bar.dataset.bound) {
      bar.dataset.bound = '1';
      bar.addEventListener('click', openNodePanel);
    }
  }

  function openNodePanel() {
    let panel = document.getElementById('node-panel');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.id = 'node-panel';
    panel.className = 'node-panel';
    panel.innerHTML = '<div class="np-head">数据节点测速 <span class="np-hint">点击健康灯可关闭</span></div><div class="np-body">测速中…</div>';
    document.body.appendChild(panel);

    DS.testNodes().then((rows) => {
      const byGroup = {};
      rows.forEach((r) => {
        byGroup[r.group] = byGroup[r.group] || [];
        byGroup[r.group].push(r);
      });
      const html = Object.keys(byGroup).map((g) => {
        const items = byGroup[g].map((r) => {
          const cls = r.ok ? (r.ms < 800 ? 'ok' : (r.ms < 2000 ? 'slow' : 'warn')) : 'bad';
          const ms = r.ok ? r.ms + 'ms' : '超时';
          return '<div class="np-row ' + cls + '">' +
            '<span class="np-dot"></span>' +
            '<span class="np-host">' + r.host.replace('https://', '') + '</span>' +
            '<span class="np-ms">' + ms + '</span></div>';
        }).join('');
        return '<div class="np-group"><div class="np-gname">' + g + '</div>' + items + '</div>';
      }).join('');
      panel.querySelector('.np-body').innerHTML = html || '无节点';
    });

    setTimeout(() => {
      document.addEventListener('click', function close(e) {
        if (!panel.contains(e.target) && e.target.id !== 'health-bar') {
          panel.remove();
          document.removeEventListener('click', close);
        }
      });
    }, 0);
  }

  /* ==========================================================================
   * 启动
   * ========================================================================== */
  function init() {
    buildTypeTabs();
    bindEvents();
    bindHealth();
    renderTopbar();
    setInterval(renderTopbar, 5000);
    refreshAll();
    renderNews();
    state.newsTimer = setInterval(renderNews, CFG.refresh.news);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
