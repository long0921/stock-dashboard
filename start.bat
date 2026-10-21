@echo off
chcp 65001 >nul
rem ============================================================
rem  股市看板一键启动
rem  原理：东财行情域名走本地 Clash 代理(127.0.0.1:7890)，
rem        腾讯/新浪等国内站直连，不绕海外节点
rem  前提：Clash Verge 已启动并在 7890 端口监听
rem ============================================================
start msedge --proxy-server="http://127.0.0.1:7890" --proxy-bypass-list="<-loopback>;*.gtimg.cn;*.qq.com;*.sina.com.cn;*.sinaimg.cn;*.weibo.com;*.xueqiu.com" --new-window "%~dp0index.html"
