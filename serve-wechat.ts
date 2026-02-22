// 简单的静态文件服务器 - 服务 public_wechatstyle 到 8889 端口
const port = 8889

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    let filePath = url.pathname

    // 默认文件
    if (filePath === '/' || filePath === '') {
      filePath = '/index.html'
    }

    // 安全检查：防止目录遍历
    if (filePath.includes('..')) {
      return new Response('Forbidden', { status: 403 })
    }

    // 尝试读取文件
    const file = Bun.file(`public_wechatstyle${filePath}`)

    if (await file.exists()) {
      return new Response(file)
    }

    // 如果文件不存在，返回 index.html（SPA 支持）
    const indexFile = Bun.file('public_wechatstyle/index.html')
    if (await indexFile.exists()) {
      return new Response(indexFile)
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`Server running at http://localhost:${port}`)
