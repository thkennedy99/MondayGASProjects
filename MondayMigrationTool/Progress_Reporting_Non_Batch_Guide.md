# Progress Reporting in Non-Batch Mode — Detailed Guide

## Overview

Non-batch mode handles slide generation jobs with fewer than 75 logos (the `BATCH_THRESHOLD` constant in `SlideGenerationNonSegmented`). In this mode, the entire generation runs within a single Google Apps Script execution (up to the 6-minute limit), and the client-side UI polls the server every 2 seconds for real-time progress updates.

This guide explains the complete progress reporting lifecycle: how progress is initialized, updated, stored, polled, and displayed in the UI.

---

## Architecture Summary

```
┌─────────────────────┐         ┌─────────────────────────────┐
│   Client (Browser)  │         │   Server (Apps Script)       │
│                     │         │                              │
│ 1. User clicks      │         │                              │
│    "Generate"        │────────▶│ startSlideGenerationProcess()│
│                     │         │   → generates sessionId      │
│                     │◀────────│   → returns sessionId        │
│                     │         │                              │
│ 2. Start polling    │         │                              │
│    every 2 seconds  │         │                              │
│    ┌──────────────┐ │         │                              │
│    │ setInterval  │ │         │ 3. runGeneration(sessionId)  │
│    │  2000ms      │ │────────▶│   → long-running process     │
│    └──────────────┘ │         │   → updates PropertiesService│
│                     │         │     + CacheService on each   │
│ 4. Poll progress    │         │     milestone                │
│    getProgressStatus│────────▶│                              │
│    WithSession()    │◀────────│   → returns progress object  │
│                     │         │                              │
│ 5. Update UI        │         │                              │
│    - progress bar   │         │                              │
│    - status text    │         │                              │
│    - stats counter  │         │                              │
│                     │         │                              │
│ 6. Detect 100%     │         │                              │
│    + "complete"     │         │                              │
│    → stop polling   │         │                              │
└─────────────────────┘         └─────────────────────────────┘
```

**Key distinction from batch mode:** In non-batch mode, the server-side generation runs as a single `google.script.run.runGeneration()` call. There are no time-based triggers, no chunked partner data in cache, and no multi-execution coordination. The UI simply polls the shared progress state that the server updates as it works.

---

## Step-by-Step Lifecycle

### Step 1: Client Initiates Generation

**File:** `LogoGeneratorScript.html` (around line 1480–1495)

When the user clicks "Generate Slides", the client calls three functions in sequence:

```javascript
// Step 1: Get a session ID from the server
google.script.run
  .withSuccessHandler(function(sessionId) {
    currentSessionId = sessionId;
    updateSessionInfo(currentSessionId);

    // Step 2: Start polling BEFORE starting generation
    startProgressPolling(sessionId);

    // Step 3: Fire-and-forget the actual generation
    google.script.run.runGeneration(sessionId);
  })
  .withFailureHandler(handleGenerationError)
  .startSlideGenerationProcess(params);
```

**Why polling starts first:** The `runGeneration()` call is fire-and-forget — the client does not wait for it to return. Polling begins immediately so the UI can show progress updates while the server works.

### Step 2: Server Creates the Session

**File:** `main` (the `startSlideGenerationProcess` function)

The server:
1. Generates a unique session ID
2. Stores the generation parameters in `CacheService.getUserCache()` with key `sessionId + '_params'`
3. Calls `initializeProgressTrackingWithSession(sessionId, totalLogos, segmented)` to set up the progress tracking record
4. Returns the session ID to the client

### Step 3: Server Initializes Progress

**File:** `SlideGenerationProgress` (line 118–144)

```javascript
function initializeProgressTrackingWithSession(sessionId, totalLogos, segmented) {
  const tracker = new PersistentProgressTracker(sessionId);
  const progress = tracker.getDefaultProgress();

  progress.totalLogos = totalLogos;
  progress.segmented = segmented;
  progress.status = 'Initializing slide generation...';

  tracker.saveProgress(progress);
  return sessionId;
}
```

This creates the initial progress object with:
- `percent: 0`
- `placedLogos: 0`
- `status: 'Initializing slide generation...'`
- `batchProcessing: false`
- `batchStatus: 'none'`

### Step 4: Server Runs Generation and Updates Progress

**File:** `SlideGenerationCore` (line 11–141) → `SlideGenerationNonSegmented` (line 24–183)

The `runGeneration()` function orchestrates the generation. For non-batch mode, progress is updated at specific milestones:

#### Milestone 1: Filter/Initialization (5%)
```javascript
// SlideGenerationCore, line 48
updateProgressTrackingWithSession(sessionId, 'Initializing...', 5, 0, partners.length);
```

#### Milestone 2: Logo Validation (15%)
```javascript
// SlideGenerationNonSegmented, line 31
updateProgressTrackingWithSession(sessionId, 'Validating partner logos...', 15, progress.current, progress.total);
```

#### Milestone 3: Layout Calculation (25%)
```javascript
// SlideGenerationNonSegmented, line 92
updateProgressTrackingWithSession(sessionId, 'Placing logos on slide...', 25);
```

#### Milestone 4: Logo Placement (25%–95%, every 25 logos)
```javascript
// SlideGenerationNonSegmented, lines 109–113
for (let i = 0; i < sortedValidPartners.length; i++) {
  processedCount++;

  // Update progress every 25 logos (not every logo — for performance)
  if (i % 25 === 0) {
    const percent = 25 + Math.round((processedCount / sortedValidPartners.length) * 70);
    updateProgressTrackingWithSession(
      sessionId,
      `Placing logos: ${processedCount}/${sortedValidPartners.length}`,
      percent,
      processedCount,
      sortedValidPartners.length
    );
  }
  // ... place logo on slide ...
}
```

**Note:** The percentage formula `25 + (processedCount / total * 70)` maps logo placement to the 25%–95% range, reserving 0%–25% for initialization and 95%–100% for finalization.

#### Milestone 5: Finalization (99% then 100%)
```javascript
// SlideGenerationCore, lines 136 and 141
updateProgressTrackingWithSession(sessionId, 'Finalizing presentation...', 99, result.successfulLogos, partners.length);
// ... save history ...
updateProgressTrackingWithSession(sessionId, 'Generation complete!', 100, result.successfulLogos, partners.length);
```

### Step 5: Progress Storage (Dual-Write)

**File:** `SlideGenerationProgress` (lines 13–112)

The `PersistentProgressTracker` class uses a dual-storage strategy:

```
┌──────────────────────┐    ┌──────────────────────┐
│  CacheService        │    │  PropertiesService    │
│  (UserCache)         │    │  (UserProperties)     │
│                      │    │                       │
│  TTL: 600 seconds    │    │  Persistent until     │
│  Fast reads          │    │  manually deleted     │
│  May be evicted      │    │  Slower reads         │
└──────────────────────┘    └──────────────────────┘
         ▲                           ▲
         │                           │
         └───── saveProgress() ──────┘
                writes to BOTH

         getProgress() reads:
         1. Try CacheService first
         2. Fall back to PropertiesService
         3. Fall back to getDefaultProgress()
```

**Write path** (`saveProgress`):
```javascript
saveProgress(progressData) {
  const dataString = JSON.stringify(dataWithMeta);

  // Primary: persistent storage
  this.properties.setProperty(this.sessionId, dataString);

  // Secondary: cache for fast reads
  this.cache.put(this.sessionId, dataString, 600);
}
```

**Read path** (`getProgress`):
```javascript
getProgress() {
  // 1. Try cache first (fast)
  const cached = this.cache.get(this.sessionId);
  if (cached) return JSON.parse(cached);

  // 2. Fall back to persistent storage
  const stored = this.properties.getProperty(this.sessionId);
  if (stored) {
    // Re-populate cache for next read
    this.cache.put(this.sessionId, stored, 600);
    return JSON.parse(stored);
  }

  // 3. Return defaults
  return this.getDefaultProgress();
}
```

**Why dual storage?** `CacheService` is faster but unreliable (values can be evicted at any time). `PropertiesService` is persistent but slower. The dual-write ensures the polling UI gets fast responses while the data survives cache evictions.

### Step 6: Client Polls for Progress

**File:** `LogoGeneratorScript.html` (lines 1802–1833)

```javascript
function startProgressPolling(sessionId) {
  progressPollingInterval = setInterval(() => {
    google.script.run
      .withSuccessHandler(function(progress) {
        if (progress) {
          updateProgress(progress);

          // Detect completion: percent >= 100 AND "complete" in status
          const isCompleted = progress.percent >= 100 &&
                             progress.status &&
                             progress.status.toLowerCase().includes('complete');

          if (isCompleted) {
            clearInterval(progressPollingInterval);
            generationInProgress = false;
            google.script.run.getFinalResult(sessionId);
          }
        }
      })
      .withFailureHandler(function(error) {
        console.error('Progress polling error:', error);
      })
      .getProgressStatusWithSession(sessionId);
  }, 2000); // Every 2 seconds
}
```

**Key details:**
- Polls every **2 seconds**
- Calls `getProgressStatusWithSession(sessionId)` on the server
- Completion requires **both** `percent >= 100` **and** the word "complete" in the status string
- On completion, stops polling and fetches the final result

### Step 7: Server Returns Progress to Polling Requests

**File:** `SlideGenerationProgress` (lines 417–465)

```javascript
function getProgressStatusWithSession(sessionId) {
  const tracker = new PersistentProgressTracker(sessionId);
  const progress = tracker.getProgress();

  // For segmented mode, compute segmentDetails array for UI
  if (progress.segmented && progress.segmentBreakdown) {
    progress.segmentDetails = [];
    // ... builds segment detail objects ...
  }

  return progress;
}
```

This function simply reads the latest progress from storage and returns it. Both the generation process (writing) and the polling requests (reading) operate on the same `PersistentProgressTracker` state.

### Step 8: Client Updates UI

**File:** `LogoGeneratorScript.html` (line 1837+)

The `updateProgress(progress)` function updates the DOM:

```javascript
function updateProgress(progress) {
  // Progress bar width
  progressFill.style.width = (progress.percent || 0) + '%';

  // Status message
  progressText.textContent = progress.status || 'Processing...';

  // Stats line: "X / Y (Z%)"
  progressStats.textContent =
    `${progress.placedLogos || 0} / ${progress.totalLogos || 0} (${progress.percent || 0}%)`;

  // Error list (if any)
  if (progress.errors && progress.errors.length > 0) {
    // Renders red error items
  }

  // Missing logos list (if any)
  if (progress.missingLogos && progress.missingLogos.length > 0) {
    // Renders orange missing logo items
  }

  // Segment progress (segmented mode only)
  if (progress.segmented && progress.segmentDetails) {
    // Renders segment-by-segment progress
  }
}
```

**UI elements** (defined in `LogoGeneratorUI.html`):

| Element ID | Purpose | Example Display |
|---|---|---|
| `progressFill` | CSS width for progress bar | `width: 45%` |
| `progressText` | Current operation status | `Placing logos: 34/75` |
| `progressStats` | Numeric counters | `34 / 75 (45%)` |
| `progressDetails` | Error and missing logo lists | Red/orange bullet lists |
| `segmentDetails` | Segment-level progress | Only shown in segmented mode |

---

## The Progress Data Object

Here is the complete progress object as stored and returned in non-batch mode:

```javascript
{
  // Identity
  sessionId: "slideProgress_user_example_com_1710000000000",
  userEmail: "user@example.com",

  // Core progress
  status: "Placing logos: 34/75",    // Human-readable status message
  percent: 57,                        // 0-100, displayed in progress bar
  totalLogos: 75,                     // Total logos to place
  placedLogos: 34,                    // Successfully placed so far

  // Error tracking
  errors: [],                         // Array of error message strings
  missingLogos: [],                   // Partners with no logo file
  problemFiles: [],                   // Logo files that couldn't be loaded

  // Timing
  startTime: 1710000000000,           // Epoch ms when generation started
  lastUpdate: 1710000045000,          // Epoch ms of most recent update
  timestamp: "2026-03-10T15:00:45Z",  // ISO string of most recent update

  // Segmentation (for segmented non-batch mode)
  segmented: false,                   // true if using segmented generation
  hasSecondarySegments: false,
  totalPrimarySegments: 0,
  completedPrimarySegments: 0,
  currentPrimarySegment: "",
  currentSecondarySegment: "",
  segmentBreakdown: {},

  // Batch fields (always present but unused in non-batch)
  batchProcessing: false,
  currentBatch: 0,
  totalBatches: 0,
  batchStatus: "none"
}
```

---

## Segmented Non-Batch Mode

When `params.segmented = true` and the total logo count is below `BATCH_THRESHOLD`, the system uses segmented progress tracking. This adds per-segment granularity:

### Initialization

**File:** `SlideGenerationProgress` (line 196–259)

```javascript
initializeSegmentedProgressWithSession(sessionId, groupedPartners, hasSecondarySegment)
```

This populates `segmentBreakdown` with entries like:
```javascript
segmentBreakdown: {
  "Technology": {
    primaryName: "Technology",
    totalLogos: 25,
    placedLogos: 0,
    secondarySegments: {
      "Gold": { secondaryName: "Gold", totalLogos: 10, placedLogos: 0 },
      "Silver": { secondaryName: "Silver", totalLogos: 15, placedLogos: 0 }
    }
  },
  "Financial": {
    primaryName: "Financial",
    totalLogos: 20,
    placedLogos: 0,
    secondarySegments: {}
  }
}
```

### Per-Logo Updates

```javascript
// Called for each logo placement
updateLogoPlacementProgressWithSession(sessionId, partnerName, success)
```

This function (line 304–357):
1. Increments `placedLogos` globally
2. Recalculates `percent`
3. Updates the current segment's `placedLogos`
4. Updates the current secondary segment's `placedLogos` (if applicable)

### Segment Transitions

```javascript
// Called when starting a new primary segment
updatePrimarySegmentProgressWithSession(sessionId, primarySegmentName, logoCountInSegment)

// Called when a primary segment is fully processed
completePrimarySegmentProgressWithSession(sessionId)
```

### UI Display

The polling response includes computed `segmentDetails` array:
```javascript
segmentDetails: [
  {
    primaryName: "Technology",
    totalLogos: 25,
    placedLogos: 25,
    isComplete: true,
    isCurrent: false,
    secondarySegments: [
      { secondaryName: "Gold", totalLogos: 10, placedLogos: 10, isComplete: true, isCurrent: false },
      { secondaryName: "Silver", totalLogos: 15, placedLogos: 15, isComplete: true, isCurrent: false }
    ]
  },
  {
    primaryName: "Financial",
    totalLogos: 20,
    placedLogos: 8,
    isComplete: false,
    isCurrent: true,
    secondarySegments: []
  }
]
```

---

## Comparison: Non-Batch vs. Batch Progress

| Aspect | Non-Batch Mode | Batch Mode |
|---|---|---|
| **Logo threshold** | < 75 logos | >= 75 logos |
| **Execution model** | Single `runGeneration()` call | Multiple time-based triggers |
| **Progress storage** | `UserProperties` + `UserCache` | `ScriptProperties` + `ScriptCache` |
| **Update granularity** | Every 25 logos | Per batch (50 logos) |
| **Progress function** | `updateProgressTrackingWithSession()` | `updateBatchProgressWithSession()` |
| **Polling function** | `getProgressStatusWithSession()` | `getBatchProgressStatus()` |
| **Completion signal** | `percent: 100` + status includes "complete" | `batchStatus: 'completed'` |
| **Timeout risk** | Possible for jobs near threshold | Avoided via trigger chaining |
| **Session recovery** | `recoverActiveSession()` | Batch state in `ScriptProperties` |
| **Cleanup** | `cleanupOldSessions()` | `cleanupStaleBatchProgress()` |

---

## Key Functions Reference

### Server-Side (Progress Tracking)

| Function | File | Purpose |
|---|---|---|
| `initializeProgressTrackingWithSession()` | SlideGenerationProgress | Create initial progress record |
| `updateProgressTrackingWithSession()` | SlideGenerationProgress | Update status, percent, counts |
| `updateLogoPlacementProgressWithSession()` | SlideGenerationProgress | Increment per-logo (segmented) |
| `initializeSegmentedProgressWithSession()` | SlideGenerationProgress | Set up segment breakdown |
| `updatePrimarySegmentProgressWithSession()` | SlideGenerationProgress | Mark segment as current |
| `completePrimarySegmentProgressWithSession()` | SlideGenerationProgress | Mark segment as done |
| `getProgressStatusWithSession()` | SlideGenerationProgress | Read progress for UI polling |
| `logProgressWithSession()` | SlideGenerationProgress | Console logging with session ID |

### Server-Side (Session Management)

| Function | File | Purpose |
|---|---|---|
| `recoverActiveSession()` | helpersessionprogresstrack | Find active session after disconnect |
| `cleanupOldSessions()` | helpersessionprogresstrack | Remove stale sessions (24h default) |
| `getSessionStatistics()` | helpersessionprogresstrack | Debug session storage usage |
| `emergencySessionReset()` | helpersessionprogresstrack | Clear all sessions for current user |

### Client-Side (UI)

| Function | File | Purpose |
|---|---|---|
| `startProgressPolling()` | LogoGeneratorScript.html | Begin 2-second polling loop |
| `updateProgress()` | LogoGeneratorScript.html | Update DOM with progress data |
| `showProgress()` | LogoGeneratorScript.html | Show progress modal overlay |
| `hideProgress()` | LogoGeneratorScript.html | Hide progress modal |
| `cancelGeneration()` | LogoGeneratorScript.html | Stop polling, hide modal |
| `handleGenerationError()` | LogoGeneratorScript.html | Error display and cleanup |

---

## Performance Considerations

### Why Update Every 25 Logos Instead of Every Logo?

Each `updateProgressTrackingWithSession()` call involves:
1. `getProgress()` — reads from CacheService (or PropertiesService)
2. JSON parse
3. Object modification
4. JSON stringify
5. `setProperty()` to PropertiesService
6. `cache.put()` to CacheService

For 75 logos, updating every logo would mean 75 read-write cycles to persistent storage. At ~100ms per cycle, that adds ~7.5 seconds of overhead. Updating every 25 logos reduces this to 3 cycles (~300ms).

### Why 2-Second Polling Interval?

- **Too fast (500ms):** Each `google.script.run` call has ~500ms–1000ms latency. Polling faster than the response time wastes quota and creates request pileup.
- **Too slow (10s):** For a 30-second generation job, only 3 progress updates would reach the UI, making the progress bar appear jerky.
- **2 seconds:** Provides smooth visual progress while staying well within Apps Script quotas.

### PropertiesService Size Limit

`PropertiesService` has a **9KB per-property limit**. The progress object typically stays under 2KB for non-segmented mode. For segmented mode with many segments, the `segmentBreakdown` could approach this limit. The system does not currently implement truncation for non-batch progress (unlike `BatchLogoProcessor` which trims to 9KB).

---

## Error Handling

### Server-Side Errors

Every progress function wraps operations in try-catch:
```javascript
function updateProgressTrackingWithSession(sessionId, status, percent, processedCount, totalCount) {
  try {
    // ... update logic ...
  } catch (error) {
    console.error('Error updating progress tracking:', error);
    return false;
  }
}
```

Progress tracking errors are **non-fatal** — they return `false` but don't stop generation. The logos still get placed even if the progress display fails.

### Client-Side Polling Errors

```javascript
.withFailureHandler(function(error) {
  console.error('Progress polling error:', error);
  // Polling continues — individual failures don't stop the loop
})
```

A single polling failure does not stop the interval. The next poll in 2 seconds will try again.

### Generation Errors

```javascript
function handleGenerationError(error) {
  generationInProgress = false;
  clearInterval(progressPollingInterval);
  hideProgress();
  showError('Generation failed: ' + (error.message || JSON.stringify(error)));
}
```

If `runGeneration()` itself throws an error (returned via `withFailureHandler`), the UI stops polling and displays the error.

### Session Recovery After Browser Refresh

If the user refreshes the browser mid-generation:
1. The server-side `runGeneration()` continues running (it's server-side)
2. The client loses `currentSessionId` and `progressPollingInterval`
3. `recoverActiveSession()` can find the most recent active session from `UserProperties`
4. The client can resume polling with the recovered session ID

---

## Implementing New Progress Milestones

To add a new progress update point in non-batch mode:

```javascript
// 1. Import the function (it's global in Apps Script)
// 2. Call with: sessionId, status message, percent (0-100), processed count, total count

updateProgressTrackingWithSession(
  sessionId,
  'Your new status message...',  // Shown in progressText element
  50,                             // Percent complete (shown in progress bar)
  25,                             // Processed count (shown in progressStats)
  50                              // Total count (shown in progressStats)
);
```

**Rules:**
- Keep `percent` between 0–100 (clamped automatically)
- Include the count in the status message for readability: `Doing X: 25/50`
- Don't update too frequently — batch updates every N items for performance
- The percent parameter takes priority; if omitted, it's calculated from `processedCount / totalCount`

---

## Diagram: Complete Data Flow

```
User clicks "Generate"
        │
        ▼
startSlideGenerationProcess(params)
        │
        ├─── Stores params in UserCache (key: sessionId + '_params')
        ├─── Calls initializeProgressTrackingWithSession()
        │         │
        │         ├─── Creates PersistentProgressTracker
        │         └─── Saves {percent:0, status:'Initializing...'} to UserProperties + UserCache
        │
        └─── Returns sessionId to client
                │
        ┌───────┴────────┐
        │                │
  Client starts     Client calls
  polling (2s)      runGeneration(sessionId)
        │                │
        │                ├── Reads params from UserCache
        │                ├── Gets partners from spreadsheet
        │                ├── updateProgress(5%, 'Initializing...')
        │                │        └── Writes to UserProperties + UserCache
        │                │
  Poll: reads    ◀───────┤
  from UserCache         │
  returns progress       ├── Validates logos
        │                ├── updateProgress(15%, 'Validating...')
        │                │        └── Writes to UserProperties + UserCache
        │                │
  Poll: reads    ◀───────┤
  45% displayed          │
        │                ├── Places logos (every 25: updateProgress)
        │                │        └── Writes to UserProperties + UserCache
        │                │
  Poll: reads    ◀───────┤
  75% displayed          │
        │                ├── updateProgress(99%, 'Finalizing...')
        │                ├── updateProgress(100%, 'Generation complete!')
        │                │        └── Writes to UserProperties + UserCache
        │                │
  Poll: reads    ◀───────┘
  100% + "complete"
        │
  clearInterval()
  getFinalResult(sessionId)
        │
  Display result to user
```

---

**Last Updated:** March 2026
**Related Files:** `SlideGenerationProgress`, `SlideGenerationNonSegmented`, `SlideGenerationCore`, `helpersessionprogresstrack`, `LogoGeneratorScript.html`, `LogoGeneratorUI.html`
