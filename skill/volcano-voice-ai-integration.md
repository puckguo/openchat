# 火山引擎豆包端到端实时语音大模型集成 Skill

## 概述

本文档描述如何正确集成火山引擎豆包端到端实时语音大模型API，实现低延迟的语音到语音对话功能。

**API文档**: https://www.volcengine.com/docs/6561/1594356

**核心特性**:
- 端到端语音对话（语音输入 → 语音输出）
- 实时ASR（语音识别）
- 流式TTS（语音合成）
- 低延迟交互

---

## 1. 认证配置

### 1.1 环境变量

```env
# 火山引擎豆包端到端实时语音大模型配置
VOLCANO_APP_ID=你的AppID
VOLCANO_ACCESS_KEY=你的AccessKey
VOLCANO_SECRET_KEY=你的SecretKey
VOLCANO_ENDPOINT=wss://openspeech.bytedance.com/api/v3/realtime/dialogue
VOLCANO_API_APP_KEY=PlgvMymc7f3tQnJ6
VOLCANO_API_RESOURCE_ID=volc.speech.dialog
ENABLE_VOICE_AI=true
```

### 1.2 HTTP Headers（关键！）

认证必须通过 HTTP Headers 传递，**不是** URL 参数：

```typescript
const headers = {
  'X-Api-App-ID': config.appId,
  'X-Api-Access-Key': config.accessToken,
  'X-Api-Resource-Id': 'volc.speech.dialog',
  'X-Api-App-Key': 'PlgvMymc7f3tQnJ6',
}
```

### 1.3 使用 ws 库（重要！）

Bun 原生 WebSocket 不支持自定义 headers，必须使用 `ws` 库：

```typescript
import WebSocket from "ws"

const ws = new WebSocket(endpoint, { headers })
```

---

## 2. 二进制协议

### 2.1 协议格式

```
+--------+--------+--------+--------+----------+----------+---------+
| Byte 0 | Byte 1 | Byte 2 | Byte 3 | Optional | Payload  | Payload |
| Ver|Hsz| Type   | Ser|Cmp| Rsv    | Fields   | Size (4B)| Data    |
+--------+--------+--------+--------+----------+----------+---------+
```

- **Byte 0**: Protocol Version (4bit) | Header Size (4bit) = `0x11`
- **Byte 1**: Message Type (4bit) | Flags (4bit)
- **Byte 2**: Serialization (4bit) | Compression (4bit)
- **Byte 3**: Reserved = `0x00`

### 2.2 消息类型

| 类型值 | 名称 | 说明 |
|--------|------|------|
| 0x01 | FULL_CLIENT | 客户端文本事件 |
| 0x02 | AUDIO_CLIENT | 客户端音频数据 |
| 0x09 | FULL_SERVER | 服务器文本响应 |
| 0x0B | AUDIO_SERVER | 服务器音频响应 |

### 2.3 序列化类型

| 值 | 类型 |
|----|------|
| 0x00 | RAW（原始二进制） |
| 0x01 | JSON |

### 2.4 Flags

| 值 | 含义 |
|----|------|
| 0x04 | 携带事件ID |

---

## 3. 事件ID

### 3.1 客户端事件

| ID | 事件 | 说明 |
|----|------|------|
| 1 | StartConnection | 开始连接 |
| 2 | FinishConnection | 结束连接 |
| 100 | StartSession | 开始会话 |
| 102 | FinishSession | 结束会话 |
| 200 | TaskRequest | 上传音频 |
| 501 | ChatTextQuery | 文本输入 |

### 3.2 服务端事件

| ID | 事件 | 说明 |
|----|------|------|
| 50 | ConnectionStarted | 连接成功 |
| 51 | ConnectionFailed | 连接失败 |
| 150 | SessionStarted | 会话开始 |
| 152 | SessionFinished | 会话结束 |
| 153 | SessionFailed | 会话失败 |
| 350 | TTSSentenceStart | TTS句子开始 |
| 352 | TTSResponse | TTS音频数据 |
| 359 | TTSEnded | TTS结束 |
| 451 | ASRResponse | ASR识别结果 |
| 459 | ASREnded | ASR结束 |
| 550 | ChatResponse | AI文本响应 |
| 559 | ChatEnded | AI回复结束 |

---

## 4. 交互流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        客户端                                    │
└─────────────────────────────────────────────────────────────────┘
        │
        │ 1. WebSocket Connect (带认证Headers)
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        火山引擎服务器                             │
└─────────────────────────────────────────────────────────────────┘
        │
        │ 2. StartConnection → ConnectionStarted
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. StartSession (配置bot_name, model等)                         │
└─────────────────────────────────────────────────────────────────┘
        │
        │ → SessionStarted (返回dialog_id)
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 循环：TaskRequest (发送PCM音频数据)                           │
│     ← ASRResponse (识别结果)                                     │
│     ← ChatResponse (AI文本回复)                                  │
│     ← TTSResponse (AI音频数据，OGG/Opus格式)                      │
│     ← TTSEnded (一轮对话结束)                                    │
└─────────────────────────────────────────────────────────────────┘
        │
        │ 5. FinishSession
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  结束会话（WebSocket连接可复用）                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 音频格式

### 5.1 输入音频

- **格式**: PCM (Raw)
- **采样率**: 16000 Hz
- **声道**: 单声道
- **位深**: 16-bit
- **字节序**: Little-endian
- **推荐发包**: 20ms 一包 (640 bytes)

### 5.2 输出音频

- **格式**: OGG 封装的 Opus
- **采样率**: 24000 Hz (默认)
- **处理方式**: 累积所有 TTSResponse 块，在 TTSEnded 后合并播放

### 5.3 音频播放注意事项

1. **不能单独播放每个音频块** - 每个 TTSResponse 返回的是 OGG 页面片段
2. **必须累积后播放** - 收集所有块，在 TTSEnded 事件时合并成一个完整的 OGG 文件
3. **使用 HTML5 Audio** - `decodeAudioData` 无法解码流式 OGG

```javascript
// 正确的音频处理方式
let audioChunks = [];

function onTTSResponse(base64Audio) {
  const bytes = base64ToUint8Array(base64Audio);
  audioChunks.push(bytes);
}

function onTTSEnded() {
  // 合并所有块
  const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  audioChunks = [];

  // 创建 Blob 并播放
  const blob = new Blob([combined], { type: 'audio/ogg' });
  const audio = new Audio(URL.createObjectURL(blob));
  audio.play();
}
```

---

## 6. StartSession 配置

```typescript
const startSessionPayload = {
  dialog: {
    bot_name: '豆包',           // AI名称
    dialog_id: '',              // 用于接续对话（可选）
    extra: {
      model: 'O',               // 模型版本: O, SC, 1.2.1.0, 2.2.0.0
      // 以下可选
      // system_role: '...',
      // speaking_style: '...',
      // enable_volc_websearch: false,
    }
  }
}
```

---

## 7. 常见错误

### 7.1 "Expected 101 status code"

**原因**: 认证失败或资源未开通

**解决方案**:
1. 检查 HTTP Headers 是否正确设置
2. 确认使用 `ws` 库而非原生 WebSocket
3. 确认已在火山引擎控制台开通"端到端实时语音大模型"服务

### 7.2 "requested resource not granted"

**原因**: 账号未开通对应资源

**解决方案**: 登录火山引擎控制台开通服务

### 7.3 音频无法播放 (DEMUXER_ERROR)

**原因**: 尝试单独播放音频片段

**解决方案**: 累积所有音频块，在 TTSEnded 后合并播放

---

## 8. 完整实现示例

参考文件:
- `multiplayer/voice-ai-service.ts` - 服务端实现
- `public/index.html` - 客户端实现

### 8.1 服务端核心代码

```typescript
// 连接火山引擎
const ws = new WebSocket(endpoint, {
  headers: {
    'X-Api-App-ID': config.appId,
    'X-Api-Access-Key': config.accessToken,
    'X-Api-Resource-Id': config.apiResourceId,
    'X-Api-App-Key': config.apiAppKey,
  }
})

// 编码二进制消息
function encodeClientEvent(eventId, sessionId, payload) {
  const payloadBuffer = Buffer.from(JSON.stringify(payload))
  const sessionIdBuffer = Buffer.from(sessionId, 'utf-8')

  const buffer = Buffer.alloc(4 + 4 + 4 + sessionIdBuffer.length + 4 + payloadBuffer.length)
  let offset = 0

  // Header
  buffer.writeUInt8(0x11, offset++)  // Version 1, Header Size 1
  buffer.writeUInt8(0x14, offset++)  // FULL_CLIENT, FLAGS_WITH_EVENT
  buffer.writeUInt8(0x10, offset++)  // JSON, NO_COMPRESSION
  buffer.writeUInt8(0x00, offset++)  // Reserved

  // Event ID
  buffer.writeUInt32BE(eventId, offset)
  offset += 4

  // Session ID
  buffer.writeUInt32BE(sessionIdBuffer.length, offset)
  offset += 4
  sessionIdBuffer.copy(buffer, offset)
  offset += sessionIdBuffer.length

  // Payload
  buffer.writeUInt32BE(payloadBuffer.length, offset)
  offset += 4
  payloadBuffer.copy(buffer, offset)

  return buffer
}
```

---

## 9. 版本说明

- **O版本**: 支持精品音色（vv, xiaohe, yunzhou, xiaotian）
- **SC版本**: 支持声音复刻
- **1.2.1.0**: O2.0版本，增强推理和唱歌能力
- **2.2.0.0**: SC2.0版本，增强角色演绎

---

## 10. 资源

- [官方文档](https://www.volcengine.com/docs/6561/1594356)
- [火山引擎控制台](https://console.volcengine.com/)
