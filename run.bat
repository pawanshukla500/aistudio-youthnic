@echo off
setlocal

title Youthnic AI Studio
cd /d "%~dp0"

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js and npm are required to run Youthnic AI Studio.
  echo Install Node.js, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo.
  echo [ERROR] .env.local is missing.
  echo Add the Firebase and Supabase browser configuration before starting the app.
  echo Backend AI keys belong in encrypted Supabase Edge Function secrets.
  echo.
  pause
  exit /b 1
)

for %%K in (
  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID
  VITE_FIREBASE_STORAGE_BUCKET
  VITE_FIREBASE_APP_ID
  VITE_SUPABASE_URL
  VITE_SUPABASE_PUBLISHABLE_KEY
) do (
  findstr /B /C:"%%K=" ".env.local" >nul
  if errorlevel 1 (
    echo.
    echo [ERROR] %%K is missing from .env.local.
    echo.
    pause
    exit /b 1
  )
)

if /I "%~1"=="--check" (
  if not exist "node_modules\" (
    echo [ERROR] node_modules is missing. Run npm.cmd install.
    exit /b 1
  )
  echo Youthnic AI Studio is configured for Firebase + Supabase and ready to run.
  exit /b 0
)

if not exist "node_modules\" (
  echo Installing project dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting Youthnic AI Studio...
echo App URL: http://localhost:5173
echo Press Ctrl+C to stop the development server.
echo.

start "" cmd /c "timeout /t 3 /nobreak ^>nul ^& start "" http://localhost:5173"
call npm.cmd run dev -- --host localhost --port 5173

if errorlevel 1 (
  echo.
  echo [ERROR] The development server stopped with an error.
  pause
)

endlocal
