#!/bin/bash
# OpenCode Chat 一键部署脚本
# 支持 Docker 和 Docker Compose 两种方式

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示欢迎信息
show_banner() {
    echo -e "${BLUE}"
    cat << "EOF"
╔════════════════════════════════════════════════════════════╗
║                                                              ║
║   OpenCode Chat - 多人协作 AI 聊天室                        ║
║   Multiplayer AI Chat Space with DeepSeek Integration      ║
║                                                              ║
╚════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# 检查 Docker 是否安装
check_docker() {
    print_info "检查 Docker 是否安装..."
    if ! command -v docker &> /dev/null; then
        print_error "Docker 未安装，请先安装 Docker"
        echo "安装指南: https://docs.docker.com/get-docker/"
        exit 1
    fi
    print_success "Docker 已安装: $(docker --version)"
}

# 检查 Docker Compose 是否安装
check_docker_compose() {
    print_info "检查 Docker Compose 是否安装..."
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_warning "Docker Compose 未安装，将使用 docker run 方式部署"
        return 1
    fi
    print_success "Docker Compose 已安装"
    return 0
}

# 创建 .env 文件
create_env_file() {
    if [ -f ".env" ]; then
        print_warning ".env 文件已存在，跳过创建"
        return
    fi

    print_info "创建 .env 配置文件..."
    cat > .env << 'EOF'
# WebSocket 服务配置
WS_PORT=3002

# AI 服务配置 (必填)
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
ENABLE_AI=true

# 数据库配置 (可选 - 使用 PostgreSQL)
ENABLE_DATABASE=false
# POSTGRES_USER=opencode
# POSTGRES_PASSWORD=opencode_password
# POSTGRES_DB=opencode_chat
# DATABASE_URL=postgresql://opencode:opencode_password@postgres:5432/opencode_chat

# 阿里云 OSS 配置 (可选)
ENABLE_OSS=false
# VITE_OSS_ACCESS_KEY_ID=your_access_key
# VITE_OSS_ACCESS_KEY_SECRET=your_access_secret
# VITE_OSS_BUCKET=your_bucket
# VITE_OSS_REGION=oss-cn-beijing

# Supabase 认证配置 (可选)
ENABLE_SUPABASE_AUTH=false
# SUPABASE_URL=your_supabase_url
# SUPABASE_PUBLISHABLE_KEY=your_publishable_key
ALLOW_ANONYMOUS=true
EOF

    print_success ".env 文件已创建"
    print_warning "请编辑 .env 文件，设置您的 DEEPSEEK_API_KEY"
}

# 使用 Docker Compose 部署
deploy_with_compose() {
    print_info "使用 Docker Compose 部署..."

    # 检查是否需要 PostgreSQL
    if grep -q "ENABLE_DATABASE=true" .env 2>/dev/null; then
        print_info "启动服务 (包含 PostgreSQL)..."
        docker-compose up -d
    else
        print_info "启动 OpenCode Chat 服务..."
        docker-compose up -d opencode-chat
    fi

    print_success "服务已启动！"
}

# 使用 Docker 直接部署
deploy_with_docker() {
    print_info "使用 Docker 直接部署..."

    # 读取端口配置
    WS_PORT=$(grep "^WS_PORT=" .env 2>/dev/null | cut -d'=' -f2)
    WS_PORT=${WS_PORT:-3002}

    # 读取 AI 配置
    DEEPSEEK_API_KEY=$(grep "^DEEPSEEK_API_KEY=" .env 2>/dev/null | cut -d'=' -f2)

    if [ -z "$DEEPSEEK_API_KEY" ] || [ "$DEEPSEEK_API_KEY" = "your_deepseek_api_key_here" ]; then
        print_error "请先在 .env 文件中设置 DEEPSEEK_API_KEY"
        exit 1
    fi

    print_info "启动 OpenCode Chat 容器..."

    # 停止并删除旧容器
    docker stop opencode-chat 2>/dev/null || true
    docker rm opencode-chat 2>/dev/null || true

    # 启动新容器
    docker run -d \
        --name opencode-chat \
        --restart unless-stopped \
        -p "${WS_PORT}:3002" \
        -e DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY}" \
        -e $(grep "^DEEPSEEK_BASE_URL=" .env | cut -d'=' -f1) \
        -e $(grep "^DEEPSEEK_MODEL=" .env | cut -d'=' -f1) \
        -e NODE_ENV=production \
        -e WS_PORT=3002 \
        -e WS_HOST=0.0.0.0 \
        -v opencode-data:/app/data \
        opencode-chat:latest

    print_success "容器已启动！"
}

# 显示部署信息
show_deployment_info() {
    WS_PORT=$(grep "^WS_PORT=" .env 2>/dev/null | cut -d'=' -f2)
    WS_PORT=${WS_PORT:-3002}

    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  部署完成！${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  🌐 访问地址: ${BLUE}http://localhost:${WS_PORT}${NC}"
    echo ""
    echo -e "  📋 常用命令:"
    echo -e "     查看日志: ${YELLOW}docker logs -f opencode-chat${NC}"
    echo -e "     停止服务: ${YELLOW}docker stop opencode-chat${NC}"
    echo -e "     启动服务: ${YELLOW}docker start opencode-chat${NC}"
    echo -e "     重启服务: ${YELLOW}docker restart opencode-chat${NC}"
    echo ""
    echo -e "  📚 更多文档: ${BLUE}https://github.com/your-repo/opencode-chat${NC}"
    echo ""
}

# 主函数
main() {
    show_banner

    # 解析命令行参数
    DEPLOY_MODE="${1:-auto}"

    case "$DEPLOY_MODE" in
        compose)
            check_docker
            check_docker_compose || {
                print_error "Docker Compose 未安装"
                exit 1
            }
            create_env_file
            deploy_with_compose
            ;;
        docker)
            check_docker
            create_env_file
            deploy_with_docker
            ;;
        auto)
            check_docker
            if check_docker_compose; then
                print_info "检测到 Docker Compose，使用 compose 模式部署"
                create_env_file
                deploy_with_compose
            else
                print_info "使用 docker 模式部署"
                create_env_file
                deploy_with_docker
            fi
            ;;
        *)
            print_error "未知部署模式: $DEPLOY_MODE"
            echo "用法: $0 [auto|compose|docker]"
            exit 1
            ;;
    esac

    show_deployment_info
}

# 执行主函数
main "$@"
