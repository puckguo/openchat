#!/bin/bash
# =============================================================================
# OpenCode Multiplayer Server - Linux 一键部署脚本
# =============================================================================
# 使用方法:
#   1. 上传此脚本到服务器
#   2. chmod +x deploy-linux.sh
#   3. ./deploy-linux.sh
# =============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
INSTALL_DIR="/opt/opencode-server"
SERVICE_NAME="opencode-ws"
WS_PORT=${WS_PORT:-3002}

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

# 检查是否以 root 运行
check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "请使用 root 权限运行此脚本"
        print_info "使用: sudo ./deploy-linux.sh"
        exit 1
    fi
}

# 检查系统类型
check_system() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$NAME
        VERSION=$VERSION_ID
    else
        print_error "无法检测操作系统类型"
        exit 1
    fi
    print_info "检测到操作系统: $OS $VERSION"
}

# 安装依赖
install_dependencies() {
    print_info "安装系统依赖..."
    if [[ "$OS" == *"Ubuntu"* ]] || [[ "$OS" == *"Debian"* ]]; then
        apt-get update
        apt-get install -y curl unzip tar git
    elif [[ "$OS" == *"CentOS"* ]] || [[ "$OS" == *"Red Hat"* ]] || [[ "$OS" == *"Fedora"* ]]; then
        yum install -y curl unzip tar git
    else
        print_warning "未知的操作系统，尝试使用通用命令..."
    fi
    print_success "系统依赖安装完成"
}

# 安装 Bun
install_bun() {
    print_info "检查 Bun 安装..."
    if command -v bun &> /dev/null; then
        BUN_VERSION=$(bun --version)
        print_success "Bun 已安装 (版本: $BUN_VERSION)"
    else
        print_info "安装 Bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
        print_success "Bun 安装完成"
    fi
}

# 准备安装目录
prepare_directory() {
    print_info "准备安装目录: $INSTALL_DIR"
    if [ -d "$INSTALL_DIR" ]; then
        print_warning "目录已存在，备份旧版本..."
        mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    mkdir -p "$INSTALL_DIR"
    print_success "安装目录准备完成"
}

# 复制项目文件
copy_project_files() {
    print_info "复制项目文件..."

    # 获取脚本所在目录
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # 检查是否是正确的项目目录
    if [ ! -f "$SCRIPT_DIR/package.json" ]; then
        print_error "未找到 package.json，请确保在正确的项目目录中运行此脚本"
        exit 1
    fi

    # 复制文件
    cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"

    print_success "项目文件复制完成"
}

# 安装项目依赖
install_project_deps() {
    print_info "安装项目依赖..."
    cd "$INSTALL_DIR"
    export PATH="$HOME/.bun/bin:$PATH"
    bun install
    print_success "项目依赖安装完成"
}

# 配置环境变量
setup_environment() {
    print_info "配置环境变量..."
    cd "$INSTALL_DIR"

    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
            print_warning "请编辑 .env 文件，填入你的实际配置"
            print_info "配置文件路径: $INSTALL_DIR/.env"
        else
            print_error "未找到 .env.example 文件"
            exit 1
        fi
    else
        print_warning ".env 文件已存在，跳过创建"
    fi
}

# 创建 Systemd 服务
create_systemd_service() {
    print_info "创建 Systemd 服务..."

    # 检测 bun 路径
    BUN_PATH="$HOME/.bun/bin/bun"
    if [ ! -f "$BUN_PATH" ]; then
        BUN_PATH=$(which bun)
    fi

    cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=OpenCode Multiplayer WebSocket Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=WS_PORT=$WS_PORT
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$BUN_PATH run multiplayer/websocket-server.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=opencode-ws

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    print_success "Systemd 服务创建完成"
}

# 配置防火墙
configure_firewall() {
    print_info "配置防火墙..."

    if command -v ufw &> /dev/null; then
        ufw allow $WS_PORT/tcp
        print_success "UFW 防火墙规则添加完成 (端口: $WS_PORT)"
    elif command -v firewall-cmd &> /dev/null; then
        firewall-cmd --permanent --add-port=$WS_PORT/tcp
        firewall-cmd --reload
        print_success "Firewalld 防火墙规则添加完成 (端口: $WS_PORT)"
    else
        print_warning "未检测到支持的防火墙工具，请手动开放端口 $WS_PORT"
    fi
}

# 启动服务
start_service() {
    print_info "启动服务..."
    systemctl start $SERVICE_NAME
    sleep 2

    if systemctl is-active --quiet $SERVICE_NAME; then
        print_success "服务启动成功!"
        print_info "服务状态: systemctl status $SERVICE_NAME"
    else
        print_error "服务启动失败"
        print_info "查看日志: journalctl -u $SERVICE_NAME -n 50"
        exit 1
    fi
}

# 健康检查
health_check() {
    print_info "进行健康检查..."
    sleep 3

    if curl -s http://localhost:$WS_PORT/health > /dev/null; then
        print_success "健康检查通过!"
        RESPONSE=$(curl -s http://localhost:$WS_PORT/health)
        print_info "服务器响应: $RESPONSE"
    else
        print_warning "健康检查未通过，请检查日志"
    fi
}

# 打印部署信息
print_deployment_info() {
    echo ""
    echo "============================================================================="
    echo -e "${GREEN}          OpenCode Multiplayer Server 部署完成!${NC}"
    echo "============================================================================="
    echo ""
    echo "  安装目录: $INSTALL_DIR"
    echo "  配置文件: $INSTALL_DIR/.env"
    echo "  服务名称: $SERVICE_NAME"
    echo "  服务端口: $WS_PORT"
    echo ""
    echo "  常用命令:"
    echo "    查看状态: systemctl status $SERVICE_NAME"
    echo "    启动服务: systemctl start $SERVICE_NAME"
    echo "    停止服务: systemctl stop $SERVICE_NAME"
    echo "    重启服务: systemctl restart $SERVICE_NAME"
    echo "    查看日志: journalctl -u $SERVICE_NAME -f"
    echo ""
    echo "  如果这是首次部署，请务必编辑配置文件:"
    echo "    nano $INSTALL_DIR/.env"
    echo ""
    echo "  然后重启服务以应用配置:"
    echo "    systemctl restart $SERVICE_NAME"
    echo ""
    echo "  WebSocket 连接地址:"
    echo "    ws://$(curl -s ifconfig.me 2>/dev/null || echo 'your-server-ip'):$WS_PORT"
    echo ""
    echo "============================================================================="
}

# 主函数
main() {
    echo "============================================================================="
    echo "          OpenCode Multiplayer Server - Linux 一键部署脚本"
    echo "============================================================================="
    echo ""

    check_root
    check_system
    install_dependencies
    install_bun
    prepare_directory
    copy_project_files
    install_project_deps
    setup_environment
    create_systemd_service
    configure_firewall

    # 询问是否立即启动
    if [ -f "$INSTALL_DIR/.env" ]; then
        # 检查是否已配置
        if grep -q "your-" "$INSTALL_DIR/.env"; then
            print_warning "检测到 .env 文件中仍有默认配置值"
            print_info "请先编辑 $INSTALL_DIR/.env 文件，填入实际配置后再启动服务"
        else
            read -p "是否立即启动服务? [Y/n]: " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                start_service
                health_check
            fi
        fi
    fi

    print_deployment_info
}

# 运行主函数
main "$@"
