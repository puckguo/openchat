# 阿里云 RDS 和 OSS 集成指南

本模块提供阿里云 RDS (PostgreSQL) 和 OSS (对象存储) 的可复用集成代码，可直接复制到其他项目中使用。

## 目录结构

```
aliyun/
├── README.md           # 本文档
├── oss.ts              # OSS 对象存储模块
├── database.ts         # RDS PostgreSQL 数据库模块
└── .env.example        # 环境变量配置模板
```

## 快速开始

### 1. 安装依赖

```bash
# OSS 依赖
npm install ali-oss

# RDS PostgreSQL 依赖
npm install pg
npm install -D @types/pg
```

### 2. 配置环境变量

复制 `.env.example` 到项目根目录，填入实际配置：

```env
# RDS PostgreSQL 数据库配置
VITE_RDS_HOST=your-rds-host.pg.rds.aliyuncs.com
VITE_RDS_PORT=5432
VITE_RDS_DATABASE=your-database
VITE_RDS_USER=your-user
VITE_RDS_PASSWORD=your-password

# 阿里云 OSS 配置
VITE_OSS_ACCESS_KEY_ID=your-access-key-id
VITE_OSS_ACCESS_KEY_SECRET=your-access-key-secret
VITE_OSS_BUCKET=your-bucket-name
VITE_OSS_REGION=oss-cn-beijing
```

### 3. 使用示例

#### OSS 文件上传

```typescript
import { OSSManager, getOSSManager, initializeOSS } from './oss'

// 初始化
const oss = await initializeOSS()

// 上传文件
const key = oss.generateFileKey('session-123', 'image.png', 'user-456')
const result = await oss.uploadFile(key, fileBuffer, {
  headers: { 'Content-Type': 'image/png' }
})
console.log('上传成功:', result.url)

// 获取文件URL
const url = await oss.getFileUrl(key, 3600) // 1小时有效签名URL

// 删除文件
await oss.deleteFile(key)
```

#### RDS 数据库操作

```typescript
import { DatabaseManager, getDatabaseManager, initializeDatabase } from './database'

// 初始化
const db = await initializeDatabase()

// 保存消息
await db.saveMessage('session-123', {
  id: 'msg-001',
  sessionId: 'session-123',
  senderId: 'user-456',
  senderName: '张三',
  senderRole: 'user',
  type: 'text',
  content: '你好！',
  timestamp: new Date().toISOString()
})

// 获取消息列表
const messages = await db.getMessages('session-123', 50)

// 保存文件元数据（关联OSS）
await db.saveFileMetadata({
  id: 'file-001',
  sessionId: 'session-123',
  messageId: 'msg-001',
  fileName: 'document.pdf',
  fileSize: 102400,
  mimeType: 'application/pdf',
  ossUrl: 'https://bucket.oss-cn-beijing.aliyuncs.com/...',
  ossKey: 'uploads/session-123/document.pdf',
  uploadedBy: 'user-456'
})
```

## 模块详细说明

### OSS 模块 (oss.ts)

**核心功能：**
- 文件上传（Buffer / URL）
- 签名URL生成
- 文件删除
- 文件存在检查
- 文件重命名
- 文件列表查询

**配置接口：**
```typescript
interface OSSConfig {
  accessKeyId: string      // 阿里云 AccessKey ID
  accessKeySecret: string  // 阿里云 AccessKey Secret
  bucket: string           // OSS Bucket 名称
  region: string           // OSS 区域，如 oss-cn-beijing
  roleArn?: string         // 可选：RAM角色ARN（用于STS）
}
```

**主要方法：**
| 方法 | 说明 |
|------|------|
| `initialize()` | 初始化OSS客户端 |
| `uploadFile(key, buffer, options)` | 上传文件 |
| `uploadFromUrl(key, url, options)` | 从URL上传文件 |
| `getFileUrl(key, expires?)` | 获取文件访问URL |
| `deleteFile(key)` | 删除文件 |
| `fileExists(key)` | 检查文件是否存在 |
| `renameFile(oldKey, newKey)` | 重命名文件 |
| `generateFileKey(sessionId, fileName, userId)` | 生成唯一文件Key |

### RDS 模块 (database.ts)

**核心功能：**
- 数据库自动创建
- 表结构自动初始化
- 会话管理
- 消息存储
- 参与者管理
- 文件元数据存储（与OSS关联）

**配置接口：**
```typescript
interface DatabaseConfig {
  host: string        // RDS主机地址
  port: number        // 端口，默认5432
  database: string    // 数据库名
  user: string        // 用户名
  password: string    // 密码
}
```

**数据表结构：**

```sql
-- 会话表
CREATE TABLE sessions (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255),
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  settings JSONB DEFAULT '{}'
);

-- 消息表
CREATE TABLE messages (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) REFERENCES sessions(id),
  sender_id VARCHAR(255),
  sender_name VARCHAR(255),
  sender_role VARCHAR(50),
  type VARCHAR(50) DEFAULT 'text',
  content TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 文件表（OSS元数据）
CREATE TABLE files (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) REFERENCES sessions(id),
  message_id VARCHAR(255),
  file_name VARCHAR(500),
  file_size BIGINT,
  mime_type VARCHAR(100),
  oss_url VARCHAR(1000),
  oss_key VARCHAR(500),
  uploaded_by VARCHAR(255),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**主要方法：**
| 方法 | 说明 |
|------|------|
| `connect()` | 连接数据库 |
| `disconnect()` | 断开连接 |
| `createSession(id, name, createdBy)` | 创建会话 |
| `getSession(id)` | 获取会话 |
| `saveMessage(sessionId, message)` | 保存消息 |
| `getMessages(sessionId, limit, before?)` | 获取消息列表 |
| `saveParticipant(sessionId, participant)` | 保存参与者 |
| `saveFileMetadata(fileData)` | 保存文件元数据 |
| `getSessionFiles(sessionId)` | 获取会话文件列表 |

## 阿里云控制台配置

### RDS 配置步骤

1. 登录[阿里云RDS控制台](https://rds.console.aliyun.com/)
2. 创建 PostgreSQL 实例
3. 配置白名单（添加应用服务器IP）
4. 创建数据库和账号
5. 获取连接地址

### OSS 配置步骤

1. 登录[阿里云OSS控制台](https://oss.console.aliyun.com/)
2. 创建 Bucket
3. 配置 Bucket 属性（区域、存储类型、访问权限）
4. 创建 AccessKey（建议使用RAM子账号）
5. 配置 CORS（如需前端直传）

### RAM 权限配置

建议为应用创建独立的 RAM 用户，只授予必要权限：

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject",
        "oss:GetObject",
        "oss:DeleteObject",
        "oss:ListObjects"
      ],
      "Resource": [
        "acs:oss:*:*:your-bucket-name",
        "acs:oss:*:*:your-bucket-name/*"
      ]
    }
  ],
  "Version": "1"
}
```

## 注意事项

1. **安全性**
   - 不要将 AccessKey 提交到版本控制
   - 使用环境变量存储敏感配置
   - 定期轮换 AccessKey

2. **性能优化**
   - 大文件使用分片上传
   - 高频访问文件使用 CDN 加速
   - 合理设置数据库连接池

3. **成本控制**
   - OSS 设置生命周期规则，自动清理过期文件
   - RDS 选择合适的实例规格
   - 监控流量和存储使用量

## 常见问题

**Q: OSS 上传报错 "SecurityTokenExpired"**
A: 签名URL已过期，需要重新生成

**Q: RDS 连接超时**
A: 检查白名单配置，确保应用服务器IP已添加

**Q: 数据库自动创建失败**
A: 确保连接用户有 CREATEDB 权限，或手动创建数据库

## 相关链接

- [阿里云 OSS 文档](https://help.aliyun.com/product/31815.html)
- [阿里云 RDS PostgreSQL 文档](https://help.aliyun.com/product/26092.html)
- [ali-oss SDK 文档](https://github.com/ali-sdk/ali-oss)
- [node-postgres 文档](https://node-postgres.com/)
