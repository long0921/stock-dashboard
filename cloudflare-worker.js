// Cloudflare Worker：反代东方财富接口
// 部署后把你的看板链接改成  https://你的站点/?proxy=https://xxx.your-name.workers.dev
// 这样别人浏览器直连 CF 节点，CF 再去访问东财，绕过宽带 DNS 污染

const UPSTREAMS = [
  'push2.eastmoney.com',
  'push2his.eastmoney.com',
  '82.push2.eastmoney.com',
  'push2delay.eastmoney.com',
  '41.push2his.eastmoney.com'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    // 找一个能用的东财节点
    const target = UPSTREAMS[Math.floor(Math.random() * UPSTREAMS.length)];
    const targetUrl = 'https://' + target + url.pathname + url.search;
    try {
      const r = await fetch(targetUrl, {
        headers: { 'Referer': 'https://quote.eastmoney.com/', 'User-Agent': request.headers.get('user-agent') || '' }
      });
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: Object.assign({}, CORS, { 'Content-Type': r.headers.get('content-type') || 'application/javascript' })
      });
    } catch (e) {
      return new Response('// proxy error: ' + e.message, { headers: CORS });
    }
  }
};
