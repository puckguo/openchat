# Open CoChat Deployment Guide

This guide covers various deployment options for Open CoChat, from local development to production cloud deployments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start with Docker](#quick-start-with-docker)
- [Cloud Server Deployment](#cloud-server-deployment)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Minimum Requirements

- **CPU**: 2 cores
- **RAM**: 4GB
- **Disk**: 10GB free space
- **OS**: Linux (Ubuntu 20.04+, CentOS 8+, Debian 11+), macOS 12+, or Windows Server 2019+

### Software Requirements

- **Docker**: >= 20.10 (for Docker deployment)
- **Bun**: >= 1.0.0 (for manual deployment)
- **Node.js**: >= 18.0.0 (alternative to Bun)
- **PostgreSQL**: >= 14.0
- **Git**: >= 2.0

### External Services

- DeepSeek API key (required for AI features)
- Alibaba Cloud OSS (optional, for file storage)
- Supabase account (optional, for authentication)

## Quick Start with Docker

### Using Docker Compose (Recommended)

This is the fastest way to get Open CoChat running:

```bash
# Clone the repository
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# At minimum, set:
# - DEEPSEEK_API_KEY
# - DATABASE_URL (or use the included PostgreSQL)

# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop services
docker-compose down
```

Access the application at `http://localhost:3000`

### Docker Compose with External Database

If you prefer to use your own PostgreSQL instance:

```bash
# Create .env file
cat > .env << 'EOF'
# Use external database
DATABASE_URL=postgresql://user:password@your-host:5432/opencode_chat

# Disable built-in database
POSTGRES_ENABLED=false

# AI Service
DEEPSEEK_API_KEY=your-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
ENABLE_AI=true

# Server
WS_PORT=3002
WS_HOST=0.0.0.0
EOF

# Start without database container
docker-compose up -d opencode-chat
```

### Manual Docker Build

```bash
# Build the image
docker build -t opencode-chat:latest .

# Run with default configuration
docker run -d \
  --name opencode-chat \
  -p 3002:3002 \
  -e DEEPSEEK_API_KEY=your-key \
  -e DATABASE_URL=postgresql://... \
  opencode-chat:latest

# Check logs
docker logs -f opencode-chat
```

### Docker with Volume Mounts

```bash
docker run -d \
  --name opencode-chat \
  -p 3002:3002 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/.env:/app/.env:ro \
  --restart unless-stopped \
  opencode-chat:latest
```

## Cloud Server Deployment

### AWS EC2 Deployment

#### 1. Launch EC2 Instance

```bash
# Using AWS CLI
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.medium \
  --key-name your-key-pair \
  --security-group-ids sg-xxxxx \
  --subnet-id subnet-xxxxx
```

#### 2. SSH into Instance

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

#### 3. Install Docker

```bash
# Update package index
sudo apt-get update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker ubuntu
```

#### 4. Deploy Application

```bash
# Clone repository
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat

# Configure environment
cp .env.example .env
nano .env

# Start with Docker Compose
docker-compose up -d

# Configure security group to allow:
# - Port 80 (HTTP)
# - Port 443 (HTTPS)
# - Port 3002 (WebSocket)
```

### Google Cloud Run Deployment

```bash
# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/PROJECT_ID/opencode-chat

# Deploy to Cloud Run
gcloud run deploy opencode-chat \
  --image gcr.io/PROJECT_ID/opencode-chat \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY \
  --set-env-vars DATABASE_URL=$DATABASE_URL
```

### Azure Container Instances

```bash
# Create resource group
az group create --name opencode-chat-rg --location eastus

# Create container
az container create \
  --resource-group opencode-chat-rg \
  --name opencode-chat \
  --image opencodechat/opencode-chat:latest \
  --cpu 2 \
  --memory 4 \
  --ports 3002 \
  --environment-variables \
    DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY \
    DATABASE_URL=$DATABASE_URL
```

### DigitalOcean App Platform

1. Push your code to GitHub
2. Create a new app in DigitalOcean
3. Connect your GitHub repository
4. Configure build and run commands:
   - **Build Command**: `bun install`
   - **Run Command**: `bun run start`
5. Add environment variables
6. Deploy

### Alibaba Cloud ECS

```bash
# Connect to ECS instance
ssh root@your-ecs-ip

# Install Docker
curl -fsSL https://get.docker.com | sh

# Deploy application
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat
docker-compose up -d
```

## Local Development Setup

### Installation

#### Install Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1|iex"
```

#### Install PostgreSQL

**Ubuntu/Debian:**
```bash
sudo apt-get install postgresql postgresql-contrib
```

**macOS:**
```bash
brew install postgresql@14
brew services start postgresql@14
```

**Windows:**
Download from [postgresql.org](https://www.postgresql.org/download/windows/)

### Setup Database

```bash
# Create database and user
sudo -u postgres psql

CREATE DATABASE opencode_chat;
CREATE USER opencode_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE opencode_chat TO opencode_user;
\q
```

### Configure Environment

```bash
# Clone repository
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat

# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### Run Database Migrations

```bash
bun run db:migrate
```

### Start Development Server

```bash
# Development mode with hot reload
bun run dev

# Production mode
bun run start

# Using PM2 (recommended for production)
npm install -g pm2
pm2 start multiplayer/websocket-server.ts --name opencode-chat --interpreter bun
pm2 save
pm2 startup
```

### Access Application

- WebSocket Server: `ws://localhost:3002`
- Health Check: `http://localhost:3002/health`
- Frontend: `http://localhost:8081`

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DEEPSEEK_API_KEY` | DeepSeek API key | `sk-xxxxx` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |

### Optional Variables

#### Server Configuration

```env
# WebSocket Server
WS_PORT=3002                    # WebSocket port (default: 3002)
WS_HOST=0.0.0.0                 # Bind address (default: 0.0.0.0)
NODE_ENV=production             # Environment: development, production
```

#### Database Configuration

```env
# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/opencode_chat
ENABLE_DATABASE=true            # Enable database features

# Individual database settings (alternative to DATABASE_URL)
VITE_RDS_HOST=localhost
VITE_RDS_PORT=5432
VITE_RDS_DATABASE=opencode_chat
VITE_RDS_USER=opencode_user
VITE_RDS_PASSWORD=secure_password
```

#### AI Service Configuration

```env
# DeepSeek AI
DEEPSEEK_API_KEY=sk-your-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat    # Model: deepseek-chat, deepseek-coder
DEEPSEEK_MAX_TOKENS=2000        # Response token limit
ENABLE_AI=true                  # Enable AI features
```

#### File Storage (Alibaba Cloud OSS)

```env
# OSS Configuration
VITE_OSS_ACCESS_KEY_ID=your-access-key
VITE_OSS_ACCESS_KEY_SECRET=your-secret-key
VITE_OSS_BUCKET=your-bucket-name
VITE_OSS_REGION=oss-cn-beijing  # Region: oss-cn-hangzhou, oss-us-west-1, etc.
VITE_OSS_ENDPOINT=              # Optional: custom endpoint
ENABLE_OSS=true                 # Enable file storage
```

#### Authentication (Supabase)

```env
# Supabase Auth
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ENABLE_SUPABASE_AUTH=false      # Enable Supabase authentication
ALLOW_ANONYMOUS=true            # Allow unauthenticated access
```

#### Storage Configuration

```env
# Local Storage
STORAGE_PATH=./data             # Local data directory
MAX_FILE_SIZE=10485760          # Max file size in bytes (10MB)
```

#### Rate Limiting

```env
# Rate Limiting
RATE_LIMIT_REQUESTS=100         # Requests per window
RATE_LIMIT_WINDOW=60000         # Window duration in ms (60 seconds)
```

## Database Setup

### PostgreSQL Setup

#### Initial Schema Creation

```sql
-- Connect to database
psql -U opencode_user -d opencode_chat

-- Create tables
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  password_question TEXT,
  password_answer TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) REFERENCES sessions(id),
  sender_id VARCHAR(255),
  sender_name VARCHAR(255),
  sender_role VARCHAR(50),
  type VARCHAR(50),
  content TEXT,
  mentions JSONB,
  mentions_ai BOOLEAN DEFAULT FALSE,
  reply_to VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS participants (
  session_id VARCHAR(255) REFERENCES sessions(id),
  user_id VARCHAR(255),
  name VARCHAR(255),
  role VARCHAR(50),
  status VARCHAR(50),
  joined_at TIMESTAMP,
  last_seen TIMESTAMP,
  PRIMARY KEY (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) REFERENCES sessions(id),
  summary TEXT NOT NULL,
  last_message_id VARCHAR(255),
  message_count INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) REFERENCES sessions(id),
  message_id VARCHAR(255) REFERENCES messages(id),
  file_name VARCHAR(500),
  file_size BIGINT,
  mime_type VARCHAR(100),
  oss_url TEXT,
  oss_key VARCHAR(500),
  uploaded_by VARCHAR(255),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_participants_session ON participants(session_id);
CREATE INDEX idx_summaries_session ON summaries(session_id);
CREATE INDEX idx_files_session ON files(session_id);
```

#### Database Connection Pool

Configure connection pooling for production:

```env
DATABASE_URL=postgresql://user:pass@host:5432/db?pool_max=20&pool_min=5&pool_idle_timeout=30000
```

### Backup and Restore

#### Backup Database

```bash
# Using pg_dump
pg_dump -U opencode_user -h localhost -d opencode_chat > backup.sql

# Compressed backup
pg_dump -U opencode_user -h localhost -d opencode_chat | gzip > backup.sql.gz
```

#### Restore Database

```bash
# Restore from backup
psql -U opencode_user -h localhost -d opencode_chat < backup.sql

# Restore from compressed backup
gunzip -c backup.sql.gz | psql -U opencode_user -h localhost -d opencode_chat
```

#### Automated Backups

```bash
# Add to crontab for daily backups
crontab -e

# Add line for daily backup at 2 AM
0 2 * * * pg_dump -U opencode_user -h localhost opencode_chat | gzip > /backups/opencode_chat_$(date +\%Y\%m\%d).sql.gz
```

## Reverse Proxy Configuration

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/opencode-chat

server {
    listen 80;
    server_name chat.yourdomain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name chat.yourdomain.com;

    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/chat.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # WebSocket upgrade
    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3002/health;
        access_log off;
    }
}
```

### Apache Configuration

```apache
# /etc/apache2/sites-available/opencode-chat.conf

<VirtualHost *:80>
    ServerName chat.yourdomain.com
    Redirect permanent / https://chat.yourdomain.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName chat.yourdomain.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/chat.yourdomain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/chat.yourdomain.com/privkey.pem

    ProxyRequests Off
    ProxyPreserveHost On

    ProxyPass /health http://localhost:3002/health
    ProxyPassReverse /health http://localhost:3002/health

    <Location />
        ProxyPass ws://localhost:3002
        ProxyPassReverse ws://localhost:3002
    </Location>
</VirtualHost>
```

## SSL/TLS Setup

### Using Let's Encrypt with Certbot

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d chat.yourdomain.com

# Auto-renewal (configured automatically)
sudo certbot renew --dry-run
```

## Troubleshooting

### Common Issues

#### 1. WebSocket Connection Fails

**Symptoms**: Client cannot connect to WebSocket server

**Solutions**:
- Check if WebSocket port is open: `netstat -tuln | grep 3002`
- Verify firewall rules: `sudo ufw status`
- Check server logs: `docker-compose logs -f` or `pm2 logs`
- Ensure WS_HOST is set to `0.0.0.0` in production

#### 2. AI Not Responding

**Symptoms**: @ai mentions don't generate responses

**Solutions**:
- Verify DEEPSEEK_API_KEY is correct
- Check API key has sufficient credits
- Test API key: `curl https://api.deepseek.com/v1/models`
- Review server logs for AI errors
- Ensure ENABLE_AI=true

#### 3. Database Connection Errors

**Symptoms**: Messages not saving, connection refused

**Solutions**:
- Verify DATABASE_URL is correct
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Test connection: `psql -U user -h host -d database`
- Check database user permissions
- Verify network connectivity to database server

#### 4. File Upload Failures

**Symptoms**: Files don't upload, OSS errors

**Solutions**:
- Verify OSS credentials are correct
- Check OSS bucket permissions
- Ensure bucket region matches OSS_REGION
- Test OSS upload manually
- Check file size limits

#### 5. High Memory Usage

**Symptoms**: Server runs out of memory

**Solutions**:
- Reduce message cache size in server config
- Enable database pagination for history
- Configure rate limiting
- Increase server memory
- Use PM2 cluster mode for load balancing

### Debug Mode

Enable debug logging:

```bash
# Set environment variable
export DEBUG=opencode-chat:*
export NODE_ENV=development

# Or in .env
DEBUG=opencode-chat:*
NODE_ENV=development
```

### Health Check

Monitor server health:

```bash
# Check health endpoint
curl http://localhost:3002/health

# Expected response:
{
  "status": "ok",
  "uptime": 123456,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "connections": 10,
  "rooms": 3
}
```

### Performance Monitoring

Use monitoring tools:

```bash
# PM2 monitoring
pm2 monit

# Docker stats
docker stats

# System resources
htop
```

## Security Best Practices

1. **Use HTTPS in production**: Always encrypt connections
2. **Rotate API keys regularly**: Don't use the same keys forever
3. **Implement rate limiting**: Prevent abuse
4. **Use strong database passwords**: Generate random passwords
5. **Enable authentication**: Use Supabase or your own auth
6. **Keep dependencies updated**: Regularly update packages
7. **Monitor logs**: Set up log aggregation
8. **Backup regularly**: Automate database backups

## Support

For deployment help:

- Documentation: [docs.opencode.chat](https://docs.opencode.chat)
- Discord: [discord.gg/opencode](https://discord.gg/opencode)
- Issues: [GitHub Issues](https://github.com/opencode-chat/opencode-chat/issues)
- Email: deploy@opencode.chat
