# CLAUDE.md - Monday.com Workspace Migration Tool

## Project Context

This is a Google Apps Script (GAS) web application that migrates entire Monday.com workspaces — boards, items, groups, folders, documents, and user assignments — within the same account or across different Monday.com accounts. It uses a React 18 + Bootstrap 5 frontend with Babel Standalone (zero-build JSX), communicating with GAS server functions via the `google.script.run` promise wrapper pattern.

See `ARCHITECTURE.md` for detailed system diagrams, migration flow, and known issues.

## Technology Stack

- **Backend**: Google Apps Script V8 Runtime
- **Frontend**: React 18.2.0, Bootstrap 5.3.0, Bootstrap Icons 1.10.0
- **Build**: Zero-build — Babel Standalone transpiles JSX in the browser
- **API**: Monday.com GraphQL API v2025-07
- **Storage**: Google Sheets (migration logs), Google Drive (document backups), CacheService + PropertiesService (state persistence)
- **Advanced Services**: Drive API v2 (enabled in manifest)

## File Organization

```
├── Code.gs                        # Web app entry point, CONFIG, API key management
├── MigrationService.gs            # Core migration logic — board routing, item migration
├── BatchMigrationProcessor.gs     # Phase-based execution engine, trigger chaining
├── MondayAPI.gs                   # Monday.com GraphQL API wrapper (all API calls)
├── InventoryService.gs            # Account/workspace scanning
├── ValidationService.gs           # Post-migration source vs target comparison
├── DocumentMigrationService.gs    # Doc export/import with Google Drive backup
├── UserMigrationService.gs        # Post-migration user/guest assignment
├── PdfReportService.gs            # PDF report generation via Google Docs
├── index.html                     # HTML container — loads CDN libs, injects server data
├── app.html                       # Full React SPA (all tabs, components, state)
├── styles.html                    # CSS with dark mode support
├── appsscript.json                # GAS manifest (scopes, timezone, advanced services)
└── ARCHITECTURE.md                # Architecture & design guide
```

## Critical GAS Constraints

### 6-Minute Execution Limit
GAS kills any execution after 6 minutes. The migration uses **phase-based batch execution** (INIT → BOARDS → DOCUMENTS → FINALIZE), each phase running as a separate execution chained via `ScriptApp.newTrigger().timeBased().after(5000)`. See `BatchMigrationProcessor.gs`.

- `MAX_EXECUTION_MS: 330000` (5.5 min) — yields before the 6-min wall
- `MAX_BOARDS_PER_EXECUTION: 20` — prevents OOM from cumulative memory

### State Persistence (Dual-Store Pattern)
All migration state uses **dual-store** for reliability:
- **CacheService** (fast, 100KB/value limit, 6hr TTL) — primary read path
- **PropertiesService** (durable, 9KB/value limit) — fallback/persistence

Large board mappings are split into 50KB chunks: `migBoardMap_<id>_0`, `migBoardMap_<id>_1`, etc.

### Cache Size Limit
CacheService values max at 100KB. Always check size before caching:
```javascript
if (json.length < 90000) {
  cache.put(key, json, ttl);
}
```

### Date Serialization
**ALWAYS** convert Date objects to strings before returning to the client. `google.script.run` cannot serialize Date objects.
```javascript
return JSON.parse(JSON.stringify(data)); // safeReturn() pattern
```

## Configuration & Secrets

Script Properties (set via `setupScriptProperties()` or GAS UI):

| Key | Purpose |
|-----|---------|
| `MONDAY_API_KEY` | Source Monday.com API key |
| `MONDAY_MIGRATION_API_KEY` | Target Monday.com API key (cross-account) |
| `MIGRATION_SPREADSHEET_ID` | Google Sheet ID for migration logs |

`DocumentMigrationService.gs` has a hardcoded `DRIVE_BACKUP_FOLDER_ID` for Google Drive document backups.

**WARNING**: `Code.gs:setupScriptProperties()` contains hardcoded API keys. Do not commit real keys. Move to environment-specific setup.

## Key Coding Patterns

### Server Entry Point
```javascript
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  template.configData = JSON.stringify({...});
  return template.evaluate()
    .setTitle(CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

### Client-Server Communication
All client calls use the `callGoogleScript()` promise wrapper:
```javascript
const callGoogleScript = (functionName, ...args) => {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      [functionName](...args);
  });
};
```

### Server Return Convention
All public server functions return `{ success: true, data: ... }` or `{ success: false, error: '...' }`, wrapped through `safeReturn()` (defined in `Code.gs:686`).

### Monday.com API Calls
All GraphQL calls go through `callMondayAPI()` / `callMondayAPIWithKey()` in `MondayAPI.gs`. Cross-account mutations use the target API key. The API uses `v2025-07` versioning.

```javascript
// Same-account (source)
callMondayAPI(query, variables);

// Cross-account (target)
callMondayAPIWithKey(targetApiKey, query, variables);
```

### Retry with Exponential Backoff
API calls use retry logic. Follow the existing pattern when adding new API calls.

### LockService for Concurrency
Use `LockService.getScriptLock()` when modifying shared state (sheets, properties) to prevent race conditions.

## Board Migration Routes

Three strategies for creating boards in the target workspace (see `MigrationService.gs:migrateBoard()`):

1. **Route 1 — Managed Template** (`use_template` mutation): Creates a board linked to a managed template. Requires the board's `created_from_board_id` which is currently **unavailable via the API** (see Known Issues).

2. **Route 2 — Template Clone** (`duplicate_board` mutation): Duplicates a board to the target workspace. Preserves views, automations, formulas. **This is the default and recommended path.**

3. **Route 3 — Manual** (`create_board` + column creation): Creates an empty board and adds columns one by one. Used as fallback when duplication fails.

## Migration Components

Defined in `MIGRATION_COMPONENTS` (top of `MigrationService.gs`):

| Component | Mandatory | Default | Notes |
|-----------|-----------|---------|-------|
| boards, columns, items | Yes | On | Always migrated |
| groups | No | On | Board groups/sections |
| folders | No | On | Directory hierarchy |
| useTemplates | No | On | Route 2 — `duplicate_board` |
| useManagedTemplates | No | **Off** | Route 1 — `use_template` (broken) |
| managedColumns | No | On | Account-level managed column links |
| documents | No | On | Markdown export + Drive backup |

## Known Issues

1. **Managed template detection is broken**: The `created_from_board_id` field is not available in the Monday.com API. Fingerprint-based fallback detects template *groups* but produces regular board IDs, not template IDs, so `use_template` cannot work. The guard at `MigrationService.gs:1714` intentionally blocks fingerprint-based IDs from Route 1.

2. **Hardcoded secrets**: `Code.gs:setupScriptProperties()` contains hardcoded API keys and spreadsheet IDs.

3. **`DRIVE_BACKUP_FOLDER_ID` is hardcoded** in `DocumentMigrationService.gs`.

See `ARCHITECTURE.md` Section "Outstanding Issues" for the full list.

## Development Workflow

### Local Development
This is a GAS project — there is no local runtime. Development options:
- **clasp** (`@google/clasp`): Push/pull `.gs` and `.html` files to/from GAS
- **GAS Web Editor**: Edit directly at script.google.com

### Deployment
1. Set Script Properties (`MONDAY_API_KEY`, `MONDAY_MIGRATION_API_KEY`, `MIGRATION_SPREADSHEET_ID`)
2. Deploy as web app: Deploy → New Deployment → Web app
3. Execute as: User accessing the web app
4. Access: Anyone in your organization (or specific users)

### Testing
- Use the **Inventory** tab to scan workspaces without making changes
- Use the **Test Run** tab for dry-run migration analysis
- Use the **Validation** tab to compare source vs target post-migration
- Run `setupScriptProperties()` once to initialize Script Properties

### OAuth Scopes (from `appsscript.json`)
- `spreadsheets` — migration logging
- `drive` — document backup
- `script.container.ui` — web app serving
- `script.external_request` — Monday.com API calls
- `script.scriptapp` — trigger chaining for batch execution

## Style & Conventions

- **No module system**: GAS has no `import`/`export`. All `.gs` files share a single global scope. Avoid name collisions.
- **`var` not `const`/`let` at top level**: GAS V8 supports `const`/`let` but they behave differently at top level in multi-file projects. Use `var` for globals, `const`/`let` inside functions.
- **Function naming**: Public functions callable from client use camelCase with no prefix. Internal helpers use `_underscore` prefix.
- **HTML partials**: Use `<?!= include('filename') ?>` to compose HTML files. The `include()` function is in `Code.gs`.
- **React in HTML**: All React code lives in `app.html` inside a `<script type="text/babel">` tag. Babel Standalone transpiles it at load time.
- **Error returns**: Always return `{ success: true/false, ... }` from server functions. Never throw errors that would reach the client unhandled.
- **JSON safety**: Always pass data through `safeReturn()` before returning to the client to strip non-serializable types.
