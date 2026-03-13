# Monday.com Workspace Migration Tool - Architecture & Design Guide

## Overview

The Monday.com Workspace Migration Tool is a Google Apps Script (GAS) web application that migrates entire Monday.com workspaces — boards, items, files, documents, folders, and user assignments — within the same account or across different Monday.com accounts. It uses a React 18 + Bootstrap 5 frontend with Babel Standalone for zero-build JSX, communicating with GAS server functions via the `google.script.run` promise wrapper pattern.

## System Architecture

```
                              ┌──────────────────────────────────────┐
                              │         CLIENT (Browser)             │
                              │  React 18 SPA + Bootstrap 5          │
                              │  ┌────────────┐  ┌───────────────┐  │
                              │  │  Tabs:      │  │ Progress      │  │
                              │  │  Inventory  │  │ Modal &       │  │
                              │  │  Test Run   │  │ Adaptive      │  │
                              │  │  Migration  │  │ Polling       │  │
                              │  │  Validation │  │               │  │
                              │  │  Users      │  │ Toast         │  │
                              │  │  Templates  │  │ Notifications │  │
                              │  └────────────┘  └───────────────┘  │
                              └──────────────┬───────────────────────┘
                                             │ google.script.run
                              ┌──────────────▼───────────────────────┐
                              │         SERVER (GAS V8 Runtime)      │
                              │                                      │
                              │  Code.gs ─── Web app entry, config   │
                              │  MigrationService.gs ── Core logic   │
                              │  BatchMigrationProcessor.gs ── Phase │
                              │    orchestration & trigger chaining  │
                              │  MondayAPI.gs ── GraphQL API wrapper │
                              │  InventoryService.gs ── Account scan │
                              │  ValidationService.gs ── Post-check  │
                              │  DocumentMigrationService.gs ── Docs │
                              │  UserMigrationService.gs ── Users    │
                              │  PdfReportService.gs ── PDF reports  │
                              └──────────┬────────────┬──────────────┘
                                         │            │
                              ┌──────────▼──┐  ┌──────▼───────────┐
                              │ Monday.com  │  │ Google Services  │
                              │ GraphQL API │  │ - Sheets (log)   │
                              │ v2025-07    │  │ - Drive (backup) │
                              │             │  │ - Cache/Props    │
                              └─────────────┘  └──────────────────┘
```

## File Inventory

### Server-Side (.gs files)

| File | Purpose | Key Functions |
|------|---------|---------------|
| `Code.gs` | Web app entry point, configuration, API key management, setup helpers | `doGet()`, `getTargetAccounts()`, `setupScriptProperties()`, `detectWorkspaceTemplates()` |
| `MigrationService.gs` | Core migration logic — board routing, item migration, template detection | `migrateBoard()`, `migrateBoardViaTemplate()`, `migrateBoardFromManagedTemplate()`, `migrateBoardManual()`, `detectManagedTemplatesForBoards()` |
| `BatchMigrationProcessor.gs` | Phase-based execution engine that chains GAS triggers to avoid the 6-minute limit | `_executeMigrationBatched()`, `_phaseInit()`, `_phaseBoards()`, `_phaseDocuments()`, `_phaseFinalize()`, `continueMigrationBatch()` |
| `MondayAPI.gs` | Low-level Monday.com GraphQL API wrapper — all API calls flow through here | `callMondayAPI()`, `callMondayAPIWithKey()`, `getBoardsInWorkspace()`, `useTemplateOnTarget()`, `_tryGetCreatedFromBoardIds()` |
| `InventoryService.gs` | Account-level inventory scan — workspaces, boards, users, items | `getAccountInventory()`, `getWorkspaceInventory()` |
| `ValidationService.gs` | Post-migration comparison of source vs target workspaces | `validateMigration()`, `compareWorkspaces()` |
| `DocumentMigrationService.gs` | Export docs as markdown, backup to Google Drive, recreate in target | `migrateDocuments()`, `analyzeDocumentsForMigration()` |
| `UserMigrationService.gs` | Post-migration user/guest assignment to boards | `scanUserMigration()`, `executeUserMigration()` |
| `PdfReportService.gs` | PDF report generation via Google Docs export | `generateValidationPdf()` |

### Client-Side (.html files)

| File | Purpose |
|------|---------|
| `index.html` | Main HTML container — loads React, Bootstrap, Babel, injects server data via template variables |
| `app.html` | Full React SPA — all tabs, components, state management, `callGoogleScript()` wrapper |
| `styles.html` | CSS styles including dark mode support via CSS variables |

## Migration Flow

### Phase-Based Execution Model

The migration is broken into phases to work within the GAS 6-minute execution limit. Each phase runs as a separate GAS execution, chained via time-based triggers.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     MIGRATION LIFECYCLE                             │
│                                                                     │
│  UI calls runMigration()                                           │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────┐   trigger    ┌──────────┐   trigger   ┌───────────┐  │
│  │  INIT   │ ──────────▶  │  BOARDS  │ ─────────▶  │ DOCUMENTS │  │
│  │         │              │  (yield  │              │           │  │
│  │ Create  │              │  every   │              │ Export MD │  │
│  │ target  │              │  20 brds │              │ Drive bk  │  │
│  │ ws      │              │  or 5.5  │              │ Recreate  │  │
│  │ Scan    │              │  min)    │              │           │  │
│  │ boards  │              │          │              │           │  │
│  │ Create  │              │          │              │           │  │
│  │ folders │              │          │              │           │  │
│  │ Detect  │              │          │              │           │  │
│  │ tpls    │              │          │              │           │  │
│  └─────────┘              └──────────┘              └─────┬─────┘  │
│                                                           │        │
│                                                    trigger│        │
│                                                           ▼        │
│                                                     ┌──────────┐   │
│                                                     │ FINALIZE │   │
│                                                     │          │   │
│                                                     │ Save map │   │
│                                                     │ Log to   │   │
│                                                     │ Sheets   │   │
│                                                     │ 100%     │   │
│                                                     └──────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Phase Details

**INIT Phase** (`_phaseInit`):
1. Fetch source workspace metadata
2. Create target workspace via API
3. Scan source boards, filter out subitem boards
4. Apply user-selected board filter (if provided)
5. Recreate folder hierarchy in target workspace
6. Detect managed templates (if enabled) via `detectManagedTemplatesForBoards()`
7. Save state and schedule BOARDS phase

**BOARDS Phase** (`_phaseBoards`):
1. Process boards sequentially, one at a time
2. For each board, re-fetch full structure (columns, groups) to keep state small
3. Route to appropriate migration method (see Board Migration Routing below)
4. Migrate items with column value mapping, subitems, and file attachments
5. Move board to correct folder in target workspace
6. Yield after 20 boards OR 5.5 minutes elapsed — schedule continuation trigger
7. Retry failed boards up to 2 times with exponential backoff

**DOCUMENTS Phase** (`_phaseDocuments`):
1. Export each doc from source workspace as markdown
2. Save markdown files to Google Drive as backup
3. Create new docs in target workspace
4. Import markdown content

**FINALIZE Phase** (`_phaseFinalize`):
1. Save board mapping to spreadsheet
2. Log migration summary
3. Update progress to 100%
4. Clean up batch state

### State Management

Migration state is persisted in a dual-store pattern:

```
┌─────────────────────────────────────────────────┐
│              STATE STORAGE                       │
│                                                  │
│  ScriptProperties (durable, 9KB/value limit)    │
│    migBatch_<id> → lean state (no boardMapping) │
│    MIG_TRIGGER_<triggerId> → migrationId        │
│                                                  │
│  ScriptCache (fast, 100KB/value, 6hr TTL)       │
│    migBatch_<id> → lean state                   │
│    migBoardMap_<id>_chunks → chunk count        │
│    migBoardMap_<id>_0..N → chunked JSON         │
│                                                  │
│  mig_<id> → UI progress (read by polling)       │
│    Both stores for reliability                   │
└─────────────────────────────────────────────────┘
```

Board mapping is stored separately in chunked cache because it can grow large with 100+ boards. Each chunk is 50KB (CacheService limit is 100KB per value). A Properties fallback stores the mapping if it fits under 9KB.

## Board Migration Routing

The `migrateBoard()` function routes each board through one of three strategies:

```
                    migrateBoard()
                         │
                         ▼
              ┌─────────────────────┐
              │ useManagedTemplates │
              │ AND templateMapping │──── YES ──▶ Route 1: use_template
              │ AND NOT fingerprint │            (managed template)
              └─────────┬──────────┘
                        │ NO
                        ▼
              ┌─────────────────────┐
              │  useTemplates AND   │──── YES ──▶ Route 2: duplicate_board
              │  same-account       │            (template clone)
              └─────────┬──────────┘
                        │ NO
                        ▼
                  Route 3: Manual
                  (create_board + columns)
```

### Route 1: Managed Template (`migrateBoardFromManagedTemplate`)
- Calls `use_template` mutation to create a board linked to a template
- The new board maintains a live connection to the template
- Template changes propagate to all instances
- Async operation — polls for board creation completion
- Only items/files/forms need migration (structure comes from template)

### Route 2: Template Clone (`migrateBoardViaTemplate`)
- Calls `duplicate_board` with `duplicate_board_with_structure`
- Preserves views, automations, formulas, column settings, managed column links
- Creates an independent copy (no live link to source)
- Items are cleared from the duplicate, then source items are migrated with column mapping
- **This is the recommended and default approach**

### Route 3: Manual (`migrateBoardManual`)
- Creates a blank board via `create_board`
- Recreates columns one by one via `create_column`
- Recreates groups
- Migrates items with column value mapping
- Used for cross-account migrations without templates, or when all template options are disabled
- Loses views, automations, formulas, mirrors, and managed column links

## Template Detection System

### Primary: `created_from_board_id`

The Monday.com API field `created_from_board_id` directly identifies which template a board was created from. This is the ideal approach because:
- It provides the actual template board ID
- `use_template` can use this ID to create linked instances
- No heuristics or guessing needed

**Current Status: BROKEN** — The field `created_from_board_id` is not available on the Monday.com API version being used. The query returns:
```
Cannot query field "created_from_board_id" on type "Board".
```

### Fallback: Column Fingerprint Grouping

When `created_from_board_id` is unavailable, the system groups boards by their column structure:

1. For each board, extract column IDs (excluding `name`), sort them, and join with `|`
2. Group boards with identical fingerprints
3. Groups with 2+ boards are assumed to share a template origin
4. The first board in each group becomes the "reference board"

**Limitation**: Fingerprint-based mapping produces regular board IDs, not template IDs. The `use_template` mutation requires an actual template board ID, so fingerprint-based groups CANNOT use Route 1 (managed templates). They fall through to Route 2 (`duplicate_board`) instead.

## Migration Components (User-Selectable)

| Component | Mandatory | Default | Description |
|-----------|-----------|---------|-------------|
| `boards` | Yes | On | Board structure |
| `columns` | Yes | On | Column definitions |
| `items` | Yes | On | All item data |
| `groups` | No | On | Board groups/sections |
| `folders` | No | On | Recreate folder hierarchy |
| `useTemplates` | No | On | Use `duplicate_board` (recommended) |
| `useManagedTemplates` | No | Off | Use `use_template` for linked instances |
| `managedColumns` | No | On | Preserve managed column links |
| `documents` | No | On | Export/recreate docs with Drive backup |

## Cross-Account Migration

The tool supports migrating between two different Monday.com accounts:

- **Source account**: `MONDAY_API_KEY` — used for all read operations
- **Target account**: `MONDAY_MIGRATION_API_KEY` — used for all write operations
- Same-account migrations null out the target key to avoid unnecessary overhead
- People columns are skipped in cross-account mode (different user ID spaces)
- File transfer downloads from source, uploads to target via multipart form POST
- Template preparation can create skeleton boards on the target platform

## Item Migration

Items are migrated in batches using parallel `create_item` mutations:

1. Fetch source items with pagination (500 per page via `items_page`)
2. Build column value map, skipping non-writable types (mirror, formula, auto_number, etc.)
3. Create items on target board, mapping source group → target group
4. Migrate subitems for each parent item
5. Migrate file attachments: download from source via `public_url`, upload to target via multipart form POST
6. Track cumulative file download size to monitor memory usage

## UI Architecture

The React SPA (`app.html`) is a single-file application using Babel Standalone for in-browser JSX compilation. Key patterns:

- **Tab-based navigation**: Inventory, Test Run, Migration, Validation, Users & Guests, Templates
- **Adaptive polling**: Progress polling starts at 1s intervals, slows to 5s after 20 polls
- **Toast notifications**: Success/error toasts via React portal to `#toast-root`
- **Progress modal**: Real-time progress display with cancel support
- **Dark mode**: CSS variable-based theming with `localStorage` persistence

---

## Outstanding Issues

### 1. Managed Templates Not Creating Linked Boards (Critical)

**Symptom**: When `useManagedTemplates` is enabled, boards are created with the correct columns but do NOT have a live link back to the template board. Every board falls through to `duplicate_board` with the log message:
```
Board "X" has no managed template — falling back to duplicate_board
```

**Root Cause**: The Monday.com API field `created_from_board_id` is not available on the current API version (returns `Cannot query field "created_from_board_id" on type "Board"`). This causes `_tryGetCreatedFromBoardIds()` to return an empty map. The fallback fingerprint grouping correctly identifies board groups (e.g., 45 Customer boards, 54 Partner boards), but sets `isFingerprintBased = true`.

The critical guard in `migrateBoard()` at line 1714 then blocks Route 1:
```javascript
if (components.useManagedTemplates && components._templateMapping && !components._isFingerprintBased) {
    tplBoardId = components._templateMapping[String(sourceBoard.id)] || null;
}
```

Since `_isFingerprintBased` is `true`, `tplBoardId` stays `null`, and every board falls to Route 2 (`duplicate_board`). This is by design — fingerprint-based IDs are regular board IDs, not template IDs, so `use_template` would fail with them.

**Impact**: All 101 boards are migrated via `duplicate_board` — they get the right structure and data, but are independent copies without template linkage. Template updates won't propagate to migrated boards.

**Possible Fixes**:
1. **API Version Update**: Check if `created_from_board_id` is available in a newer API version (currently using `2025-07`). The field may require a different API version header or may be a beta/enterprise-only feature.
2. **Manual Template Set**: Use the existing template set mechanism (`getTemplateSetsForMigration()`, `initTemplatePreparation()`) to manually map source boards to template IDs on the target platform. This workflow is partially built but requires the user to pre-create templates on the target.
3. **Template Board Detection**: If the source workspace has actual template boards (not just boards created from templates), detect them by convention (e.g., boards with names like "Template: Customer Tracker") and use those IDs for `use_template`.
4. **Hybrid Approach**: For same-account migrations, use `duplicate_board` on the first board in each fingerprint group to create a template, then use that duplicated board's ID with `use_template` for remaining boards in the group.

### 2. Fingerprint Grouping Includes Non-Template Boards

**Symptom**: The 12-column fingerprint group (54 boards) includes personal tracker boards (Rod's, Paul's, Kelly's, etc.) alongside partner activity boards (WTW, Akur8, etc.). These boards share the same column structure but serve different purposes.

**Impact**: All 54 boards are treated as instances of the same template, which is technically correct (they share column structure) but may not match the user's mental model. Personal trackers are grouped with partner boards.

**Possible Fix**: Add board name pattern matching or folder-based filtering to distinguish board "families" within the same fingerprint group.

### 3. `duplicate_board` Creates Independent Copies

**Symptom**: Even when Template Clone is used (the default), the duplicated boards are independent copies. They have the correct structure, views, and automations, but there is no managed template link. If the original template board is updated, the duplicated boards won't receive those changes.

**Impact**: This is a fundamental limitation of `duplicate_board` — it creates a copy, not a linked instance. Only `use_template` creates linked instances, but that requires actual template board IDs.

### 4. Subitem Board Handling

**Symptom**: Subitem boards are correctly filtered out during migration (99 subitem boards excluded), but subitem data migration relies on `create_subitem` for each parent item. The subitem board on the target is auto-created by Monday.com when the first subitem is added.

**Impact**: Subitem column structure on the target may not exactly match the source if the source subitem boards had custom columns added after initial creation. The auto-created subitem board uses the default subitem column set.

### 5. Large File Migration Memory Pressure

**Symptom**: File downloads accumulate in GAS memory during board migration. The code tracks cumulative download size but doesn't enforce a hard limit. A board with many large files (e.g., Mitchell International with 30MB+ of ZIP files) could trigger OOM in a single board migration.

**Impact**: The `MAX_BOARDS_PER_EXECUTION = 20` limit helps, but a single board with many large files could still exceed memory.

### 6. Template Set UI Workflow Incomplete

The template management system has server-side functions (`initTemplatePreparation()`, `listTemplateSets()`, `prepareTemplatesOnTarget()`) but the UI workflow for creating and managing template sets is partially implemented. Users cannot easily:
- Create a template board on the target platform
- Map source board fingerprint groups to target template IDs
- Verify template columns match before migration

### 7. API Rate Limiting

The tool makes many sequential API calls (one per board, one per item batch, one per file upload). Monday.com's API rate limits (complexity-based) could throttle large migrations. The code has retry logic with exponential backoff for board-level failures, but no proactive rate limit detection or throttling.

### 8. Views and Automations Not Fully Preserved in Manual Mode

Route 3 (manual board creation) loses views, automations, formulas, mirror columns, board relations, and dependencies. These are only preserved by `duplicate_board` (Route 2). The test run analysis correctly warns about complex columns, but users may not understand the full implications.

### 9. People Column Mapping in Cross-Account Mode

Cross-account migrations skip people columns entirely because user IDs differ between accounts. The `UserMigrationService` handles post-migration user assignment, but this is a separate manual step. There's no automatic user-by-email matching during item migration.

### 10. Form Migration Fragility

Form migration (`migrateBoardForms()`) is attempted after each board migration but failures are caught and logged without blocking. Form question types and conditional logic may not transfer completely, especially for forms with complex branching or integrations.
