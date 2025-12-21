@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title GitHub Pages アップロード（Ukeflow Tuner）

REM ==========================================
REM  設定（必要ならここだけ変更）
REM ==========================================
set "REPO_URL=https://github.com/nyaamuko/ukulele-scroll.git"
set "BRANCH=main"
set "PAGES_URL=https://nyaamuko.github.io/ukulele-scroll/"

REM 公開したいファイルが入っているフォルダ名（このBATと同じ階層に置く）
set "SRC_DIR=ukeflow_tuner_mvp"

REM GitHub Pages の公開先（どちらか）
REM  - docs フォルダ運用なら docs
REM  - ルート運用なら root
REM 自動判定：docs フォルダが存在する場合 docs に出す。無ければ root に出す。
set "DEST_MODE=AUTO"

echo ==========================================
echo   GitHub Pages アップロード（Ukeflow Tuner）
echo ==========================================
echo.

REM ▼ BATがあるフォルダへ移動（= リポジトリ直下想定）
cd /d "%~dp0"
echo [INFO] Working Dir: %cd%
echo.

REM ▼ Git確認
where git >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Git が見つかりません。Git for Windows を入れてください。
  pause
  exit /b 1
)

REM ▼ リポジトリ確認（なければクローン）
if not exist ".git" (
  echo [INFO] .git が無いのでクローンします...
  git clone "%REPO_URL%" .
  if %errorlevel% neq 0 (
    echo [ERROR] clone に失敗しました。
    pause
    exit /b 1
  )
)

REM ▼ ブランチ更新
echo [STEP] fetch / checkout / pull ...
git fetch --all
git checkout %BRANCH%
if %errorlevel% neq 0 (
  echo [ERROR] checkout に失敗しました（%BRANCH%）。
  pause
  exit /b 1
)
git pull origin %BRANCH%
if %errorlevel% neq 0 (
  echo [ERROR] pull に失敗しました（認証が必要な場合があります）。
  pause
  exit /b 1
)

echo.
echo [STEP] Source check ...
if not exist "%SRC_DIR%\index.html" (
  echo [ERROR] %SRC_DIR%\index.html が見つかりません。
  echo        ukeflow_tuner_mvp.zip を解凍して
  echo        このBATと同じ階層に %SRC_DIR% フォルダを置いてください。
  pause
  exit /b 1
)

REM ▼ 配置先判定
set "DEST_DIR="
if /I "%DEST_MODE%"=="AUTO" (
  if exist "docs\" (
    set "DEST_DIR=docs"
  ) else (
    set "DEST_DIR=."
  )
) else if /I "%DEST_MODE%"=="DOCS" (
  set "DEST_DIR=docs"
) else (
  set "DEST_DIR=."
)

echo [INFO] Deploy Destination: %DEST_DIR%
echo.

REM ▼ 配置先フォルダがdocsなら作る
if /I "%DEST_DIR%"=="docs" (
  if not exist "docs\" mkdir "docs"
)

REM ▼ コピー（公開ルートへ）
echo [STEP] Copy files ...
copy /y "%SRC_DIR%\index.html" "%DEST_DIR%\index.html" >nul
copy /y "%SRC_DIR%\styles.css" "%DEST_DIR%\styles.css" >nul
copy /y "%SRC_DIR%\app.js" "%DEST_DIR%\app.js" >nul

echo [INFO] Copied:
echo   %SRC_DIR%\index.html  ->  %DEST_DIR%\index.html
echo   %SRC_DIR%\styles.css  ->  %DEST_DIR%\styles.css
echo   %SRC_DIR%\app.js      ->  %DEST_DIR%\app.js
echo.

REM ▼ 変更確認
echo [STEP] git status ...
git status

REM ▼ add / commit / push
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set "D=%%a%%b%%c"
set "T=%time:~0,2%%time:~3,2%%time:~6,2%"
set "T=%T: =0%"
set "COMMIT_MSG=deploy tuner %D%_%T%"

echo.
echo [STEP] add ...
git add -A

echo [STEP] commit ...
git commit -m "%COMMIT_MSG%"
if %errorlevel% neq 0 (
  echo [INFO] commit はスキップされました（変更なしの可能性）。
)

echo [STEP] push ...
git push origin %BRANCH%
if %errorlevel% neq 0 (
  echo [ERROR] push に失敗しました（認証が必要な場合があります）。
  pause
  exit /b 1
)

echo.
echo [SUCCESS] アップロード完了！
echo Commit: %COMMIT_MSG%
echo URL: %PAGES_URL%
echo.
echo ※ GitHub Pages の反映に 30秒〜数分かかることがあります。
pause
exit /b 0
