# 前端文件目录

将 `index.html` 前端文件放在此目录下。

## 快速部署

1. 将前端 `index.html` 复制到此目录：
   ```bash
   cp /path/to/opencode-frontend/index.html ./public/
   ```

2. 修改 `index.html` 中的服务器地址（可选）：
   - 找到第319行左右的 `server-url` 输入框
   - 将 `value="ws://localhost:3002"` 改为你的服务器地址
   - 或者直接使用相对路径 `value="ws://" + window.location.host`

3. 启动服务器后访问：
   ```
   http://your-server-ip:3002
   ```

## 目录结构

```
opencode-server/
├── multiplayer/      # 服务器源代码
├── public/           # 前端文件（当前目录）
│   └── index.html    # 前端页面
├── package.json
└── ...
```
