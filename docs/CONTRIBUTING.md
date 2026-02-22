# Contributing to Open CoChat

Thank you for your interest in contributing to Open CoChat! We welcome contributions from everyone, regardless of experience level.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Documentation](#documentation)

## Code of Conduct

Please be respectful and constructive in all interactions. We're committed to providing a welcoming and inclusive environment for everyone.

## Getting Started

### Prerequisites

- Bun >= 1.0.0 (or Node.js >= 18)
- Git
- A GitHub account
- Basic knowledge of TypeScript

### Setting Up Your Development Environment

#### 1. Fork the Repository

Click the "Fork" button in the top-right corner of the repository page.

#### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR_USERNAME/opencode-chat.git
cd opencode-chat
```

#### 3. Install Dependencies

```bash
bun install
```

#### 4. Create a Development Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions/changes
- `chore/` - Maintenance tasks

#### 5. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your development settings.

## Development Workflow

### Making Changes

1. Write code following our [Coding Standards](#coding-standards)
2. Add tests for new functionality
3. Ensure all tests pass: `bun test`
4. Run linter: `bun run lint`
5. Format code: `bun run format`

### Committing Changes

Follow conventional commit format:

```
type(scope): subject

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Maintenance tasks

Examples:
```
feat(ai): add support for custom AI models

fix(websocket): handle connection timeout gracefully

docs(readme): update installation instructions

test(auth): add tests for Supabase authentication
```

### Syncing with Upstream

Keep your fork up-to-date:

```bash
# Add upstream remote
git remote add upstream https://github.com/opencode-chat/opencode-chat.git

# Fetch upstream changes
git fetch upstream

# Merge upstream changes
git checkout main
git merge upstream/main

# Push to your fork
git push origin main
```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Enable strict type checking
- Avoid `any` types when possible
- Use interfaces for object shapes
- Provide meaningful type names

```typescript
// Good
interface UserMessage {
  id: string
  content: string
  timestamp: Date
}

async function sendMessage(message: UserMessage): Promise<void> {
  // ...
}

// Avoid
async function sendMessage(message: any): Promise<any> {
  // ...
}
```

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Add semicolons
- Use trailing commas in multi-line arrays/objects
- Maximum line length: 100 characters

```typescript
// Good
const config = {
  port: 3002,
  host: 'localhost',
  features: [
    'websocket',
    'ai',
  ],
}

// Avoid
const config={port:3002,host:"localhost",features:["websocket","ai"]}
```

### Naming Conventions

- **Variables/Functions**: camelCase
- **Classes/Interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Private properties**: prefix with `_`

```typescript
const MAX_CONNECTIONS = 100;

class WebSocketServer {
  private _clients: Map<string, Client> = new Map();

  connect(clientId: string): void {
    // ...
  }
}
```

### Error Handling

Always handle errors properly:

```typescript
// Good
async function fetchUserData(userId: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${userId}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Unable to fetch user data');
  }
}

// Avoid
async function fetchUserData(userId: string) {
  const response = await fetch(`/api/users/${userId}`);
  return await response.json();
}
```

### Comments

- Use JSDoc for function documentation
- Comment complex logic
- Keep comments up-to-date
- Avoid obvious comments

```typescript
/**
 * Establishes a WebSocket connection with reconnection logic
 * @param url - WebSocket server URL
 * @param options - Connection configuration
 * @returns Promise<WebSocket> - Connected WebSocket instance
 */
async function connectWebSocket(
  url: string,
  options: ConnectionOptions
): Promise<WebSocket> {
  // Implementation here...
}
```

## Testing Guidelines

### Writing Tests

- Write tests for all new features
- Aim for high code coverage (>80%)
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

```typescript
describe('WebSocket Server', () => {
  it('should handle client connection', async () => {
    // Arrange
    const server = new WebSocketServer({ port: 3002 });
    const client = new WebSocket('ws://localhost:3002');

    // Act
    await new Promise(resolve => client.on('open', resolve));

    // Assert
    expect(server.getConnectionCount()).toBe(1);
  });
});
```

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/websocket.test.ts

# Run tests with coverage
bun test --coverage

# Watch mode
bun test --watch
```

### Test Structure

Organize tests to mirror source structure:

```
tests/
├── unit/           # Unit tests
│   ├── ai.test.ts
│   └── websocket.test.ts
├── integration/    # Integration tests
│   └── api.test.ts
└── e2e/           # End-to-end tests
    └── chat-flow.test.ts
```

## Pull Request Process

### Before Submitting

1. **Review your changes**
   ```bash
   git diff main
   ```

2. **Ensure tests pass**
   ```bash
   bun test
   bun run lint
   ```

3. **Update documentation**
   - Update README if needed
   - Add comments to complex code
   - Update API documentation

4. **Write a good commit message**
   ```bash
   git commit -m "feat(feature-name): description of changes"
   ```

### Submitting a Pull Request

1. Push your changes to your fork
   ```bash
   git push origin feature/your-feature-name
   ```

2. Create a pull request on GitHub
   - Go to the repository on GitHub
   - Click "New Pull Request"
   - Select your branch
   - Fill in the PR template

3. PR title should follow commit format
   - `feat: Add support for custom AI models`
   - `fix: Resolve WebSocket connection timeout`

4. Provide a clear description of changes
   - What was changed
   - Why the change was made
   - How it was tested
   - Screenshots (if applicable)

### PR Review Process

1. **Automatic Checks**
   - CI tests must pass
   - Code coverage must not decrease
   - Linter checks must pass

2. **Code Review**
   - Maintainers will review your PR
   - Address review comments
   - Make requested changes

3. **Approval**
   - At least one maintainer approval required
   - All CI checks must pass
   - No merge conflicts

4. **Merge**
   - Maintainers will squash and merge
   - Your commit will be credited to you

## Documentation

### Code Documentation

- Use JSDoc for public APIs
- Document complex algorithms
- Keep documentation in sync with code

### README Documentation

Update README.md when:
- Adding new features
- Changing configuration
- Updating installation steps
- Modifying examples

### API Documentation

Document API endpoints:
```typescript
/**
 * POST /api/messages
 * Send a message to a chat session
 *
 * @param sessionId - The session identifier
 * @param content - Message content
 * @returns Created message object
 *
 * @example
 * const response = await fetch('/api/messages', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     sessionId: 'abc123',
 *     content: 'Hello!'
 *   })
 * });
 */
```

## Development Tools

### Recommended VS Code Extensions

- ESLint
- Prettier
- TypeScript Vue Plugin
- Error Lens
- GitLens
- Thunder Client (for API testing)

### Useful Commands

```bash
# Format code
bun run format

# Check types
bun run type-check

# Run linter
bun run lint

# Fix linting issues
bun run lint:fix

# Build for production
bun run build

# Start dev server
bun run dev

# Run production server
bun run start
```

## Getting Help

- Ask questions in GitHub Discussions
- Join our Discord: [discord.gg/opencode](https://discord.gg/opencode)
- Check existing issues for similar problems
- Read the documentation

## Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Credited in release notes
- Invited to become maintainers (for consistent contributors)

Thank you for contributing to Open CoChat!
