import { serve } from "bun";
import { readFileSync } from "fs";

const PORT = 8889;
const PUBLIC_DIR = "C:/open-cochat-wechatUI/public";
const CERT_PATH = "C:/open-cochat-wechatUI/SSL/www.puckg.xyz.pem";
const KEY_PATH = "C:/open-cochat-wechatUI/SSL/www.puckg.xyz.key";

console.log(`[Frontend 8889] Starting HTTPS server on port ${PORT}`);
console.log(`[Frontend 8889] Serving: ${PUBLIC_DIR}`);
console.log(`[Frontend 8889] Using certificate: ${CERT_PATH}`);

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
    if (path === "/") path = "/index.html";

    const filePath = `${PUBLIC_DIR}${path}`;
    const file = Bun.file(filePath);

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    try {
      const exists = await file.exists();
      if (!exists) {
        if (path === "/favicon.ico") {
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

console.log(`[Frontend 8889] Server running at https://0.0.0.0:${PORT}`);
console.log(`[Frontend 8889] Public access: https://www.puckg.xyz:${PORT}`);
