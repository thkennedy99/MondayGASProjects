# Building Rich, Reflexive Web Apps in Google Apps Script with React + Bootstrap/CoreUI

_A fully updated, productionâ€‘ready guide (July 2025)._

> **Revision highlights (after Claude, Gemini & Grok reviews + your request):**
> - Internal execution target set to **â‰¤15 minutes** per server run (chunk longer jobs). Official cap is still 6 minutesâ€”design accordingly.
> - Clarified **simultaneous execution limits** (30/user, 1,000/script) and typical bottlenecks.
> - Documented **CacheService** (TTL 21,600â€¯s, 100â€¯KB/value, eviction risk) and **PropertiesService** (~9â€¯KB/value) with JSON chunking patterns.
> - Added a **mode-aware session strategy** (Execute-as-user vs Execute-as-me).
> - Expanded **LockService** guidance (Script vs Document vs User locks + retry/backoff).
> - Hardened **clickjacking defenses** when using `XFrameOptionsMode.ALLOWALL`.
> - Standardized on **React 18â€™s `createRoot`**; removed legacy `ReactDOM.render`.
> - Included **a11y guidance** for modals/toasts (focus trap, ARIA).
> - Labeled the **zero-build path as prototype only**; provided a production build workflow (clasp + bundler).
> - Added **observability/logging** (Cloud Logging/Error Reporting) and **performance tips** (batching, adaptive polling).

---

## 0. Errata & Gaps (Quick Reference)

### 0.1 Fixed Code / Syntax Errors
- `{.formData, â€¦}` â†’ `{ ...formData, â€¦ }`
- `[functionName](.args)` â†’ `[functionName](...args)`
- Only use `ReactDOM.createRoot` (React 18); remove `ReactDOM.render`.
- Modal portal now mounts/unmounts cleanly; disposes Bootstrap instance.
- CSS typos fixed (`rgba(0,0,0,.125/.075)`).

### 0.2 Newly Added / Strengthened Sections
- Security (CSP hints, CSRF-ish nonces, clickjacking mitigations).
- Concurrency & data integrity with proper locks and retries.
- Caching & properties size/TTL limits (plus chunking pattern).
- Performance/Quota section with concrete limits.
- Accessibility patterns.
- Tooling/testing pipeline (clasp + bundler, gas-local-runner, Jest).
- Deployment checklist.

---

## 1. Introduction

Google Apps Script (GAS) lets you deploy secure, authenticated web apps inside Googleâ€™s infrastructure with instant access to Sheets, Drive, Gmail, etc. Pairing GAS with **React 18** and **Bootstrap/CoreUI** gives you a modern, component-based UI without external servers.

We present two paths:

1. **Zero-build prototype path** â€“ CDN React + Babel standalone in the browser. Fast to start, weaker CSP and bundle size.  
2. **Production path** â€“ Bundle with Vite/Rollup/Esbuild + push via `clasp`. Tight CSP, smaller payloads, TypeScript support.

**Execution budget:** Youâ€™ve observed >12â€¯min runs. Set an **internal design cap of 15â€¯min** per server call. Officially, Apps Script executions are limited to ~6â€¯minâ€”so chunk long jobs, use triggers/queues, or multi-pass workflows.

---

## 2. Architecture Overview

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ React 18 + Bootstrap UI (Client in index.html)â”‚
â”‚   â€¢ Promise-wrapped google.script.run RPC     â”‚
â”‚   â€¢ Modal & Toast portals                     â”‚
â”‚   â€¢ State hooks / optional Zustand/Redux      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–²â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                â”‚                       â”‚
                â”‚ google.script.run     â”‚
                â”‚ (async callbacks)     â”‚
                â–¼                       â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ Apps Script Server (Code.gs & friends)        â”‚
â”‚   â€¢ Business logic (Sheets/Drive/Gmail/etc.)  â”‚
â”‚   â€¢ LockService wrappers                      â”‚
â”‚   â€¢ CacheService / PropertiesService          â”‚
â”‚   â€¢ Error envelope + Cloud Logging            â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 3. Project Setup

### 3.1 Files

```
/Code.gs              # Server code
/index.html           # React mount & script includes
/styles.html          # Custom CSS
/partials/*.html      # Optional HTML snippets
/appsscript.json      # GAS manifest
```

### 3.2 Manifest (`appsscript.json`)

```jsonc
{
  "timeZone": "America/Chicago",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/script.container.ui"
  ],
  "webapp": {
    "executeAs": "USER_ACCESSING",   // or "USER_DEPLOYING"
    "access": "DOMAIN"               // or "ANYONE", etc.
  }
}
```

### 3.3 `doGet`

```javascript
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('My GAS React App')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) // if iframe needed
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

> If you use `ALLOWALL`, you must add your own clickjacking defense (see Â§11).

### 3.4 `include` helper

```javascript
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
```

---

## 4. HTML Shell (Zero-Build Prototype)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>My GAS React App</title>

  <!-- Bootstrap / CoreUI -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">
  <!-- Optional: CoreUI (already includes Bootstrap) -->
  <!-- <link rel="stylesheet" href="https://unpkg.com/@coreui/coreui@5/dist/css/coreui.min.css"> -->

  <?!= include('styles'); ?>
</head>
<body>
  <div id="root"></div>
  <div id="modal-root"></div>
  <div id="toast-root" class="position-fixed bottom-0 end-0 p-3"></div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

  <script type="text/babel">
    // --- React code lives here in prototype mode ---
  </script>
</body>
</html>
```

> **Production**: bundle this code, drop Babel-in-browser and external CDN scripts, enforce strict CSP.

---

## 5. Client â†” Server Communication

### 5.1 Promise Wrapper for `google.script.run`

```javascript
const callGoogleScript = (functionName, ...args) =>
  new Promise((resolve, reject) => {
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
      // Local mock (dev only)
      console.log(`Mock call â†’ ${functionName}`, args);
      setTimeout(() => resolve({ success: true, mock: true }), 200);
    }
  });
```

### 5.2 Server Error Envelope

```javascript
function handleError(fn, error) {
  console.error(`Error in ${fn}:`, error);
  return { success: false, error: String(error), functionName: fn, ts: new Date().toISOString() };
}
```

Wrap every server entrypoint in try/catch and return this envelope.

---

## 6. React 18 Bootstrap

```javascript
const { useState, useEffect, useRef, useCallback, createContext, useContext } = React;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ErrorBoundary>
    <Providers>
      <App />
    </Providers>
  </ErrorBoundary>
);
```

### 6.1 ErrorBoundary

```javascript
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(error){ return { hasError:true, error }; }
  componentDidCatch(error, info){ console.error('Boundary:', error, info); }
  render(){
    if (this.state.hasError){
      return (
        <div className="alert alert-danger m-4">
          <h4>Something went wrong</h4>
          <p>{this.state.error?.message}</p>
          <button className="btn btn-primary" onClick={()=>location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### 6.2 Providers Wrapper

```javascript
const Providers = ({ children }) => (
  <ToastProvider>
    <ModalProvider>
      {children}
    </ModalProvider>
  </ToastProvider>
);
```

---

## 7. Modal System (React Portals + Bootstrap 5)

**Goals:** true React Portals, proper cleanup, optional static backdrop, focus management.

```javascript
const ModalContext = createContext(null);
export const useModal = () => useContext(ModalContext);

const ModalProvider = ({ children }) => {
  const modalRoot = document.getElementById('modal-root');
  const [modals, setModals] = useState([]);

  const show = useCallback((jsx, options = {}) => {
    const id = crypto.randomUUID();
    setModals(m => [...m, { id, jsx, options }]);
    return id;
  }, []);

  const hide = useCallback(id => setModals(m => m.filter(modal => modal.id !== id)), []);

  return (
    <ModalContext.Provider value={{ show, hide }}>
      {children}
      {modals.map(({ id, jsx, options }) => (
        <ModalPortal key={id} id={id} options={options} onHide={() => hide(id)} root={modalRoot}>
          {jsx}
        </ModalPortal>
      ))}
    </ModalContext.Provider>
  );
};

const ModalPortal = ({ id, children, options, onHide, root }) => {
  const elRef = useRef(document.createElement('div'));
  const modalRef = useRef(null);

  useEffect(() => {
    const el = elRef.current;
    root.appendChild(el);

    el.innerHTML = `
      <div class="modal fade" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog ${options?.size ? `modal-${options.size}` : ''} modal-dialog-centered">
          <div class="modal-content"></div>
        </div>
      </div>`;

    const modalEl = el.querySelector('.modal');
    const contentEl = el.querySelector('.modal-content');
    modalRef.current = new bootstrap.Modal(modalEl, {
      backdrop: options?.static ? 'static' : true,
      keyboard: !options?.static
    });

    modalEl.addEventListener('hidden.bs.modal', onHide, { once: true });
    modalRef.current.show();

    return () => {
      modalRef.current?.hide();
      bootstrap.Modal.getInstance(modalEl)?.dispose?.();
      root.removeChild(el);
    };
  }, [onHide, options, root]);

  return ReactDOM.createPortal(
    <>
      <div className="modal-header">
        <h5 className="modal-title" id={`modal-${id}-label`}>{options?.title || 'Dialog'}</h5>
        <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div className="modal-body" id={`modal-${id}-desc`}>{children}</div>
      {options?.footer && <div className="modal-footer">{options.footer}</div>}
    </>,
    elRef.current.querySelector('.modal-content')
  );
};
```

### 7.1 Confirm Helper

```javascript
const useConfirm = () => {
  const { show } = useModal();
  return (message) => new Promise(resolve => {
    const footer = (
      <>
        <button className="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
        <button className="btn btn-danger" onClick={() => resolve(true)} data-bs-dismiss="modal">Confirm</button>
      </>
    );
    show(<p>{message}</p>, { title: 'Confirm', size: 'sm', footer });
  });
};
```

---

## 8. Toast System

```javascript
const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const show = useCallback((msg, type='info', delay=3000) => {
    const id = crypto.randomUUID();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), delay);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {ReactDOM.createPortal(
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast align-items-center text-white bg-${t.type} show mb-2`} role="status" aria-live="polite">
              <div className="d-flex">
                <div className="toast-body">{t.msg}</div>
                <button className="btn-close btn-close-white me-2 m-auto" onClick={()=>setToasts(s=>s.filter(x=>x.id!==t.id))}></button>
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

---

## 9. Sessions, Caching & Concurrency

### 9.1 Session Strategy (Execute-as-user vs Execute-as-me)

```javascript
const SESSION_PREFIX = 'sess_';

function sessionKey(key){
  const email = Session.getActiveUser().getEmail() || 'anon';
  return `${SESSION_PREFIX}${email}_${key}`;
}

function setUserSession(key, value, ttl = 600){
  CacheService.getUserCache().put(sessionKey(key), JSON.stringify(value), Math.min(ttl, 21600));
}

function getUserSession(key){
  const v = CacheService.getUserCache().get(sessionKey(key));
  return v ? JSON.parse(v) : null;
}

function clearUserSession(key){
  CacheService.getUserCache().remove(sessionKey(key));
}
```

- **If executeAs = USER_ACCESSING**: `getUserCache()` is per-user.  
- **If executeAs = USER_DEPLOYING**: cache is shared under your account; key by visitorâ€™s email or use ScriptCache/Properties.

### 9.2 Locking Helpers

```javascript
function withLock(type = 'script', timeoutMs = 10000, fn){
  const lockSvc = LockService;
  const lock = type === 'document' ? lockSvc.getDocumentLock()
             : type === 'user'     ? lockSvc.getUserLock()
             : lockSvc.getScriptLock();
  lock.waitLock(timeoutMs);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

async function withRetry(fn, tries=3, delay=300){
  try { return await fn(); }
  catch(e){
    if (tries <= 1) throw e;
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, tries - 1, delay * 2);
  }
}
```

Use ScriptLock for global mutual exclusion, DocumentLock when contention is sheet-bound, UserLock when isolating per-user updates.

### 9.3 Cleanup Trigger

Create a time-driven trigger to purge temp files/sheets (`Temp_*`) older than N hours.

---

## 10. Data Layer Patterns (Sheets)

- **Batch everything**: one `getValues()`, transform in memory, one `setValues()`.
- Create a header map once.
- Use `copyTo` for large block copies.
- Avoid `getValue()`/`setValue()` in loops.

```javascript
function getTasks(filters) {
  try {
    return withLock('document', 2000, () => {
      const ss = SpreadsheetApp.getActive();
      const sh = ss.getSheetByName('Tasks') || ss.insertSheet('Tasks').appendRow(['ID','Title','Desc','Status','Created','Updated']).getSheet();
      const values = sh.getDataRange().getValues();
      const [headers, ...rows] = values;
      let tasks = rows.map(r => Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
      if (filters?.status && filters.status !== 'all') {
        tasks = tasks.filter(t => t.Status === filters.status);
      }
      return { success:true, data: tasks };
    });
  } catch (err) { return handleError('getTasks', err); }
}
```

---

## 11. Security Hardening

1. **Clickjacking**: If your app can be iframed (`ALLOWALL`), add CSP `frame-ancestors` (limited via `<meta http-equiv>`), or a JS frame-buster snippet.  
2. **CSRF-ish tokens**: For any state-changing RPC, issue a nonce (Cache/Properties) and validate on server.  
3. **Input validation**: Sanitize user input on server; validate MIME types for uploads; set Drive sharing explicitly.  
4. **CSP & inline scripts**: Bundling removes `unsafe-inline` needs.  
5. **Escaping HTML**: Never trust inputs in `innerHTML`; use textContent or sanitize.

---

## 12. Accessibility (a11y)

- Bootstrap handles basic focus trap, but test keyboard-only flows.  
- Add `aria-labelledby`, `aria-describedby` on modals.  
- Ensure visible focus outlines.  
- Toasts need `role="status"` or `aria-live="polite"`â€”donâ€™t rely only on color.

---

## 13. Performance & Quotas

| Area | Practical Target | Official Limit (typical) | Mitigation |
|------|-------------------|--------------------------|------------|
| Execution time | â‰¤ 15 min per call | ~6 min per run | Chunk work, queue via triggers |
| Simultaneous execs | < 30/user, < 1,000/script | 30/user, 1000/script | Backoff, batch calls, debounce UI |
| CacheService TTL | Use â‰¤ 21,600â€¯s | Max 21,600â€¯s | Refill on miss, accept eviction |
| Cache/Property size | < 90â€¯KB/entry | 100â€¯KB Cache, ~9â€¯KB Property | Chunk JSON across keys |
| Sheets calls | Batch | Quota per call count | `getValues/setValues`, `copyTo`, avoid loops |

Use `withRetry()` for transient quota/lock failures.

---

## 14. Testing & Local Dev

- **clasp** to push/pull Apps Script files.  
- **gas-local-runner** / `clasp run` for unit tests on server code.  
- Client: Jest/Vitest + React Testing Library; mock `google.script.run`.  
- Local dev server: host compiled bundle and inject mocked google APIs.

---

## 15. Deployment Checklist

- [ ] Manifest scopes minimized and reviewed.  
- [ ] Error logging to Cloud Logging or another sink.  
- [ ] Friendly UI for auth failures.  
- [ ] Multi-user concurrency tested (locks).  
- [ ] Time-based cleanup triggers configured.  
- [ ] CSP / clickjacking protections in place.  
- [ ] Dev mocks removed/disabled.  
- [ ] Long-running jobs chunked/queued (<15â€¯min).

---

## 16. Advanced Patterns

- **Adaptive polling hook** (increase interval after idle or on error).  
- **useDebounce** for search inputs.  
- **Optimistic UI** with rollback on error.  
- **Virtualized tables** (clusterize.js/virtual-list) for big datasets.  
- **Hash routing** (custom or tiny router) to avoid BrowserRouter limitations on GAS.  
- **State management**: Small apps = hooks/context; large = Zustand or Redux Toolkit.

---

## 17. Utility Snippets

### 17.1 Objects â†” Sheets

```javascript
function objectsToSheet(sheet, objs, headerOrder){
  if (!objs.length) return;
  const headers = headerOrder || Object.keys(objs[0]);
  sheet.clearContents();
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  const rows = objs.map(o => headers.map(h => o[h] ?? ''));
  sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
}
```

### 17.2 UUID

```javascript
const uuid = () => Utilities.getUuid();
```

### 17.3 Safe JSON Parse

```javascript
const safeJSON = (str, fallback=null) => { try{ return JSON.parse(str); } catch { return fallback; } };
```

---

## 18. `styles.html` (Fixed)

```html
<style>
  :root{
    --bs-primary:#0d6efd;
    --bs-primary-rgb:13,110,253;
  }
  body{ background:#f8f9fa; }
  .card{
    border:1px solid rgba(0,0,0,.125);
    box-shadow:0 .125rem .25rem rgba(0,0,0,.075);
    transition:transform .2s, box-shadow .2s;
  }
  .card:hover{
    transform:translateY(-2px);
    box-shadow:0 .5rem 1rem rgba(0,0,0,.15);
  }
  .toast-container{ z-index:1050; }
  @media (max-width:768px){
    .btn-group{ flex-direction:column; width:100%; }
    .btn-group .btn{ margin-bottom:.5rem; }
  }
</style>
```

---

**End of Guide**

---
