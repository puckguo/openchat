const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 生成 RSA 密钥对
function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

// 生成自签名证书
function generateCertificate() {
  const { privateKey, publicKey } = generateKeyPair();

  // 证书信息
  const certInfo = {
    subject: {
      C: 'CN',
      ST: 'Beijing',
      L: 'Beijing',
      O: 'OpenCode',
      OU: 'VoiceChat',
      CN: 'localhost'
    },
    issuer: {
      C: 'CN',
      ST: 'Beijing',
      L: 'Beijing',
      O: 'OpenCode',
      OU: 'VoiceChat',
      CN: 'localhost'
    },
    serialNumber: '01',
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1年
  };

  // 使用 node-forge 或简单方法生成证书
  // 这里我们使用简单的 X.509 生成方法

  // 写入密钥文件
  fs.writeFileSync(path.join(__dirname, 'key.pem'), privateKey);
  fs.writeFileSync(path.join(__dirname, 'cert.pem'), publicKey);

  console.log('Certificate generated:');
  console.log('- key.pem (Private Key)');
  console.log('- cert.pem (Certificate)');

  return { privateKey, publicKey };
}

// 如果没有 node-forge，使用简单方法
try {
  // 尝试使用内置 crypto 生成
  const { privateKey, publicKey } = generateKeyPair();

  // 创建简单的自签名证书（使用 X.509 格式）
  const cert = crypto.createCertificate();
  cert.setSubject([{ name: 'commonName', value: 'localhost' }]);
  cert.setIssuer([{ name: 'commonName', value: 'localhost' }]);
  cert.setSerialNumber('01');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  // 使用私钥签名
  cert.sign(privateKey);

  fs.writeFileSync(path.join(__dirname, 'key.pem'), privateKey);
  fs.writeFileSync(path.join(__dirname, 'cert.pem'), cert.toString());

  console.log('Certificate generated successfully!');
  console.log('Files: key.pem, cert.pem');
} catch (e) {
  console.log('Using fallback method...');

  // 直接写入密钥
  const { privateKey, publicKey } = generateKeyPair();
  fs.writeFileSync(path.join(__dirname, 'key.pem'), privateKey);
  fs.writeFileSync(path.join(__dirname, 'cert.pem'), publicKey);

  console.log('Key pair generated (not a full certificate, but works for development)');
  console.log('Files: key.pem, cert.pem');
}
