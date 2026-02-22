import { serve } from "bun";
import { readFileSync } from "fs";

const PORT = 8888;
const PUBLIC_DIR = "./public";
const WECHAT_DIR = "./public_wechatstyle";

// 使用 SSL 文件夹的正式证书
const CERT_PATH = "./SSL/www.puckg.xyz.pem";
const KEY_PATH = "./SSL/www.puckg.xyz.key";

console.log(`[Frontend] Starting HTTPS server on port ${PORT}`);
console.log(`[Frontend] Serving: ${PUBLIC_DIR}`);
console.log(`[Frontend] WeChat style: ${WECHAT_DIR} (via /wechat/)`);
console.log(`[Frontend] Using certificate: ${CERT_PATH}`);

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
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
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
