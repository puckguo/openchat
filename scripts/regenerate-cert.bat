@echo off
set certDir=../ssl
set ipAddress=192.168.1.253

(
echo [req]
echo distinguished_name = req_distinguished_name
echo x509_extensions = v3_req
echo prompt = no
echo.
echo [req_distinguished_name]
echo CN = localhost
echo.
echo [v3_req]
echo keyUsage = keyEncipherment, dataEncipherment
echo extendedKeyUsage = serverAuth
echo subjectAltName = @alt_names
echo.
echo [alt_names]
echo DNS.1 = localhost
echo DNS.2 = *.localhost
echo IP.1 = 127.0.0.1
echo IP.2 = 192.168.1.253
) > %certDir%/openssl-local.cnf

openssl req -x509 -nodes -days 365 -newkey rsa:2048 ^
    -keyout %certDir%/local-key.pem ^
    -out %certDir%/local-cert.pem ^
    -config %certDir%/openssl-local.cnf

del %certDir%/openssl-local.cnf
echo Certificate regenerated for IP: 192.168.1.253
