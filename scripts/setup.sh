#!/bin/bash
# OpenCode Chat Setup Script
# This script installs dependencies and configures the environment

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}OpenCode Chat Setup${NC}"
echo "=============================="
echo ""

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${YELLOW}Bun is not installed. Installing Bun...${NC}"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    echo -e "${GREEN}Bun installed successfully${NC}"
else
    echo -e "${GREEN}Bun is already installed: $(bun --version)${NC}"
fi

# Check if Node.js is installed (alternative)
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js is not installed. Please install Node.js >= 18${NC}"
fi

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}PostgreSQL is not installed.${NC}"
    echo "Please install PostgreSQL >= 14:"
    echo "  Ubuntu/Debian: sudo apt-get install postgresql"
    echo "  macOS: brew install postgresql@14"
    echo "  Windows: https://www.postgresql.org/download/windows/"
else
    echo -e "${GREEN}PostgreSQL is installed: $(psql --version)${NC}"
fi

# Install dependencies
echo ""
echo -e "${GREEN}Installing dependencies...${NC}"
bun install

# Create environment file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo -e "${YELLOW}Creating .env file from template...${NC}"
    cp .env.example .env
    echo -e "${GREEN}Created .env file${NC}"
    echo -e "${YELLOW}Please edit .env with your configuration${NC}"
    echo "Required variables:"
    echo "  - DEEPSEEK_API_KEY"
    echo "  - DATABASE_URL"
else
    echo -e "${GREEN}.env file already exists${NC}"
fi

# Create data directory
echo ""
echo -e "${GREEN}Creating data directories...${NC}"
mkdir -p data/logs

# Check for Docker
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo ""
    echo -e "${GREEN}Docker and Docker Compose are installed${NC}"
    echo "You can use: docker-compose up -d"
fi

echo ""
echo -e "${GREEN}Setup completed!${NC}"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your configuration"
echo "  2. Run database migrations: bun run db:migrate (if needed)"
echo "  3. Start the server: ./scripts/start.sh or bun run start"
echo ""
echo "For more information, see docs/DEPLOYMENT.md"
