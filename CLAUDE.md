# CLAUDE.md - Alliance Manager Portal (Google Apps Script)

## Project Overview

The Alliance Manager Portal is a Google Apps Script web application that syncs partner activity data from Monday.com into Google Sheets, enabling Alliance Managers to track and manage partner activities and marketing approvals. The application provides:

- **Partner Activity Tracking**: Syncs partner board data from Monday.com (1500+ items across multiple partner boards)
- **Internal Activity Management**: Tracks internal Guidewire activities across 4 dedicated Monday.com boards
- **Marketing Approvals & Calendar**: Manages marketing approval requests and event calendars
- **Role-Based Access**: AllianceManagers and Admins access data based on TechAllianceManager sheet permissions
- **Real-Time Sync**: Hourly automated sync via ScriptApp triggers, manual sync via UI buttons

**Key Services**:
- Monday.com API (GraphQL v2, API-Version: 2026-01)
- Google Sheets (database storage)
- Google Workspace (authentication, email notifications)
- GmailApp for notifications

**Users**: Alliance Managers, Marketing Managers, Admins

## Repository Structure

```
/home/user/MondayGASProjects/
├── code.gs                      # Web app entry points (doGet, doPost), session init
├── main.gs                      # Sync orchestration (4-stage sync), board configs, cache clearing
├── manager.gs                   # Manager lookups, authorization from TechAllianceManager sheet
├── DataService.gs               # Data retrieval layer (activity, calendar, approvals)
├── MondayAPI.gs                 # Monday.com GraphQL queries, retryableFetch_, API wrapper
├── Datafetcher.gs               # Board structure & item fetching (cursor pagination, batch ops)
├── dataprocessor.gs             # Data transformation (sanitization, parsing, translation)
├── CacheService.gs              # Multi-tier caching (script/user/document)
├── EmailService.gs              # Notification emails (marketing approvals, calendar)
├── utilities.gs                 # Date, formatting, array utilities
├── documentfetcher.gs           # Monday.com document/file link processing
├── BoardAudit.gs                # Diagnostic functions for board structure validation
├── index.html                   # Main React SPA (PartnerActivities, InternalActivities, etc)
├── marketingmanager.html        # Marketing Manager dashboard (React + Chart.js)
├── error.html                   # Error page template
├── appsscript.json             # Project manifest (timeZone, scopes, V8 runtime)
├── CLAUDE.md                    # This file
├── Coding Instructions          # Development best practices
└── README.md                    # Project overview
```

## MCP Tools for Documentation & API Access

| MCP Server | Purpose | When to Use |
|-----------|---------|------------|
| **context7** | Live GAS API documentation, method signatures, return types | Before writing any code: verify function existence, check parameters, understand return values |
| **fetch** | Web page retrieval (StackOverflow, GitHub, Google Workspace blog) | Research existing solutions, check documentation pages, validate patterns |
| **monday** | Monday.com API access, query execution, rate limit info | Debug board structures, validate column IDs, test API calls |

**SECURITY NOTE**: `.mcp.json` contains `MONDAY_API_TOKEN` (JWT). This file is git-ignored and NEVER committed. Never log its contents or include it in error messages.

## Pre-Implementation Research Protocol

Before writing ANY code, follow this sequence:

### Step 1: Verify Current Documentation via MCP
Use Context7 to check:
- Function signatures in GAS API
- Return types and parameter requirements
- Available service quotas and limits
- OAuth scopes needed

Example:
```
"Verify the exact signature of SpreadsheetApp.getActiveSpreadsheet() via Context7"
→ Returns Spreadsheet object, no parameters, requires spreadsheets scope
```

### Step 2: Search for Existing Solutions
- Stack Overflow: `site:stackoverflow.com google-apps-script [your question]`
- GitHub: `site:github.com google-apps-script [your feature]`
- Google Workspace Updates Blog: Check announcements for API changes

### Step 3: Validate API Methods
Never assume a method exists. Verify:
- Method name exactly as documented
- Parameter types and order
- Return type
- Required OAuth scopes
- Current quotas

Example (from this project):
```
Assumption: CacheService.getScriptCache().removeAll([keys]) removes multiple keys
Verification via Context7: Correct! Signature is removeAll(keys: string[])
```

## Architecture

### Server-Side (Google Apps Script)

#### Entry Points (code.gs)
```javascript
function doGet(e) {
  // Webhook parameter: manager name/email
  const rawManager = e.parameter.manager || '';
  let managerEmail = rawManager.includes('@') ? rawManager.trim().toLowerCase() :
                     getManagerEmailByName(rawManager);

  const session = initializeSession(managerEmail, e.parameter.token);
  const template = HtmlService.createTemplateFromFile(templateName);
  template.configData = { user: managerEmail, version: CONFIG.VERSION, ... };
  return template.evaluate().setTitle(...).setXFrameOptionsMode(...);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  // Route to handlers based on data.action
}
```

#### Authentication & Identity (manager.gs)
```javascript
// Manager identity comes from Session.getActiveUser() or webhook parameter
function getManagerList() {
  // Returns array of @guidewire.com emails from AllianceManager sheet
  const cache = CacheService.getScriptCache();
  const cached = cache.get('manager_list');
  if (cached) return JSON.parse(cached);
  // Read from AllianceManager sheet, filter by domain, cache 1 hour
}

function getManagerAuthorization(managerEmail) {
  // Returns { mondayBoards, role, reports, managerName } from TechAllianceManager
  // Roles: 'User', 'Manager', 'Admin', 'SrDirector'
  // Cache 1 hour per manager
}
```

#### Data Sync Layer (main.gs - 4-Stage Process)

The sync uses a lock/debounce pattern to prevent concurrent runs:

```javascript
function syncMondayData(force) {
  // Check: already running? completed recently?
  const syncCheck = canStartSync(300); // 5 min debounce
  if (!syncCheck.canStart && !force) return { skipped: true };

  setSyncLock(); // Acquire lock (15 min timeout)
  try {
    // STAGE 1: Sync MondayDashboard (board registry)
    syncMondayDashboard();
    SpreadsheetApp.flush();
    Utilities.sleep(5000);

    // STAGE 2: Sync Partner Activities (dynamic board discovery from Dashboard)
    // - Get board configs from MondayDashboard
    // - Batch fetch board structures (chunks of 10)
    // - Fetch items with cursor pagination (PAGE_SIZE=200)
    // - Write to temp sheet, post-process (delete completed, translate names, sort)
    // - Atomic swap: copy temp → main sheet

    // STAGE 3: Sync Marketing Boards (approvals, calendar, 2026 approvals)
    syncMarketingBoards();
    clearMarketingCaches();

    // STAGE 4: Sync Guidewire Internal Boards
    syncGuidewireBoards();

    // Clear partner activity & heatmap caches
    clearActivityCaches();
    clearHeatmapCaches();

    clearSyncLock();
    return { success: true };
  } catch (error) {
    clearSyncLock();
    return { success: false, message: error.toString() };
  }
}
```

Key patterns:
- **Debounce**: `canStartSync(300)` prevents rapid re-syncs (5 min minimum)
- **Lock**: `setSyncLock()` prevents concurrent syncs (15 min safety timeout)
- **Batch Fetching**: `getBatchBoardStructuresViaApi(boardIds)` chunks into groups of 10
- **Pagination**: `getAllBoardItems(boardId)` uses cursor-based pagination (PAGE_SIZE=200)
- **Atomic Updates**: Sync to temp sheet, post-process, then swap to main sheet

#### Data Retrieval Layer (DataService.gs)
```javascript
class DataService {
  getActivityData(type, manager, filters, sort, pagination) {
    // type: 'partner' (MondayData) or 'internal' (GWMondayData)
    // Returns: { data, total, page, pageSize, pages }
    // NO CACHING - always reads fresh from sheet
  }

  getMarketingCalendarData(managerEmail) {
    // Reads MarketingCalendar sheet
  }

  getMarketingApprovalsData(managerEmail) {
    // Reads MarketingApproval sheet
  }

  static ensureSerializable(data) {
    // Converts Date objects to 'YYYY-MM-DD' strings before UI delivery
    // Recursively processes arrays and objects
  }
}
```

#### Caching (main.gs cache clearing functions)
```javascript
function clearActivityCaches() {
  // Removes patterns: activity_${type}_${manager}_page${1..10}
}

function clearMarketingCaches() {
  // Removes: marketing_approvals_${manager}, marketing_calendar_${manager}
}

function clearHeatmapCaches() {
  // Removes: heatmap_${manager}
}
```

### Client-Side (React 18 + Bootstrap 5)

#### HTML Structure (index.html)
- Root div for React mount point
- Modal root for dialogs
- Toast root for notifications
- Bootstrap 5 + Icons
- React 18 + Babel Standalone (zero-build)
- Google Script interface via `google.script.run`

#### React Components
Main tabs/views in PartnerActivities, InternalActivities, MarketingCalendar, MarketingApprovals, GeneralApprovals, PartnerHeatmap

#### Promise Wrapper for Server Calls
```javascript
const callGoogleScript = (functionName, ...args) => {
  return new Promise((resolve, reject) => {
    if (google?.script?.run) {
      google.script.run
        .withSuccessHandler(res => {
          if (res && typeof res === 'object' && res.success === false) {
            reject(new Error(res.error || 'Server error'));
          } else {
            resolve(res);
          }
        })
        .withFailureHandler(err => reject(new Error(err?.message || err)))
        [functionName](...args);
    }
  });
};
```

#### Data Flow
```
User Action (React)
  → callGoogleScript(functionName, params)
  → google.script.run → GAS function
  → GAS reads Sheet or calls Monday API
  → GAS returns JSON (dates as strings!)
  → React receives via Promise
  → State update → Render
```

## Authentication & Authorization

### Identity Resolution
1. **Webhook Parameter** (trusted): `doGet(e)` receives `?manager=` parameter
2. **Session User** (GAS): `Session.getActiveUser().getEmail()` as fallback
3. **Lookup**: `getManagerEmailByName(rawName)` converts "Tim Kennedy" → "tkennedy@guidewire.com"

### Authorization Levels
Defined in **TechAllianceManager** sheet (columns: Email, MondayBoards, MondayRole, Reports):

```
Email                    | MondayBoards          | MondayRole   | Reports
tkennedy@guidewire.com  | WTW,Sentry,Zendesk   | Manager      | Jane Doe,John Smith
admin@guidewire.com     | *                     | Admin        | (all)
```

Roles: `'User'` (default), `'Manager'` (supervises team), `'Admin'` (full access), `'SrDirector'` (strategic)

### Session Storage
```javascript
function initializeSession(userEmail, token) {
  const cache = CacheService.getUserCache();
  let session = { user: userEmail, token, created, lastActivity, permissions };
  cache.put(sessionKey, JSON.stringify(session), CONFIG.SESSION_TIMEOUT); // 30 min
  return session;
}
```

### Permission Checks
```javascript
function getUserPermissions(email) {
  // Returns { canView, canEdit, canDelete, canAdmin }
  // Admins: ['admin@guidewire.com']
  // Managers: from getManagerList()
}
```

## Caching Strategy

| Tier | Service | TTL | Used For | Key Pattern |
|------|---------|-----|----------|------------|
| Script | CacheService.getScriptCache() | 15 min max | High-traffic data, sync status | `manager_list`, `marketing_approvals_${email}` |
| User | CacheService.getUserCache() | 30 min | Per-user session data | `session_${email}` |
| Document | CacheService.getDocumentCache() | 24 hrs | Persistent config | (rarely used) |
| Properties | PropertiesService.getScriptProperties() | Permanent | API keys, config | `MONDAY_API_KEY`, `SPREADSHEET_ID` |

### Cache Key Naming Conventions
```javascript
// Manager lists
'manager_list'
'manager_email_${name.replace(/\s+/g, '_')}'
'manager_auth_${email.replace(/[@.]/g, '_')}'

// Activity data
'activity_${type}_${manager}_page${n}'      // type: 'partner', 'internal'
'activity_${type}_${manager}_recent'

// Marketing
'marketing_approvals_${manager}'
'marketing_calendar_${manager}'
'approvals_2026_${manager}'

// Heatmap
'heatmap_${manager}'

// Sync status
'SYNC_IN_PROGRESS'
'SYNC_STARTED_AT'
'LAST_SYNC_COMPLETED'
```

### Size Limits
- Cache: 100KB per key maximum
- Check before caching: `if (JSON.stringify(data).length < 90000) cache.put(...)`
- PropertiesService: Unlimited per project

### Cache Clearing Strategy
After data mutations (add/edit/delete in Monday.com):
1. Immediate single-board sync via `syncAndClear*()` functions
2. No lock (quick operations)
3. Clear specific caches (not all caches)

Example:
```javascript
function syncAndClearMarketingCalendar() {
  syncMarketingBoards();           // Re-fetch from API
  clearMarketingCalendarCaches();  // Clear only calendar cache
  return { success: true };
}
```

## Spreadsheet Schema

All sheets stored in active spreadsheet via `SpreadsheetApp.getActiveSpreadsheet()`.

### Configuration Sheets

#### MondayDashboard
**Purpose**: Registry of partner boards to sync
**Columns**: Partner Name, PartnerBoard (Monday.com board ID), Status, SyncDate
**Key Logic**: Dynamic board discovery for Stage 2 sync
**Used By**: `getBoardConfigurations()` reads this to find which partner boards to fetch

#### AllianceManager
**Purpose**: Master list of authorized managers
**Columns**: Manager (name), Email (@guidewire.com), Department, Status
**Cache**: 1 hour (manager_list)
**Used By**: `getManagerList()`, `getManagerEmailByName()`

#### TechAllianceManager
**Purpose**: Manager authorization and role assignment
**Columns**: Manager, Email, MondayBoards (comma-separated), MondayRole (User/Manager/Admin/SrDirector), Reports (comma-separated names)
**Cache**: 1 hour per manager (manager_auth_${email})
**Used By**: `getManagerAuthorization()` returns { mondayBoards, role, reports, managerName }

#### Partner
**Purpose**: Master partner/account list
**Columns**: Account Name, Account Owner (manager name), Status, Industry, Annual Value
**Used By**: `getManagedPartners()` filters by Account Owner matching manager

#### PartnerTranslate
**Purpose**: Name translation map (Monday.com partner names → sheet display names)
**Columns**: Original Name (A), Translated Name (B)
**Used By**: `getPartnerTranslateLookup()` returns Map, `translatePartnerNamesOnSheet()` applies translations

#### InternalBoards
**Purpose**: Configuration for Guidewire internal activity boards
**Columns**: BoardName, ID (Monday.com board ID), SheetName (target sheet)
**Used By**: `getGuidewireBoardConfigurations()` dynamically discovers GW boards

### Data Sheets

#### MondayData
**Purpose**: Partner activities from all partner boards
**Columns** (auto-generated from board structure):
- Item Name, Group, Status, Owner, Due Date, Created, Last Updated, Priority, ...
- Plus partnerName, boardName, boardId (added by processor)
**Size**: 1500+ rows typical
**Updated By**: `syncMondayData()` Stage 2, atomic swap from MondayData_Temp

#### GWMondayData
**Purpose**: Guidewire internal activities from 4 internal boards
**Columns** (standardized across all GW boards):
- Item Name, Group, Status, Owner, Priority, Activity Type, Due Date, ...
- Plus board source identifier
**Updated By**: `syncGuidewireBoards()` Stage 4

#### MarketingApproval
**Purpose**: Marketing approval requests
**Columns** (from board 9710279044): Name, Status, Owner, Department, Start Date, Priority, Request Type, Urgency, Cost
**Size**: Variable
**Updated By**: `syncMarketingBoards()`

#### MarketingCalendar
**Purpose**: Marketing event calendar
**Columns** (from board 9770467355): Name, Month, Week, Activity Type, Event Date
**Updated By**: `syncMarketingBoards()`

#### Approvals2026
**Purpose**: 2026 marketing approvals
**Columns** (from board 18389979949): Custom structure
**Updated By**: `sync2026ApprovalsBoard()`

### Operations Sheets

#### Errors (created on-demand)
**Purpose**: Error log for debugging
**Columns**: Timestamp, Function, Error, User, Stack
**Created By**: Error handlers (not used in current code)

### Temp Sheets (internal)

#### MondayData_Temp
**Purpose**: Staging for partner activities during sync
**Lifecycle**: Created at sync start, post-processed (delete completed, translate names, sort), copied to MondayData, deleted
**Keeps sync atomic**: All operations on temp sheet, then one fast copy to main

## Key Business Logic

### 4-Stage Sync Process

**Stage 1: MondayDashboard Sync**
- Fetches board structure & items from dashboard board (ID: 8705508201)
- Stores partner name + board ID mapping
- Purpose: Discover which partner boards to sync in Stage 2
- Example output: `[{Partner Name: "WTW", PartnerBoard: "8463767815"}, ...]`

**Stage 2: Partner Activities Sync**
1. Read MondayDashboard sheet → extract unique board IDs
2. Batch fetch board structures (10 boards per API call)
3. For each board: cursor pagination with PAGE_SIZE=200 items
4. Process items: delete completed/cancelled, translate partner names, sort by item name
5. Atomic write: all data to MondayData_Temp, then copy to MondayData

Key: **Debounce (5 min)** + **Lock (15 min)** prevents concurrent syncs

**Stage 3: Marketing Boards Sync**
- Sync 3 marketing boards separately (can retry individually)
- No lock (quick operations)
- Clear marketing caches after sync

**Stage 4: Guidewire Internal Boards Sync**
- Dynamically read InternalBoards sheet
- Sync all configured GW boards to GWMondayData
- Batch fetch structures, cursor pagination per board

### Manager-Partner Association

```javascript
function getManagedPartners(managerEmail) {
  // Step 1: Resolve email to actual person name from AllianceManager
  const managerName = getManagerName(managerEmail); // Tim Kennedy

  // Step 2: Read Partner sheet, filter rows where Account Owner matches name
  // Matching logic: exact, contains, or first-name match
  return managedPartners; // ["WTW", "Sentry", "Zendesk"]
}
```

### Partner Name Translation

```javascript
function translatePartnerNamesOnSheet(sheet) {
  const translationMap = getPartnerTranslateLookup(); // Map: Original → Translated
  // For each row: check column B (Partner Name), replace with translation if exists
  // Example: "Travelers Insurance Co" → "Travelers" (if in PartnerTranslate sheet)
}
```

### Status Filtering

Post-processing after sync removes rows where Group (column B) equals:
- 'Completed', 'Cancelled', 'Accepted'

Prevents stale data from cluttering the sheet.

### Cursor-Based Pagination (Monday.com API)

```javascript
function getAllBoardItems(boardId) {
  let cursor = null;
  let allItems = [];
  const PAGE_SIZE = 200; // Balanced complexity vs calls

  while (hasMore) {
    const query = cursor ? `next_items_page(cursor: "${cursor}", limit: ${PAGE_SIZE})` :
                           `boards(ids: [${boardId}]).items_page(limit: ${PAGE_SIZE})`;
    const response = makeApiRequest(query);

    // Extract pageData based on cursor presence
    allItems.push(...pageData.items);
    cursor = pageData.cursor; // Update for next iteration
    hasMore = !!pageData.cursor; // Stop if no cursor
  }
  return allItems;
}
```

## Code Standards

### Error Handling
```javascript
function publicFunction(params) {
  try {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters');
    }
    const result = doWork(params);
    return { success: true, data: result };
  } catch (error) {
    console.error('Error in publicFunction:', error);
    return { success: false, error: error.toString() };
  }
}

// Called from client via callGoogleScript():
const result = await callGoogleScript('publicFunction', params);
if (result.success) { /* use data */ } else { /* show error */ }
```

### Null/Undefined Checks
```javascript
// Pattern 1: Conditional access
const value = row[columnIndex] ? row[columnIndex].toString().trim() : '';

// Pattern 2: Early return
if (!boardId || boardId === '') return [];

// Pattern 3: Optional chaining (ES2020)
const email = user?.email || 'unknown@example.com';
const data = response?.data?.boards?.[0] || null;

// Pattern 4: Array null-safe
const emails = managers.filter(m => m && m.email); // Remove nulls first

// Pattern 5: JSON parse safe
try {
  const parsed = JSON.parse(jsonString);
} catch (e) {
  console.error('JSON parse failed:', e);
  return null;
}
```

### Type Safety & Serialization
```javascript
// Date handling - CRITICAL
const dateString = new Date().toISOString(); // ✓ String safe for UI
// const dateObj = new Date(); // ✗ NEVER pass to client

// From server → client ALWAYS serialize dates
function getActivityData() {
  const data = sheet.getRange(...).getValues();
  // Dates in cells are Date objects
  return DataService.ensureSerializable(data); // Converts to 'YYYY-MM-DD'
}

// ensureSerializable implementation
static ensureSerializable(data) {
  if (data instanceof Date) {
    const year = data.getFullYear();
    const month = String(data.getMonth() + 1).padStart(2, '0');
    const day = String(data.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  // Recursive for arrays/objects...
  return data;
}

// Column value sanitization
function sanitizeValueForSheet(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    // Extract names from objects, join with comma
    return value.map(v => v.name || v.text || String(v)).join(', ');
  }
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'object') {
    if (value.name) return String(value.name);
    if (value.text) return String(value.text);
    try { return JSON.stringify(value); }
    catch (e) { return ''; }
  }
  return String(value);
}
```

## Development Conventions

### Column Mapping Pattern
```javascript
// Step 1: Get headers from row 1
const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

// Step 2: Find column index (case-insensitive)
const emailIndex = headers.findIndex(h => h.toLowerCase().trim() === 'email');

// Step 3: Extract from data rows using index
for (let i = 1; i < data.length; i++) {
  const email = data[i][emailIndex] ? data[i][emailIndex].toString().trim().toLowerCase() : '';
}

// Used in: getManagerList, getManagerEmailByName, getManagedPartners, TechAllianceManager reads
```

### String Normalization
```javascript
// Consistent pattern: trim + lowercase for comparisons
const normalized = input.toString().trim().toLowerCase();
const exact = normalized === targetValue.toLowerCase();
const partial = normalized.includes(targetValue.toLowerCase());

// Used in: all lookups (manager name, email, partner name)
```

### Batch Reads
```javascript
// Instead of getRange(row, col).getValue() in a loop:
const lastRow = sheet.getLastRow();
const lastCol = sheet.getLastColumn();
const allData = sheet.getRange(1, 1, lastRow, lastCol).getValues(); // One call

// Iterate through allData array instead
for (let i = 0; i < allData.length; i++) {
  const row = allData[i];
  const value = row[columnIndex];
}

// Used in: all sheet reading operations (DataService, board configurations)
```

### Cache Key Naming
```javascript
// Pattern: category_identifier_optional_variant
'manager_list'                           // Singleton
'manager_email_tim_kennedy'              // Name-based (spaces → underscores)
'manager_auth_tkennedy_guidewire_com'   // Email-based (@ and . → underscores)
'activity_partner_tkennedy_guidewire_com_page1'
'marketing_approvals_tkennedy_guidewire_com'
'heatmap_tkennedy_guidewire_com'
```

### Timezone Handling
```javascript
// appsscript.json: "timeZone": "America/Chicago"
// All dates returned to client as ISO strings: "2025-02-15"
// No timezone conversion needed (sheets use system timezone)
```

### Retryable Fetch with Exponential Backoff
```javascript
function retryableFetch_(url, options, maxAttempts) {
  maxAttempts = maxAttempts || 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();

      if (code >= 200 && code < 300) return response; // Success

      if (code === 429 || code >= 500) {
        // Retryable error
        if (attempt < maxAttempts) {
          let delay;
          if (code === 429) {
            delay = parseRetryDelay_(response.getContentText()); // Monday.com's retry_in_seconds
          } else {
            delay = Math.pow(2, attempt) * 1000; // Exponential: 2s, 4s, 8s, 16s
          }
          console.log(`Retry ${attempt + 1}/${maxAttempts} after ${delay / 1000}s`);
          Utilities.sleep(delay);
          continue;
        }
      }
      throw new Error(`HTTP ${code}: ${response.getContentText().substring(0, 500)}`);
    } catch (e) {
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Error: ${e.message}. Retry after ${delay / 1000}s`);
        Utilities.sleep(delay);
      } else {
        throw e;
      }
    }
  }
}
```

## Google Apps Script Guidelines

### Execution Limits (Critical)
- **Script Timeout**: 6 minutes per execution (normal), 30 minutes (background)
- **URL Fetch**: 20,000 per day quota
- **Email**: 100 per day quota
- **Triggers**: Max 20 per script

### Verified API Patterns

#### Spreadsheet Access
```javascript
const ss = SpreadsheetApp.getActiveSpreadsheet();
const sheet = ss.getSheetByName('SheetName');
const range = sheet.getRange(row, col, numRows, numCols);
const values = range.getValues(); // Returns 2D array
range.setValues(newValues);       // Batch update (faster than cell-by-cell)
```

#### Triggers
```javascript
// Time-based trigger (hourly sync)
ScriptApp.newTrigger('syncAllMondayData')
  .timeBased()
  .everyHours(1)
  .create();

// Get and delete existing triggers
const triggers = ScriptApp.getProjectTriggers();
triggers.forEach(t => {
  if (t.getHandlerFunction() === 'syncMondayData') {
    ScriptApp.deleteTrigger(t);
  }
});
```

#### Cache Service (Multi-Tier)
```javascript
// Script-scoped: shared across all users, 6-hour limit
const scriptCache = CacheService.getScriptCache();
scriptCache.put(key, JSON.stringify(value), 600); // 10 min
scriptCache.get(key); // Returns null if not found
scriptCache.removeAll([key1, key2, ...]); // Batch remove

// User-scoped: per-user, 30-min limit
const userCache = CacheService.getUserCache();
```

#### Properties Service (Persistent)
```javascript
// Store API keys, config (permanent)
const props = PropertiesService.getScriptProperties();
props.setProperty('MONDAY_API_KEY', token);
props.getProperty('MONDAY_API_KEY');
props.deleteProperty('key');
```

### Critical Don'ts

❌ **Never assume method existence** — Always verify signature via Context7
❌ **Never pass Date objects to UI** — Always convert to ISO string
❌ **Never ignore execution time limits** — Syncs take 4+ min, use temp sheets + atomic swap
❌ **Never make individual API calls in a loop** — Batch 10 boards per call
❌ **Never cache without size checks** — Cache limit is 100KB per key
❌ **Never use CacheService in triggers** — Cache may not be available, use PropertiesService
❌ **Never commit API tokens** — Use PropertiesService, .mcp.json is git-ignored

### Common Pitfalls

#### Pitfall 1: Column Value Access
```javascript
// ❌ Wrong: slow, one call per cell
for (let row = 2; row <= sheet.getLastRow(); row++) {
  const value = sheet.getRange(row, colIndex).getValue();
}

// ✓ Right: one batch call
const data = sheet.getRange(2, colIndex, sheet.getLastRow() - 1, 1).getValues();
for (let row of data) {
  const value = row[0];
}
```

#### Pitfall 2: Spreadsheet Timeout
```javascript
// ❌ Can timeout on heavy workload
for (let i = 0; i < 1000; i++) {
  sheet.getRange(...).setValues(...);
  // Each setValues() can timeout if sheet is busy
}

// ✓ Right: batch all writes, then flush
const allData = [];
for (let i = 0; i < 1000; i++) {
  allData.push([...values...]);
}
sheet.getRange(1, 1, allData.length, allData[0].length).setValues(allData);
SpreadsheetApp.flush();
```

#### Pitfall 3: Missing Sheet
```javascript
// ❌ Crashes if sheet doesn't exist
const sheet = ss.getSheetByName('MissingSheet');
sheet.getRange(...); // Null reference error

// ✓ Right: check or create
let sheet = ss.getSheetByName('SheetName');
if (!sheet) {
  sheet = ss.insertSheet('SheetName');
}
```

#### Pitfall 4: JSON Parse Failure
```javascript
// ❌ Crashes on invalid JSON
const cached = cache.get(key);
const value = JSON.parse(cached); // Throws if cached is not valid JSON

// ✓ Right: use try-catch
try {
  const value = cached ? JSON.parse(cached) : null;
} catch (e) {
  console.error('Cache parse failed:', e);
  return null;
}
```

## Security

### Secret Storage
```javascript
// ✓ Correct: Stored in PropertiesService (encrypted by Google)
const API_KEY = PropertiesService.getScriptProperties().getProperty('MONDAY_API_KEY');

// ❌ Wrong: Hardcoded in code
const API_KEY = 'eyJhbGci...'; // Never!

// ❌ Wrong: Logged to console
console.log('API_KEY=' + API_KEY); // Never log secrets!
```

### Authentication
```javascript
// Identity: webhook parameter or Session.getActiveUser()
function doGet(e) {
  const managerEmail = e.parameter.manager || Session.getActiveUser().getEmail();
  // Webhook trusted: comes from Monday.com
  // Session.getActiveUser(): verified by Google Workspace domain
}

// Authorization: TechAllianceManager sheet
function getManagerAuthorization(email) {
  const auth = lookupInSheet(email); // { mondayBoards, role, reports }
  // Returns role: 'User', 'Manager', 'Admin', 'SrDirector'
  // Client receives: auth.role (use to hide/show UI buttons)
}
```

### Input Sanitization
```javascript
// String normalization (prevents injection)
const sanitized = input.toString().trim().toLowerCase();

// Column value type checking
function parseColumnValue(columnValue, columnDef) {
  const type = columnDef.type; // Declared in BOARD_SCHEMAS
  const value = columnValue.value ? JSON.parse(columnValue.value) : null;
  switch (type) {
    case 'date': return value ? value.date : '';
    case 'people': return value ? value.personsAndTeams.map(p => p.id) : [];
    default: return columnValue.text || '';
  }
}
```

### OAuth Scopes (appsscript.json)
```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",       // Read/write sheets
  "https://www.googleapis.com/auth/drive",              // Access Google Drive
  "https://www.googleapis.com/auth/gmail.send",         // Send notifications
  "https://www.googleapis.com/auth/script.container.ui", // UI dialogs
  "https://www.googleapis.com/auth/script.external_request", // URL fetch
  "https://www.googleapis.com/auth/userinfo.email"      // Current user email
]
```

### Webhook Validation
```javascript
function validateWebhookSignature(data) {
  // Stub in current code (returns true)
  // TODO: Implement Monday.com HMAC validation
  // Monday.com includes request signature in headers
  return true;
}
```

## Code Modification Rules

### When Making Changes

1. **Read Before Write**: Always read the complete file first
2. **Preserve Functionality**: Don't remove or rename existing functions
3. **Incremental Changes**: Small, focused edits (don't refactor unrelated code)
4. **Cache Invalidation**: After data mutations, clear relevant caches
5. **Test Edge Cases**: Empty data, max data, concurrent access
6. **Document Changes**: Add inline comments for non-obvious logic

### Example: Adding a New Board Type
```javascript
// Step 1: Add configuration to main.gs
const NEW_BOARD_ID = '12345678';
const NEW_SHEET_NAME = 'NewBoardData';

// Step 2: Add to sync function
function syncMondayData(force) {
  // ... existing stages ...
  syncNewBoard(); // Add new sync function
  clearNewBoardCache(); // Clear cache
}

// Step 3: Implement sync function
function syncNewBoard() {
  try {
    const sheet = getOrCreateSheet(NEW_SHEET_NAME);
    clearSheetData(sheet);
    const structure = getBoardStructure(NEW_BOARD_ID);
    const items = getAllBoardItems(NEW_BOARD_ID);
    writeDataToSheet(sheet, structure, items, false, {});
  } catch (error) {
    console.error('Error syncing new board:', error);
  }
}

// Step 4: Add cache clearing
function clearNewBoardCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('new_board_data');
}
```

## Testing Requirements

Before deploying ANY code change, verify:

- [ ] **Empty Data**: What happens when sheet is empty? Array returned should be `[]`
- [ ] **Max Data**: 1500+ rows in MondayData. Does sync complete in <6 min? Does pagination work?
- [ ] **UI Rendering**: Components render without JavaScript errors (check browser console)
- [ ] **Error Conditions**: Monday.com API down (429, 500), sheet missing, invalid JSON
- [ ] **Concurrent Access**: Multiple managers viewing same data simultaneously
- [ ] **Timezone**: Data displays in America/Chicago (appsscript.json timezone)
- [ ] **Trigger Management**: Hourly sync runs without stacking (lock prevents concurrent)
- [ ] **Cache Expiration**: Cache TTL respected, stale data refreshes
- [ ] **Sheet Formulas**: Any existing formulas still calculate (may need forceRecalculation)
- [ ] **GAS Environment**: Test in actual Apps Script editor, not local IDE

## Troubleshooting Protocol

### Step 1: Check Logs First (MCP + GAS Logging)

```
1. Open Apps Script Editor
2. View > Execution log
3. Check for errors with function names, line numbers
4. Use Context7 to verify function signatures
```

### Step 2: Use MCP Tools

**Context7**: Verify a function exists and signature matches
```
"Does CacheService.getScriptCache().removeAll() accept an array of keys?"
→ Yes, signature: removeAll(keys: string[]): void
```

**Fetch**: Look up documentation pages
```
"Fetch Monday.com API rate limits from their docs"
→ Read complexity budget info from developer.monday.com
```

**Monday MCP**: Test API queries directly
```
"Execute this GraphQL query on board 8463767815 to check if it's accessible"
→ Run query, see response or error
```

### Step 3: Search for Solutions

- Stack Overflow: `site:stackoverflow.com google-apps-script [specific error]`
- GitHub: `site:github.com google-apps-script [feature name]`
- Google Workspace Blog: Check for API deprecations/changes

### Step 4: Reproduce in Actual Environment

- Always test in Apps Script editor
- Always test with actual Monday.com boards (use test board ID 8463767815)
- Always check browser console (React errors show there)
- Always check execution log (GAS errors show there)

## Communication Standards

### When Delivering Code Changes

1. **Show complete file contents** (if small) or relevant sections
2. **Highlight changes** with line numbers or diffs
3. **Explain why** (what problem does it solve?)
4. **Note limitations** (known issues, edge cases)
5. **Provide test instructions**

Example:
```
Modified: main.gs lines 500-520

OLD (lines 500-505):
function getOrCreateSheet(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

NEW (same function with error handling):
function getOrCreateSheet(sheetName) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      console.log(`Creating sheet: ${sheetName}`);
      sheet = spreadsheet.insertSheet(sheetName);
    }
    return sheet;
  } catch (error) {
    console.error(`Error creating sheet ${sheetName}:`, error);
    throw error;
  }
}

WHY: Added error handling and logging for debugging sheet creation failures

LIMITATION: Doesn't handle quota exceeded (GAS throws separate error)

TEST:
1. Run syncMondayData() with existing sheet (should skip creation)
2. Run with non-existent sheet name (should create and log)
3. Check execution log for "Creating sheet: SheetName"
```

### When Discussing Issues

1. **Be specific about errors** (exact error message, line number)
2. **Provide context** (what were you trying to do?)
3. **Suggest verification steps** (use Context7, check MCP tools)

Example:
```
ISSUE: "syncMondayData() fails with 'Cannot read property 'getValues' of null'"

CONTEXT: Running sync at 2:00 PM, MondayDashboard sheet has 50 rows

ROOT CAUSE (verify via Context7):
- getBoardConfigurations() returns null if required columns not found
- Sheet.getDataRange() succeeds but headers() lookup fails

SOLUTION:
1. Check MondayDashboard headers match exactly: "Partner Name", "PartnerBoard"
2. Verify no filter applied to sheet
3. Run with logging: console.log(headers) to see actual column names
```

## Deployment

### Web App Settings
```
Execute as: USER_ACCESSING (each user sees their own auth context)
Who has access: Domain (anyone with @guidewire.com)
Entry point: doGet(e) for GET requests, doPost(e) for POST
```

### HTML Serving
```javascript
function doGet(e) {
  // Create template from index.html
  const template = HtmlService.createTemplateFromFile('index');

  // Pass server data to template
  template.configData = { user: managerEmail, version, ... };

  // Evaluate template and return
  return template.evaluate()
    .setTitle('Activity Management Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://www.guidewire.com/favicon.ico');
}
```

### Include Mechanism
```javascript
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Used in HTML templates:
<?!= include('styles') ?>  <!-- Injects HTML/CSS from styles.html -->
<?!= include('app') ?>     <!-- Injects React app from app.html -->
```

## Support and Resources

### MCP-Powered Documentation (Preferred)

1. **Context7**: Live GAS API documentation
   - Verify function signatures before coding
   - Check return types and quotas
   - Look up method availability by runtime version

2. **Fetch**: Web pages and reference docs
   - Search StackOverflow: `site:stackoverflow.com google-apps-script`
   - Read Google Workspace blog announcements
   - Check Monday.com API documentation

3. **Monday MCP**: Monday.com API access
   - Execute test queries directly
   - Verify board/column IDs
   - Check rate limit responses

### Primary Documentation

1. **Google Apps Script**
   - [Official Documentation](https://developers.google.com/apps-script)
   - [V8 Runtime Guide](https://developers.google.com/apps-script/guides/v8-runtime)
   - [Execution Limits](https://developers.google.com/apps-script/guides/services/quotas)

2. **Google Workspace**
   - [Spreadsheets API](https://developers.google.com/sheets/api)
   - [Gmail API](https://developers.google.com/gmail/api)
   - [Drive API](https://developers.google.com/drive/api)

3. **Monday.com**
   - [GraphQL API Documentation](https://developer.monday.com)
   - [API Version 2026-01](https://developer.monday.com/api-docs) (current)
   - [Rate Limits & Complexity Budget](https://developer.monday.com/api-docs)

4. **Frontend Stack**
   - [React 18](https://react.dev)
   - [Bootstrap 5](https://getbootstrap.com)
   - [Bootstrap Icons](https://icons.getbootstrap.com)

### Community Resources

- **Stack Overflow**: Tag `google-apps-script` (5000+ questions)
- **Google Apps Script Community**: [developers.google.com/community](https://developers.google.com/community)
- **GitHub**: Search `google-apps-script [your feature]`

## Summary: The Three Principles

### 1. Verify First
- Use Context7 to check live documentation before writing code
- Verify function signatures, return types, quotas
- Never assume a method exists or works a certain way

### 2. Test Always
- Every change must be tested in actual Apps Script environment
- Test with real Monday.com boards and Google Sheets
- Check execution log and browser console for errors
- Edge cases: empty data, max data, concurrent access

### 3. Never Assume
- If uncertain, use Context7 or Fetch to look it up
- Never guess at API behavior or function signatures
- Always check the actual codebase for patterns
- Always verify sheet names, column indices, board IDs

---

**Last Updated**: March 2026
**Project Type**: Google Apps Script + React 18 + Monday.com Integration
**Maintained For**: Alliance Managers, Marketing Managers, Admins at Guidewire
**Production Status**: Active (100+ daily syncs, 1500+ partner records)
