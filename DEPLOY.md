# 部署分享指南

## 方案 A：Netlify Drop（5 分钟，零安装，立刻有链接）

1. 打开 https://app.netlify.com/drop
2. 把整个 `stock-dashboard` 文件夹**直接拖到网页虚线框里**
3. 等 10 秒，得到一个 `https://随机名.netlify.app` 链接，发给别人
4. **更新**：改完代码后再拖一次文件夹（或者注册 Netlify 账号绑定站点，以后 git push 自动更新）

## 方案 B：GitHub Pages（自动同步，以后改完代码双击 deploy.bat 就更新）

### 一次性准备
1. 装 Git：`winget install Git.Git`
2. 注册 GitHub 账号，新建一个仓库 `stock-dashboard`（Public）
3. 在仓库 Settings → Pages → Source 选 `main` 分支 `/root`，保存
4. 得到链接 `https://你的用户名.github.io/stock-dashboard/`

### 以后每次更新
双击 `deploy.bat`，自动 commit + push，1 分钟后链接生效。

## 方案 C：加 Cloudflare Worker 反代（解决东财被宽带污染）

方案 A/B 部署后，别人浏览器直连 push2.eastmoney.com。如果对方宽带也污染了这个域名，日韩/月K/资金流就空。要做到"任何网络都能用"：

1. 注册 https://dash.cloudflare.com （免费）
2. Workers & Pages → Create Worker → 粘贴 `cloudflare-worker.js` 里的代码
3. 部署后得到 `https://xxx.your-name.workers.dev`
4. 分享链接改成：`https://你的站点/?proxy=https://xxx.your-name.workers.dev`

## 自动同步吗？

- 方案 A（Netlify Drop）：每次手动拖文件夹，不是自动
- 方案 B（GitHub Pages）：**git push 即更新，别人刷新就是新版**，完全自动
- 反代 Worker 代码不变，不用动

## 别人打开后是什么体验？

- A股/美股/港股：腾讯源直连，任何网络都通
- 日韩指数/月K/板块资金流：直连东财，取决于对方宽带是否污染
- 加了 ?proxy= 后：全球任何网络都通
