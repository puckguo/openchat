@echo off
REM OpenCode Chat 一键部署脚本 (Windows)
REM 支持 Docker 和 Docker Compose 两种方式

setlocal enabledelayedexpansion

REM 颜色设置 (Windows 10+)
set "INFO=[INFO]"
set "SUCCESS=[SUCCESS]"
set "WARNING=[WARNING]"
set "ERROR=[ERROR]"

REM 显示欢迎信息
:show_banner
cls
echo.
echo ================================================================
echo.
echo   OpenCode Chat - 多人协作 AI 聊天室
echo   Multiplayer AI Chat Space with DeepSeek Integration
echo.
echo ================================================================
echo.
goto :eof

REM 检查 Docker 是否安装
:check_docker
echo %INFO% 检查 Docker 是否安装...
docker --version >nul 2>&1
if errorlevel 1 (
    echo %ERROR% Docker 未安装，请先安装 Docker Desktop
    echo 安装指南: https://docs.docker.com/desktop/install/windows-install/
    exit /b 1
)
echo %SUCCESS% Docker 已安装
goto :eof

REM 检查 Docker Compose 是否安装
:check_docker_compose
echo %INFO% 检查 Docker Compose 是否安装...
docker-compose --version >nul 2>&1
if errorlevel 1 (
    docker compose version >nul 2>&1
    if errorlevel 1 (
        echo %WARNING% Docker Compose 未安装，将使用 docker run 方式部署
        exit /b 1
    )
)
echo %SUCCESS% Docker Compose 已安装
exit /b 0

REM 创建 .env 文件
:create_env_file
if exist ".env" (
    echo %WARNING% .env 文件已存在，跳过创建
    goto :eof
)

echo %INFO% 创建 .env 配置文件...
(
echo # WebSocket 服务配置
echo WS_PORT=3002
echo.
echo # AI 服务配置 ^(必填^)
echo DEEPSEEK_API_KEY=your_deepseek_api_key_here
echo DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
echo DEEPSEEK_MODEL=deepseek-chat
echo ENABLE_AI=true
echo.
echo # 数据库配置 ^(可选 - 使用 PostgreSQL^)
echo ENABLE_DATABASE=false
echo # POSTGRES_USER=opencode
echo # POSTGRES_PASSWORD=opencode_password
echo # POSTGRES_DB=opencode_chat
echo # DATABASE_URL=postgresql://opencode:opencode_password@postgres:5432/opencode_chat
echo.
echo # 阿里云 OSS 配置 ^(可选^)
echo ENABLE_OSS=false
echo # VITE_OSS_ACCESS_KEY_ID=your_access_key
echo # VITE_OSS_ACCESS_KEY_SECRET=your_access_secret
echo # VITE_OSS_BUCKET=your_bucket
echo # VITE_OSS_REGION=oss-cn-beijing
echo.
echo # Supabase 认证配置 ^(可选^)
echo ENABLE_SUPABASE_AUTH=false
echo # SUPABASE_URL=your_supabase_url
echo # SUPABASE_PUBLISHABLE_KEY=your_publishable_key
echo ALLOW_ANONYMOUS=true
) > .env

echo %SUCCESS% .env 文件已创建
echo %WARNING% 请编辑 .env 文件，设置您的 DEEPSEEK_API_KEY
goto :eof

REM 使用 Docker Compose 部署
:deploy_with_compose
echo %INFO% 使用 Docker Compose 部署...
docker-compose up -d opencode-chat
if errorlevel 1 (
    echo %ERROR% 部署失败
    exit /b 1
)
echo %SUCCESS% 服务已启动！
goto :eof

REM 使用 Docker 直接部署
:deploy_with_docker
echo %INFO% 使用 Docker 直接部署...

REM 读取端口配置
set "WS_PORT=3002"
for /f "tokens=2 delims==" %%a in ('findstr "^WS_PORT=" .env 2^>nul') do set "WS_PORT=%%a"

REM 停止并删除旧容器
echo %INFO% 停止旧容器...
docker stop opencode-chat >nul 2>&1
docker rm opencode-chat >nul 2>&1

REM 启动新容器
echo %INFO% 启动新容器...
docker run -d ^
    --name opencode-chat ^
    --restart unless-stopped ^
    -p %WS_PORT%:3002 ^
    -e DEEPSEEK_API_KEY ^
    -e DEEPSEEK_BASE_URL ^
    -e DEEPSEEK_MODEL ^
    -e NODE_ENV=production ^
    -e WS_PORT=3002 ^
    -e WS_HOST=0.0.0.0 ^
    -v opencode-data:/app/data ^
    --env-file .env ^
    opencode-chat:latest

if errorlevel 1 (
    echo %ERROR% 容器启动失败
    exit /b 1
)
echo %SUCCESS% 容器已启动！
goto :eof

REM 显示部署信息
:show_deployment_info
set "WS_PORT=3002"
for /f "tokens=2 delims==" %%a in ('findstr "^WS_PORT=" .env 2^>nul') do set "WS_PORT=%%a"

echo.
echo ================================================================
echo   部署完成！
echo ================================================================
echo.
echo   🌐 访问地址: http://localhost:%WS_PORT%
echo.
echo   📋 常用命令:
echo      查看日志: docker logs -f opencode-chat
echo      停止服务: docker stop opencode-chat
echo      启动服务: docker start opencode-chat
echo      重启服务: docker restart opencode-chat
echo.
echo   📚 更多文档: https://github.com/your-repo/opencode-chat
echo.
goto :eof

REM 主函数
:main
call :show_banner

set "DEPLOY_MODE=%~1"
if "%DEPLOY_MODE%"=="" set "DEPLOY_MODE=auto"

call :check_docker
if errorlevel 1 exit /b 1

if "%DEPLOY_MODE%"=="compose" (
    call :check_docker_compose
    if errorlevel 1 (
        echo %ERROR% Docker Compose 未安装
        exit /b 1
    )
    call :create_env_file
    call :deploy_with_compose
) else if "%DEPLOY_MODE%"=="docker" (
    call :create_env_file
    call :deploy_with_docker
) else if "%DEPLOY_MODE%"=="auto" (
    call :check_docker_compose
    if errorlevel 1 (
        echo %INFO% 使用 docker 模式部署
        call :create_env_file
        call :deploy_with_docker
    ) else (
        echo %INFO% 检测到 Docker Compose，使用 compose 模式部署
        call :create_env_file
        call :deploy_with_compose
    )
) else (
    echo %ERROR% 未知部署模式: %DEPLOY_MODE%
    echo 用法: %~nx0 [auto^|compose^|docker]
    exit /b 1
)

call :show_deployment_info
goto :eof

REM 执行主函数
call :main %*
