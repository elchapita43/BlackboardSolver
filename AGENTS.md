# AGENTS.md - BlackboardSolver

## Project Overview

TypeScript/Node.js application that syncs pending tasks from Blackboard Palermo. Uses Express for the API, better-sqlite3 for local storage, and Playwright for e2e testing and Chrome automation.

## Build / Lint / Test Commands

```bash
# Install dependencies
npm install

# Development (runs with tsx, watches for changes)
npm run dev

# Build (compiles TypeScript to dist/)
npm run build

# Type check only (no emit)
npm run typecheck

# Start production server (requires prior build)
npm start

# Run all e2e tests
npm run test:e2e

# Run all e2e tests with UI (interactive)
npm run test:e2e:ui

# Run e2e tests in debug mode (with Playwright inspector)
npm run test:e2e:debug

# Run a single test file
npx playwright test tests/e2e/api.spec.ts

# Run a single test by name (grep pattern)
npx playwright test -g "debería devolver 200"

# Run tests in a specific project (chromium is default)
npx playwright test --project=chromium

# Install Playwright browsers (required before first run)
npx playwright install chromium
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3010` |
| `BASE_URL` | Test base URL | `http://127.0.0.1:3010` |
| `BLACKBOARD_CHROME_PROFILE` | Chrome profile name to use | Last active profile |
| `BLACKBOARD_USERNAME` | Login username (alternative to credentials.json) | - |
| `BLACKBOARD_PASSWORD` | Login password (alternative to credentials.json) | - |
| `BLACKBOARD_LOGIN_STRATEGY` | Login strategy: `auto`, `blackboard`, or `myup` | `auto` |
| `OPENROUTER_API_KEY` | API key for chat feature | - |
| `OPENROUTER_MODEL` | OpenRouter model to use | `qwen/qwen3.6-plus-preview:free` |

---

## Code Style Guidelines

### General

- **Language**: TypeScript with strict mode enabled
- **Module system**: NodeNext (ESM with .ts extension)
- **Target**: ES2022
- **No semicolons** at statement ends
- **No ESLint/Prettier** configuration - follow existing patterns

### Imports

Use explicit `node:` prefix for Node.js built-in modules:

```typescript
// Correct
import path from "node:path";
import fs from "node:fs/promises";
import express from "express";

// Avoid
import path from "path";
import fs from "fs/promises";
```

Import ordering (grouped, no blank lines within groups):

1. Node.js built-ins (`node:*`)
2. External packages
3. Relative imports (`./` and `../`)

```typescript
import path from "node:path";
import express from "express";
import { BlackboardDatabase } from "./database";
import type { PendingTask } from "./types";
```

Use `import type` for type-only imports to improve tree-shaking.

### Types

- Always use explicit type annotations on function parameters and return types
- Use interfaces for object shapes that are stored or passed between modules
- Use type aliases for unions, intersections, and utility types
- Enable `noUncheckedIndexedAccess` in TypeScript config - access array indices carefully

```typescript
// Interface for external/stored data structures
export interface PendingTask {
  id: string;
  title: string;
  course?: string;
  status: TaskStatus;
}

// Type alias for unions
export type TaskStatus = "pending" | "upcoming" | "overdue" | "unknown";

// Explicit return types on functions
async function fetchTaskDetail(input: { taskId: string }): Promise<TaskDetail> {
  // ...
}
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `BlackboardDatabase`, `SyncService` |
| Interfaces | PascalCase | `PendingTask`, `TaskRecord` |
| Type aliases | PascalCase | `TaskStatus`, `ChatMessage` |
| Functions | camelCase | `syncPendingTasks`, `fetchTaskDetail` |
| Variables | camelCase | `storedSnapshot`, `collectedTasks` |
| Constants (module-level) | UPPER_SNAKE_CASE | `LOGIN_URL`, `CANDIDATE_PAGES` |
| Private fields | `private readonly` | `private readonly database` |

```typescript
const LOGIN_URL = "https://palermo.blackboard.com/";
const CANDIDATE_PAGES = [{ label: "Ultra Home", url: "..." }];

export class SyncService {
  private currentRun: Promise<StoredSnapshot> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly store: SnapshotStore
  ) {}
}
```

### Error Handling

Use consistent error formatting and always check error types:

```typescript
// Format error to string safely
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// In API routes - return user-friendly messages
app.post("/api/tasks/sync", async (_request, response) => {
  try {
    const snapshot = await syncService.sync();
    response.json({ ok: true, snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({ ok: false, error: message });
  }
});

// Silent catches should have comments explaining why
try {
  await fs.writeFile(htmlPath, await page.content(), "utf8");
} catch {
  // Debug artifact only - don't fail the operation
}
```

### API Response Patterns

All API responses follow this structure:

```typescript
// Success
response.json({ ok: true, ...data });

// Error
response.status(STATUS_CODE).json({ ok: false, error: "Human-readable message" });
```

### Async/Await

- Always use `async/await` over raw Promises
- Use `try/finally` to ensure cleanup (e.g., closing browser contexts)
- Avoid `await` in loops when parallel execution is possible

```typescript
// Good: try/finally ensures cleanup
try {
  const { context } = await launchUserChrome(dataDir);
  const page = context.pages()[0];
  // ... work
} finally {
  await context.close();
}

// Good: run operations in parallel when possible
await Promise.all([
  fs.writeFile(htmlPath, await page.content()),
  page.screenshot({ path: screenshotPath })
]);
```

### Database (SQLite)

- Use prepared statements with named parameters for all queries
- Use transactions for batch operations
- Store dates as ISO 8601 strings
- Map database rows to interface types via private mapper methods

```typescript
upsertTasks(tasks: PendingTask[], syncedAt: string): void {
  const statement = this.database.prepare(`
    INSERT INTO tasks (...) VALUES (@id, @title, ...)
    ON CONFLICT(id) DO UPDATE SET ...
  `);

  const transaction = this.database.transaction((items) => {
    for (const task of items) {
      statement.run({ id: task.id, title: task.title, ... });
    }
  });

  transaction(tasks);
}
```

### Testing Guidelines

- Tests use Spanish descriptions (`debería devolver 200...`)
- Use `test.describe.configure({ mode: "serial" })` for tests that modify shared state
- Use fixtures for reusable test setup
- Always call `response.json()` even on error responses to get the body
- For long-running operations (sync), use extended timeouts: `{ timeout: 300000 }`

```typescript
test.describe("GET /api/tasks", () => {
  test("debería devolver 200 con estructura válida", async ({ request }) => {
    const response = await request.get("/api/tasks");
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty("ok", true);
    expect(body).toHaveProperty("snapshot");
  });
});
```

---

## Architecture Notes

- **src/index.ts** - Express app setup and route registration
- **src/database.ts** - SQLite operations via better-sqlite3
- **src/sync-service.ts** - Orchestrates sync operations, deduplicates concurrent requests
- **src/task-assistant-service.ts** - Chat feature with OpenRouter API
- **src/snapshot-store.ts** - Persists sync results to JSON
- **src/blackboard/scraper.ts** - Playwright-based Chrome automation
- **tests/e2e/** - Playwright e2e tests

### Key Configuration Files

- `tsconfig.json` - Strict TypeScript with NodeNext module resolution
- `playwright.config.ts` - E2e test configuration (chromium only, parallel by default)
- `.env.example` - Example environment variables

### Data Storage

- `.data/blackboard.db` - SQLite database
- `.data/latest-tasks.json` - Last sync result
- `.data/debug/*.html` - Debug HTML snapshots
- `.data/debug/*.png` - Debug screenshots
- `.data/chrome-automation-runs/` - Temporary Chrome profile copies
