@echo off
chcp 65001 >nul
echo 启动服务器并加载环境变量...

:: 加载 .env 文件
for /f "tokens=1,2 delims==" %%a in (.env) do (
    set "%%a=%%b"
)

echo ENABLE_DAILY_REPORT=%ENABLE_DAILY_REPORT%
echo DAILY_REPORT_ENABLED=%DAILY_REPORT_ENABLED%
echo DAILY_REPORT_SCHEDULE_ENABLED=%DAILY_REPORT_SCHEDULE_ENABLED%

:: 启动服务器
echo.
echo 启动服务器...
bun run start

pause
