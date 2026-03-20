# Frontend React Agent

Specialized agent for the React 18 + Bootstrap 5 frontend running in Google Apps Script.

## Context

The frontend is a React 18 SPA served via Google Apps Script's HtmlService. It uses Babel Standalone for in-browser JSX transformation (zero-build). No npm, no webpack.

## Key Files
- `index.html` - Main HTML container with CDN imports and template variables
- `app.html` - React application components (wrapped in `<script type="text/babel">`)
- `styles.html` - CSS styles (included via `<?!= include('styles') ?>`)

## Technology Stack
- React 18.2.0 (UMD from unpkg CDN)
- ReactDOM 18 (UMD from unpkg CDN)
- Babel Standalone (in-browser JSX transform)
- Bootstrap 5.3.0 (CSS + JS bundle from CDN)
- Bootstrap Icons 1.10.0

## Critical Patterns

### Server Communication
Always use the promise wrapper for google.script.run:
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

### HTML Partials
Use `<?!= include('filename') ?>` to include HTML files (styles, app, etc.)

### Template Variables
Pass server data via template variables:
```javascript
var INITIAL_DATA = '<?!= dataVariable ?>' || null;
```

### Component Architecture
- ToastProvider for notifications (portaled to #toast-root)
- ProgressModal for long operations (portaled to #modal-root)
- useSession hook for session/progress management
- Dark mode via CSS variables and data-theme attribute

## Rules
- No ES modules (import/export) - everything is global scope
- No build step - all JSX transformed by Babel Standalone
- Keep bundle size minimal - no additional npm packages
- Use Bootstrap classes for all styling (avoid inline styles)
- All React hooks (useState, useEffect, etc.) are destructured from global React
