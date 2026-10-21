@echo off
chcp 65001 >nul
cd /d "%~dp0"
set GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe
echo === 部署股市看板到 GitHub Pages ===
"%GIT%" add -A
"%GIT%" commit -m "update %date% %time%"
"%GIT%" push
if errorlevel 1 (
  echo.
  echo [!] 推送失败，检查上面的错误信息
  pause
  exit /b 1
)
echo.
echo [√] 已推送，等待约 1 分钟 GitHub Pages 自动发布
echo [√] 访问: https://long0921.github.io/stock-dashboard/
pause
