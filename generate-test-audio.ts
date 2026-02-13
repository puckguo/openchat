// 生成测试音频文件 (16kHz, 16-bit PCM)
// 创建一个1秒的1kHz正弦波

const sampleRate = 16000
const duration = 2 // 2秒
const frequency = 1000 // 1kHz

const numSamples = sampleRate * duration
const buffer = new ArrayBuffer(numSamples * 2)
const view = new DataView(buffer)

for (let i = 0; i < numSamples; i++) {
  // 生成正弦波
  const t = i / sampleRate
  const sample = Math.sin(2 * Math.PI * frequency * t) * 0.5 // 50% 振幅

  // 转换为 16-bit PCM
  const pcmSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
  view.setInt16(i * 2, pcmSample, true) // 小端序
}

// 保存为文件
const fs = require('fs')
fs.writeFileSync('test-audio.pcm', Buffer.from(buffer))
console.log(`Generated test audio: ${numSamples} samples, ${buffer.byteLength} bytes`)
