# Dockerfile for Open CoChat
# Optimized for Bun runtime with direct TypeScript execution

FROM oven/bun:1.1

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r opencode && useradd -r -g opencode opencode

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies with SSL workaround
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN bun install --frozen-lockfile || \
    bun install

# Copy source code
COPY multiplayer ./multiplayer
COPY public ./public
COPY package.json ./

# Create data directory with correct permissions
RUN mkdir -p /app/data /app/logs && chown -R opencode:opencode /app

# Switch to non-root user
USER opencode

# Expose WebSocket port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

# Default environment variables
ENV NODE_ENV=production \
    WS_PORT=3002 \
    WS_HOST=0.0.0.0

# Start the application
CMD ["bun", "run", "start"]
