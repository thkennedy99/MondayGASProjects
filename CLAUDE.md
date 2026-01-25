# CLAUDE.md - Google Apps Script Web Applications

## Project Context

This codebase contains Google Apps Script (GAS) web applications built with React 18 and Bootstrap 5. The primary applications include:
- **Alliance Manager Portal**: Monday.com integration for partner activity tracking
- **Document Generator**: Automated document generation with Adobe API integration
- Various partner management and tracking systems

## Technology Stack

- **Backend**: Google Apps Script V8 Runtime
- **Frontend**: React 18.2.0, Bootstrap 5.3.0, Bootstrap Icons 1.10.0
- **Build**: Zero-build approach using Babel Standalone
- **APIs**: Monday.com GraphQL API v2, Google Workspace APIs, Adobe PDF Services
- **Storage**: Multi-tier caching (CacheService + PropertiesService)

## Architecture Overview

```
┌────────────────────────────────────────────┐
│     CLIENT LAYER (Browser)                 │
│  - React 18 SPA                           │
│  - Bootstrap 5 UI                         │
│  - Promise-wrapped google.script.run      │
└──────────────┬─────────────────────────────┘
               │
┌──────────────▼─────────────────────────────┐
│     SERVICE LAYER (GAS)                    │
│  - Session & Progress Management          │
│  - Data Services with Validation          │
│  - Multi-tier Caching                     │
└──────────────┬─────────────────────────────┘
               │
┌──────────────▼─────────────────────────────┐
│     DATA LAYER                             │
│  - Google Sheets (Database)               │
│  - Google Drive (File Storage)            │
│  - External APIs (Monday.com, Adobe)      │
└────────────────────────────────────────────┘
```

## File Organization

```
/Project Root
├── Code.gs                      # Main server entry point
├── SessionProgressManager.gs    # Job tracking system
├── DataService.gs              # Data operations & caching
├── MondayAPI.gs                # Monday.com integration
├── index.html                  # Main HTML container
├── app.html                    # React application
├── styles.html                 # CSS styles
└── appsscript.json            # Project manifest
```

## Critical Implementation Patterns

### 1. Server Entry Points

```javascript
// Main doGet with template variables
function doGet(e) {
  const managerName = e?.parameter?.manager || null;
  const template = HtmlService.createTemplateFromFile('index');
  template.managerName = managerName;
  
  return template.evaluate()
    .setTitle('App Title')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Include helper for HTML partials
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
```

### 2. Promise Wrapper for google.script.run

**CRITICAL**: Always wrap google.script.run in promises for React integration.

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
      // Development mock
      console.log(`Mock call → ${functionName}`, args);
      setTimeout(() => resolve({ success: true, mock: true }), 200);
    }
  });
};
```

### 3. Multi-Tier Caching Strategy

**CRITICAL**: Always implement dual-store pattern for reliability.

```javascript
class ProgressTracker {
  constructor(jobId, ttlSeconds = 600) {
    this.id = jobId;
    this.ttl = ttlSeconds;
  }
  
  get() {
    // Try cache first (fast)
    const cached = CacheService.getScriptCache().get(this.id);
    if (cached) return JSON.parse(cached);
    
    // Fall back to properties (durable)
    const stored = PropertiesService.getScriptProperties().getProperty(this.id);
    return stored ? JSON.parse(stored) : this._default();
  }
  
  save(patch) {
    const current = this.get();
    const merged = Object.assign({}, current, patch, {
      lastUpdate: Date.now()
    });
    
    // Dual-store for reliability
    const json = JSON.stringify(merged);
    PropertiesService.getScriptProperties().setProperty(this.id, json);
    CacheService.getScriptCache().put(this.id, json, Math.min(this.ttl, 21600));
    
    return merged;
  }
  
  clear() {
    CacheService.getScriptCache().remove(this.id);
    PropertiesService.getScriptProperties().deleteProperty(this.id);
  }
  
  _default() {
    return {
      id: this.id,
      state: 'initializing',
      percent: 0,
      message: 'Starting...',
      errors: [],
      startTime: Date.now(),
      lastUpdate: Date.now()
    };
  }
}

// Generate unique job ID
function generateJobId(prefix = 'job') {
  return prefix + '_' + Utilities.getUuid();
}
```

**Cache TTL Guidelines**:
- Partners/Contacts: 1 hour (3600s)
- Session Progress: 10 minutes (600s)
- Templates: 24 hours (86400s)
- User Preferences: Permanent (PropertiesService only)

### 4. Date Handling

**CRITICAL**: ALWAYS convert Date objects to strings before passing to client.

```javascript
// ❌ WRONG - Will crash
return { date: new Date() };

// ✅ CORRECT
return { date: new Date().toISOString() };

// For all server functions
function safeReturn(data) {
  return JSON.parse(JSON.stringify(data)); // Converts dates to strings
}
```

### 5. Error Handling Pattern

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
      new Date(),
      functionName,
      error.toString(),
      Session.getActiveUser().getEmail(),
      error.stack || ''
    ]);
  } catch (logError) {
    console.error('Failed to log error:', logError);
  }
  
  return {
    success: false,
    error: error.toString(),
    functionName: functionName,
    timestamp: new Date().toISOString()
  };
}

// Wrap all public functions
function publicFunction(params) {
  try {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters');
    }
    const result = doActualWork(params);
    return { success: true, data: result };
  } catch (error) {
    return handleError('publicFunction', error);
  }
}
```

### 6. Session Management Hook

```javascript
const useSession = () => {
  const [sessionId, setSessionId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);
  const pollCountRef = useRef(0);
  
  const startSession = async (documentType, formData) => {
    try {
      const result = await callGoogleScript('startDocumentGeneration', {
        documentType,
        formData
      });
      
      if (result.success) {
        const id = result.sessionId;
        setSessionId(id);
        startPolling(id);
        return id;
      } else {
        throw new Error(result.error || 'Failed to start generation');
      }
    } catch (error) {
      console.error('Session start error:', error);
      throw error;
    }
  };
  
  const startPolling = (id) => {
    if (!id) return;
    setPolling(true);
    pollCountRef.current = 0;
    
    const poll = async () => {
      if (!id) return;
      
      try {
        const result = await callGoogleScript('getJobProgress', id);
        
        if (result.success && result.progress) {
          setProgress(result.progress);
          pollCountRef.current++;
          
          if (result.progress.state === 'completed' || 
              result.progress.state === 'error') {
            stopPolling();
            return;
          }
        }
        
        // Adaptive polling intervals
        const interval = pollCountRef.current < 5 ? 1000 :
                        pollCountRef.current < 10 ? 2000 :
                        pollCountRef.current < 20 ? 3000 : 5000;
        
        pollRef.current = setTimeout(poll, interval);
        
      } catch (error) {
        console.error('Polling error:', error);
        stopPolling();
      }
    };
    
    poll();
  };
  
  const stopPolling = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  };
  
  const cancelSession = async () => {
    if (sessionId) {
      try {
        await callGoogleScript('cancelJob', sessionId);
      } catch (error) {
        console.error('Cancel error:', error);
      }
    }
    stopPolling();
    setSessionId(null);
    setProgress(null);
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, []);
  
  return {
    sessionId,
    progress,
    polling,
    startSession,
    cancelSession
  };
};
```

## Monday.com Integration

### Board Structure Schema

Based on analyzed boards, use this pattern for column definitions:

```javascript
const BOARD_SCHEMAS = {
  'MarketingApproval': {
    boardId: '9710279044',
    sheetName: 'MarketingApproval',
    columns: {
      name: { id: 'name', type: 'name' },
      status: { id: 'status', type: 'status' },
      owner: { id: 'person', type: 'people' },
      allianceManager: { id: 'text_mktkrhhj', type: 'text' },
      requestingDept: { id: 'status_1', type: 'status' },
      startDate: { id: 'date_mktkb5sf', type: 'date' },
      priority: { id: 'color_mktjmqkc', type: 'status' },
      requestType: { id: 'status_16', type: 'status' },
      urgency: { id: 'color_mktjnf1b', type: 'status' },
      cost: { id: 'numeric_mktjxtjk', type: 'numbers' }
    }
  },
  
  'MarketingCalendar': {
    boardId: '9770467355',
    sheetName: 'MarketingCalendar',
    columns: {
      name: { id: 'name', type: 'name' },
      month: { id: 'color_mktk2s2a', type: 'status' },
      week: { id: 'color_mktkd041', type: 'status' },
      activityType: { id: 'color_mktk258r', type: 'status' },
      eventDate: { id: 'date_mktkyhta', type: 'date' }
    }
  },
  
  'GWMondayData': {
    // Combines 3 boards: Partner Management (9791255941), 
    // Solution Ops (9791272390), Marketing (9855494527)
    boardIds: ['9791255941', '9791272390', '9855494527'],
    sheetName: 'GWMondayData',
    commonColumns: {
      name: { id: 'name', type: 'name' },
      subitems: { id: 'subtasks_mkp7am7a', type: 'subtasks' },
      comments: { id: 'status_1_mkn1ekgr', type: 'long_text' },
      activityStatus: { id: 'color_mktakkpw', type: 'status' },
      assignedBy: { id: '9791140449__multiple_person_mktq3ehf', type: 'people' },
      owner: { id: '9791140449__multiple_person_mktqh3q3', type: 'people' },
      importance: { id: 'color_mkt9mypk', type: 'status' },
      activityType: { id: 'color_mktqmpeh', type: 'status' },
      dateCreated: { id: 'date_1_mkn1x66b', type: 'date' },
      dateDue: { id: 'date_1_mkn1rbp8', type: 'date' },
      actualCompletion: { id: 'dup__of_date_due_mkn1zx06', type: 'date' },
      files: { id: 'files_mkn15ep0', type: 'file' },
      techBoardType: { id: '9791140449__color_mktzarg2', type: 'status' }
    }
  },
  
  'PartnerBoards': {
    // Template for partner-specific boards (e.g., WTW - 8465980366)
    sheetName: 'MondayData',
    commonColumns: {
      name: { id: 'name', type: 'name' },
      subitems: { id: 'subtasks_mkq8zjd4', type: 'subtasks' },
      comments: { id: 'status_1_mkn1ekgr', type: 'long_text' },
      activityStatus: { id: 'color_mktak50b', type: 'status' },
      owner: { id: 'dropdown_mkta767d', type: 'dropdown' },
      importance: { id: 'color_mktattds', type: 'status' },
      activity: { id: 'color_mktah6mj', type: 'status' },
      dateCreated: { id: 'date_1_mkn1x66b', type: 'date' },
      dateDue: { id: 'date_1_mkn1rbp8', type: 'date' },
      actualCompletion: { id: 'dup__of_date_due_mkn1zx06', type: 'date' },
      files: { id: 'files_mkn15ep0', type: 'file' },
      partnerName: { id: 'status_1_mkn1xbbx', type: 'status' }
    }
  }
};

// Status label mappings
const STATUS_LABELS = {
  activityStatus: {
    '0': 'Not Started',
    '1': 'Blockers',
    '2': 'In Progress',
    '3': 'Ongoing',
    '4': 'Halted',
    '5': 'Not Started',
    '6': 'SOLD',
    '10': 'Completed'
  },
  importance: {
    '0': '1. Urgent',
    '1': '2. High',
    '2': '3. Medium',
    '3': '4. Low',
    '5': '5. N/A'
  },
  approvalStatus: {
    '0': 'Submit Request Form',
    '1': 'Sent to Will for Approval',
    '2': 'PM Approved',
    '3': 'Ready to Start',
    '4': 'Final Approval',
    '5': 'Started',
    '6': 'Marketing Approved',
    '7': 'Will Approved',
    '8': 'Sent to Eric For Approval',
    '9': 'PM Rejected',
    '10': 'Marketing Rejected',
    '11': 'Send to AM to Adjust',
    '12': 'Rejected',
    '13': 'Will Rejected',
    '160': 'Sent to Marketing for Approval'
  }
};
```

### Monday.com GraphQL Queries

```javascript
// Get board structure
function getBoardStructure(boardId) {
  const query = `
    query {
      boards(ids: [${boardId}]) {
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
  `;
  return callMondayAPI(query);
}

// Get items with column values
function getBoardItems(boardId, limit = 500) {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        items_page(limit: ${limit}) {
          items {
            id
            name
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
  `;
  return callMondayAPI(query);
}

// Update item column value
function updateMondayItem(itemId, columnId, value) {
  const query = `
    mutation {
      change_column_value(
        item_id: ${itemId},
        column_id: "${columnId}",
        value: ${JSON.stringify(JSON.stringify(value))}
      ) {
        id
      }
    }
  `;
  return callMondayAPI(query);
}

// API call helper
function callMondayAPI(query, variables = {}) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('MONDAY_API_KEY');
  const options = {
    method: 'post',
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

### Column Value Parsing

```javascript
// Parse different column types
function parseColumnValue(column, columnDef) {
  const type = columnDef.type;
  const value = column.value ? JSON.parse(column.value) : null;
  
  switch (type) {
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

## React Component Patterns

### 1. HTML Structure

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    
    <!-- Bootstrap 5 CSS -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css">
    
    <!-- React 18 -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    
    <?!= include('styles') ?>
  </head>
  <body>
    <div id="root"></div>
    <div id="modal-root"></div>
    <div id="toast-root"></div>
    
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    
    <script>
      var INITIAL_DATA = '<?!= dataVariable ?>' || null;
    </script>
    
    <?!= include('app') ?>
  </body>
</html>
```

### 2. Toast Notification System

```javascript
const ToastContext = createContext(null);
const useToast = () => useContext(ToastContext);

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  
  const show = useCallback((msg, type = 'info', delay = 3000) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    if (delay > 0) {
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), delay);
    }
  }, []);
  
  const remove = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);
  
  return (
    <ToastContext.Provider value={{ show, remove }}>
      {children}
      {ReactDOM.createPortal(
        <div className="toast-container position-fixed bottom-0 end-0 p-3">
          {toasts.map(t => (
            <div key={t.id} className={`toast show bg-${
              t.type === 'danger' ? 'danger' : 
              t.type === 'success' ? 'success' : 'info'
            } text-white`}>
              <div className="toast-body d-flex justify-content-between align-items-center">
                {t.msg}
                <button 
                  type="button" 
                  className="btn-close btn-close-white ms-2" 
                  onClick={() => remove(t.id)}
                ></button>
              </div>
            </div>
          ))}
        </div>,
        document.getElementById('toast-root')
      )}
    </ToastContext.Provider>
  );
};
```

### 3. Progress Modal

```javascript
const ProgressModal = ({ show, progress, onCancel }) => {
  const percent = progress?.percent || 0;
  const message = progress?.message || 'Initializing...';
  const state = progress?.state || 'initializing';
  
  return ReactDOM.createPortal(
    <div className={`modal ${show ? 'd-block' : 'd-none'}`} 
         style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              {state === 'error' ? (
                <><i className="bi bi-x-circle-fill text-danger me-2"></i>Error</>
              ) : state === 'completed' ? (
                <><i className="bi bi-check-circle-fill text-success me-2"></i>Complete</>
              ) : (
                <><i className="bi bi-hourglass-split me-2"></i>Processing...</>
              )}
            </h5>
          </div>
          <div className="modal-body">
            <div className="progress mb-3" style={{ height: '25px' }}>
              <div 
                className={`progress-bar progress-bar-striped ${
                  state === 'running' ? 'progress-bar-animated' : ''
                } bg-${
                  state === 'error' ? 'danger' : 
                  state === 'completed' ? 'success' : 'primary'
                }`}
                style={{ width: `${percent}%` }}
              >
                {percent}%
              </div>
            </div>
            <p className="mb-2">{message}</p>
            {progress?.details && (
              <small className="text-muted d-block">{progress.details}</small>
            )}
            {progress?.errors?.length > 0 && (
              <div className="alert alert-danger mt-3">
                {progress.errors[progress.errors.length - 1].msg}
              </div>
            )}
          </div>
          <div className="modal-footer">
            {state !== 'completed' && state !== 'error' && (
              <button className="btn btn-danger" onClick={onCancel}>
                Cancel
              </button>
            )}
            {(state === 'completed' || state === 'error') && (
              <button className="btn btn-secondary" onClick={onCancel}>
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('modal-root')
  );
};
```

### 4. Dark Mode Support

```javascript
// CSS Variables
:root {
  --bs-primary: #0056b3;
  --bs-body-bg: #ffffff;
  --bs-body-color: #212529;
  --bs-card-bg: #ffffff;
  --bs-border-color: #dee2e6;
}

[data-theme="dark"] {
  --bs-body-bg: #1a1a1a;
  --bs-body-color: #f8f9fa;
  --bs-card-bg: #2a2a2a;
  --bs-border-color: #3a3a3a;
}

// React Hook
const useDarkMode = () => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 
           (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };
  
  return { theme, toggleTheme };
};
```

## Performance Optimization

### 1. Large Dataset Handling

```javascript
// Check size before caching
function getCachedData(cacheKey, fetchFunction, ttl = 3600) {
  const cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      console.error('Cache parse error:', e);
    }
  }
  
  const data = fetchFunction();
  const json = JSON.stringify(data);
  
  // Only cache if under 90KB (cache limit is 100KB)
  if (json.length < 90000) {
    try {
      CacheService.getScriptCache().put(cacheKey, json, ttl);
    } catch (e) {
      console.log('Cache write failed, data too large');
    }
  }
  
  return data;
}

// Estimate data size
function estimateDataSize() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Partner');
  const numRows = sheet.getLastRow();
  const numCols = sheet.getLastColumn();
  
  // Rough estimate: 50 bytes per cell average
  return numRows * numCols * 50;
}
```

### 2. Batch Operations

```javascript
// Process in batches to avoid timeout
function processLargeDataset(jobId) {
  const tracker = new ProgressTracker(jobId);
  const CHUNK_SIZE = 100;
  const MAX_RUNTIME = 5 * 60 * 1000; // 5 minutes
  
  const startTime = Date.now();
  let processed = 0;
  const total = getDataCount();
  
  while (processed < total) {
    // Check runtime limit
    if (Date.now() - startTime > MAX_RUNTIME) {
      // Save state and schedule continuation
      tracker.save({
        state: 'paused',
        percent: Math.floor((processed / total) * 100),
        message: 'Continuing in next execution...',
        resumeFrom: processed
      });
      
      // Schedule continuation trigger
      ScriptApp.newTrigger('resumeProcessing')
        .timeBased()
        .after(1000)
        .create();
      
      return;
    }
    
    // Process chunk
    const chunk = getDataChunk(processed, CHUNK_SIZE);
    processChunk(chunk);
    
    processed += chunk.length;
    
    // Update progress
    tracker.save({
      state: 'running',
      percent: Math.floor((processed / total) * 100),
      message: `Processing ${processed} of ${total}...`
    });
  }
  
  // Complete
  tracker.save({
    state: 'completed',
    percent: 100,
    message: 'Processing complete'
  });
}
```

### 3. Adaptive Polling

```javascript
function getPollingInterval(attemptCount) {
  if (attemptCount < 5) return 1000;   // First 5: 1 second
  if (attemptCount < 10) return 2000;  // Next 5: 2 seconds
  if (attemptCount < 20) return 3000;  // Next 10: 3 seconds
  if (attemptCount < 50) return 5000;  // Next 30: 5 seconds
  return 10000;                         // After 50: 10 seconds
}
```

### 4. Retry Pattern with Exponential Backoff

```javascript
function retryableOperation(operation, maxAttempts = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        Utilities.sleep(delay);
      }
    }
  }
  
  throw new Error(`Failed after ${maxAttempts} attempts: ${lastError}`);
}

// Usage
const result = retryableOperation(() => 
  UrlFetchApp.fetch(url, options)
);
```

## Security Best Practices

```javascript
// 1. Admin check based on email
const ADMIN_EMAILS = ['admin@example.com'];

function isAdmin(email) {
  email = email || Session.getActiveUser().getEmail();
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

function adminOnlyFunction(params) {
  if (!isAdmin()) {
    return {
      success: false,
      error: 'Unauthorized: Admin access required'
    };
  }
  return executeAdminFunction(params);
}

// 2. Store sensitive data in Script Properties
const API_KEY = PropertiesService.getScriptProperties().getProperty('MONDAY_API_KEY');

// 3. Validate all inputs
function validateFormData(data) {
  const errors = [];
  
  // Email validation
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Invalid email format');
  }
  
  // Date validation
  if (data.date) {
    const date = new Date(data.date);
    if (isNaN(date.getTime())) {
      errors.push('Invalid date');
    }
    
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    if (date < threeMonthsAgo) {
      errors.push('Date cannot be more than 3 months old');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

// 4. Sanitize error messages
function sanitizeError(error) {
  return error.toString()
    .replace(/at .+\(.+\)/g, '')      // Remove stack frames
    .replace(/\/.+\//g, '')            // Remove file paths
    .replace(/\d{10,}/g, '[ID]')      // Remove long IDs
    .substring(0, 200);                // Limit length
}

// 5. Use LockService for concurrent operations
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

## Manifest Configuration

```json
{
  "timeZone": "America/Chicago",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/script.container.ui",
    "https://www.googleapis.com/auth/script.external_request"
  ],
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "DOMAIN"
  }
}
```

## Common Pitfalls & Solutions

### ❌ Issue: Date objects crash UI
```javascript
// Wrong
return { date: new Date() };

// Correct
return { date: new Date().toISOString() };
```

### ❌ Issue: Cache size exceeded
```javascript
// Check size before caching
const json = JSON.stringify(data);
if (json.length < 90000) {
  cache.put(key, json, ttl);
}
```

### ❌ Issue: Session.getActiveUser() in triggers
```javascript
// Store user email in Properties on UI load
PropertiesService.getUserProperties()
  .setProperty('currentUser', userEmail);

// Retrieve in server functions
const currentUser = PropertiesService.getUserProperties()
  .getProperty('currentUser');
```

### ❌ Issue: Concurrent sheet modifications
```javascript
// Always use LockService
function updateSheet(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    // Perform updates
  } finally {
    lock.releaseLock();
  }
}
```

### ❌ Issue: Google Sheets formula calculations
```javascript
// Formulas don't auto-recalculate in scripts
// Force recalculation by editing a cell
function forceRecalculation(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const range = sheet.getRange(1, 1, lastRow, lastCol);
  range.setValues(range.getValues()); // This forces recalc
}
```

## Testing & Debugging

### 1. Development Helpers

```javascript
// Test environment setup
function testSetup() {
  console.log('Testing environment...');
  
  const tests = [
    { 
      name: 'Spreadsheet Access', 
      test: () => SpreadsheetApp.openById(SPREADSHEET_ID) 
    },
    { 
      name: 'Drive Access', 
      test: () => DriveApp.getFolderById(FOLDER_ID) 
    },
    { 
      name: 'Cache Service', 
      test: () => CacheService.getScriptCache().put('test', 'ok', 1) 
    },
    { 
      name: 'Properties Service', 
      test: () => PropertiesService.getScriptProperties()
                   .setProperty('test', 'ok') 
    }
  ];
  
  tests.forEach(({ name, test }) => {
    try {
      test();
      console.log(`✓ ${name}: OK`);
    } catch (e) {
      console.error(`✗ ${name}: ${e.toString()}`);
    }
  });
  
  return 'Test complete - check logs';
}
```

### 2. Client-Side Debugging

```javascript
// Add debug mode
const DEBUG = localStorage.getItem('debug') === 'true';

const debugLog = (...args) => {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
};

// Usage in components
debugLog('Session started:', sessionId);
debugLog('Progress update:', progress);

// Enable in console: localStorage.setItem('debug', 'true')
```

### 3. Performance Monitoring

```javascript
// Track function execution time
function timeFunction(fn, label) {
  const start = Date.now();
  const result = fn();
  const duration = Date.now() - start;
  console.log(`${label}: ${duration}ms`);
  return result;
}

// Usage
const data = timeFunction(
  () => getCachedPartners(),
  'getCachedPartners'
);
```

## Deployment Checklist

### Pre-Deployment
- [ ] Test all document types with sample data
- [ ] Verify caching with large datasets (1500+ records)
- [ ] Test concurrent users (5+ simultaneous)
- [ ] Check error handling for all API failures
- [ ] Validate email delivery
- [ ] Test with different user permissions
- [ ] Verify cleanup triggers are installed
- [ ] Test dark mode functionality
- [ ] Validate all Monday.com board integrations

### Deployment Steps
1. Update `appsscript.json` with correct scopes
2. Set Script Properties for configuration:
   ```javascript
   PropertiesService.getScriptProperties().setProperties({
     'MONDAY_API_KEY': 'your-api-key',
     'SPREADSHEET_ID': 'your-sheet-id',
     'FOLDER_ID': 'your-folder-id'
   });
   ```
3. Install time-based triggers for cleanup
4. Deploy as web app:
   - Go to Deploy > New Deployment
   - Type: Web app
   - Execute as: Me
   - Who has access: Anyone in your organization
5. Test deployed URL with different users
6. Monitor Cloud Logging for first 24 hours

### Post-Deployment
- [ ] Monitor Cloud Logging for errors
- [ ] Check cache hit rates
- [ ] Verify daily cleanup is running
- [ ] Review usage patterns
- [ ] Collect user feedback
- [ ] Document any issues and resolutions

## CSS Best Practices

```css
/* CSS Variables for Theming */
:root {
  --bs-primary: #0056b3;
  --bs-primary-rgb: 0, 86, 179;
  --gw-orange: #ff6900;
  --gw-blue: #0056b3;
  --gw-gray: #6c757d;
}

/* Dark Mode Variables */
[data-theme="dark"] {
  --bs-body-bg: #1a1a1a;
  --bs-body-color: #f8f9fa;
  --bs-card-bg: #2a2a2a;
  --bs-border-color: #3a3a3a;
}

/* Card Enhancements */
.card {
  border: 1px solid rgba(0, 0, 0, 0.125);
  box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
  transition: transform 0.2s, box-shadow 0.2s;
  background: var(--bs-card-bg);
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
}

/* Responsive Adjustments */
@media (max-width: 768px) {
  .btn-group {
    flex-direction: column;
    width: 100%;
  }
  
  .btn-group .btn {
    margin-bottom: 0.5rem;
    width: 100%;
  }
}
```

## Key Metrics (Production)

- **Performance**: Sub-second UI responses
- **Scalability**: Handles 50+ concurrent users
- **Reliability**: 99.9% uptime
- **Data**: Processes 1500+ partner records
- **Cache Hit Rate**: Target >80%
- **Average Session Duration**: 5-10 minutes
- **Error Rate**: <0.1%

## Troubleshooting Guide

### No Data Showing
- Verify sheet names match exactly
- Check user permissions on spreadsheet
- Confirm Monday.com API key is valid
- Check browser console for errors

### Slow Performance
- Enable caching (should be automatic)
- Reduce page size in pagination
- Check for large datasets
- Monitor API rate limits

### Authentication Issues
- Ensure user is logged into Google Workspace
- Verify domain restrictions
- Check session hasn't expired
- Clear browser cache and cookies

### Monday.com Integration Issues
- Verify board IDs are correct
- Check column IDs match schema
- Ensure API key has proper permissions
- Review Monday.com API rate limits

## Resources

- [Google Apps Script Documentation](https://developers.google.com/apps-script)
- [React 18 Documentation](https://react.dev)
- [Bootstrap 5 Documentation](https://getbootstrap.com)
- [Monday.com API Documentation](https://developer.monday.com)

---

**Last Updated**: January 2025  
**Production Tested**: ✅ 100+ daily users  
**Version**: 2.0
