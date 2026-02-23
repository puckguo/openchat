import { serve } from "bun";
import { readFileSync } from "fs";

const PORT = 8888;
const PUBLIC_DIR = "./public";
const WECHAT_DIR = "./public_wechatstyle";

// WebSocket服务器地址（用于API代理）- 使用域名以匹配SSL证书
const WS_SERVER_URL = process.env.WS_SERVER_URL || "https://www.puckg.xyz:3002";

// 使用 SSL 文件夹的正式证书（完整证书链）
const CERT_PATH = "./SSL/www.puckg.xyz_fullchain.crt";
const KEY_PATH = "./SSL/www.puckg.xyz.key";

console.log(`[Frontend] Starting HTTPS server on port ${PORT}`);
console.log(`[Frontend] Serving: ${PUBLIC_DIR}`);
console.log(`[Frontend] WeChat style: ${WECHAT_DIR} (via /wechat/)`);
console.log(`[Frontend] Using certificate: ${CERT_PATH}`);
console.log(`[Frontend] API proxy to: ${WS_SERVER_URL}`);

serve({
  port: PORT,
  hostname: "0.0.0.0",
  tls: {
    cert: readFileSync(CERT_PATH),
    key: readFileSync(KEY_PATH),
  },
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // API代理 - 将/api/请求转发到WebSocket服务器
    if (path.startsWith("/api/")) {
      try {
        const targetUrl = `${WS_SERVER_URL}${path}${url.search}`;
        console.log(`[Proxy] ${req.method} ${path} -> ${targetUrl}`);

        const proxyHeaders = new Headers();
        req.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "host") {
            proxyHeaders.set(key, value);
          }
        });

        const response = await fetch(targetUrl, {
          method: req.method,
          headers: proxyHeaders,
          body: req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined,
        });

        const responseHeaders = new Headers(response.headers);
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

        return new Response(response.body, {
          status: response.status,
          headers: responseHeaders,
        });
      } catch (error) {
        console.error(`[Proxy] Error:`, error);
        return new Response(JSON.stringify({ error: "Proxy error" }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...Object.fromEntries(headers) },
        });
      }
    }

    let baseDir: string;

    // 检查是否是微信风格前端的请求
    if (path.startsWith("/wechat")) {
      // 微信风格前端
      baseDir = WECHAT_DIR;
      path = path.replace("/wechat", "") || "/";
      if (path === "/") path = "/index.html";
    } else {
      // 原版前端
      baseDir = PUBLIC_DIR;
      if (path === "/") path = "/index.html";
    }

    const filePath = `${baseDir}${path}`;
    const file = Bun.file(filePath);

    // 检查文件是否存在
    try {
      const exists = await file.exists();
      if (!exists) {
        // 文件不存在，返回 404
        if (path === "/favicon.ico") {
          // favicon.ico 不存在时返回空响应，避免浏览器报错
          return new Response(null, { status: 204, headers });
        }
        return new Response("Not Found", { status: 404, headers });
      }
    } catch (error) {
      return new Response("Internal Server Error", { status: 500, headers });
    }

    return new Response(file, { headers });
  },
});

console.log(`[Frontend] Server running at https://0.0.0.0:${PORT}`);
console.log(`[Frontend] - Original: https://www.puckg.xyz:${PORT}/`);
console.log(`[Frontend] - WeChat style: https://www.puckg.xyz:${PORT}/wechat/`);
