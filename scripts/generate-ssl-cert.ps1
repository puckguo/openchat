# 生成本地自签名证书脚本
# 用于局域网 HTTPS 部署

$certDir = "../ssl"
$certPath = "$certDir/local-cert.pem"
$keyPath = "$certDir/local-key.pem"

# 创建 SSL 目录
if (-not (Test-Path $certDir)) {
    New-Item -ItemType Directory -Path $certDir -Force
    Write-Host "Created SSL directory: $certDir"
}

# 检查 OpenSSL 是否可用
$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
    Write-Error "OpenSSL not found. Please install OpenSSL first."
    Write-Host "You can install it via:"
    Write-Host "  - Chocolatey: choco install openssl"
    Write-Host "  - Git for Windows includes OpenSSL in Git Bash"
    exit 1
}

# 获取本机 IP 地址
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -like "192.168.*" -or
    $_.IPAddress -like "10.*" -or
    $_.IPAddress -like "172.16.*" -or
    $_.IPAddress -like "172.17.*" -or
    $_.IPAddress -like "172.18.*" -or
    $_.IPAddress -like "172.19.*" -or
    $_.IPAddress -like "172.2*.*" -or
    $_.IPAddress -like "172.30.*" -or
    $_.IPAddress -like "172.31.*"
} | Select-Object -First 1).IPAddress

if (-not $ipAddress) {
    $ipAddress = "192.168.1.253"
}

Write-Host "Generating self-signed certificate for IP: $ipAddress"

# 创建 OpenSSL 配置文件
$opensslConfig = @"
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = localhost

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1 = 127.0.0.1
IP.2 = $ipAddress
"@

$configPath = "$certDir/openssl.cnf"
$opensslConfig | Out-File -FilePath $configPath -Encoding UTF8

# 生成私钥和证书
& openssl req -x509 -nodes -days 365 -newkey rsa:2048 `
    -keyout $keyPath `
    -out $certPath `
    -config $configPath `
    2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ SSL Certificate generated successfully!"
    Write-Host "   Certificate: $certPath"
    Write-Host "   Private Key: $keyPath"
    Write-Host "   IP Address:  $ipAddress"
    Write-Host "`n📱 Mobile device access: https://$ipAddress`:8888"
    Write-Host "`n⚠️  Note: Browser will show certificate warning, click 'Advanced' -> 'Proceed'"
} else {
    Write-Error "Failed to generate certificate"
    exit 1
}

# 清理临时配置文件
Remove-Item $configPath -Force -ErrorAction SilentlyContinue
