#!/bin/bash
# OpenCode Chat Start Script
# This script starts the OpenCode Chat server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Default port
WS_PORT=${WS_PORT:-3002}
NODE_ENV=${NODE_ENV:-production}

echo -e "${GREEN}Starting OpenCode Chat...${NC}"
echo "=============================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please run: ./scripts/setup.sh"
    echo "Or copy .env.example to .env and configure it"
    exit 1
fi

# Check required environment variables
if [ -z "$DEEPSEEK_API_KEY" ]; then
    echo -e "${YELLOW}Warning: DEEPSEEK_API_KEY not set${NC}"
    echo "AI features will not work without this key"
fi

if [ -z "$DATABASE_URL" ]; then
    echo -e "${YELLOW}Warning: DATABASE_URL not set${NC}"
    echo "Messages will not be persisted"
fi

# Display configuration
echo "Configuration:"
echo "  Environment: $NODE_ENV"
echo "  WebSocket Port: $WS_PORT"
echo "  AI Enabled: ${ENABLE_AI:-false}"
echo "  Database: ${ENABLE_DATABASE:-false}"
echo ""

# Create logs directory
mkdir -p data/logs

# Start the server
echo -e "${GREEN}Starting server...${NC}"
echo ""

if [ "$NODE_ENV" = "development" ]; then
    # Development mode with hot reload
    bun run --watch multiplayer/websocket-server.ts
else
    # Production mode
    bun run start
fi
