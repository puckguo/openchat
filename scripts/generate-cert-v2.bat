@echo off
chcp 65001 >nul
set certDir=../ssl
set ipAddress=192.168.1.253

if not exist %certDir% mkdir %certDir%

echo Generating compatible SSL certificate for %ipAddress%...

(
echo [req]
echo default_bits = 2048
echo distinguished_name = req_distinguished_name
echo req_extensions = v3_req
echo prompt = no
echo.
echo [req_distinguished_name]
echo C = CN
echo ST = Local
echo L = Local
echo O = OpenCode Chat
echo OU = Development
echo CN = localhost
echo.
echo [v3_req]
echo keyUsage = digitalSignature, keyEncipherment
echo extendedKeyUsage = serverAuth
echo subjectAltName = @alt_names
echo basicConstraints = CA:FALSE
echo.
echo [alt_names]
echo DNS.1 = localhost
echo DNS.2 = *.localhost
echo IP.1 = 127.0.0.1
echo IP.2 = ::1
echo IP.3 = %ipAddress%
) > %certDir%/openssl.cnf

openssl req -x509 -nodes -sha256 -days 365 -newkey rsa:2048 ^
    -keyout %certDir%/local-key.pem ^
    -out %certDir%/local-cert.pem ^
    -config %certDir%/openssl.cnf ^
    -extensions v3_req

del %certDir%\openssl.cnf

echo.
echo Certificate generated:
echo   - %certDir%/local-cert.pem
echo   - %certDir%/local-key.pem
echo.
echo Access: https://%ipAddress%:8888
