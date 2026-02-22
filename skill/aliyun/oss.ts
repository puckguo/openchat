/**
 * Alibaba Cloud OSS Integration Module
 * Reusable object storage service integration for file uploads
 *
 * @example
 * ```typescript
 * import { OSSManager, initializeOSS } from './oss'
 *
 * // Initialize
 * const oss = await initializeOSS()
 *
 * // Upload file
 * const key = oss.generateFileKey('session-123', 'image.png', 'user-456')
 * const result = await oss.uploadFile(key, fileBuffer)
 * console.log('Uploaded:', result.url)
 * ```
 */

import OSS from "ali-oss"

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface OSSConfig {
  /** Alibaba Cloud AccessKey ID */
  accessKeyId: string
  /** Alibaba Cloud AccessKey Secret */
  accessKeySecret: string
  /** OSS Bucket name */
  bucket: string
  /** OSS Region, e.g., oss-cn-beijing */
  region: string
  /** Optional: RAM Role ARN for STS */
  roleArn?: string
}

export interface UploadResult {
  /** Public or signed URL of the uploaded file */
  url: string
  /** OSS object key */
  key: string
  /** File size in bytes */
  size: number
}

export interface UploadUrlResult {
  /** Signed upload URL */
  url: string
  /** OSS object key */
  key: string
}

export interface RenameResult {
  /** New OSS object key */
  newKey: string
  /** New file URL */
  newUrl: string
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Get OSS configuration from environment variables
 * Override this function to provide custom configuration
 */
export function getOSSConfig(): OSSConfig {
  return {
    accessKeyId: process.env.VITE_OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.VITE_OSS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET || "",
    bucket: process.env.VITE_OSS_BUCKET || process.env.OSS_BUCKET || "",
    region: process.env.VITE_OSS_REGION || process.env.OSS_REGION || "",
    roleArn: process.env.VITE_OSS_ROLE_ARN || process.env.OSS_ROLE_ARN,
  }
}

// =============================================================================
// OSS Manager Class
// =============================================================================

/**
 * OSS Manager - Handles all OSS operations
 *
 * @example
 * ```typescript
 * const oss = new OSSManager()
 * await oss.initialize()
 *
 * // Upload a file
 * const result = await oss.uploadFile('uploads/file.txt', buffer)
 * ```
 */
export class OSSManager {
  private client: OSS | null = null
  private config: OSSConfig

  constructor(config?: OSSConfig) {
    this.config = config || getOSSConfig()
  }

  /**
   * Initialize OSS client
   * Must be called before any other operations
   */
  async initialize(): Promise<void> {
    try {
      this.client = new OSS({
        accessKeyId: this.config.accessKeyId,
        accessKeySecret: this.config.accessKeySecret,
        bucket: this.config.bucket,
        region: this.config.region,
      })

      console.log("[OSS] Initialized successfully")
      console.log(`[OSS] Bucket: ${this.config.bucket}, Region: ${this.config.region}`)
    } catch (error) {
      console.error("[OSS] Initialization failed:", error)
      throw error
    }
  }

  /**
   * Check if client is initialized
   */
  private ensureInitialized(): void {
    if (!this.client) {
      throw new Error("OSS not initialized. Call initialize() first.")
    }
  }

  /**
   * Generate signed upload URL for direct browser upload
   *
   * @param key - OSS object key
   * @param mimeType - File MIME type
   * @param expires - URL expiration time in seconds (default: 3600)
   */
  async generateUploadUrl(
    key: string,
    mimeType: string,
    expires: number = 3600
  ): Promise<UploadUrlResult> {
    this.ensureInitialized()

    try {
      const url = this.client!.signatureUrl(key, {
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
   *
   * @param key - OSS object key (file path in bucket)
   * @param buffer - File content as Buffer
   * @param options - Upload options (headers, timeout, etc.)
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    options?: OSS.PutObjectOptions
  ): Promise<UploadResult> {
    this.ensureInitialized()

    try {
      const result = await this.client!.put(key, buffer, options)
      const url = result.url

      console.log(`[OSS] File uploaded: ${key}, Size: ${buffer.length} bytes`)

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
   * Upload file from URL (fetch and upload)
   *
   * @param key - OSS object key
   * @param fileUrl - Source URL to fetch file from
   * @param options - Upload options
   */
  async uploadFromUrl(
    key: string,
    fileUrl: string,
    options?: OSS.PutObjectOptions
  ): Promise<UploadResult> {
    this.ensureInitialized()

    try {
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
   *
   * @param key - OSS object key
   * @param expires - If provided, generates a signed URL valid for this many seconds
   */
  async getFileUrl(key: string, expires?: number): Promise<string> {
    this.ensureInitialized()

    try {
      if (expires) {
        return this.client!.signatureUrl(key, { expires })
      }
      return `https://${this.config.bucket}.${this.config.region}.aliyuncs.com/${key}`
    } catch (error) {
      console.error("[OSS] Get URL failed:", error)
      throw error
    }
  }

  /**
   * Delete file from OSS
   *
   * @param key - OSS object key
   */
  async deleteFile(key: string): Promise<void> {
    this.ensureInitialized()

    try {
      await this.client!.delete(key)
      console.log(`[OSS] File deleted: ${key}`)
    } catch (error) {
      console.error("[OSS] Delete failed:", error)
      throw error
    }
  }

  /**
   * Check if file exists
   *
   * @param key - OSS object key
   */
  async fileExists(key: string): Promise<boolean> {
    this.ensureInitialized()

    try {
      await this.client!.head(key)
      return true
    } catch {
      return false
    }
  }

  /**
   * Rename file in OSS (copy + delete)
   * Note: OSS doesn't support direct rename, so this is a copy + delete operation
   *
   * @param oldKey - Current OSS object key
   * @param newKey - New OSS object key
   */
  async renameFile(oldKey: string, newKey: string): Promise<RenameResult> {
    this.ensureInitialized()

    try {
      // Copy to new location
      await this.client!.copy(newKey, oldKey)
      console.log(`[OSS] File copied: ${oldKey} -> ${newKey}`)

      // Delete original
      await this.client!.delete(oldKey)
      console.log(`[OSS] Old file deleted: ${oldKey}`)

      const newUrl = await this.getFileUrl(newKey)
      return { newKey, newUrl }
    } catch (error) {
      console.error("[OSS] Rename failed:", error)
      throw error
    }
  }

  /**
   * Generate unique file key for OSS storage
   *
   * @param namespace - Namespace (e.g., session ID, user ID)
   * @param fileName - Original file name
   * @param identifier - Additional identifier (e.g., user ID)
   */
  generateFileKey(namespace: string, fileName: string, identifier: string): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 10)
    const rawExtension = fileName.split(".").pop() || ""
    const extension = rawExtension.replace(/[^a-zA-Z0-9]/g, "").substring(0, 10)

    return `uploads/${namespace}/${timestamp}-${identifier}-${random}.${extension}`
  }

  /**
   * List files with a given prefix
   *
   * @param prefix - Key prefix to filter files
   * @param maxKeys - Maximum number of files to return
   */
  async listFiles(prefix: string, maxKeys: number = 100): Promise<string[]> {
    this.ensureInitialized()

    try {
      const result = await this.client!.list({
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
   * Get file metadata
   *
   * @param key - OSS object key
   */
  async getFileMeta(key: string): Promise<OSS.ObjectMeta | null> {
    this.ensureInitialized()

    try {
      const result = await this.client!.head(key)
      return result.meta || null
    } catch {
      return null
    }
  }
}

// =============================================================================
// File Type Utilities
// =============================================================================

/**
 * Detect MIME type from file name extension
 */
export function detectMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || ""

  const mimeTypes: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    bmp: "image/bmp",

    // Videos
    mp4: "video/mp4",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    wmv: "video/x-ms-wmv",
    mkv: "video/x-matroska",

    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    flac: "audio/flac",

    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

    // Text & Code
    txt: "text/plain",
    json: "application/json",
    js: "application/javascript",
    ts: "application/typescript",
    html: "text/html",
    css: "text/css",
    xml: "application/xml",
    md: "text/markdown",

    // Archives
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",
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

export function isDocumentFile(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    mimeType.includes("word") ||
    mimeType.includes("excel") ||
    mimeType.includes("powerpoint") ||
    mimeType === "text/plain"
  )
}

// =============================================================================
// Singleton Instance
// =============================================================================

let globalOSSManager: OSSManager | null = null

/**
 * Get global OSS manager instance (singleton)
 */
export function getOSSManager(): OSSManager {
  if (!globalOSSManager) {
    globalOSSManager = new OSSManager()
  }
  return globalOSSManager
}

/**
 * Initialize global OSS manager
 */
export async function initializeOSS(): Promise<OSSManager> {
  const oss = getOSSManager()
  await oss.initialize()
  return oss
}

/**
 * Reset global OSS manager (useful for testing)
 */
export function resetOSSManager(): void {
  globalOSSManager = null
}
