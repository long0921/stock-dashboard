@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 部署股市看板到 GitHub Pages ===
git add -A
git commit -m "update %date% %time%"
git push
if errorlevel 1 (
  echo.
  echo [!] 推送失败，检查上面的错误信息
  pause
  exit /b 1
)
echo.
echo [√] 已推送，等待约 1 分钟 GitHub Pages 自动发布
pause
