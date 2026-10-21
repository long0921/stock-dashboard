/* ==========================================================================
 * datasource.js —— 数据层
 * 纯静态页面（file://）无法用 fetch 跨域，所以统一走 JSONP（<script> 标签）
 * 职责：请求封装 / 多源降级 / 超时重试 / 数据标准化 / 健康状态上报
 * ========================================================================== */

(function () {
  const CFG = window.DASH_CONFIG;
  const health = { em: 'unknown', tx: 'unknown', sina: 'unknown', sinaGlobal: 'unknown' };
  const listeners = [];
  let seq = 0;

  /** 从完整 URL 中拆出 host / path，让 config 里的地址既当首选节点又能被替换 */
  function hostOf(url) {
    const m = /^(https?:\/\/[^/]+)/.exec(String(url));
    return m ? m[1] : '';
  }
  function pathOf(url) {
    return String(url).replace(/^https?:\/\/[^/]+/, '');
  }
  function hostsFor(url, fallbacks) {
    const list = [];
    const h = hostOf(url);
    if (h) list.push(h);
    fallbacks.forEach((x) => { if (list.indexOf(x) === -1) list.push(x); });
    return list;
  }

  /* ---------------- 多域名轮换 ----------------
   * 东财有多个数据节点，单个节点限流 / 被墙时自动换下一个
   */
  const EM_HOSTS = [
    'https://push2.eastmoney.com',
    'https://82.push2.eastmoney.com',
    'https://push2delay.eastmoney.com'
  ];
  const EM_HIS_HOSTS = [
    'https://push2his.eastmoney.com',
    'https://41.push2his.eastmoney.com'
  ];

  async function jsonpAnywhere(hosts, path, query, timeout) {
    let lastErr = null;
    for (let i = 0; i < hosts.length; i++) {
      try {
        return await jsonp(hosts[i] + path + '?' + query, 'cb', timeout || 3500);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('全部数据节点不可用');
  }

  /* ---------------- 基础：JSONP ----------------
   * 注意：新浪的 callback 名有字符白名单（不接受下划线开头/连续下划线），
   * 所以回调名允许由调用方指定，见 fetchNews()
   */
  function jsonp(url, cbParam, timeout, cbName) {
    return new Promise((resolve, reject) => {
      const fnName = cbName || ('dashJp' + (++seq) + 'x' + Date.now().toString(36));
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('请求超时'));
      }, timeout || CFG.refresh.jsonpTimeout);

      function cleanup() {
        clearTimeout(timer);
        try { delete window[fnName]; } catch (e) { window[fnName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[fnName] = function (data) { cleanup(); resolve(data); };
      script.onerror = function () { cleanup(); reject(new Error('网络错误或被拦截')); };
      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + cbParam + '=' + fnName;
      document.head.appendChild(script);
    });
  }

  /* ---------------- 基础：加载一段 JS 并读取其定义的全局变量（腾讯源） ---------------- */
  function loadScriptVars(url, varNames, timeout) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('请求超时'));
      }, timeout || CFG.refresh.jsonpTimeout);
      function cleanup() {
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      script.charset = 'GBK';
      script.onload = function () {
        const out = {};
        varNames.forEach((n) => {
          const v = window['v_' + n];
          if (v && typeof v === 'string' && v.indexOf('~') > -1) out[n] = v;
        });
        cleanup();
        resolve(out);
      };
      script.onerror = function () { cleanup(); reject(new Error('网络错误')); };
      script.src = url;
      document.head.appendChild(script);
    });
  }

  /* ---------------- 腾讯 appstock 系接口 ----------------
   * 响应形如 "变量名={json}"（赋值语句而非函数调用），
   * 通过 _var= 指定变量名，<script> 加载后从 window 上读回来。
   * UTF-8 JSON，无需 GBK。
   */
  function loadTxVar(url, timeout) {
    return new Promise((resolve, reject) => {
      const varName = 'dashTx' + (++seq) + 'x' + Date.now().toString(36);
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('请求超时'));
      }, timeout || CFG.refresh.jsonpTimeout);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[varName]; } catch (e) { window[varName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      script.onload = function () {
        const v = window[varName];
        cleanup();
        if (v && v.code === 0 && v.data) resolve(v);
        else reject(new Error('腾讯返回异常'));
      };
      script.onerror = function () { cleanup(); reject(new Error('网络错误')); };
      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + '_var=' + varName;
      document.head.appendChild(script);
    });
  }

  function setHealth(src, state) {
    if (health[src] !== state) {
      health[src] = state;
      listeners.forEach((fn) => fn(health));
    }
  }

  /* ---------------- 工具：数字安全转换 ---------------- */
  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /* ==========================================================================
   * 1) 指数 / 个股行情
   * ========================================================================== */

  /** 东方财富批量行情 */
  async function fetchEMQuotes(items, timeout) {
    if (!items.length) return [];
    const secids = items.map((i) => i.secid).join(',');
    // f7 振幅 f8 换手 f10 量比 f62 主力净流入 f66/f72/f78/f84 超大/大/中/小单 f184 主力净占比
    const query = 'fltt=2&invt=2&secids=' + encodeURIComponent(secids) +
      '&fields=f1,f2,f3,f4,f5,f6,f7,f8,f10,f12,f13,f14,f15,f16,f17,f18,' +
      'f62,f66,f72,f78,f84,f184,f124';
    const res = await jsonpAnywhere(
      hostsFor(CFG.endpoints.emQuote, EM_HOSTS),
      pathOf(CFG.endpoints.emQuote), query, timeout || 4000);
    const diff = (res && res.data && res.data.diff) || [];
    const arr = Array.isArray(diff)
      ? diff
      : Object.keys(diff).map((k) => diff[k]); // 有时返回对象而非数组
    return arr.map((d) => ({
      // 用 "市场.代码" 作为唯一标识（与 config 里的 secid 一致），避免跨源匹配错位
      secid: d.f13 !== undefined && d.f13 !== null ? (d.f13 + '.' + d.f12) : String(d.f12),
      code: d.f12,
      market: d.f13,
      name: d.f14,
      price: num(d.f2),
      change: num(d.f4),
      pct: num(d.f3),
      high: num(d.f15),
      low: num(d.f16),
      open: num(d.f17),
      prevClose: num(d.f18),
      volume: num(d.f5),          // 成交量（手）
      amount: num(d.f6),          // 成交额
      amplitude: num(d.f7),       // 振幅 %
      turnover: num(d.f8),        // 换手率 %
      volumeRatio: num(d.f10),    // 量比
      netFlow: num(d.f62),        // 主力净流入
      superFlow: num(d.f66),      // 超大单
      bigFlow: num(d.f72),        // 大单
      midFlow: num(d.f78),        // 中单
      smallFlow: num(d.f84),      // 小单
      flowPct: num(d.f184),       // 主力净占比 %
      updated: d.f124,
      source: 'em'
    })).filter((d) => d.price !== null);
  }

  /** 东财 secid -> 腾讯代码。腾讯无日韩数据，因此日韩只能靠东财 */
  function txSymbolOf(secid) {
    const map = {
      '1.000001': 'sh000001', '0.399001': 'sz399001', '0.399006': 'sz399006',
      '1.000688': 'sh000688', '1.000300': 'sh000300', '1.000016': 'sh000016',
      '100.DJIA': 'usDJI', '100.IXIC': 'usIXIC', '100.SPX': 'usINX',
      '100.NDX': 'usNDX',
      '100.HSI': 'hkHSI', '100.HSTECH': 'hkHSTECH'
    };
    if (map[secid]) return map[secid];
    const p = String(secid).split('.');
    const m = p[0], code = p[1];
    if (m === '1') return 'sh' + code;                       // 沪市
    if (m === '0' && /^\d{6}$/.test(code)) return 'sz' + code; // 深市
    if (m === '116') return 'hk' + code;                     // 港股
    if (m === '105' || m === '106' || m === '107') return 'us' + code; // 美股
    return null;
  }

  /** 腾讯备用行情（A 股 / 美股 / 港股，无日韩、无板块资金流） */
  async function fetchTXQuotes(items) {
    const pairs = items.map((i) => [i.secid, txSymbolOf(i.secid)]).filter((p) => p[1]);
    if (!pairs.length) return [];
    const symbols = pairs.map((p) => p[1]);
    const raw = await loadScriptVars(CFG.endpoints.txQuote + symbols.join(','), symbols);
    const nameMap = {};
    const secidMap = {};
    pairs.forEach((p) => { secidMap[p[1]] = p[0]; });
    items.forEach((i) => { const s = txSymbolOf(i.secid); if (s) nameMap[s] = i.name; });
    return Object.keys(raw).map((key) => {
      const f = raw[key].split('~');
      const parsed = parseTX(f);
      // f[35] 是 "现价/成交量(手)/成交额(元)" 的组合串，拆出来补成交量与成交额
      const combo = typeof f[35] === 'string' && f[35].indexOf('/') > -1 ? f[35].split('/') : null;
      const isCN = /^(sh|sz)/.test(key);
      return {
        secid: secidMap[key] || '',
        code: String(f[2] || '').replace(/^\./, ''), market: null,
        name: f[1] || nameMap[key] || key,
        price: parsed.price, change: parsed.change, pct: parsed.pct,
        high: parsed.high, low: parsed.low, open: num(f[5]),
        prevClose: parsed.prevClose,
        volume: combo ? num(combo[1]) : num(f[6]),
        amount: combo ? num(combo[2]) : null,
        turnover: isCN ? num(f[38]) : null,    // f[38] 换手率仅确认 A 股含义，其余市场不乱猜
        source: 'tx'
      };
    });
  }

  /**
   * 腾讯各市场字段位置不一致（港股比 A 股多一个时间字段），
   * 这里用「现价 - 昨收 = 涨跌额」的关系自动定位涨跌幅，避免错位。
   */
  function parseTX(f) {
    const price = num(f[3]);
    const prevClose = num(f[4]);
    let change = num(f[31]);
    let pct = num(f[32]);
    let high = num(f[33]);
    let low = num(f[34]);
    const delta = (price !== null && prevClose) ? price - prevClose : null;
    if (delta !== null && prevClose) {
      const targetPct = (delta / prevClose) * 100;
      for (let i = 28; i <= 36; i++) {
        const c = num(f[i]);
        const p = num(f[i + 1]);
        if (c === null || p === null) continue;
        if (Math.abs(c - delta) < Math.max(0.02, Math.abs(delta) * 0.05) &&
            Math.abs(p - targetPct) < 0.08) {
          change = c; pct = p; high = num(f[i + 2]); low = num(f[i + 3]);
          break;
        }
      }
    }
    return { price: price, prevClose: prevClose, change: change, pct: pct, high: high, low: low };
  }

  /**
   * 新浪全球指数（日经/KOSPI）：响应是 var hq_str_xxx="..." 赋值语句，GBK 编码
   * 日经 int_nikkei："日经指数,现价,涨跌额,涨跌幅%"（4 字段）
   * KOSPI b_KOSPI："韩国KOSPI指数,现价,涨跌额,涨跌幅%,?,时间,日期,开盘,昨收,最高,最低,?"（13 字段）
   */
  function loadSinaGlobal(codes, timeout) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('新浪超时')); }, timeout || 5000);
      function cleanup() {
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      script.charset = 'GBK';
      script.onload = function () {
        const out = {};
        codes.forEach((c) => {
          const v = window['hq_str_' + c];
          if (v && typeof v === 'string' && v.indexOf(',') > -1) out[c] = v;
        });
        cleanup();
        if (!Object.keys(out).length) reject(new Error('新浪无数据'));
        else resolve(out);
      };
      script.onerror = function () { cleanup(); reject(new Error('新浪 Referer 校验或网络错误')); };
      script.src = CFG.endpoints.sinaGlobal + codes.join(',');
      document.head.appendChild(script);
    });
  }

  /** 把新浪全球指数字段标准化成统一 quote 对象 */
  async function fetchSinaGlobalQuotes(items) {
    const withSina = items.filter((i) => i.sinaCode);
    if (!withSina.length) return [];
    const codes = withSina.map((i) => i.sinaCode);
    const raw = await loadSinaGlobal(codes, 5000);
    setHealth('sinaGlobal', 'ok');
    return withSina.map((i) => {
      const s = raw[i.sinaCode];
      if (!s) return null;
      const f = s.split(',');
      const price = num(f[1]);
      const change = num(f[2]);
      const pct = num(f[3]);
      const prevClose = (change !== null && price !== null && change !== 0)
        ? price - change : null;
      // KOSPI 格式有开盘/昨收/最高/最低，日经没有
      const open = num(f[7]) || null;
      const prevCloseFull = num(f[8]) || prevClose;
      const high = num(f[9]) || null;
      const low = num(f[10]) || null;
      return {
        secid: i.secid,
        code: i.secid.split('.')[1],
        market: null,
        name: f[0] || i.name,
        price: price,
        change: change,
        pct: pct,
        high: high, low: low, open: open,
        prevClose: prevCloseFull,
        volume: null, amount: null,
        turnover: null, volumeRatio: null,
        netFlow: null, superFlow: null, bigFlow: null, midFlow: null, smallFlow: null,
        flowPct: null, source: 'sina'
      };
    }).filter((q) => q && q.price !== null);
  }

  /** 行情统一入口：东财批量 -> 缺失项逐个补 -> 腾讯 -> 新浪全球指数（日韩兜底） */
  async function fetchQuotes(items) {
    if (!items || !items.length) return { data: [], source: 'none' };

    const got = {};
    let emReachable = false;

    // 1) 批量请求
    try {
      const batch = await fetchEMQuotes(items);
      emReachable = true;
      setHealth('em', 'ok');
      batch.forEach((q) => { if (q.secid) got[q.secid] = q; });
    } catch (e) {
      // 网络层不可用（域名不通 / 被限流），不做逐个重试，直接换源
      setHealth('em', 'error');
    }

    // 2) 东财通了但个别代码取不到（指数代码写错、或该指数东财没有）
    //    逐个重取，避免一个坏代码把同批其他指数一起拖没
    if (emReachable) {
      const missing = items.filter((i) => !got[i.secid]);
      const deadline = Date.now() + 6000;        // 补请求总预算，避免个别坏代码拖慢整页
      for (const item of missing) {
        if (Date.now() > deadline) break;
        try {
          const one = await fetchEMQuotes([item], 3500);
          if (one && one.length && one[0].secid) got[one[0].secid] = one[0];
        } catch (e) { /* 单个失败忽略 */ }
      }
      const list = Object.keys(got).map((k) => got[k]);
      if (list.length) return { data: list, source: 'em' };
    }

    // 3) 东财整体不可用 -> 腾讯（注意：腾讯没有日韩指数）
    const rest = items.filter((i) => !got[i.secid]);
    try {
      const tx = await fetchTXQuotes(rest);
      setHealth('tx', 'ok');
      tx.forEach((q) => { if (q.secid) got[q.secid] = q; });
    } catch (e) {
      setHealth('tx', 'error');
    }

    // 4) 腾讯仍缺的（主要是日韩指数）-> 新浪全球指数兜底
    const stillMissing = items.filter((i) => !got[i.secid] && i.sinaCode);
    if (stillMissing.length) {
      try {
        const sina = await fetchSinaGlobalQuotes(stillMissing);
        sina.forEach((q) => { if (q.secid) got[q.secid] = q; });
      } catch (e) {
        setHealth('sinaGlobal', 'error');
      }
    }

    const all = Object.keys(got).map((k) => got[k]);
    if (!all.length) throw new Error('全部行情源不可用');
    return { data: all, source: emReachable ? 'em' : 'tx' };
  }

  /* ==========================================================================
   * 2) 排行（板块资金流 / 涨跌幅）
   * ========================================================================== */

  async function fetchRank(fs, fid, po, limit, fields) {
    const query = 'pn=1&pz=' + limit + '&po=' + po + '&np=1&fltt=2&invt=2' +
      '&fid=' + fid + '&fs=' + encodeURIComponent(fs) +
      '&fields=' + (fields || 'f12,f14,f2,f3,f62,f184,f104,f105,f207,f222');
    const res = await jsonpAnywhere(
      hostsFor(CFG.endpoints.emRank, EM_HOSTS),
      pathOf(CFG.endpoints.emRank), query, 4000);
    const diff = (res && res.data && res.data.diff) || [];
    const arr = Array.isArray(diff) ? diff : Object.keys(diff).map((k) => diff[k]);
    return arr.map((d) => ({
      code: d.f12,
      name: d.f14,
      price: num(d.f2),
      pct: num(d.f3),
      netFlow: num(d.f62),      // 主力净流入（元）
      flowPct: num(d.f184),     // 主力净占比 %
      up: num(d.f104),          // 上涨家数
      down: num(d.f105),        // 下跌家数
      leader: d.f207 || null,   // 领涨股
      leaderPct: num(d.f222)
    })).filter((d) => d.name);
  }

  /* ==========================================================================
   * 2.5) 示例数据（离线兜底）
   * 仅当所有在线数据源都取不到板块数据时使用，界面上会明确标注「示例数据」
   * 用途：断网 / 接口被限制时，看板结构依然可见，方便调试和演示
   * ========================================================================== */

  const DEMO_SECTORS = [
    { code: 'BK1037', name: '消费电子', pct: 3.18, netFlow: 2898452224, leader: '工业富联' },
    { code: 'BK1338', name: '消费电子零部件及组装', pct: 3.09, netFlow: 2694481920 },
    { code: 'BK1205', name: '机械设备', pct: 2.45, netFlow: 2273493504 },
    { code: 'BK1237', name: '自动化设备', pct: 4.00, netFlow: 1391188064 },
    { code: 'BK0727', name: '医疗服务', pct: 2.80, netFlow: 928549904 },
    { code: 'BK1600', name: '医疗研发外包', pct: 2.60, netFlow: 645087136 },
    { code: 'BK1593', name: '通信终端及配件', pct: 3.53, netFlow: 582390400 },
    { code: 'BK1201', name: '电子', pct: 2.58, netFlow: 566881792 },
    { code: 'BK0481', name: '汽车零部件', pct: 1.70, netFlow: 558877008 },
    { code: 'BK1408', name: '机器人', pct: 4.01, netFlow: -521684160 }
  ];

  function demoRank(kind, po) {
    const rows = DEMO_SECTORS.slice();
    const desc = po !== 0;                       // po=1 降序，po=0 升序
    if (kind === 'flow') rows.sort((a, b) => desc ? b.netFlow - a.netFlow : a.netFlow - b.netFlow);
    else rows.sort((a, b) => desc ? b.pct - a.pct : a.pct - b.pct);
    return rows.map((r) => ({
      code: r.code, name: r.name, price: null, pct: r.pct,
      netFlow: r.netFlow, flowPct: null, up: null, down: null,
      leader: r.leader || null, leaderPct: null, demo: true
    }));
  }

  /* ==========================================================================
   * 3) 分时走势（迷你 sparkline）
   * ========================================================================== */

  /**
   * 当日分时：价格 + 均价 + 成交量
   * 字段顺序 f51 时间 / f52 开 / f53 收(即当前价) / f54 高 / f55 低 / f56 量 / f57 额 / f58 均价
   * 东财不通时自动降级到腾讯（腾讯无均价字段，图表会自动不画均价线）
   */
  async function fetchTrends(secid, preClose) {
    try {
      const query = 'secid=' + secid +
        '&fields1=f1,f2,f3,f4,f5,f6,f7,f8' +
        '&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1';
      const res = await jsonpAnywhere(
        hostsFor(CFG.endpoints.emTrends, EM_HIS_HOSTS),
        pathOf(CFG.endpoints.emTrends), query, 4000);
      const trends = (res && res.data && res.data.trends) || [];
      if (!trends.length) throw new Error('东财分时为空');
      const points = trends.map((t) => {
        const p = String(t).split(',');
        return {
          time: String(p[0] || '').slice(11, 16),   // 只留 HH:mm
          open: num(p[1]),
          value: num(p[2]),                          // 当前价
          high: num(p[3]),
          low: num(p[4]),
          volume: num(p[5]),                         // 该分钟成交量（手）
          amount: num(p[6]),
          avg: num(p[7])                             // 均价
        };
      }).filter((p) => p.value !== null);
      if (!points.length) throw new Error('东财分时为空');
      return {
        points: points,
        preClose: num(res && res.data ? res.data.preClose : null) || preClose || null,
        name: res && res.data ? res.data.name : null
      };
    } catch (e) {
      return await fetchTXTrends(secid, preClose);
    }
  }

  /**
   * 腾讯分时：data[code].data.data = ["0930 现价 累计量 累计额", ...]
   * 量与额是累计值，需要差分成每分钟；昨收取 data[code].qt[code][4]
   */
  async function fetchTXTrends(secid, preClose) {
    const code = txSymbolOf(secid);
    if (!code) throw new Error('该标的无腾讯分时（日韩指数仅东财提供）');
    const res = await loadTxVar(CFG.endpoints.txMinute + '?code=' + code, 8000);
    const d = res.data && res.data[code];
    const arr = d && d.data && d.data.data;
    if (!arr || !arr.length) throw new Error('腾讯分时为空');
    const qt = d.qt && d.qt[code];
    let prevV = 0, prevA = 0;
    const points = arr.map((s) => {
      const p = String(s).split(/\s+/);
      const cv = num(p[2]), ca = num(p[3]);
      const pt = {
        time: String(p[0]).slice(0, 2) + ':' + String(p[0]).slice(2, 4),
        open: null, high: null, low: null,
        value: num(p[1]),
        volume: cv !== null ? Math.max(cv - prevV, 0) : null,
        amount: ca !== null ? Math.max(ca - prevA, 0) : null,
        avg: null                                      // 腾讯无均价字段
      };
      if (cv !== null) prevV = cv;
      if (ca !== null) prevA = ca;
      return pt;
    }).filter((p) => p.value !== null);
    if (!points.length) throw new Error('腾讯分时为空');
    return {
      points: points,
      preClose: (qt ? num(qt[4]) : null) || preClose || null,
      name: qt ? qt[1] : null
    };
  }

  /* ==========================================================================
   * 3.5) K 线 与 资金流历史
   * ========================================================================== */

  /** K 线：klt 101=日 102=周 103=月；5/15/30/60=分钟线。东财不通自动降级腾讯 */
  async function fetchKline(secid, klt, lmt) {
    try {
      const query = 'secid=' + secid +
        '&fields1=f1,f2,f3,f4,f5,f6' +
        '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
        '&klt=' + (klt || 101) + '&fqt=1&end=20500101&lmt=' + (lmt || 120);
      const res = await jsonpAnywhere(
        hostsFor(CFG.endpoints.emKline, EM_HIS_HOSTS),
        pathOf(CFG.endpoints.emKline), query, 4000);
      const arr = (res && res.data && res.data.klines) || [];
      const list = arr.map((s) => {
        const p = String(s).split(',');
        return {
          date: p[0],
          open: num(p[1]), close: num(p[2]), high: num(p[3]), low: num(p[4]),
          volume: num(p[5]), amount: num(p[6]),
          amplitude: num(p[7]), pct: num(p[8]), change: num(p[9]), turnover: num(p[10])
        };
      }).filter((k) => k.close !== null);
      if (!list.length) throw new Error('东财 K 线为空');
      return list;
    } catch (e) {
      return await fetchTXKline(secid, klt, lmt);
    }
  }

  /**
   * 腾讯 K 线：fqkline（日/周/月）与 mkline（分钟）
   * 返回 [日期, 开, 收, 高, 低, 量, ...]，量单位与东财不同但只影响 tooltip 文案
   */
  const TX_KLT = { 101: 'day', 102: 'week', 103: 'month', 5: 'm5', 15: 'm15', 30: 'm30', 60: 'm60' };

  async function fetchTXKline(secid, klt, lmt) {
    const code = txSymbolOf(secid);
    if (!code) throw new Error('该标的无腾讯 K 线（日韩指数仅东财提供）');
    const k = TX_KLT[klt] || 'day';
    const n = lmt || 120;
    const url = k.charAt(0) === 'm'
      ? CFG.endpoints.txKlineMin + '?param=' + code + ',' + k + ',,' + n
      : CFG.endpoints.txKline + '?param=' + code + ',' + k + ',,,' + n + ',qfq';
    const res = await loadTxVar(url, 8000);
    const d = res.data && res.data[code];
    const arr = (d && (d[k] || d['qfq' + k])) || [];
    if (!arr.length) throw new Error('腾讯 K 线为空');
    const out = [];
    arr.forEach((r) => {
      const close = num(r[2]);
      if (close === null) return;
      const open = num(r[1]), high = num(r[3]), low = num(r[4]);
      const prev = out.length ? out[out.length - 1].close : null;
      const change = prev !== null ? close - prev : null;
      out.push({
        // 分钟线日期形如 "202610201130"，补成 "2026-10-20 11:30" 便于阅读
        date: String(r[0]).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5'),
        open: open, close: close, high: high, low: low,
        volume: num(r[5]), amount: null,
        amplitude: (prev && high !== null && low !== null) ? (high - low) / prev * 100 : null,
        pct: (prev && change !== null) ? change / prev * 100 : null,
        change: change, turnover: null
      });
    });
    return out;
  }

  /** 资金流历史：主力 / 超大单 / 大单 / 中单 / 小单 净流入（仅东财有，失败快速返回空，不拖累 K 线渲染） */
  async function fetchFlow(secid, klt, lmt) {
    const query = 'secid=' + secid +
      '&fields1=f1,f2,f3,f7' +
      '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
      '&klt=' + (klt || 101) + '&lmt=' + (lmt || 120);
    // 资金流只有东财提供，且东财被拦时两个 his 节点解析到同一 IP，没必要逐个等，只试第一个 host 快速失败
    try {
      const res = await jsonp(
        EM_HIS_HOSTS[0] + pathOf(CFG.endpoints.emFlow) + '?' + query,
        'cb', 3000);
      const arr = (res && res.data && res.data.klines) || [];
      return arr.map((s) => {
        const p = String(s).split(',');
        return {
          date: p[0],
          main: num(p[1]),    // 主力净流入
          super: num(p[2]),   // 超大单
          big: num(p[3]),     // 大单
          mid: num(p[4]),     // 中单
          small: num(p[5])    // 小单
        };
      }).filter((f) => f.main !== null);
    } catch (e) {
      return [];
    }
  }

  /* ==========================================================================
   * 4) 财经快讯（新浪 7x24）
   * ========================================================================== */

  async function fetchNews(limit) {
    const url = CFG.endpoints.sinaNews +
      '?page=1&page_size=' + (limit || 30) + '&zhibo_id=152&tag_id=0&dire=f&dpc=1';
    // 新浪对回调名有白名单限制，这里用纯字母数字的回调名
    let res;
    try {
      res = await jsonp(url, 'callback', null, 'dashNews' + Date.now());
      setHealth('sina', 'ok');
    } catch (e) {
      setHealth('sina', 'error');
      throw e;
    }
    const list = (res && res.result && res.result.data && res.result.data.feed &&
      res.result.data.feed.list) || [];
    return list.map((n) => {
      let tags = [];
      if (n.tag && n.tag.length) tags = n.tag.map((t) => t.name);
      return {
        id: n.id,
        text: stripHtml(n.rich_text || ''),
        time: n.create_time,
        url: n.docurl,
        tags: tags
      };
    }).filter((n) => n.text);
  }

  const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', '#160': ' ' };

  function stripHtml(s) {
    return String(s)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')                       // 先去掉标签
      .replace(/&([a-z]+|#39|#160);/gi, function (m, g1) {
        const k = String(g1).toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENTITY_MAP, k) ? ENTITY_MAP[k] : m;
      })                                             // 再还原实体
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------------- 节点测速 ---------------- */
  function pingHost(host, path, query, cbParam) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      jsonp(host + path + '?' + query, cbParam || 'cb', 3000)
        .then(() => resolve({ ok: true, ms: Math.round(performance.now() - t0) }))
        .catch(() => resolve({ ok: false, ms: null }));
    });
  }
  async function testNodes() {
    const groups = [
      { group: '东财实时行情', hosts: EM_HOSTS, path: '/api/qt/clist/get',
        q: 'pn=1&pz=1&fid=f3&po=1&fs=m:1+t:2&fields=f12,f14' },
      { group: '东财历史K线', hosts: EM_HIS_HOSTS, path: '/api/qt/stock/kline/get',
        q: 'secid=1.000001&klt=101&fqt=1&lmt=1&fields1=f1&fields2=f51' },
      { group: '腾讯行情', hosts: ['https://qt.gtimg.cn', 'https://web.ifzq.gtimg.cn'], path: '', q: '' }
    ];
    const out = [];
    await Promise.all(groups.map(async (g) => {
      await Promise.all(g.hosts.map(async (h) => {
        let r;
        if (g.path) {
          r = await pingHost(h, g.path, g.q);
        } else {
          // 腾讯：直接 script 加载
          r = await new Promise((resolve) => {
            const t0 = performance.now();
            const s = document.createElement('script');
            s.charset = 'GBK';
            s.onload = () => resolve({ ok: true, ms: Math.round(performance.now() - t0) });
            s.onerror = () => resolve({ ok: false, ms: null });
            s.src = h + (h.indexOf('gtimg.cn') > -1 && h.indexOf('web.') === -1 ? '/q=s_sh000001' : '/appstock/app/minute/query?code=sh000001');
            document.head.appendChild(s);
            setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, 3000);
          });
        }
        out.push({ group: g.group, host: h, ok: r.ok, ms: r.ms });
      }));
    }));
    return out;
  }

  /* ---------------- 导出 ---------------- */
  window.DataSource = {
    fetchQuotes: fetchQuotes,
    fetchRank: fetchRank,
    fetchTrends: fetchTrends,
    fetchKline: fetchKline,
    fetchFlow: fetchFlow,
    fetchNews: fetchNews,
    demoRank: demoRank,
    testNodes: testNodes,
    onHealth: function (fn) { listeners.push(fn); fn(health); },
    getHealth: function () { return Object.assign({}, health); }
  };
})();
