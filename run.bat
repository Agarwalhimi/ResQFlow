@echo off
title ResQFlow Emergency Route Planner

echo.
echo ==========================================
echo       ResQFlow Emergency Route Planner
echo ==========================================
echo.

REM ------------------------------------------
REM Step 1: Check Python
REM ------------------------------------------

echo [1/4] Checking Python installation...
python --version

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Python is not installed or not added to PATH.
    echo Please install Python 3.10 or newer.
    pause
    exit /b 1
)

echo Python is available.
echo.

REM ------------------------------------------
REM Step 2: Install Python packages
REM ------------------------------------------

echo [2/4] Installing required Python packages...
echo.

python -m pip install -r requirements.txt

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Could not install Python packages.
    echo Check your requirements.txt file and internet connection.
    pause
    exit /b %errorlevel%
)

echo.
echo Python packages installed successfully.
echo.

REM ------------------------------------------
REM Step 3: Build C Dijkstra module
REM ------------------------------------------

echo [3/4] Building Dijkstra C module...
echo.

call build_dsa.bat

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Dijkstra module could not be built.
    echo.
    echo Make sure GCC is installed and available in PATH.
    echo You can test GCC by running:
    echo gcc --version
    echo.
    pause
    exit /b %errorlevel%
)

echo.
echo Dijkstra module built successfully.
echo.

REM ------------------------------------------
REM Step 4: Start Flask application
REM ------------------------------------------

echo [4/4] Starting ResQFlow Flask server...
echo.
echo ==========================================
echo          ResQFlow is starting...
echo ==========================================
echo.
echo Open your browser and go to:
echo.
echo http://127.0.0.1:5000
echo.
echo Press CTRL+C to stop the server.
echo.
echo ==========================================
echo.

python app.py

if %errorlevel% neq 0 (
    echo.
    echo ERROR: ResQFlow could not start.
    echo Check the error message above.
    echo.
)

pause