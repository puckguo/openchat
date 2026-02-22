/**
 * Alibaba Cloud OSS Integration
 * Object Storage Service for file uploads in chat
 */

import OSS from "ali-oss"

// =============================================================================
// OSS Configuration
// =============================================================================

export interface OSSConfig {
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  region: string
  roleArn?: string
}

export function getOSSConfig(): OSSConfig {
  return {
    accessKeyId: process.env.VITE_OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.VITE_OSS_ACCESS_KEY_SECRET || "",
    bucket: process.env.VITE_OSS_BUCKET || "",
    region: process.env.VITE_OSS_REGION || "",
    roleArn: process.env.VITE_OSS_ROLE_ARN,
  }
}

// =============================================================================
// OSS Manager
// =============================================================================

export class OSSManager {
  private client: OSS | null = null
  private config: OSSConfig

  constructor(config?: OSSConfig) {
    this.config = config || getOSSConfig()
  }

  async initialize(): Promise<void> {
    try {
      this.client = new OSS({
        accessKeyId: this.config.accessKeyId,
        accessKeySecret: this.config.accessKeySecret,
        bucket: this.config.bucket,
        region: this.config.region,
      })

    } catch (error) {
      console.error("[OSS] Initialization failed:", error)
      throw error
    }
  }

  /**
   * Generate upload URL for direct browser upload
   */
  async generateUploadUrl(
    key: string,
    mimeType: string,
    expires: number = 3600
  ): Promise<{ url: string; key: string }> {
    if (!this.client) throw new Error("OSS not initialized")

    try {
      const url = this.client.signatureUrl(key, {
        method: "PUT",
        expires,
        "Content-Type": mimeType,
      })

      return { url, key }
    } catch (error) {
      console.error("[OSS] Generate upload URL failed:", error)
      throw error
    }
  }

  /**
   * Upload file buffer to OSS
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    options?: OSS.PutObjectOptions
  ): Promise<{ url: string; key: string; size: number }> {
    if (!this.client) throw new Error("OSS not initialized")

    try {
      const result = await this.client.put(key, buffer, options)
      const url = result.url


      return {
        url,
        key,
        size: buffer.length,
      }
    } catch (error) {
      console.error("[OSS] Upload failed:", error)
      throw error
    }
  }

  /**
   * Upload from URL (for proxy uploads)
   */
  async uploadFromUrl(
    key: string,
    fileUrl: string,
    options?: OSS.PutObjectOptions
  ): Promise<{ url: string; key: string; size: number }> {
    if (!this.client) throw new Error("OSS not initialized")

    try {
      // Fetch file from URL
      const response = await fetch(fileUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      return this.uploadFile(key, buffer, options)
    } catch (error) {
      console.error("[OSS] Upload from URL failed:", error)
      throw error
    }
  }

  /**
   * Get file URL (public or signed)
   */
  async getFileUrl(key: string, expires?: number): Promise<string> {
    if (!this.client) throw new Error("OSS not initialized")

    try {
      if (expires) {
        // Generate signed URL
        return this.client.signatureUrl(key, { expires })
      }

      // Public URL
      return `https://${this.config.bucket}.${this.config.region}.aliyuncs.com/${key}`
    } catch (error) {
      console.error("[OSS] Get URL failed:", error)
      throw error
    }
  }

  /**
   * Delete file from OSS
   */
  async deleteFile(key: string): Promise<void> {
    if (!this.client) throw new Error("OSS not initialized")

    try {
      await this.client.delete(key)
    } catch (error) {
      console.error("[OSS] Delete failed:", error)
      throw error
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(key: string): Promise<boolean> {
    if (!this.client) throw new Error("OSS not initialized")

    try {
      await this.client.head(key)
      return true
    } catch {
      return false
    }
  }

  /**
   * Generate unique file key
   */
  generateFileKey(sessionId: string, fileName: string, userId: string): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 10)
    // 清理扩展名，只保留字母数字字符
    const rawExtension = fileName.split(".").pop() || ""
    const extension = rawExtension.replace(/[^a-zA-Z0-9]/g, "").substring(0, 10)
    const safeFileName = fileName
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .substring(0, 50)

    return `opencode-chat/${sessionId}/${timestamp}-${userId}-${random}.${extension}`
  }

  /**
   * List files in a session
   */
  async listSessionFiles(sessionId: string, maxKeys: number = 100): Promise<string[]> {
    if (!this.client) throw new Error("OSS not initialized")

    try {
      const prefix = `opencode-chat/${sessionId}/`
      const result = await this.client.list({
        prefix,
        "max-keys": maxKeys,
      })

      return (result.objects || []).map((obj) => obj.name)
    } catch (error) {
      console.error("[OSS] List files failed:", error)
      return []
    }
  }

  /**
   * Rename file in OSS (copy + delete)
   */
  async renameFile(oldKey: string, newKey: string): Promise<{ newKey: string; newUrl: string }> {
    if (!this.client) throw new Error("OSS not initialized")

    try {
      // OSS不支持直接重命名，需要复制然后删除原文件
      // 复制文件
      await this.client.copy(newKey, oldKey)

      // 删除原文件
      await this.client.delete(oldKey)

      // 获取新文件的URL
      const newUrl = await this.getFileUrl(newKey)

      return { newKey, newUrl }
    } catch (error) {
      console.error("[OSS] Rename failed:", error)
      throw error
    }
  }
}

// =============================================================================
// File Type Detection
// =============================================================================

export function detectMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || ""

  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    json: "application/json",
    js: "application/javascript",
    ts: "application/typescript",
    html: "text/html",
    css: "text/css",
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
  }

  return mimeTypes[ext] || "application/octet-stream"
}

export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

export function isVideoFile(mimeType: string): boolean {
  return mimeType.startsWith("video/")
}

export function isAudioFile(mimeType: string): boolean {
  return mimeType.startsWith("audio/")
}

// =============================================================================
// Singleton Instance
// =============================================================================

let globalOSSManager: OSSManager | null = null

export function getOSSManager(): OSSManager {
  if (!globalOSSManager) {
    globalOSSManager = new OSSManager()
  }
  return globalOSSManager
}

export async function initializeOSS(): Promise<OSSManager> {
  const oss = getOSSManager()
  await oss.initialize()
  return oss
}
