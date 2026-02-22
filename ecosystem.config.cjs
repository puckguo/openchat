module.exports = {
  apps: [
    {
      name: 'opencode-websocket',
      script: 'multiplayer/websocket-server.ts',
      interpreter: 'bun',
      cwd: './',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        // WebSocket 服务器配置
        WS_PORT: '3002',
        // 启用本地 HTTPS
        USE_HTTPS: 'true',
        SSL_CERT_PATH: './SSL/local-cert.pem',
        SSL_KEY_PATH: './SSL/local-key.pem',
        // 启用功能
        ENABLE_DATABASE: 'true',
        ENABLE_OSS: 'true',
        ENABLE_AI: 'true',
        ENABLE_VOICE_CHAT: 'true',
        ENABLE_VOICE_AI: 'true',
        ENABLE_DAILY_REPORT: 'true'
      },
      error_file: './logs/websocket-error.log',
      out_file: './logs/websocket-out.log',
      time: true,
      windowsHide: true
    },
    {
      name: 'opencode-frontend',
      script: 'frontend-server-https-local.ts',
      interpreter: 'bun',
      cwd: './',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      time: true,
      windowsHide: true
    }
  ]
};
