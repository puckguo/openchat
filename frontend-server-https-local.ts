import { serve } from "bun";
import { readFileSync, existsSync } from "fs";
import * as path from "path";

const PORT = 8888;
const PUBLIC_DIR = "./public_wechatstyle";

// 本地自签名证书路径
const CERT_PATH = "./SSL/local-cert.pem";
const KEY_PATH = "./SSL/local-key.pem";

console.log(`[Frontend] Starting HTTPS server on port ${PORT}`);
console.log(`[Frontend] Serving: ${PUBLIC_DIR}`);
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
    let pathname = url.pathname;

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // 文件下载端点
    if (pathname.startsWith("/downloads/")) {
      const encodedFilename = pathname.replace("/downloads/", "");
      const filename = decodeURIComponent(encodedFilename);
      // 防止路径遍历攻击
      const sanitizedFilename = filename.split(/[\\/]/).pop() || "file";

      // 尝试多个可能的路径查找文件
      const possiblePaths = [
        path.join(process.cwd(), sanitizedFilename),
        path.join(process.cwd(), "downloads", sanitizedFilename),
      ];

      let filePath: string | null = null;
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          filePath = p;
          break;
        }
      }

      if (!filePath) {
        console.error(`[Download] File not found: ${sanitizedFilename}`);
        return new Response("File not found", { status: 404, headers });
      }

      try {
        const file = Bun.file(filePath);
        const ext = sanitizedFilename.split('.').pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          txt: 'text/plain',
          md: 'text/markdown',
          json: 'application/json',
        };
        const contentType = mimeTypes[ext || ''] || 'application/octet-stream';

        const encodedFileName = encodeURIComponent(sanitizedFilename);
        const downloadHeaders = new Headers(headers);
        downloadHeaders.set("Content-Type", contentType);
        downloadHeaders.set("Content-Disposition", `attachment; filename*=UTF-8''${encodedFileName}`);

        return new Response(file, { headers: downloadHeaders });
      } catch (error) {
        console.error(`[Download] Error serving file: ${filePath}`, error);
        return new Response("File not found", { status: 404, headers });
      }
    }

    // 静态文件服务
    if (pathname === "/") pathname = "/index.html";

    const filePath = `${PUBLIC_DIR}${pathname}`;
    const file = Bun.file(filePath);

    // 检查文件是否存在
    try {
      const exists = await file.exists();
      if (!exists) {
        if (pathname === "/favicon.ico") {
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
console.log(`[Frontend] Local access: https://localhost:${PORT}`);
console.log(`[Frontend] LAN access: https://192.168.1.253:${PORT}`);
console.log(`[Frontend] Note: First time access will show certificate warning, please click 'Advanced' -> 'Proceed'`);
