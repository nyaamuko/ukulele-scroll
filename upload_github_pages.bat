@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title GitHub Pages デプロイ（直下ファイル）

echo ==========================================
echo   GitHub Pages デプロイ（直下：index/styles/app）
echo ==========================================
echo.

cd /d "%~dp0"
echo [INFO] Working Dir: %cd%
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Git が見つかりません。
  pause
  exit /b 1
)

echo [STEP] pull ...
git checkout main
git pull origin main

echo.
echo [STEP] file check ...
if not exist "index.html" (
  echo [ERROR] index.html が直下にありません。
  echo        ukeflow_tuner_mvp からコピーしてください：
  echo        copy /y ukeflow_tuner_mvp\index.html index.html
  pause
  exit /b 1
)
if not exist "styles.css" (
  echo [ERROR] styles.css が直下にありません。
  echo        copy /y ukeflow_tuner_mvp\styles.css styles.css
  pause
  exit /b 1
)
if not exist "app.js" (
  echo [ERROR] app.js が直下にありません。
  echo        copy /y ukeflow_tuner_mvp\app.js app.js
  pause
  exit /b 1
)

echo.
echo [STEP] add/commit/push ...
git add -A

set "TS=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
git commit -m "deploy root %TS%"
if %errorlevel% neq 0 (
  echo [INFO] commit はスキップ（変更なし）
)

git push origin main
if %errorlevel% neq 0 (
  echo [ERROR] push に失敗しました。
  pause
  exit /b 1
)

echo.
echo [SUCCESS] 完了！
echo URL: https://nyaamuko.github.io/ukulele-scroll/
pause
exit /b 0
