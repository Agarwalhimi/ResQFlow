@echo off

echo Building Dijkstra module...

gcc dsa_algorithms.c -o dsa_algorithms.exe

if %errorlevel% neq 0 (
echo Build failed.
pause
exit /b %errorlevel%
)

echo Dijkstra module built successfully.
pause

