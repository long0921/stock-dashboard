/* ==========================================================================
 * config.js —— 看板全部可配置项集中在这里
 * 想加指数 / 改板块 / 换数据源 / 调刷新频率，只改本文件即可，不用动业务代码
 * ========================================================================== */

window.DASH_CONFIG = {
  /* ---------- 离线兜底 ----------
   * 板块接口全部取不到时，用内置示例数据渲染（界面会明确标注「示例数据」），
   * 保证看板结构始终可见。不想看到示例数据就改成 false
   */
  demo: { enabled: true },

  /* ---------- 刷新策略（毫秒）---------- */
  refresh: {
    trading: 5000,       // 交易时段刷新间隔
    closed: 300000,      // 非交易时段刷新间隔
    news: 60000,         // 新闻刷新间隔
    jsonpTimeout: 5000   // 单次请求超时（东财被拦时快速降级到腾讯）
  },

  /* ---------- 数据源 ----------
   * 主源：东方财富（数据最全，含板块资金流）
   * 备源：腾讯财经（仅有指数，无板块数据），主源失败时自动降级
   */
  endpoints: {
    // 东方财富：批量指数 / 个股行情
    emQuote: 'https://push2.eastmoney.com/api/qt/ulist.np/get',
    // 东方财富：排行列表（板块、个股）
    emRank: 'https://push2.eastmoney.com/api/qt/clist/get',
    // 东方财富：分时数据（迷你走势图 / 当日分时图）
    emTrends: 'https://push2his.eastmoney.com/api/qt/stock/trends2/get',
    // 东方财富：K 线（klt 101=日 102=周 103=月 5/15/30/60=分钟）
    emKline: 'https://push2his.eastmoney.com/api/qt/stock/kline/get',
    // 东方财富：资金流历史（主力 / 超大单 / 大单 / 中单 / 小单）
    emFlow: 'https://push2his.eastmoney.com/api/qt/stock/fflow/kline/get',
    // 腾讯财经：备用行情（GBK 编码的 JS 变量，不是标准 JSONP）
    txQuote: 'https://qt.gtimg.cn/q=',
    // 腾讯财经：备用 K 线 / 分时（东财历史节点不通时自动降级）
    // 注意这三个接口的响应是 "变量名={json}" 赋值语句，靠 _var 参数指定变量名
    txKline: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',   // 日/周/月 K
    txKlineMin: 'https://ifzq.gtimg.cn/appstock/app/kline/mkline',   // 分钟 K
    txMinute: 'https://web.ifzq.gtimg.cn/appstock/app/minute/query', // 当日分时
    // 新浪财经 7x24 全球直播（财经快讯）
    sinaNews: 'https://zhibo.sina.com.cn/api/zhibo/feed',
    // 新浪全球指数实时（日经/KOSPI，file:// 下 Referer 校验可能 403，开代理或 http 打开时生效）
    sinaGlobal: 'https://hq.sinajs.cn/list='
  },

  /* ---------- 反代注入 ----------
   * 分享链接里加 ?proxy=https://你的.workers.dev ，
   * 所有东财请求自动走反代（解决别人宽带污染 push2.eastmoney.com 的问题）。
   * 例：https://你的.github.io/stock-dashboard/?proxy=https://xxx.workers.dev
   */

  /* ---------- 指数分组 ----------
   * secid 规则：1.= 沪市, 0.= 深市/北交所, 100.= 国际指数
   * 分为 core（已验证，优先请求）和 extra（扩展，独立请求，失败不影响主区）
   */
  indexGroups: [
    {
      id: 'cn',
      title: 'A 股',
      flag: '🇨🇳',
      tz: 'Asia/Shanghai',
      session: [[9, 30], [11, 30], [13, 0], [15, 0]],
      core: [
        { secid: '1.000001', name: '上证指数' },
        { secid: '0.399001', name: '深证成指' },
        { secid: '0.399006', name: '创业板指' },
        { secid: '1.000688', name: '科创50' },
        { secid: '1.000300', name: '沪深300' }
      ],
      extra: [
        { secid: '1.000016', name: '上证50' },
        { secid: '0.899050', name: '北证50' }
      ]
    },
    {
      id: 'us',
      title: '美股',
      flag: '🇺🇸',
      tz: 'America/New_York',
      session: [[9, 30], [16, 0]],
      core: [
        { secid: '100.DJIA', name: '道琼斯' },
        { secid: '100.NDX', name: '纳斯达克100' },
        { secid: '100.SPX', name: '标普500' }
      ],
      extra: [
        { secid: '100.IXIC', name: '纳斯达克综指' }
      ]
    },
    {
      id: 'kr',
      title: '韩国',
      flag: '🇰🇷',
      tz: 'Asia/Seoul',
      session: [[9, 0], [15, 30]],
      core: [
        { secid: '100.KS11', name: 'KOSPI', sinaCode: 'b_KOSPI' }
      ],
      extra: [
        { secid: '100.KOSPI200', name: 'KOSPI200' }
      ]
    },
    {
      id: 'jp',
      title: '日本',
      flag: '🇯🇵',
      tz: 'Asia/Tokyo',
      session: [[9, 0], [15, 30]],
      core: [
        { secid: '100.N225', name: '日经225', sinaCode: 'int_nikkei' }
      ],
      extra: [
        { secid: '100.N300', name: '日经300' }
      ]
    },
    {
      id: 'hk',
      title: '港股',
      flag: '🇨🇳',
      tz: 'Asia/Hong_Kong',
      session: [[9, 30], [12, 0], [13, 0], [16, 0]],
      core: [
        { secid: '100.HSI', name: '恒生指数' }
      ],
      extra: [
        { secid: '124.HSTECH', name: '恒生科技' }
      ]
    }
  ],

  /* ---------- 板块排行 ----------
   * fs 说明： m:90+t:2 行业板块 / m:90+t:3 概念板块 / m:90+t:1 地域板块
   * fid  说明： f62 主力净流入 / f3 涨跌幅
   * po   说明： 1 降序，0 升序
   */
  sectorTypes: [
    { id: 'industry', name: '行业板块', fs: 'm:90+t:2' },
    { id: 'concept', name: '概念板块', fs: 'm:90+t:3' },
    { id: 'area', name: '地域板块', fs: 'm:90+t:1' }
  ],

  ranks: {
    flow: {
      title: '板块主力资金净流入',
      fid: 'f62',
      po: 1,
      limit: 12,
      fields: 'f12,f14,f2,f3,f62,f184,f104,f105,f207,f222'
    },
    change: {
      title: '板块涨跌幅',
      fid: 'f3',
      po: 1,
      limit: 12,
      fields: 'f12,f14,f2,f3,f62,f184,f104,f105,f207,f222'
    }
  },

  /* ---------- 详情面板：K 线周期与参数 ---------- */
  periods: [
    { id: 'trend', name: '分时', klt: 0 },
    { id: 'd', name: '日K', klt: 101 },
    { id: 'w', name: '周K', klt: 102 },
    { id: 'm', name: '月K', klt: 103 },
    { id: '60', name: '60分', klt: 60 },
    { id: '30', name: '30分', klt: 30 },
    { id: '15', name: '15分', klt: 15 },
    { id: '5', name: '5分', klt: 5 }
  ],
  klineLimit: 1000,       // 一次拉多少根 K 线（够缩放平移看几年历史）
  klineMa: [5, 10, 20],   // 叠加的均线周期

  /* ---------- 新闻 ---------- */
  news: {
    limit: 30,
    // 命中这些关键词的快讯会被标记为「重要」并高亮
    keywords: [
      '美联储', '加息', '降息', '非农', 'CPI', 'GDP', '央行', '降准', 'LPR',
      '财政部', '国务院', '证监会', '关税', '制裁', '财报', '业绩', '停牌',
      '重组', '并购', 'IPO', '涨停', '暴跌', '大涨', '熔断'
    ]
  },

  /* ---------- 自选股（localStorage 持久化） ---------- */
  watchlist: {
    storageKey: 'stock-dashboard-watchlist',
    defaults: ['1.600519', '0.000001', '1.601318', '0.300750']
  }
};

/* ---------- 反代注入（在对象定义完后执行） ----------
 * 分享链接里加 ?proxy=https://你的.workers.dev ，
 * 所有东财请求自动走反代，绕过别人宽带对 push2.eastmoney.com 的污染
 */
(function () {
  try {
    const u = new URL(location.href);
    const p = u.searchParams.get('proxy');
    if (!p) return;
    const C = window.DASH_CONFIG;
    Object.keys(C.endpoints).forEach((k) => {
      const v = C.endpoints[k];
      if (typeof v === 'string' && v.indexOf('eastmoney.com') > -1) {
        C.endpoints[k] = v.replace(/^https:\/\/[^/]+\.eastmoney\.com/, p.replace(/\/$/, ''));
      }
    });
  } catch (e) {}
})();
