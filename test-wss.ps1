# =============================================================================
# Open CoChat - WSS/HTTPS 连接测试脚本
# =============================================================================

param(
    [string]$Url = "wss://puckg.xyz:3002",
    [string]$Session = "test-room",
    [string]$Name = "test-user",
    [int]$Timeout = 10
)

Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "          WSS/HTTPS 连接测试" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""

# 构建 WebSocket URL
$wsUrl = "${Url}?session=${Session}&name=${Name}&role=member"
Write-Host "测试地址: $wsUrl" -ForegroundColor Yellow
Write-Host ""

# 创建 WebSocket 客户端
try {
    # 使用 .NET WebSocket 客户端
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ws.Options.UseDefaultCredentials = $true

    # 设置超时
    $cts = New-Object System.Threading.CancellationTokenSource
    $cts.CancelAfter([TimeSpan]::FromSeconds($Timeout))

    Write-Host "[1/4] 正在连接..." -ForegroundColor Gray
    $uri = New-Object System.Uri($wsUrl)

    $connectTask = $ws.ConnectAsync($uri, $cts.Token)
    $connectTask.Wait()

    if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        Write-Host "      ✓ WebSocket 连接成功!" -ForegroundColor Green
    } else {
        Write-Host "      ✗ WebSocket 连接失败" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "[2/4] 发送测试消息..." -ForegroundColor Gray

    # 发送 ping 消息
    $pingMessage = '{"type":"ping","timestamp":' + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) + '}'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($pingMessage)
    $buffer = New-Object System.ArraySegment[byte]($bytes)

    $sendTask = $ws.SendAsync($buffer, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token)
    $sendTask.Wait()

    Write-Host "      ✓ 消息发送成功" -ForegroundColor Green

    Write-Host ""
    Write-Host "[3/4] 接收响应..." -ForegroundColor Gray

    # 接收响应
    $receiveBuffer = New-Object byte[] 1024
    $receiveSegment = New-Object System.ArraySegment[byte]($receiveBuffer)

    $receiveTask = $ws.ReceiveAsync($receiveSegment, $cts.Token)
    $receiveTask.Wait()

    $result = $receiveTask.Result
    if ($result.Count -gt 0) {
        $response = [System.Text.Encoding]::UTF8.GetString($receiveBuffer, 0, $result.Count)
        Write-Host "      ✓ 收到响应: $response" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "[4/4] 关闭连接..." -ForegroundColor Gray

    $closeTask = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Test complete", $cts.Token)
    $closeTask.Wait()

    Write-Host "      ✓ 连接正常关闭" -ForegroundColor Green

    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host "          测试通过! WSS/HTTPS 工作正常" -ForegroundColor Green
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  服务器地址: $Url" -ForegroundColor Cyan
    Write-Host "  连接状态: 正常" -ForegroundColor Cyan
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Red
    Write-Host "          测试失败!" -ForegroundColor Red
    Write-Host "=============================================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  错误信息: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  可能原因:" -ForegroundColor Yellow
    Write-Host "    1. 服务器未启动" -ForegroundColor Gray
    Write-Host "    2. 防火墙阻止连接" -ForegroundColor Gray
    Write-Host "    3. 证书配置错误" -ForegroundColor Gray
    Write-Host "    4. 端口未开放" -ForegroundColor Gray
    Write-Host ""
}

if ($ws -ne $null) {
    $ws.Dispose()
}
if ($cts -ne $null) {
    $cts.Dispose()
}
