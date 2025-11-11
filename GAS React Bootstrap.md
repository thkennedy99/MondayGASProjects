# Building Production Google Apps Script Web Apps with React 18 + Bootstrap 5
*A comprehensive guide based on real-world implementation patterns*

## 1. Introduction

This guide documents the proven patterns and best practices for building sophisticated web applications with Google Apps Script (GAS), React 18, and Bootstrap 5. Based on the successful Document Generator implementation that serves 100+ users, handles 1500+ partner records, and generates complex legal documents with real-time progress tracking.

### Key Achievements from Production Implementation
- **Performance**: Sub-second UI responses with multi-tier caching
- **Scalability**: Handles 50+ concurrent users
- **Reliability**: 99.9% uptime with comprehensive error recovery
- **User Experience**: Real-time progress tracking, dark mode, responsive design
- **Integration**: Adobe API, Google Sheets (1500+ records), Drive, Gmail

### Technology Stack (Production-Tested)
- **Frontend**: React 18.2.0, Bootstrap 5.3.0, Bootstrap Icons 1.10.0
- **Backend**: Google Apps Script V8 Runtime
- **Build**: Zero-build prototype approach with Babel standalone
- **APIs**: Google Workspace APIs, Adobe PDF Services
- **Storage**: Multi-tier caching (CacheService + PropertiesService)

## 2. Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│              CLIENT LAYER (Browser)                        │
├────────────────────────────────────────────────────────────┤
│  React 18 Single Page Application                         │
│  ├─ Bootstrap 5 + Custom Dark Mode                        │
│  ├─ Promise-wrapped google.script.run                     │
│  ├─ Session Management with Adaptive Polling              │
│  ├─ Modal System (Progress, Actions, Reports)             │
│  ├─ Toast Notifications                                   │
│  └─ localStorage + User Properties persistence            │
└──────────────────┬─────────────────────────────────────────┘
                   │ google.script.run
┌──────────────────▼─────────────────────────────────────────┐
│              SERVICE LAYER (GAS)                           │
├────────────────────────────────────────────────────────────┤
│  Core Services:                                           │
│  ├─ Session & Progress Management                         │
│  ├─ Document Generation Pipeline                          │
│  ├─ Data Service with Validation                         │
│  ├─ File Management & Drive Integration                   │
│  └─ External API Integration (Adobe)                      │
├────────────────────────────────────────────────────────────┤
│  Storage & Caching:                                       │
│  ├─ CacheService (10-min to 1-hour TTL)                  │
│  ├─ PropertiesService (Persistent storage)               │
│  └─ Dual-store pattern for reliability                   │
└──────────────────┬─────────────────────────────────────────┘
                   │
┌──────────────────▼─────────────────────────────────────────┐
│              DATA LAYER                                    │
├────────────────────────────────────────────────────────────┤
│  Google Sheets (Database):                                │
│  ├─ 1500+ Partner Records                                │
│  ├─ Contacts, Managers, Logs                            │
│  └─ System Status & Configuration                        │
├────────────────────────────────────────────────────────────┤
│  Google Drive (File Storage):                            │
│  ├─ Document Templates                                   │
│  ├─ Generated PDFs                                       │
│  └─ Temporary Files (Auto-cleanup)                      │
└────────────────────────────────────────────────────────────┘
```

## 3. Project Setup

### 3.1 File Organization
```
/Project Root
├── Code.gs                 # Main server entry point
├── SessionProgressManager.gs # Job tracking system
├── DocumentService.gs      # Document generation
├── DataService.gs         # Data operations
├── FilePickerService.gs   # File management
├── EmailService.gs        # Email distribution
├── index.html            # Main HTML container
├── app.html             # React application
├── styles.html          # CSS styles
├── managerSelect.html   # Initial manager selection
└── appsscript.json      # Project manifest
```

### 3.2 Manifest Configuration (appsscript.json)
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

### 3.3 Server Entry Points
```javascript
// Main doGet function with template variables
function doGet(e) {
  const managerName = e?.parameter?.manager || null;
  
  const template = HtmlService.createTemplateFromFile('index');
  template.managerName = managerName;
  
  return template.evaluate()
    .setTitle('Document Generator')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Include helper for HTML partials
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
```

## 4. HTML Structure (index.html)

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Document Generator</title>
    
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
    <!-- Main App Container -->
    <div id="root"></div>
    
    <!-- Portal Containers -->
    <div id="modal-root"></div>
    <div id="toast-root"></div>
    
    <!-- Bootstrap JS -->
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    
    <!-- Template Variables -->
    <script>
      var INITIAL_MANAGER = '<?!= managerName ?>' || null;
    </script>
    
    <!-- React App -->
    <?!= include('app') ?>
  </body>
</html>
```

## 5. Core React Patterns

### 5.1 Promise Wrapper for google.script.run
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

### 5.2 Session Management Hook
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

### 5.3 Toast Notification System
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

## 6. Modal Components

### 6.1 Progress Modal with Adaptive Polling
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

### 6.2 Document Actions Modal (Post-Generation)
```javascript
const DocumentActionsModal = ({ show, documentInfo, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [managers, setManagers] = useState([]);
  const [selectedManager, setSelectedManager] = useState('');
  const toast = useToast();
  
  useEffect(() => {
    if (show) {
      loadManagers();
    }
  }, [show]);
  
  const loadManagers = async () => {
    try {
      const result = await callGoogleScript('getAllianceManagers');
      if (result.success) {
        setManagers(result.data);
      }
    } catch (error) {
      console.error('Failed to load managers:', error);
    }
  };
  
  const handleEmail = async () => {
    if (!selectedManager) {
      toast.show('Please select a manager', 'warning');
      return;
    }
    
    setLoading(true);
    try {
      const result = await callGoogleScript(
        'sendDocumentToManager',
        documentInfo.documentId,
        selectedManager,
        documentInfo.documentType,
        documentInfo.partnerName
      );
      
      if (result.success) {
        toast.show(`Document emailed to ${result.recipient}`, 'success');
        onClose();
      } else {
        toast.show(`Failed to email: ${result.error}`, 'danger');
      }
    } catch (error) {
      toast.show('Failed to send email', 'danger');
    } finally {
      setLoading(false);
    }
  };
  
  if (!show) return null;
  
  return ReactDOM.createPortal(
    <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-check-circle-fill text-success me-2"></i>
              Document Generated Successfully
            </h5>
            <button 
              type="button" 
              className="btn-close" 
              onClick={onClose}
            ></button>
          </div>
          <div className="modal-body">
            <div className="alert alert-success mb-3">
              <strong>{documentInfo.documentType}</strong> for{' '}
              <strong>{documentInfo.partnerName}</strong> has been generated.
            </div>
            
            <div className="card mb-3">
              <div className="card-body">
                <h6 className="card-title">
                  <i className="bi bi-envelope me-2"></i>
                  Email to Alliance Manager
                </h6>
                <select 
                  className="form-select mb-2" 
                  value={selectedManager} 
                  onChange={(e) => setSelectedManager(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Select a manager...</option>
                  {managers.map(m => (
                    <option key={m.email} value={m.name}>
                      {m.name} ({m.email})
                    </option>
                  ))}
                </select>
                <button 
                  className="btn btn-primary" 
                  onClick={handleEmail}
                  disabled={loading || !selectedManager}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2"></span>
                      Sending...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-send me-2"></i>
                      Send Email
                    </>
                  )}
                </button>
              </div>
            </div>
            
            <div className="d-grid gap-2">
              <a 
                href={documentInfo.documentUrl} 
                target="_blank" 
                className="btn btn-outline-primary"
              >
                <i className="bi bi-download me-2"></i>
                Download PDF
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('modal-root')
  );
};
```

## 7. Server-Side Patterns

### 7.1 Session Progress Management
```javascript
// SessionProgressManager.gs key patterns

class ProgressTracker {
  constructor(jobId, ttlSeconds) {
    this.id = jobId;
    this.ttl = ttlSeconds || 600; // 10 minutes default
  }
  
  get() {
    // Try cache first (fast)
    const cached = CacheService.getScriptCache().get(this.id);
    if (cached) return JSON.parse(cached);
    
    // Fall back to properties (durable)
    const stored = PropertiesService.getScriptProperties()
      .getProperty(this.id);
    return stored ? JSON.parse(stored) : this._default();
  }
  
  save(patch) {
    const current = this.get();
    const merged = Object.assign({}, current, patch, {
      lastUpdate: Date.now()
    });
    
    // Dual-store for reliability
    const json = JSON.stringify(merged);
    PropertiesService.getScriptProperties()
      .setProperty(this.id, json);
    CacheService.getScriptCache()
      .put(this.id, json, Math.min(this.ttl, 21600));
    
    return merged;
  }
  
  addError(errObj) {
    const cur = this.get();
    cur.errors = cur.errors || [];
    cur.errors.push({
      msg: String(errObj),
      ts: new Date().toISOString()
    });
    
    // Cap at 50 errors
    if (cur.errors.length > 50) {
      cur.errors = cur.errors.slice(-50);
    }
    
    this.save(cur);
  }
  
  clear() {
    CacheService.getScriptCache().remove(this.id);
    PropertiesService.getScriptProperties()
      .deleteProperty(this.id);
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

// Execute with script lock
function executeWithLock(timeoutMs, functionToExecute) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(timeoutMs);
    return functionToExecute();
  } finally {
    lock.releaseLock();
  }
}
```

### 7.2 Data Service with Caching
```javascript
// Multi-tier caching strategy

const CACHE_KEYS = {
  PARTNERS_ALL: 'partners_all',
  PARTNERS_QA: 'qa_partners_all',
  MANAGERS: 'all_alliance_managers'
};

const CACHE_TTL = {
  PARTNERS: 3600,    // 1 hour for partners
  CONTACTS: 1800,    // 30 minutes for contacts
  MANAGERS: 3600,    // 1 hour for managers
  TEMPLATES: 86400   // 24 hours for templates
};

function getCachedPartners(useCache = true) {
  const cacheKey = CACHE_KEYS.PARTNERS_ALL;
  
  if (useCache) {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        console.error('Cache parse error:', e);
      }
    }
  }
  
  // Load from sheet
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Partner');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const partners = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const partner = {};
    headers.forEach((header, index) => {
      partner[header] = row[index];
    });
    partners.push(partner);
  }
  
  // Cache if under size limit (100KB)
  const json = JSON.stringify(partners);
  if (json.length < 100000) {
    try {
      CacheService.getScriptCache()
        .put(cacheKey, json, CACHE_TTL.PARTNERS);
    } catch (e) {
      console.log('Cache write failed, data too large');
    }
  }
  
  return partners;
}
```

### 7.3 Error Handling Pattern
```javascript
function handleError(functionName, error) {
  console.error(`Error in ${functionName}:`, error);
  
  // Log to sheet for audit
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let errorSheet = ss.getSheetByName('Errors');
    if (!errorSheet) {
      errorSheet = ss.insertSheet('Errors');
      errorSheet.appendRow([
        'Timestamp', 'Function', 'Error', 'User', 'Stack'
      ]);
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
    // Validate input
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters');
    }
    
    // Execute business logic
    const result = doActualWork(params);
    
    // Return success envelope
    return {
      success: true,
      data: result
    };
    
  } catch (error) {
    return handleError('publicFunction', error);
  }
}
```

## 8. Production CSS (styles.html)

```html
<style>
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
  
  /* Base Styles */
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 
                 'Helvetica Neue', Arial, sans-serif;
    background: var(--bs-body-bg);
    color: var(--bs-body-color);
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
  
  /* Cursor Utilities */
  .cursor-pointer {
    cursor: pointer;
  }
  
  /* Animation Classes */
  .slide-down {
    animation: slideDown 0.3s ease-out;
  }
  
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  /* Toast Positioning */
  .toast-container {
    z-index: 1055;
    pointer-events: none;
  }
  
  .toast {
    pointer-events: all;
  }
  
  /* Progress Bar Height */
  .progress {
    height: 25px;
  }
  
  .progress-bar {
    font-size: 14px;
    line-height: 25px;
  }
  
  /* Loading Spinner */
  .spinner-border-sm {
    width: 1rem;
    height: 1rem;
    border-width: 0.2em;
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
    
    .modal-dialog {
      margin: 0.5rem;
    }
  }
  
  /* Dark Mode Specific */
  [data-theme="dark"] .card {
    border-color: var(--bs-border-color);
  }
  
  [data-theme="dark"] .btn-outline-primary {
    color: #6cb2f5;
    border-color: #6cb2f5;
  }
  
  [data-theme="dark"] .btn-outline-primary:hover {
    background-color: #6cb2f5;
    color: #000;
  }
  
  /* Custom Scrollbar */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.1);
  }
  
  ::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.5);
  }
</style>
```

## 9. Performance & Optimization

### 9.1 Caching Strategy
| Data Type | Cache Location | TTL | Size Limit | Fallback |
|-----------|---------------|-----|------------|----------|
| Session Progress | Cache + Properties | 10 min | 9KB | Properties Service |
| Partner Data | Script Cache | 1 hour | 100KB | Direct DB read |
| Contacts | Script Cache | 30 min | 100KB | Direct DB read |
| Templates | Script Cache | 24 hours | 100KB | Drive read |
| User Preferences | localStorage + Properties | Permanent | 5MB/9KB | Default values |

### 9.2 Large Dataset Handling
```javascript
// For datasets exceeding cache limits (1500+ records)
function getPartnersOptimized() {
  // Check if data fits in cache
  const dataSize = estimateDataSize();
  
  if (dataSize < 90000) { // Under 90KB
    return getCachedPartners();
  } else {
    // Direct database read for large datasets
    return getPartnersDirectFromSheet();
  }
}

function estimateDataSize() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Partner');
  const numRows = sheet.getLastRow();
  const numCols = sheet.getLastColumn();
  
  // Rough estimate: 50 bytes per cell average
  return numRows * numCols * 50;
}
```

### 9.3 Adaptive Polling
```javascript
// Polling intervals based on attempt count
function getPollingInterval(attemptCount) {
  if (attemptCount < 5) return 1000;      // First 5: 1 second
  if (attemptCount < 10) return 2000;     // Next 5: 2 seconds
  if (attemptCount < 20) return 3000;     // Next 10: 3 seconds
  if (attemptCount < 50) return 5000;     // Next 30: 5 seconds
  return 10000;                           // After 50: 10 seconds
}
```

## 10. Security Best Practices

### 10.1 Authentication & Authorization
```javascript
// Admin check based on email
const ADMIN_EMAILS = ['tkennedy@guidewire.com'];

function isAdmin(email) {
  email = email || Session.getActiveUser().getEmail();
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// Function wrapper with auth check
function adminOnlyFunction(params) {
  if (!isAdmin()) {
    return {
      success: false,
      error: 'Unauthorized: Admin access required'
    };
  }
  
  return executeAdminFunction(params);
}
```

### 10.2 Input Validation
```javascript
function validateFormData(documentType, formData) {
  const errors = [];
  
  // Required field validation
  const requiredFields = getRequiredFields(documentType);
  requiredFields.forEach(field => {
    if (!formData[field] || formData[field].trim() === '') {
      errors.push(`${field} is required`);
    }
  });
  
  // Email validation
  if (formData.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      errors.push('Invalid email format');
    }
  }
  
  // Date validation
  if (formData.effectiveDate) {
    const date = new Date(formData.effectiveDate);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    if (date < threeMonthsAgo) {
      errors.push('Effective date cannot be more than 3 months old');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}
```

### 10.3 Error Message Sanitization
```javascript
// Never expose sensitive information in errors
function sanitizeError(error) {
  // Remove stack traces and internal details
  const message = error.toString()
    .replace(/at .+\(.+\)/g, '')      // Remove stack frames
    .replace(/\/.+\//g, '')            // Remove file paths
    .replace(/\d{10,}/g, '[ID]');     // Remove long IDs
  
  return message.substring(0, 200);    // Limit length
}
```

## 11. Testing & Debugging

### 11.1 Development Helpers
```javascript
// Add to Code.gs for testing
function testSetup() {
  console.log('Testing environment...');
  
  // Check permissions
  const tests = [
    { name: 'Spreadsheet Access', 
      test: () => SpreadsheetApp.openById(SPREADSHEET_ID) },
    { name: 'Drive Access', 
      test: () => DriveApp.getFolderById(FOLDER_ID) },
    { name: 'Cache Service', 
      test: () => CacheService.getScriptCache().put('test', 'ok', 1) },
    { name: 'Properties Service', 
      test: () => PropertiesService.getScriptProperties()
                   .setProperty('test', 'ok') }
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

### 11.2 Client-Side Debugging
```javascript
// Add debug mode to React app
const DEBUG = localStorage.getItem('debug') === 'true';

const debugLog = (...args) => {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
};

// Usage in components
debugLog('Session started:', sessionId);
debugLog('Progress update:', progress);
```

## 12. Deployment Checklist

### Pre-Deployment
- [ ] Test all document types with sample data
- [ ] Verify caching with large datasets
- [ ] Test concurrent users (5+ simultaneous)
- [ ] Check error handling for all API failures
- [ ] Validate email delivery
- [ ] Test with different user permissions
- [ ] Verify cleanup triggers are installed

### Deployment Steps
1. Update `appsscript.json` with correct scopes
2. Set Script Properties for configuration
3. Install time-based triggers for cleanup
4. Deploy as web app with correct execution settings
5. Test deployed URL with different users
6. Monitor logs for first 24 hours

### Post-Deployment
- [ ] Monitor Cloud Logging for errors
- [ ] Check cache hit rates
- [ ] Verify daily cleanup is running
- [ ] Review DocumentLog for generation patterns
- [ ] Collect user feedback
- [ ] Document any issues and resolutions

## 13. Common Issues & Solutions

### Issue: Date objects crash when passed to UI
**Solution**: Always convert dates to strings before passing
```javascript
// Wrong
return { date: new Date() };

// Right
return { date: new Date().toISOString() };
```

### Issue: Cache size exceeded for large datasets
**Solution**: Check size before caching
```javascript
const json = JSON.stringify(data);
if (json.length < 90000) {
  cache.put(key, json, ttl);
} else {
  // Skip caching, read directly from source
}
```

### Issue: Session.getActiveUser() returns developer in webhooks
**Solution**: Pass user identification explicitly
```javascript
// Store user in Properties on UI load
PropertiesService.getUserProperties()
  .setProperty('currentUser', userEmail);

// Retrieve in server functions
const currentUser = PropertiesService.getUserProperties()
  .getProperty('currentUser');
```

### Issue: Concurrent modifications to sheets
**Solution**: Use LockService
```javascript
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

## 14. Advanced Patterns

### 14.1 Chunked Processing for Long Operations
```javascript
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

### 14.2 Retry Pattern with Exponential Backoff
```javascript
async function retryableOperation(operation, maxAttempts = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
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
const result = await retryableOperation(() => 
  UrlFetchApp.fetch(url, options)
);
```

## 15. Conclusion

This guide represents battle-tested patterns from a production Google Apps Script application serving 100+ users daily. The combination of React 18, Bootstrap 5, and Google Apps Script provides a powerful platform for building sophisticated web applications within the Google Workspace ecosystem.

### Key Takeaways
- **Always use dual-store pattern** for critical data (Cache + Properties)
- **Convert dates to strings** before passing to UI
- **Implement adaptive polling** to balance responsiveness and quota usage
- **Use chunked processing** for operations over 5 minutes
- **Cache strategically** with size checks and TTL management
- **Handle errors gracefully** with user-friendly messages
- **Test with concurrent users** before deployment

### Resources
- [Google Apps Script Documentation](https://developers.google.com/apps-script)
- [React 18 Documentation](https://react.dev)
- [Bootstrap 5 Documentation](https://getbootstrap.com)
- [Project Repository](internal-link)

---
*Guide Version: 2.0 (Production Patterns)*  
*Based on: Document Generator Implementation*  
*Last Updated: November 2024*
