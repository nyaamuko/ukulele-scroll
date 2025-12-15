@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title GitHub Pages アップロード（日時入り自動push）

REM ==========================================
REM  設定（通常は変更不要）
REM ==========================================
set "REPO_URL=https://github.com/nyaamuko/ukulele-scroll.git"
set "BRANCH=main"

echo ==========================================
echo   GitHub Pages アップロード
echo ==========================================
echo.

REM このBATが置いてあるフォルダへ移動
cd /d "%~dp0"

REM index.html チェック
if not exist "index.html" (
  echo [ERROR] index.html が見つかりません。
  echo BATは index.html と同じフォルダに置いてください。
  pause
  exit /b 1
)

REM Git チェック
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git が見つかりません。
  echo https://git-scm.com/download/win
  pause
  exit /b 1
)

REM ===== 日時取得（YYYY-MM-DD HH:MM）=====
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do (
  set Y=%%a
  set M=%%b
  set D=%%c
)
for /f "tokens=1-2 delims=: " %%a in ("%time%") do (
  set H=%%a
  set Min=%%b
)
if "%H:~0,1%"==" " set H=0%H:~1,1%

set "COMMIT_MSG=update %Y%-%M%-%D% %H%:%Min%"

REM ===== Git 初期化（初回のみ）=====
if not exist ".git" (
  echo [STEP] git init
  git init
  git branch -M %BRANCH%
)

REM ===== origin 設定 =====
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo [STEP] remote origin を追加
  git remote add origin "%REPO_URL%"
)

REM ===== 変更チェック =====
git status --porcelain > "%temp%\__gitstat.txt"
for %%F in ("%temp%\__gitstat.txt") do if %%~zF==0 (
  echo [OK] 変更なし。アップロード不要です。
  del "%temp%\__gitstat.txt" >nul 2>nul
  pause
  exit /b 0
)
del "%temp%\__gitstat.txt" >nul 2>nul

REM ===== add / commit / push =====
echo [STEP] git add
git add -A

echo [STEP] git commit
git commit -m "%COMMIT_MSG%"

echo [STEP] git push
git push -u origin %BRANCH%
if errorlevel 1 (
  echo.
  echo [ERROR] push に失敗しました。
  echo 初回は GitHub の認証画面が出ることがあります。
  pause
  exit /b 1
)

echo.
echo [SUCCESS] アップロード完了！
echo Commit: %COMMIT_MSG%
echo.
echo iPhone で下記URLを更新してください：
echo https://nyaamuko.github.io/ukulele-scroll/
echo.
pause
exit /b 0
