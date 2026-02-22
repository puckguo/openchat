@echo off
echo 正在运行携程机票爬取脚本...
echo.

REM 检查Python是否安装
where python >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到Python，请先安装Python 3.7+
    pause
    exit /b 1
)

REM 检查依赖
echo 检查Python依赖...
python -c "import selenium" >nul 2>&1
if errorlevel 1 (
    echo 正在安装selenium...
    python -m pip install selenium --quiet
)

python -c "import webdriver_manager" >nul 2>&1
if errorlevel 1 (
    echo 正在安装webdriver-manager...
    python -m pip install webdriver-manager --quiet
)

echo.
echo 开始爬取携程机票信息...
echo ========================================
python ctrip_flight_scraper.py

echo.
echo 脚本执行完成！
echo 结果已保存到 flight_results.json
echo.
pause