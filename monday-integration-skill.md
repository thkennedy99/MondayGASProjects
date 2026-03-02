# Monday.com Integration Skill

You are an expert in Monday.com API integrations, specifically with Google Apps Script (GAS) backends and React frontends. You have deep knowledge of the Monday.com GraphQL API v2, column type handling, board schemas, CRUD operations, data synchronization patterns, and multi-tier caching strategies.

---

## Monday.com GraphQL API v2

### API Endpoint & Authentication

- **Endpoint**: `https://api.monday.com/v2`
- **Auth**: Pass API key directly in the `Authorization` header (no `Bearer` prefix)
- **Method**: POST with `Content-Type: application/json`
- **Payload**: `{ "query": "<graphql>", "variables": {} }`

```javascript
function callMondayAPI(query, variables = {}) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('MONDAY_API_KEY');
  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': apiKey },
    payload: JSON.stringify({ query, variables }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch('https://api.monday.com/v2', options);
  const result = JSON.parse(response.getContentText());

  if (result.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}
```

### Rate Limiting

- Add 300ms delays between paginated requests to avoid rate limiting
- Use `Utilities.sleep(300)` in Google Apps Script between API calls
- Safety limit: cap fetches at 10,000 items per board to prevent infinite loops
- Implement exponential backoff for retries: 1s, 2s, 4s delays

---

## Core GraphQL Operations

### Read Operations

#### Get Board Structure (columns and groups)

```graphql
query {
  boards(ids: [$boardId]) {
    id
    name
    columns {
      id
      title
      type
      settings_str
    }
    groups {
      id
      title
    }
  }
}
```

#### Get Board Items (single page, up to 500 items)

```graphql
query GetBoardData($boardId: ID!, $limit: Int) {
  boards(ids: [$boardId]) {
    name
    items_page(limit: $limit) {
      cursor
      items {
        id
        name
        created_at
        updated_at
        column_values {
          id
          text
          value
        }
        group {
          id
          title
        }
      }
    }
  }
}
```

#### Cursor-Based Pagination (for large boards)

First page:
```graphql
query {
  boards(ids: [$boardId]) {
    items_page(limit: 100) {
      cursor
      items {
        id
        name
        group { id title }
        column_values { id type text value }
        assets { id name url public_url }
      }
    }
  }
}
```

Subsequent pages:
```graphql
query {
  next_items_page(cursor: "$cursor", limit: 100) {
    cursor
    items {
      id
      name
      group { id title }
      column_values { id type text value }
      assets { id name url public_url }
    }
  }
}
```

**Implementation pattern**:
```javascript
function getAllBoardItems(boardId) {
  let allItems = [];
  let cursor = null;
  let hasMore = true;
  const MAX_ITEMS = 10000;
  const PAGE_SIZE = 100;

  while (hasMore && allItems.length < MAX_ITEMS) {
    const query = cursor
      ? `query { next_items_page(cursor: "${cursor}", limit: ${PAGE_SIZE}) { cursor items { id name group { id title } column_values { id type text value } } } }`
      : `query { boards(ids: [${boardId}]) { items_page(limit: ${PAGE_SIZE}) { cursor items { id name group { id title } column_values { id type text value } } } } }`;

    const response = callMondayAPI(query);
    const pageData = cursor
      ? response.next_items_page
      : response.boards[0].items_page;

    if (pageData?.items?.length > 0) {
      allItems = allItems.concat(pageData.items);
      cursor = pageData.cursor || null;
      hasMore = !!cursor;
    } else {
      hasMore = false;
    }

    Utilities.sleep(300); // Rate limiting
  }

  return allItems;
}
```

#### Get Board Users (owners and subscribers)

```graphql
query GetBoardUsers($boardId: ID!) {
  boards(ids: [$boardId]) {
    owners { id name email }
    subscribers { id name email }
  }
}
```

#### Get Current User

```graphql
query {
  me {
    id
    name
    email
    teams { id name }
  }
}
```

### Write Operations

#### Create Item

```graphql
mutation CreateItem($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
  create_item(
    board_id: $boardId,
    group_id: $groupId,
    item_name: $itemName,
    column_values: $columnValues
  ) {
    id
    name
  }
}
```

**Variables**: `columnValues` must be a JSON-stringified object of column_id: formatted_value pairs.

#### Update Single Column

```graphql
mutation UpdateItemColumnValue($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(
    board_id: $boardId,
    item_id: $itemId,
    column_id: $columnId,
    value: $value
  ) {
    id
  }
}
```

**CRITICAL**: The `value` variable must be `JSON.stringify(formattedValue)` — double-stringified when sent in the variables object.

#### Update Multiple Columns at Once

```graphql
mutation UpdateMultipleColumns($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
  change_multiple_column_values(
    board_id: $boardId,
    item_id: $itemId,
    column_values: $columnValues
  ) {
    id
  }
}
```

**Variables**: `columnValues` is `JSON.stringify({ col_id_1: formattedValue1, col_id_2: formattedValue2 })`.

#### Delete Item

```graphql
mutation DeleteItem($itemId: ID!) {
  delete_item(item_id: $itemId) {
    id
  }
}
```

#### Archive Item

```graphql
mutation ArchiveItem($itemId: ID!) {
  archive_item(item_id: $itemId) {
    id
  }
}
```

#### Move Item to Group

```graphql
mutation MoveItemToGroup($itemId: ID!, $groupId: String!) {
  move_item_to_group(item_id: $itemId, group_id: $groupId) {
    id
  }
}
```

#### Add Update (Comment) to Item

```graphql
mutation AddUpdate($itemId: ID!, $body: String!) {
  create_update(item_id: $itemId, body: $body) {
    id
    body
    created_at
  }
}
```

---

## Column Type Handling

### Column Types Reference

| Type | API type string | Read format (`text`/`value`) | Write format (mutation value) |
|------|----------------|------------------------------|-------------------------------|
| Name | `name` | Plain text | Plain string |
| Text | `text` | Plain text | Plain string (no wrapper) |
| Long Text | `long_text` | Parsed from `value.text` | `{ "text": "content" }` |
| Status | `status` / `color` | Label text | `{ "index": <label_id> }` |
| People | `people` / `multiple-person` | Parsed from `value.personsAndTeams` | `{ "personsAndTeams": [{ "id": <int>, "kind": "person" }] }` |
| Date | `date` | `YYYY-MM-DD` string | `{ "date": "YYYY-MM-DD" }` |
| Numbers | `numbers` / `numeric` | Numeric string | Raw number (e.g., `42.5`) |
| Dropdown | `dropdown` | Label text | `{ "ids": [<label_id>] }` |
| Link/URL | `link` / `url` | URL string | `{ "url": "https://...", "text": "display text" }` |
| File | `file` | File metadata JSON | N/A (use file upload API) |
| Subtasks | `subtasks` | Subitem references | N/A (create subitems separately) |

### Column Value Formatting Function

This is the critical function for formatting values before sending mutations:

```javascript
function formatColumnValue(columnType, value, settings = {}, columnId = '') {
  switch (columnType) {
    case 'text':
      return value; // Plain string, no wrapper

    case 'long-text':
    case 'long_text':
      return { text: value };

    case 'status':
    case 'color':
      if (settings?.labels) {
        // Find label ID by matching the label name
        const deactivatedLabels = (settings.deactivated_labels || []).map(id => parseInt(id));
        const matchingIds = Object.keys(settings.labels)
          .filter(id => settings.labels[id] === value);
        const activeIds = matchingIds.filter(id => !deactivatedLabels.includes(parseInt(id)));

        if (activeIds.length > 0) {
          return { index: parseInt(activeIds[0]) };
        }
        return null; // Label not found or deactivated
      }
      return null;

    case 'date':
      if (value) {
        const dateStr = String(value).split('T')[0]; // Strip time component
        return { date: dateStr };
      }
      return null;

    case 'people':
    case 'multiple-person':
      if (Array.isArray(value)) {
        const persons = value
          .map(id => parseInt(id))
          .filter(id => !isNaN(id))
          .map(id => ({ id, kind: 'person' }));
        return persons.length > 0 ? { personsAndTeams: persons } : null;
      } else if (value) {
        const personId = parseInt(value);
        return !isNaN(personId)
          ? { personsAndTeams: [{ id: personId, kind: 'person' }] }
          : null;
      }
      return null;

    case 'numeric':
    case 'numbers':
      if (value === '' || value == null) return null;
      const num = parseFloat(value);
      return !isNaN(num) ? num : null;

    case 'dropdown':
      // Dropdown labels can be objects with {id, name} or simple strings
      const findLabelId = (labels, searchValue) => {
        for (const key of Object.keys(labels)) {
          const label = labels[key];
          if (label && typeof label === 'object' && label.name === searchValue) {
            return label.id;
          } else if (label === searchValue) {
            return parseInt(key);
          }
        }
        return null;
      };

      if (settings?.labels && typeof value === 'string') {
        const labelId = findLabelId(settings.labels, value);
        if (labelId) return { ids: [parseInt(labelId)] };
      }
      if (Array.isArray(value)) {
        const ids = value.map(v => {
          if (settings?.labels && typeof v === 'string') {
            const lid = findLabelId(settings.labels, v);
            if (lid) return parseInt(lid);
          }
          return parseInt(v);
        }).filter(id => !isNaN(id));
        return ids.length > 0 ? { ids } : null;
      }
      return null;

    case 'link':
    case 'url':
      return value ? { url: value, text: value } : null;

    default:
      return value;
  }
}
```

### Parsing Column Values from API Responses

```javascript
function parseColumnValue(column, columnType) {
  const value = column.value ? JSON.parse(column.value) : null;

  switch (columnType) {
    case 'name':
    case 'text':
      return column.text || '';
    case 'status':
      return column.text || '';
    case 'people':
      return value ? value.personsAndTeams.map(p => p.id) : [];
    case 'date':
      return value ? value.date : '';
    case 'numbers':
      return column.text ? parseFloat(column.text) : null;
    case 'dropdown':
      return value ? value.ids : [];
    case 'long_text':
      return value ? value.text : '';
    case 'file':
      return value ? value.files : [];
    default:
      return column.text;
  }
}
```

---

## Status Label Mappings

### Activity Status
| Index | Label |
|-------|-------|
| 0 | Not Started |
| 1 | Blockers |
| 2 | In Progress |
| 3 | Ongoing |
| 4 | Halted |
| 5 | Not Started |
| 6 | SOLD |
| 10 | Completed |

### Importance / Priority
| Index | Label |
|-------|-------|
| 0 | 1. Urgent |
| 1 | 2. High |
| 2 | 3. Medium |
| 3 | 4. Low |
| 5 | 5. N/A |

### Approval Status (Marketing Events)
| Index | Label |
|-------|-------|
| 0 | Submit Request Form |
| 1 | Sent to Will for Approval |
| 2 | PM Approved |
| 3 | Ready to Start |
| 4 | Final Approval |
| 5 | Started |
| 6 | Marketing Approved |
| 7 | Will Approved |
| 8 | Sent to Eric For Approval |
| 9 | PM Rejected |
| 10 | Marketing Rejected |
| 11 | Send to AM to Adjust |
| 12 | Rejected |
| 13 | Will Rejected |
| 160 | Sent to Marketing for Approval |

### Request Types
| Index | Label |
|-------|-------|
| 0 | Whitepaper or Customer Success |
| 1 | Videos/Vlogs |
| 2 | Other Collateral |
| 3 | Newsletter / Email Campaign |
| 101 | Sales Enablement Partner Pitch |
| 102 | Press Release |
| 103 | Social Promo |
| 110 | Blogs |
| 153 | GW.com or MP.com Promotional |
| 160 | Live Event |

### Requesting Department
| Index | Label |
|-------|-------|
| 0 | Product Marketing |
| 1 | GSC |
| 106 | Marketplace |
| 107 | Partner Management |
| 152 | Marketing |
| 154 | Product Development |
| 156 | CoSell |

### Priority
| Index | Label |
|-------|-------|
| 0 | Priority 2 |
| 1 | Priority 1 |
| 2 | Priority 3 |

### Urgency
| Index | Label |
|-------|-------|
| 0 | Normal |
| 1 | Rush |

### Decision Columns (Eric, Marketing, Will)
| Index | Eric Decision | Marketing Decision | Will Decision |
|-------|---------------|-------------------|---------------|
| 0 | Send Back to Requestor | Send Back to Requestor | Send Back to Requestor |
| 1 | Approve and Send to Marketing | — | Final Approval |
| 2 | Reject | Reject | Reject |
| 3 | — | Approve | — |

---

## Board Schemas

### Marketing Events Approval Requests (Board ID: 9710279044)

| Column Name | Column ID | Type |
|-------------|-----------|------|
| Name | `name` | name |
| Subitems | `subitems` | subtasks |
| Event URL | `text_mktj8ce4` | text |
| Priority | `color_mktjmqkc` | status |
| Overall Status | `status` | status |
| Owner | `person` | people |
| Alliance Manager | `text_mktkrhhj` | text |
| Requesting Department | `status_1` | status |
| Cost | `numeric_mktjxtjk` | numbers |
| Date and Location | `text_mktkdwry` | text |
| Start Date | `date_mktkb5sf` | date |
| Request Type | `status_16` | status |
| Urgency | `color_mktjnf1b` | status |
| Number of Meetings | `text_mktk5zwj` | text |
| Total Audience | `text_mktkv2yd` | text |
| Expected Attendance | `text_mktk6sdh` | text |
| Speaking Opportunity | `long_text_mktkr2xz` | long_text |
| Brand Details | `text_mktkfpbj` | text |
| Create Date | `date_mktmw20b` | date |
| Eric Approval Date | `date_mktmf2mp` | date |
| Marketing Approval Date | `date_mktmw334` | date |
| Final Approval Date | `date_mktmk43q` | date |
| Eric Decision | `color_mktmgws7` | status |
| Marketing Decision | `color_mktmnajj` | status |
| Will Decision | `color_mktm2c28` | status |
| Long text | `long_text_mktmkzbw` | long_text |

### Marketing Calendar (Board ID: 9770467355)

| Column Name | Column ID | Type |
|-------------|-----------|------|
| Event Title | `name` | name |
| Month | `color_mktk2s2a` | status |
| Event Type | `status_mktkrfhp` | status |
| Link | `url_mktkikii` | url |
| Formula | `formula_mktkajwy` | formula |
| EventDate | `date_mktkyhta` | date |

### Partner Activities / MondayData (Board ID: 8463767815)

| Column Name | Column ID | Type |
|-------------|-----------|------|
| Name | `name` | name |
| Partner Name | `status_1_mkn1xbbx` | status |
| Activity Status | `color_mktakkpw` | status |
| Owner | `person` | people |
| Assigned By | `text_mktj11qa` | text |
| Importance | `color_mkthcvny` | status |
| Date Created | `date_1_mkn1x66b` | date |
| Date Due | `date_1_mkn1rbp8` | date |
| Actual Completion | `dup__of_date_due_mkn1zx06` | date |
| Files | `files_mkn15ep0` | file |
| Comments/Notes | `status_1_mkn1ekgr` | long_text |
| Subitems | `subtasks_mkp7am7a` | subtasks |

### GW Internal Activities / GWMondayData (Board IDs: 9791255941, 9791272390, 9855494527)

These three boards (Partner Management, Solution Ops, Marketing) share a common schema:

| Column Name | Column ID | Type |
|-------------|-----------|------|
| Name | `name` | name |
| Activity Status | `color_mktakkpw` | status |
| Owner | `person` | people |
| Assigned By | `text_mktj11qa` | text |
| Importance | `color_mkthcvny` | status |
| Date Created | `date_1_mkn1x66b` | date |
| Date Due | `date_1_mkn1rbp8` | date |
| Actual Completion | `dup__of_date_due_mkn1zx06` | date |
| Files | `files_mkn15ep0` | file |
| Comments/Notes | `status_1_mkn1ekgr` | long_text |
| Tech Board Type | `9791140449__color_mktqwq7c` | status |

---

## Board-to-Sheet Sync Pattern

### Sync a Board to Google Sheets

```javascript
function syncBoardToSheet(boardId, sheetName) {
  const monday = new MondayAPI();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  // Get board structure and data
  const boardData = monday.getBoardData(boardId);
  const columns = monday.getBoardColumns(boardId);

  // Build headers
  const headers = ['Item ID', 'Name', 'Group'];
  const columnMap = {};
  columns.forEach(col => {
    headers.push(col.title);
    columnMap[col.id] = col.title;
  });

  // Clear and write headers
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Process items into rows
  const rows = boardData.items_page.items.map(item => {
    const row = [item.id, item.name, item.group.title];
    columns.forEach(col => {
      const cv = item.column_values.find(c => c.id === col.id);
      row.push(cv ? cv.text : '');
    });
    return row;
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.autoResizeColumns(1, headers.length);
  sheet.setFrozenRows(1);

  return { success: true, rowsImported: rows.length, columns: headers.length };
}
```

### Post-Delete Sync

After deleting items via the API, always re-sync the affected board to the spreadsheet. Add a 1500ms delay before syncing to allow Monday.com eventual consistency:

```javascript
Utilities.sleep(1500);
syncBoardToSheet(boardId, sheetName);
```

---

## Data Sanitization

### Sanitize Values for Google Sheets

Monday.com column values can be complex objects. Always sanitize before writing to sheets:

```javascript
function sanitizeValueForSheet(value) {
  if (value == null) return '';

  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'object') {
      return value.map(item => item.name || item.text || item.label || String(item))
        .filter(Boolean).join(', ');
    }
    return value.map(String).join(', ');
  }

  if (typeof value === 'object') {
    if (value instanceof Date) {
      return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    }
    if (value.name) return String(value.name);
    if (value.text) return String(value.text);
    if (value.date) return String(value.date);
    try {
      const s = JSON.stringify(value);
      return (s === '{}' || s === '[]') ? '' : s;
    } catch { return ''; }
  }

  return String(value);
}
```

### Ensure Serializable Data for Client

**CRITICAL**: Always convert Date objects to strings before returning data to the client (React). `google.script.run` cannot serialize Date objects.

```javascript
function ensureSerializable(data) {
  if (data == null) return data;
  if (Array.isArray(data)) return data.map(ensureSerializable);
  if (typeof data === 'object') {
    const result = {};
    for (const key in data) {
      const value = data[key];
      if (value instanceof Date) {
        result[key] = `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
      } else if (typeof value !== 'function') {
        result[key] = ensureSerializable(value);
      }
    }
    return result;
  }
  return data;
}
```

---

## Multi-Tier Caching Strategy

### Cache Tiers in Google Apps Script

| Tier | Service | Scope | Max Size | Max TTL |
|------|---------|-------|----------|---------|
| Script Cache | `CacheService.getScriptCache()` | All users | 100KB/key | 6 hours |
| User Cache | `CacheService.getUserCache()` | Per user | 100KB/key | 6 hours |
| Document Cache | `CacheService.getDocumentCache()` | Per document | 100KB/key | 6 hours |
| Properties | `PropertiesService.getScriptProperties()` | Permanent | 9KB/key | Unlimited |

### Recommended TTLs

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Partners/Contacts | 1 hour (3600s) | Rarely changes |
| Session Progress | 10 minutes (600s) | Active tracking |
| Templates | 24 hours (86400s) | Static content |
| Activity Data | 5 minutes (300s) | Moderate changes |
| User Preferences | Permanent | PropertiesService only |

### Cache Manager Pattern

```javascript
class CacheManager {
  constructor() {
    this.scriptCache = CacheService.getScriptCache();
    this.properties = PropertiesService.getScriptProperties();
  }

  get(key) {
    const cached = this.scriptCache.get(key);
    if (cached) {
      try { return JSON.parse(cached); }
      catch { return null; }
    }
    // Fallback to properties (durable storage)
    const stored = this.properties.getProperty(key);
    return stored ? JSON.parse(stored) : null;
  }

  put(key, value, ttlSeconds = 600) {
    const json = JSON.stringify(value);
    // Only cache if under 90KB (100KB limit with safety margin)
    if (json.length < 90000) {
      this.scriptCache.put(key, json, Math.min(ttlSeconds, 21600));
    }
    this.properties.setProperty(key, json);
  }

  remove(key) {
    this.scriptCache.remove(key);
    this.properties.deleteProperty(key);
  }
}
```

---

## Google Apps Script + React Integration

### Promise Wrapper for google.script.run

**CRITICAL**: Always wrap `google.script.run` in promises for React integration. The raw callback-based API does not work with React's async patterns.

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
    } else {
      // Development mock fallback
      console.log(`Mock call: ${functionName}`, args);
      setTimeout(() => resolve({ success: true, mock: true }), 200);
    }
  });
};
```

### Server Function Return Pattern

Always return structured responses from server functions:

```javascript
// Success
return { success: true, data: result };

// Error
return { success: false, error: error.toString(), functionName: 'myFunction', timestamp: new Date().toISOString() };
```

### Session Progress Tracking

For long-running operations, use a job tracker with polling:

```javascript
// Server-side: Job tracker
class ProgressTracker {
  constructor(jobId, ttl = 600) {
    this.id = jobId;
    this.ttl = ttl;
  }

  save(patch) {
    const current = this.get();
    const merged = { ...current, ...patch, lastUpdate: Date.now() };
    const json = JSON.stringify(merged);
    PropertiesService.getScriptProperties().setProperty(this.id, json);
    CacheService.getScriptCache().put(this.id, json, this.ttl);
    return merged;
  }

  get() {
    const cached = CacheService.getScriptCache().get(this.id);
    if (cached) return JSON.parse(cached);
    const stored = PropertiesService.getScriptProperties().getProperty(this.id);
    return stored ? JSON.parse(stored) : { id: this.id, state: 'initializing', percent: 0 };
  }
}

// Client-side: Adaptive polling
function getPollingInterval(attemptCount) {
  if (attemptCount < 5) return 1000;
  if (attemptCount < 10) return 2000;
  if (attemptCount < 20) return 3000;
  if (attemptCount < 50) return 5000;
  return 10000;
}
```

---

## Error Handling

### Standard Error Handler

```javascript
function handleError(functionName, error) {
  console.error(`Error in ${functionName}:`, error);

  // Log to audit sheet
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let errorSheet = ss.getSheetByName('Errors');
    if (!errorSheet) {
      errorSheet = ss.insertSheet('Errors');
      errorSheet.appendRow(['Timestamp', 'Function', 'Error', 'User', 'Stack']);
    }
    errorSheet.appendRow([
      new Date(), functionName, error.toString(),
      Session.getActiveUser().getEmail(), error.stack || ''
    ]);
  } catch (logError) {
    console.error('Failed to log error:', logError);
  }

  return { success: false, error: error.toString(), functionName, timestamp: new Date().toISOString() };
}
```

### Retry with Exponential Backoff

```javascript
function retryableOperation(operation, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        Utilities.sleep(Math.pow(2, attempt - 1) * 1000);
      }
    }
  }
  throw new Error(`Failed after ${maxAttempts} attempts: ${lastError}`);
}
```

---

## Concurrency & Locking

Always use `LockService` when multiple users or triggers may modify the same data:

```javascript
function executeWithLock(timeoutMs, fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(timeoutMs);
    return fn();
  } finally {
    lock.releaseLock();
  }
}
```

---

## Batch Processing for Large Datasets

GAS has a 6-minute execution limit. For large operations, process in chunks and schedule continuations:

```javascript
function processLargeDataset(jobId) {
  const tracker = new ProgressTracker(jobId);
  const CHUNK_SIZE = 100;
  const MAX_RUNTIME = 5 * 60 * 1000; // 5 min safety margin
  const startTime = Date.now();
  let processed = 0;
  const total = getDataCount();

  while (processed < total) {
    if (Date.now() - startTime > MAX_RUNTIME) {
      tracker.save({ state: 'paused', percent: Math.floor((processed/total)*100), resumeFrom: processed });
      ScriptApp.newTrigger('resumeProcessing').timeBased().after(1000).create();
      return;
    }

    processChunk(getDataChunk(processed, CHUNK_SIZE));
    processed += CHUNK_SIZE;
    tracker.save({ state: 'running', percent: Math.floor((processed/total)*100) });
  }

  tracker.save({ state: 'completed', percent: 100 });
}
```

---

## Security Best Practices

1. **API keys**: Store in `PropertiesService.getScriptProperties()`, never in source code
2. **Domain restriction**: Validate user email domain at the application level
3. **Input validation**: Validate all inputs from the client before processing
4. **Sanitize errors**: Strip file paths, stack traces, and long IDs before returning to client
5. **Session management**: Use `CacheService.getUserCache()` with timeout-based expiration
6. **LockService**: Use for all concurrent write operations to Google Sheets

---

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Date objects crash client UI | Always convert to ISO string before returning |
| Cache size exceeded (>100KB) | Check `JSON.stringify(data).length < 90000` before caching |
| `Session.getActiveUser()` empty in triggers | Store user email in Properties during UI load |
| Concurrent sheet modifications corrupt data | Always use `LockService.getScriptLock()` |
| Status column update fails | Must use `{ index: <int> }` format, look up ID from `settings_str.labels` |
| Dropdown column update fails | Must use `{ ids: [<int>] }` format, look up from `settings_str.labels` |
| Column ID contains board prefix | Multi-board columns may have `boardId__columnId` format |
| `column.text` vs `column.value` confusion | `text` is display string; `value` is raw JSON — parse `value` for structured types |
| GAS 6-minute timeout on large syncs | Use chunked processing with trigger-based continuation |
| Monday.com rate limiting | Add 300ms delay between paginated requests |
