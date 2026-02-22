import { serve } from "bun";

const PORT = 8080;
const PUBLIC_DIR = "./public_wechatstyle";

console.log(`[Frontend] Starting HTTP server on port ${PORT}`);
console.log(`[Frontend] Serving: ${PUBLIC_DIR}`);

serve({
  port: PORT,
  hostname: "0.0.0.0",
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

    // 检查文件是否存在
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

console.log(`[Frontend] Server running at http://0.0.0.0:${PORT}`);
console.log(`[Frontend] Local access: http://localhost:${PORT}`);
console.log(`[Frontend] LAN access: http://192.168.1.253:${PORT}`);
