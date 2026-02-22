/**
 * Alibaba Cloud Integration Module
 * Reusable RDS and OSS integration for TypeScript projects
 *
 * @example
 * ```typescript
 * import { initializeDatabase, initializeOSS } from './aliyun'
 *
 * // Initialize services
 * const db = await initializeDatabase()
 * const oss = await initializeOSS()
 *
 * // Use them...
 * ```
 */

// OSS exports
export {
  OSSManager,
  OSSConfig,
  UploadResult,
  UploadUrlResult,
  RenameResult,
  getOSSConfig,
  getOSSManager,
  initializeOSS,
  resetOSSManager,
  detectMimeType,
  isImageFile,
  isVideoFile,
  isAudioFile,
  isDocumentFile,
} from "./oss"

// Database exports
export {
  DatabaseManager,
  DatabaseConfig,
  SessionData,
  MessageData,
  ParticipantData,
  FileMetadata,
  getDatabaseConfig,
  getDatabaseManager,
  initializeDatabase,
  resetDatabaseManager,
} from "./database"
