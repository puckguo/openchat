# OpenCode Multiplayer Server - 部署包

此文件夹包含将 OpenCode Multiplayer Server 部署到生产环境所需的所有文件。

## 📁 文件说明

| 文件 | 用途 |
|------|------|
| `deploy-linux.sh` | Linux 服务器一键部署脚本 |
| `deploy-windows.ps1` | Windows Server 一键部署脚本 |
| `.env.example` | 环境变量配置模板 |
| `DEPLOY_TO_SERVER.md` | 详细部署文档 |
| `README.md` | 本文件 |

## 🚀 快速开始

### 目录结构说明

```
opencode-server/                 # 项目根目录
├── multiplayer/                 # 源代码
├── public/                      # 前端文件
├── package.json                 # 项目配置
├── ...                          # 其他项目文件
└── deploy/                      # ★ 部署相关文件（此目录）
    ├── deploy-linux.sh          # Linux 部署脚本
    ├── deploy-windows.ps1       # Windows 部署脚本
    ├── .env.example             # 环境变量模板
    ├── DEPLOY_TO_SERVER.md      # 详细部署文档
    └── README.md                # 本文件
```

### 步骤 1：准备项目代码

确保你已经拥有完整的项目代码，并且位于项目根目录：

```bash
# 方式 1：从 Git 克隆
git clone <your-repo-url> opencode-server
cd opencode-server

# 方式 2：直接解压项目压缩包
cd opencode-server

# 确认你在正确的目录（应该能看到 package.json 和 deploy/ 文件夹）
ls package.json deploy/
```

### 步骤 2：配置环境变量

**重要：** 在项目根目录创建 `.env` 文件（不是在 deploy 目录）：

```bash
# 从 deploy 目录复制模板到项目根目录
cp deploy/.env.example .env

# 编辑配置文件（填入你的实际密钥和配置）
# Linux:
nano .env

# Windows:
notepad .env
```

需要配置的主要项目：
- **RDS PostgreSQL**：数据库连接信息
- **阿里云 OSS**：文件存储 Access Key
- **DeepSeek AI**：API Key

### 步骤 3：运行部署脚本

#### Linux 服务器

```bash
# 方法 1：从项目根目录运行（推荐）
chmod +x deploy/deploy-linux.sh
./deploy/deploy-linux.sh

# 方法 2：先进入 deploy 目录再运行
cd deploy
chmod +x deploy-linux.sh
./deploy-linux.sh
```

#### Windows Server

```powershell
# 以管理员身份运行 PowerShell

# 方法 1：从项目根目录运行（推荐）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\deploy\deploy-windows.ps1

# 方法 2：先进入 deploy 目录再运行
cd deploy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\deploy-windows.ps1
```

**注意：** 脚本会自动检测自己的位置，无论从项目根目录还是 deploy 目录运行都能正常工作。

## 📋 部署前检查清单

- [ ] 已准备好云服务器（Windows/Linux）
- [ ] 已创建 RDS PostgreSQL 数据库
- [ ] 已创建阿里云 OSS Bucket
- [ ] 已获取 DeepSeek API Key
- [ ] 已编辑 `.env` 文件填入所有配置
- [ ] 服务器防火墙/安全组已开放所需端口（默认 3002）

## 🔧 部署后管理

### Linux (Systemd)

```bash
systemctl status opencode-ws      # 查看状态
systemctl start opencode-ws       # 启动服务
systemctl stop opencode-ws        # 停止服务
systemctl restart opencode-ws     # 重启服务
journalctl -u opencode-ws -f      # 查看日志
```

### Windows (PM2)

```powershell
pm2 status              # 查看状态
pm2 logs opencode-ws    # 查看日志
pm2 stop opencode-ws    # 停止服务
pm2 restart opencode-ws # 重启服务
```

## 📦 分发部署包

如果要将项目部署到多台服务器，可以按以下方式打包：

```bash
# 创建部署包（不包含敏感信息）
tar czvf opencode-server-deploy.tar.gz \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.log' \
  --exclude='data' \
  .

# 或者 ZIP 格式（Windows）
zip -r opencode-server-deploy.zip \
  -x ".env" \
  -x "node_modules/*" \
  -x ".git/*" \
  -x "*.log" \
  -x "data/*" \
  .
```

然后将压缩包上传到服务器，解压后按上述步骤部署。

## 🆘 故障排除

遇到问题请参考 `DEPLOY_TO_SERVER.md` 中的"常见问题"章节。

## 📝 注意事项

1. **不要将 `.env` 文件提交到 Git**，它包含敏感信息
2. 部署脚本会自动安装 Bun 运行时（如果未安装）
3. Linux 部署会自动创建 Systemd 服务
4. Windows 部署提供多种服务管理方式（直接运行/PM2/Windows 服务）
