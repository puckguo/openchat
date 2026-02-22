# 本地局域网部署指南

## 快速启动

### 方式一：一键启动（推荐）

```bash
cd scripts
start-local.bat
```

### 方式二：手动启动

```bash
# 1. 生成 SSL 证书（首次需要）
powershell -ExecutionPolicy Bypass -File scripts/generate-ssl-cert.ps1

# 2. 启动 WebSocket 服务器
bun run multiplayer/websocket-server.ts

# 3. 另一个终端启动前端服务器
bun run frontend-server-https-local.ts
```

## 访问方式

| 方式 | 地址 |
|------|------|
| 本机 | https://localhost:8888 |
| 局域网 | https://你的IP:8888 |

获取本机 IP：
```powershell
ipconfig | findstr "IPv4"
```

## 移动端访问步骤

1. 确保手机和电脑在同一 WiFi 下
2. 电脑上运行启动脚本
3. 手机浏览器输入 `https://192.168.x.x:8888`
4. **重要**：首次访问会显示"不安全"警告
   - Chrome: 点击"高级" → "继续前往"
   - Safari: 点击"显示详细信息" → "访问此网站"
5. 首次连接 WebSocket 时，可能需要先单独访问 `https://192.168.x.x:3002` 并接受证书

## 防火墙设置

如果其他设备无法访问，请检查防火墙：

```powershell
# 以管理员运行
New-NetFirewallRule -DisplayName "OpenCode Chat" -Direction Inbound -LocalPort 8888,3002 -Protocol TCP -Action Allow
```

## 配置说明

| 文件 | 作用 |
|------|------|
| `frontend-server-https-local.ts` | HTTPS 前端服务器（端口 8888） |
| `multiplayer/websocket-server.ts` | WebSocket 服务器（端口 3002） |
| `scripts/generate-ssl-cert.ps1` | 生成自签名证书 |
| `scripts/start-local.bat` | 一键启动脚本 |

## 技术细节

- 前端自动检测服务器地址：`getDefaultWsUrl()` 使用 `window.location.hostname` 动态连接
- WebSocket 服务器监听 `0.0.0.0:3002`，支持所有网络接口
- 证书包含本地 IP 地址作为 SAN（Subject Alternative Name）
