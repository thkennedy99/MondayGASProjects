# Refresh Tracking for GAS/React/Bootstrap Apps

A generic, copy-paste approach to auto-refreshing stale pages in Google Apps Script web apps using React and Bootstrap.

## Quick Start

Add these three blocks to your app's main HTML file (the one containing your React root).

### 1. Utility Functions and Config (plain `<script>` block, before your React code)

```javascript
<script>
// --- Refresh Tracking Utilities ---

function setStorage(name, value) {
    try {
        localStorage.setItem(name, value);
        var stored = localStorage.getItem(name);
        if (stored !== String(value)) {
            console.error('localStorage write verification failed for "' + name + '"');
        }
    } catch (e) {
        console.error('Error writing to localStorage ("' + name + '"):', e);
    }
}

function getStorage(name) {
    try {
        return localStorage.getItem(name);
    } catch (e) {
        console.error('Error reading from localStorage ("' + name + '"):', e);
        return null;
    }
}

// Configuration — adjust these for your app
var CACHE_STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // Max age before auto-refresh
var CACHE_CHECK_INTERVAL_MS  = 1 * 60 * 60 * 1000;  // Background check frequency
var CACHE_REFRESH_KEY        = 'lastRefreshTimestamp'; // localStorage key

function getCacheAgeHours() {
    var stored = getStorage(CACHE_REFRESH_KEY);
    if (!stored) return null;
    var ageMs = Date.now() - parseInt(stored, 10);
    return (ageMs / (1000 * 60 * 60)).toFixed(1);
}

function checkAndRefreshIfStale() {
    var ageHours = getCacheAgeHours();
    if (ageHours === null) {
        // First visit — seed the timestamp, no reload
        setStorage(CACHE_REFRESH_KEY, Date.now().toString());
        return false;
    }
    var thresholdHours = CACHE_STALE_THRESHOLD_MS / (1000 * 60 * 60);
    if (parseFloat(ageHours) >= thresholdHours) {
        console.log('Cache is stale (' + ageHours + ' hours old, threshold: ' +
                    thresholdHours + ' hours). Refreshing page...');
        // Update BEFORE reload to prevent infinite refresh loops
        setStorage(CACHE_REFRESH_KEY, Date.now().toString());
        window.location.reload();
        return true;
    }
    return false;
}

// --- End Refresh Tracking Utilities ---
</script>
```

### 2. React Hook (inside your Babel/JSX `<script type="text/babel">` block)

Place this `useEffect` inside your root `App` component:

```jsx
// --- Auto-refresh tracking ---
useEffect(() => {
    const thresholdHours = CACHE_STALE_THRESHOLD_MS / (1000 * 60 * 60);

    // 1. Initial page load check
    if (!checkAndRefreshIfStale()) {
        // Page is fresh — reset the timer
        setStorage(CACHE_REFRESH_KEY, Date.now().toString());
    }

    // 2. Tab visibility change (user switches back to this tab)
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            const age = getCacheAgeHours();
            console.log(`Tab became visible, cache is ${age} hours old (threshold: ${thresholdHours} hours)`);
            checkAndRefreshIfStale();
        }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 3. Window focus (user clicks on the app window)
    const handleFocus = () => {
        const age = getCacheAgeHours();
        console.log(`Window focused, cache is ${age} hours old (threshold: ${thresholdHours} hours)`);
        checkAndRefreshIfStale();
    };
    window.addEventListener('focus', handleFocus);

    // 4. Periodic background check
    const intervalId = setInterval(() => {
        const age = getCacheAgeHours();
        console.log(`Periodic check: cache is ${age} hours old (threshold: ${thresholdHours} hours)`);
        checkAndRefreshIfStale();
    }, CACHE_CHECK_INTERVAL_MS);

    // Cleanup on unmount
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
        clearInterval(intervalId);
    };
}, []);
```

### 3. That's It

No server-side changes needed. The system is entirely client-side using `localStorage`.

## Configuration Reference

| Constant | Default | Purpose |
|----------|---------|---------|
| `CACHE_STALE_THRESHOLD_MS` | 48 hours | How old the page can be before forcing a reload |
| `CACHE_CHECK_INTERVAL_MS` | 1 hour | How often the background interval fires |
| `CACHE_REFRESH_KEY` | `'lastRefreshTimestamp'` | The `localStorage` key name |

**Suggested values by app type:**

| App Type | Threshold | Check Interval |
|----------|-----------|----------------|
| Dashboard with live data | 1-4 hours | 15 minutes |
| Standard portal (default) | 24-48 hours | 1 hour |
| Rarely-updated reference app | 72+ hours | 4 hours |

If your app uses multiple HTML files with separate React roots (e.g., `index.html` and `marketingmanager.html`), use a **unique `CACHE_REFRESH_KEY`** per page to avoid one page's reload resetting the other's timer:

```javascript
var CACHE_REFRESH_KEY = 'lastRefreshTimestamp_myAppName';
```

## How It Works

```
Page Load
  |
  v
checkAndRefreshIfStale()
  |
  +--> First visit? --> Seed timestamp, continue
  |
  +--> Age < threshold? --> Update timestamp, start listeners
  |
  +--> Age >= threshold? --> Update timestamp, reload page

Ongoing Monitoring (3 triggers)
  |
  +-- visibilitychange --> check staleness
  +-- window focus     --> check staleness
  +-- setInterval      --> check staleness (backup)
```

**Anti-loop protection**: The timestamp is always updated *before* `window.location.reload()` fires. When the page reloads, the age will be ~0, so it won't reload again.

## How to Verify It's Working

### Method 1: Check the Console Logs

Open your browser's DevTools (F12) > Console tab while using the app. You should see messages on every trigger:

```
Tab became visible, cache is 2.3 hours old (threshold: 48 hours)
Window focused, cache is 2.3 hours old (threshold: 48 hours)
Periodic check: cache is 3.3 hours old (threshold: 48 hours)
```

If you see these log lines, the system is active and monitoring.

### Method 2: Inspect localStorage Directly

In DevTools > Application tab > Local Storage > your app's origin:

1. Look for the key `lastRefreshTimestamp` (or your custom key name)
2. The value should be a Unix timestamp in milliseconds (e.g., `1741190400000`)
3. Reload the page — the value should update to the current time

You can also check from the Console:

```javascript
// See the stored timestamp
localStorage.getItem('lastRefreshTimestamp')

// See the age in hours
getCacheAgeHours()
```

### Method 3: Force a Stale State to Trigger Auto-Refresh

This is the definitive test. In the DevTools Console, set the timestamp to a date far in the past, then trigger a check:

```javascript
// Set timestamp to 72 hours ago (well past the 48-hour threshold)
localStorage.setItem('lastRefreshTimestamp', (Date.now() - 72 * 60 * 60 * 1000).toString());

// Verify it reads as stale
getCacheAgeHours(); // Should show "72.0"

// Trigger the check — this WILL reload the page
checkAndRefreshIfStale();
```

The page should immediately reload. After reload, check that `getCacheAgeHours()` returns a small number (close to `"0.0"`), confirming the timestamp was reset.

### Method 4: Test Individual Triggers

**Tab visibility trigger:**
1. Switch to a different browser tab
2. Set the timestamp to the past in the other tab's console (won't work — use Method 3 first)
3. Switch back and watch the console

**Focus trigger:**
1. Click outside the browser window (e.g., on the desktop)
2. Click back on the browser window
3. Watch the console for the `"Window focused..."` message

**Interval trigger:**
For testing, temporarily lower the interval:
```javascript
// In your code, temporarily set to 10 seconds for testing
var CACHE_CHECK_INTERVAL_MS = 10 * 1000;
```
Then watch the console — you should see `"Periodic check..."` messages every 10 seconds. **Remember to revert this before deploying.**

### Method 5: Automated Verification Script

Paste this into the DevTools Console for a quick diagnostic:

```javascript
(function verifyRefreshTracking() {
    var results = [];

    // 1. Check that functions exist
    results.push(['setStorage defined', typeof setStorage === 'function']);
    results.push(['getStorage defined', typeof getStorage === 'function']);
    results.push(['getCacheAgeHours defined', typeof getCacheAgeHours === 'function']);
    results.push(['checkAndRefreshIfStale defined', typeof checkAndRefreshIfStale === 'function']);

    // 2. Check constants
    results.push(['CACHE_STALE_THRESHOLD_MS set', typeof CACHE_STALE_THRESHOLD_MS === 'number' && CACHE_STALE_THRESHOLD_MS > 0]);
    results.push(['CACHE_CHECK_INTERVAL_MS set', typeof CACHE_CHECK_INTERVAL_MS === 'number' && CACHE_CHECK_INTERVAL_MS > 0]);
    results.push(['CACHE_REFRESH_KEY set', typeof CACHE_REFRESH_KEY === 'string' && CACHE_REFRESH_KEY.length > 0]);

    // 3. Check localStorage has a timestamp
    var ts = localStorage.getItem(CACHE_REFRESH_KEY);
    results.push(['Timestamp exists in localStorage', ts !== null]);
    results.push(['Timestamp is valid number', ts !== null && !isNaN(parseInt(ts, 10))]);

    // 4. Check age calculation
    var age = getCacheAgeHours();
    results.push(['getCacheAgeHours returns value', age !== null]);
    results.push(['Age is reasonable (< 1000 hours)', age !== null && parseFloat(age) < 1000]);

    // Print results
    console.log('%c=== Refresh Tracking Verification ===', 'font-weight:bold;font-size:14px');
    var allPass = true;
    results.forEach(function(r) {
        var label = r[0], pass = r[1];
        if (!pass) allPass = false;
        console.log(
            '%c ' + (pass ? 'PASS' : 'FAIL') + ' %c ' + label,
            'background:' + (pass ? '#28a745' : '#dc3545') + ';color:white;padding:2px 6px;border-radius:3px',
            'color:inherit'
        );
    });
    console.log('%c' + (allPass ? 'All checks passed' : 'Some checks failed — review above'),
        'font-weight:bold;color:' + (allPass ? '#28a745' : '#dc3545'));
})();
```

Expected output: all lines show **PASS** with green labels.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No console logs at all | Utility functions not loaded | Ensure the plain `<script>` block is *before* the Babel/React block |
| `getCacheAgeHours is not defined` | Script order issue or typo | Check the function is in a plain `<script>` tag, not inside `<script type="text/babel">` |
| Page refreshes in a loop | Timestamp not updating before reload | Verify `setStorage` runs before `window.location.reload()` in `checkAndRefreshIfStale` |
| Timestamp exists but never triggers refresh | Threshold too high or tab never goes stale | Lower `CACHE_STALE_THRESHOLD_MS` for testing |
| `localStorage` not available | Incognito mode or browser restriction | The `getStorage`/`setStorage` wrappers handle this gracefully — the feature silently degrades |

## Notes

- **No server-side component**: This is purely client-side. Server-side cache TTLs (CacheService/PropertiesService) are separate.
- **Browser throttling**: Background tabs may throttle `setInterval` to once per minute. The visibility/focus listeners compensate for this.
- **Multiple tabs**: If a user has multiple tabs open, each tab tracks its own staleness independently. A reload in one tab does not affect others.
- **Private browsing**: `localStorage` may not persist in incognito/private mode. The system degrades gracefully — no refresh tracking, no errors.
