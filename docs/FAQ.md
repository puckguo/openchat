# Open CoChat FAQ

Frequently asked questions about Open CoChat deployment, usage, and troubleshooting.

## Table of Contents

- [General](#general)
- [Deployment](#deployment)
- [AI Features](#ai-features)
- [Security](#security)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)

## General

### What is Open CoChat?

Open CoChat is an open-source multiplayer chat platform with integrated AI capabilities. Unlike traditional chat apps, it includes an AI assistant that can read files, execute commands, and collaborate with team members in real-time.

### What makes Open CoChat different from Slack or Discord?

- **Self-hosted**: You have full control over your data
- **AI with file access**: The AI can read and analyze your project files
- **Command execution**: AI can run terminal commands and show results
- **Open source**: Free to use and modify
- **No vendor lock-in**: Deploy it anywhere you want

### Is Open CoChat free?

Yes! Open CoChat is open-source under the MIT license. You can use it for free, modify it, and even host it commercially.

### What are the system requirements?

Minimum requirements:
- CPU: 2 cores
- RAM: 4GB
- Disk: 10GB
- OS: Linux, macOS, or Windows

## Deployment

### How do I deploy Open CoChat?

The easiest way is using Docker:

```bash
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

For detailed deployment instructions, see [docs/DEPLOYMENT.md](DEPLOYMENT.md).

### Can I deploy without Docker?

Yes! You can run it directly with Bun:

```bash
bun install
bun run start
```

### Which cloud platforms are supported?

Open CoChat can be deployed on:
- AWS (EC2, ECS, Lambda)
- Google Cloud (Cloud Run, Compute Engine)
- Azure (Container Instances, AKS)
- DigitalOcean (App Platform, Droplets)
- Alibaba Cloud (ECS, ACK)
- Any VPS or bare metal server

### Do I need a database?

A PostgreSQL database is required for:
- Message persistence
- Conversation history
- User management
- Session data

Without a database, messages are stored in memory only and will be lost on restart.

### Do I need cloud storage?

Cloud storage (like Alibaba Cloud OSS) is optional. Without it:
- File uploads will be stored locally
- No automatic backups
- Limited by server disk space

## AI Features

### Which AI models are supported?

Currently, Open CoChat supports:
- **DeepSeek Chat** (default): General-purpose conversational AI
- **DeepSeek Coder**: Optimized for code-related tasks

More models will be added in future releases.

### How do I get a DeepSeek API key?

1. Visit [deepseek.com](https://www.deepseek.com/)
2. Create an account
3. Navigate to API settings
4. Generate a new API key
5. Add it to your `.env` file:
   ```
   DEEPSEEK_API_KEY=your-key-here
   ```

### What can the AI assistant do?

The AI assistant can:
- Answer questions about code and development
- Read and analyze project files
- Execute terminal commands
- Generate code snippets
- Explain complex concepts
- Summarize conversations
- Help with debugging

### How does AI file access work?

The AI has access to a secure sandbox where it can:
- List files in specified directories
- Read file contents
- Analyze code structure
- Suggest improvements

File access is restricted to configured workspace directories for security.

### Can AI write files?

Yes, AI can write files through the `write_file` tool. This is useful for:
- Generating boilerplate code
- Creating configuration files
- Writing documentation
- Saving code snippets

### How do I limit AI capabilities?

You can configure AI restrictions in `.env`:

```env
# Disable file operations
AI_ALLOW_FILE_OPERATIONS=false

# Disable command execution
AI_ALLOW_COMMANDS=false

# Limit response length
DEEPSEEK_MAX_TOKENS=1000

# Rate limiting
AI_MAX_REQUESTS_PER_MINUTE=10
```

### Is my data sent to AI services?

Yes, when you mention `@ai`, the message and relevant context are sent to DeepSeek's API. The AI does NOT have access to:
- Other sessions
- Private data not in the conversation
- System-level information

## Security

### Is Open CoChat secure?

Open CoChat includes several security features:
- Role-based access control (5 roles)
- Optional Supabase authentication
- Password-protected sessions
- Rate limiting
- Input validation
- SQL injection prevention

### Should I use authentication?

For production deployments, we strongly recommend enabling Supabase authentication:

```env
ENABLE_SUPABASE_AUTH=true
ALLOW_ANONYMOUS=false
```

### How do I secure my deployment?

1. **Use HTTPS** in production
2. **Enable authentication** via Supabase
3. **Set strong database passwords**
4. **Use firewalls** to restrict access
5. **Keep dependencies updated**
6. **Monitor logs** for suspicious activity
7. **Enable rate limiting**

### Can the AI access sensitive data?

The AI only has access to:
- Messages in the current session
- Files in configured workspace directories
- Commands you explicitly ask it to run

It cannot access:
- Other sessions
- System files
- Database credentials
- Environment variables

### How are passwords stored?

Session passwords are hashed using bcrypt before storage. Database passwords are stored only in environment variables.

## Performance

### How many concurrent users can Open CoChat handle?

The current architecture supports:
- **Development**: ~100 concurrent connections
- **Production with optimizations**: ~1,000+ concurrent connections

For higher scale, consider:
- Horizontal scaling with Redis
- Load balancing
- Database read replicas

### Why is the AI slow to respond?

AI response time depends on:
- DeepSeek API latency (typically 1-5 seconds)
- Network connection quality
- Complexity of the query
- Tool execution time (if reading files)

To improve:
- Use a closer DeepSeek API endpoint
- Reduce context size
- Enable response caching

### How do I optimize performance?

1. **Enable database indexing**:
   ```sql
   CREATE INDEX idx_messages_session ON messages(session_id);
   ```

2. **Use connection pooling**:
   ```env
   DATABASE_URL=postgresql://user:pass@host:5432/db?pool_max=20
   ```

3. **Enable Redis caching** (for distributed deployments)

4. **Use CDN for static assets**

5. **Implement rate limiting**

### How much bandwidth does Open CoChat use?

Approximate usage:
- **Text messages**: ~1KB per message
- **File uploads**: File size + 10% overhead
- **WebSocket keepalive**: ~100 bytes per second per connection

## Troubleshooting

### AI is not responding

**Possible causes:**
1. Invalid or missing API key
2. API key out of credits
3. Network connectivity issues
4. AI service disabled

**Solutions:**
```bash
# Check API key
echo $DEEPSEEK_API_KEY

# Test API connection
curl https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY"

# Check if AI is enabled
grep ENABLE_AI .env
```

### Messages are not being saved

**Possible causes:**
1. Database connection issues
2. Incorrect DATABASE_URL
3. Database not running

**Solutions:**
```bash
# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# Verify database is running
docker-compose ps postgres

# Check database logs
docker-compose logs postgres
```

### File uploads are failing

**Possible causes:**
1. OSS credentials incorrect
2. File size exceeds limit
3. Unsupported file type
4. Network issues

**Solutions:**
```bash
# Check OSS configuration
grep VITE_OSS .env

# Test OSS upload manually
# (See Alibaba Cloud OSS documentation)

# Check file size limit
grep MAX_FILE_SIZE .env
```

### WebSocket connection keeps dropping

**Possible causes:**
1. Nginx timeout settings too low
2. Network instability
3. Server resources exhausted

**Solutions:**
```nginx
# In nginx.conf
proxy_read_timeout 86400;
proxy_send_timeout 86400;
```

```bash
# Check server resources
htop
df -h
```

### High memory usage

**Possible causes:**
1. Too many cached messages
2. Memory leak
3. Insufficient resources

**Solutions:**
```bash
# Restart server
docker-compose restart

# Check memory usage
docker stats

# Clear old messages
# (Implement message retention policy)
```

### How do I enable debug logging?

```bash
# Set environment variable
export DEBUG=opencode-chat:*

# Or in .env
DEBUG=opencode-chat:*
NODE_ENV=development
```

### How do I check server health?

```bash
# Health endpoint
curl http://localhost:3002/health

# Expected response
{
  "status": "ok",
  "uptime": 123456,
  "connections": 10,
  "sessions": 3
}
```

## Getting Help

### Where can I get support?

- **Documentation**: [docs.opencode.chat](https://docs.opencode.chat)
- **Discord**: [discord.gg/opencode](https://discord.gg/opencode)
- **GitHub Issues**: [Report a bug](https://github.com/opencode-chat/opencode-chat/issues)
- **Email**: support@opencode.chat

### How do I report a bug?

1. Check existing issues first
2. Use the bug report template in `.github/ISSUE_TEMPLATE/bug_report.md`
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details
   - Logs (if applicable)

### How do I request a feature?

1. Check existing feature requests
2. Use the feature request template in `.github/ISSUE_TEMPLATE/feature_request.md`
3. Describe:
   - The problem you're trying to solve
   - Proposed solution
   - Alternative approaches considered

### How do I contribute?

Please see [docs/CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

For more information, visit [opencode.chat](https://opencode.chat)
