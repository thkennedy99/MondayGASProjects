# GAS Batch Processing Reference Guide

## Overview

This document describes a reusable batch processing pattern for Google Apps Script (GAS) that breaks long-running jobs into smaller batches using **time-based triggers**, avoiding the 6-minute execution limit imposed on GAS consumer accounts. The pattern uses **PropertiesService** for persistent state, **CacheService** for large data storage (with chunking), and **installable triggers** to chain batch executions.

### When to Use This Pattern

- Your GAS job processes more than ~50-75 items that each involve API calls (Drive, Slides, Sheets, etc.)
- Total processing time exceeds 4-5 minutes
- You need progress tracking visible to a UI or polling client
- You need automatic retry on failure
- You need to support both interactive (UI) and headless (scheduler/trigger) execution

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Entry Point                               │
│   (UI button click or scheduled trigger)                         │
│                                                                  │
│   1. Validate data                                               │
│   2. If item count >= BATCH_THRESHOLD → start batch processing   │
│      If item count < BATCH_THRESHOLD → process inline (fast)     │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│              BatchProcessor.initializeBatch()                     │
│                                                                  │
│   - Calculates total batches (items ÷ LOGOS_PER_BATCH)           │
│   - Saves state to PropertiesService (JSON, <9KB)                │
│   - Saves item list to CacheService (chunked if >50KB)           │
│   - Returns initial state                                        │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│              BatchProcessor.processNextBatch()                    │
│                                                                  │
│   - Reads state from Properties/Cache                            │
│   - Reads items from Cache (reassembles chunks)                  │
│   - Slices items[processedCount .. processedCount + batchSize]   │
│   - Processes the batch (your business logic here)               │
│   - Updates state with results                                   │
│   - If more batches remain → scheduleNextBatch()                 │
│   - If all done → mark completed, cleanup triggers               │
│   - Saves state                                                  │
└──────────────────┬───────────────────────────────────────────────┘
                   │
          ┌────────┴────────┐
          │ More batches?   │
          └────────┬────────┘
            Yes    │    No
            ▼      │    ▼
┌─────────────┐    │  ┌────────────────────┐
│ Schedule    │    │  │ Mark completed     │
│ next batch  │    │  │ Send notification  │
│ via trigger │    │  │ Cleanup triggers   │
│ (.at())     │    │  │ Cleanup state      │
└──────┬──────┘    │  └────────────────────┘
       │           │
       ▼           │
┌──────────────────┘
│  continueBatchProcessing(e)    ← Trigger handler function
│
│  1. Read triggerUid from event object
│  2. Look up session ID from BATCH_TRIGGER_{triggerUid} mapping
│  3. Create BatchProcessor(sessionId)
│  4. Call processNextBatch()
│  5. Loop continues...
└──────────────────────────────────────────────────────────────────┘
```

---

## Configuration Constants

```javascript
/**
 * Batch processing configuration - tune these for your use case
 */
const BATCH_CONFIG = {
  ITEMS_PER_BATCH: 50,            // Items to process per batch execution
  MAX_EXECUTION_TIME: 270000,     // 4.5 min in ms (buffer before 6-min GAS limit)
  TRIGGER_DELAY_MS: 30000,        // 30 seconds between batches
  CACHE_CHUNK_SIZE: 50000,        // 50KB per cache chunk (CacheService limit: 100KB/value)
  STATE_TTL: 21600,               // 6 hours cache TTL in seconds
  MAX_RETRIES: 3                  // Max retries for failed batches
};

// Threshold: below this count, process inline (no batching needed)
const BATCH_THRESHOLD = 75;
```

### Key Limits to Know

| GAS Limit | Value | How This Pattern Handles It |
|---|---|---|
| Execution time (consumer) | 6 minutes | `MAX_EXECUTION_TIME` = 4.5 min with buffer |
| PropertiesService per value | 9KB | State JSON kept minimal; errors array trimmed |
| PropertiesService total | 500KB | Cleanup functions remove stale entries |
| CacheService per value | 100KB | Data chunked at 50KB per chunk |
| CacheService TTL max | 6 hours | `STATE_TTL` = 21600 seconds |
| Triggers per project | 20 | Disabled triggers cleaned up before creating new ones |

---

## Core Class: BatchProcessor

This is the central class that manages batch state, data storage, and execution flow. Adapt the business logic in `processBatchItems()` to your use case.

```javascript
/**
 * BatchProcessor - Generic batch processing manager for GAS
 *
 * Architecture:
 * - PropertiesService: Stores batch state (metadata, progress, config)
 * - CacheService: Stores item list (chunked for large datasets)
 * - Time-based triggers: Continue processing across batches
 */
class BatchProcessor {
  /**
   * @param {string} sessionId - Unique session identifier
   */
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.stateKey = `batchState_${sessionId}`;
    this.itemsKeyPrefix = `batchItems_${sessionId}_`;
    this.properties = PropertiesService.getScriptProperties();
    this.cache = CacheService.getScriptCache();
  }

  // ─────────────────────────────────────────────
  // STATE MANAGEMENT
  // ─────────────────────────────────────────────

  /**
   * Initialize a new batch processing job
   * @param {Array} items - Array of items to process
   * @param {Object} jobConfig - Job-specific configuration (your business params)
   * @returns {Object} Initial batch state
   */
  initializeBatch(items, jobConfig) {
    const totalBatches = Math.ceil(items.length / BATCH_CONFIG.ITEMS_PER_BATCH);

    const state = {
      sessionId: this.sessionId,
      totalItems: items.length,
      processedCount: 0,
      successCount: 0,
      currentBatch: 0,
      totalBatches: totalBatches,
      status: 'pending',        // pending | processing | completed | error | cancelled
      startTime: new Date().getTime(),
      lastUpdate: new Date().getTime(),
      jobConfig: jobConfig,     // Your business-specific config (keep small!)
      errors: [],
      retryCount: 0
    };

    this.saveState(state);
    this.saveItems(items);

    console.log(`[BatchProcessor] Initialized: ${items.length} items, ${totalBatches} batches`);
    return state;
  }

  /**
   * Get current batch state from storage
   * Reads from cache first (fast), falls back to PropertiesService (persistent)
   * @returns {Object|null} Batch state or null if not found
   */
  getState() {
    try {
      // Try cache first for faster access
      let stateJson = this.cache.get(this.stateKey);
      if (stateJson) {
        return JSON.parse(stateJson);
      }

      // Fall back to PropertiesService (persistent)
      stateJson = this.properties.getProperty(this.stateKey);
      if (stateJson) {
        const state = JSON.parse(stateJson);
        // Refresh cache for future reads
        this.cache.put(this.stateKey, stateJson, BATCH_CONFIG.STATE_TTL);
        return state;
      }

      return null;
    } catch (error) {
      console.error('[BatchProcessor] Error getting state:', error);
      return null;
    }
  }

  /**
   * Save batch state to dual storage (Properties + Cache)
   * Trims errors array if state exceeds 9KB PropertiesService limit
   * @param {Object} state - Batch state to save
   */
  saveState(state) {
    try {
      state.lastUpdate = new Date().getTime();
      const stateJson = JSON.stringify(state);

      // PropertiesService has a 9KB per-property limit
      if (stateJson.length > 9000) {
        console.warn('[BatchProcessor] State too large, trimming errors array');
        state.errors = state.errors.slice(-10); // Keep only last 10 errors
      }

      const finalJson = JSON.stringify(state);
      this.properties.setProperty(this.stateKey, finalJson);
      this.cache.put(this.stateKey, finalJson, BATCH_CONFIG.STATE_TTL);
    } catch (error) {
      console.error('[BatchProcessor] Error saving state:', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────
  // ITEM DATA STORAGE (Chunked Cache)
  // ─────────────────────────────────────────────

  /**
   * Save items to CacheService in chunks
   * CacheService has a 100KB per-value limit, so large arrays are split
   * @param {Array} items - Array of items to store
   */
  saveItems(items) {
    try {
      const itemsJson = JSON.stringify(items);
      const totalChunks = Math.ceil(itemsJson.length / BATCH_CONFIG.CACHE_CHUNK_SIZE);

      // Store chunk count
      this.cache.put(
        `${this.itemsKeyPrefix}chunks`,
        String(totalChunks),
        BATCH_CONFIG.STATE_TTL
      );

      // Store each chunk
      for (let i = 0; i < totalChunks; i++) {
        const start = i * BATCH_CONFIG.CACHE_CHUNK_SIZE;
        const end = start + BATCH_CONFIG.CACHE_CHUNK_SIZE;
        const chunk = itemsJson.substring(start, end);
        this.cache.put(`${this.itemsKeyPrefix}${i}`, chunk, BATCH_CONFIG.STATE_TTL);
      }

      console.log(`[BatchProcessor] Saved ${items.length} items in ${totalChunks} chunks`);
    } catch (error) {
      console.error('[BatchProcessor] Error saving items:', error);
      throw error;
    }
  }

  /**
   * Get items from cache (reassemble chunks)
   * Falls back to recovery if cache has expired
   * @returns {Array|null} Array of items or null if not found
   */
  getItems() {
    try {
      const chunksStr = this.cache.get(`${this.itemsKeyPrefix}chunks`);
      if (!chunksStr) {
        console.warn('[BatchProcessor] Item chunks not found in cache, attempting recovery...');
        return this.recoverItems();
      }

      const totalChunks = parseInt(chunksStr);
      let itemsJson = '';

      for (let i = 0; i < totalChunks; i++) {
        const chunk = this.cache.get(`${this.itemsKeyPrefix}${i}`);
        if (!chunk) {
          console.error(`[BatchProcessor] Missing chunk ${i}, attempting recovery...`);
          return this.recoverItems();
        }
        itemsJson += chunk;
      }

      return JSON.parse(itemsJson);
    } catch (error) {
      console.error('[BatchProcessor] Error getting items:', error);
      return this.recoverItems();
    }
  }

  /**
   * Recover items when cache expires
   * Override this method with logic to reload your data from source
   * @returns {Array|null} Recovered items or null
   */
  recoverItems() {
    try {
      const state = this.getState();
      if (!state) {
        console.error('[BatchProcessor] Cannot recover: no state found');
        return null;
      }

      // ──────────────────────────────────────────────────────
      // CUSTOMIZE THIS: Reload your data from its source
      // Example: re-query a sheet, re-fetch from an API, etc.
      // ──────────────────────────────────────────────────────
      console.log('[BatchProcessor] Implement recoverItems() for your data source');
      return null;

    } catch (error) {
      console.error('[BatchProcessor] Item recovery failed:', error);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // BATCH EXECUTION
  // ─────────────────────────────────────────────

  /**
   * Process the next batch of items
   * This is the main execution method called by the trigger handler
   * @returns {Object} Result with status and statistics
   */
  processNextBatch() {
    const state = this.getState();
    if (!state) {
      throw new Error('Batch state not found. Cannot continue processing.');
    }

    if (state.status === 'completed' || state.status === 'error') {
      console.log(`[BatchProcessor] Job already ${state.status}`);
      return { status: state.status, state: state };
    }

    const items = this.getItems();
    if (!items) {
      state.status = 'error';
      state.errors.push('Item data lost from cache and recovery failed.');
      this.saveState(state);
      return { status: 'error', error: 'Cache expired and recovery failed', state: state };
    }

    state.status = 'processing';
    state.currentBatch++;
    this.saveState(state);

    console.log(`[BatchProcessor] Starting batch ${state.currentBatch}/${state.totalBatches}`);

    try {
      // Calculate batch range
      const startIdx = state.processedCount;
      const endIdx = Math.min(startIdx + BATCH_CONFIG.ITEMS_PER_BATCH, items.length);
      const batchItems = items.slice(startIdx, endIdx);

      // ──────────────────────────────────────────────────────
      // CUSTOMIZE THIS: Your actual business logic goes here
      // ──────────────────────────────────────────────────────
      const result = this.processBatchItems(batchItems, state);

      // Update state with results
      state.processedCount = endIdx;
      state.successCount += result.successCount;

      if (result.errors && result.errors.length > 0) {
        state.errors = state.errors.concat(result.errors);
      }

      // Check if all batches complete
      if (state.processedCount >= state.totalItems) {
        state.status = 'completed';
        console.log(`[BatchProcessor] All batches complete. Success: ${state.successCount}/${state.totalItems}`);
        this.cleanupTriggers();
        this.onComplete(state);  // Hook for completion actions
      } else {
        // Schedule next batch
        const triggerId = this.scheduleNextBatch();
        if (triggerId) {
          state.triggerId = triggerId;
        }
      }

      this.saveState(state);

      return {
        status: state.status,
        currentBatch: state.currentBatch,
        totalBatches: state.totalBatches,
        processedCount: state.processedCount,
        successCount: state.successCount,
        state: state
      };

    } catch (error) {
      console.error(`[BatchProcessor] Error in batch ${state.currentBatch}:`, error);
      state.errors.push(`Batch ${state.currentBatch}: ${error.message}`);

      if (!state.retryCount) state.retryCount = 0;
      state.retryCount++;

      if (state.retryCount >= BATCH_CONFIG.MAX_RETRIES) {
        state.status = 'error';
        console.error('[BatchProcessor] Max retries exceeded.');
        this.cleanupTriggers();
      } else {
        // Retry the same batch
        console.log(`[BatchProcessor] Scheduling retry ${state.retryCount}/${BATCH_CONFIG.MAX_RETRIES}`);
        state.currentBatch--;
        const triggerId = this.scheduleNextBatch();
        if (triggerId) {
          state.triggerId = triggerId;
        }
      }

      this.saveState(state);
      return { status: state.status, error: error.message, state: state };
    }
  }

  /**
   * Process a single batch of items - OVERRIDE THIS WITH YOUR LOGIC
   * @param {Array} batchItems - Items in the current batch
   * @param {Object} state - Current batch state (read-only reference)
   * @returns {Object} { successCount: number, errors: string[] }
   */
  processBatchItems(batchItems, state) {
    // ──────────────────────────────────────────────────────
    // YOUR BUSINESS LOGIC HERE
    // Example: place logos on slides, send emails, update rows, etc.
    // ──────────────────────────────────────────────────────
    let successCount = 0;
    const errors = [];

    for (const item of batchItems) {
      try {
        // ... do work with item ...
        successCount++;
      } catch (error) {
        errors.push(`Error processing ${item.name || item.id}: ${error.message}`);
      }
    }

    return { successCount, errors };
  }

  /**
   * Called when all batches are complete - OVERRIDE FOR COMPLETION ACTIONS
   * @param {Object} state - Final batch state
   */
  onComplete(state) {
    // Override to send emails, update sheets, log results, etc.
    console.log(`[BatchProcessor] Job complete: ${state.successCount}/${state.totalItems} successful`);
  }

  // ─────────────────────────────────────────────
  // TRIGGER MANAGEMENT
  // ─────────────────────────────────────────────

  /**
   * Schedule the next batch via a time-based trigger
   *
   * IMPORTANT: Uses .at(Date) instead of .after(ms) because .after() has
   * known timezone issues in some GAS environments.
   *
   * Stores a trigger-to-session mapping so the trigger handler can find
   * the correct session when the trigger fires.
   *
   * @returns {string|null} The trigger's unique ID, or null on failure
   */
  scheduleNextBatch() {
    try {
      // Clean up existing triggers for this session first
      this.cleanupTriggers();

      // Clean up orphaned triggers to prevent "too many triggers" error
      cleanupDisabledBatchTriggers();

      // Calculate trigger time as an absolute Date (timezone-safe)
      const triggerTime = new Date(Date.now() + BATCH_CONFIG.TRIGGER_DELAY_MS);

      // Create trigger - UPDATE 'continueBatchProcessing' to your handler function name
      const trigger = ScriptApp.newTrigger('continueBatchProcessing')
        .timeBased()
        .at(triggerTime)
        .create();

      const triggerId = trigger.getUniqueId();

      // Store trigger→session mapping so handler can find this job
      const mappingKey = `BATCH_TRIGGER_${triggerId}`;
      this.properties.setProperty(mappingKey, this.sessionId);

      console.log(`[BatchProcessor] Scheduled next batch: trigger ${triggerId} at ${triggerTime.toISOString()}`);
      return triggerId;

    } catch (error) {
      console.error('[BatchProcessor] Error scheduling next batch:', error);
      throw error;
    }
  }

  /**
   * Clean up triggers belonging to this batch job
   */
  cleanupTriggers() {
    try {
      const triggers = ScriptApp.getProjectTriggers();
      const state = this.getState();

      triggers.forEach(trigger => {
        // UPDATE 'continueBatchProcessing' to your handler function name
        if (trigger.getHandlerFunction() === 'continueBatchProcessing') {
          if (state && state.triggerId === trigger.getUniqueId()) {
            const triggerId = trigger.getUniqueId();
            ScriptApp.deleteTrigger(trigger);
            this.properties.deleteProperty(`BATCH_TRIGGER_${triggerId}`);
            console.log(`[BatchProcessor] Deleted trigger: ${triggerId}`);
          }
        }
      });
    } catch (error) {
      console.error('[BatchProcessor] Error cleaning up triggers:', error);
    }
  }

  /**
   * Clean up all storage for this batch job
   */
  cleanup() {
    try {
      this.cleanupTriggers();

      // Remove state
      this.properties.deleteProperty(this.stateKey);
      this.cache.remove(this.stateKey);

      // Remove item chunks
      const chunksStr = this.cache.get(`${this.itemsKeyPrefix}chunks`);
      if (chunksStr) {
        const totalChunks = parseInt(chunksStr);
        for (let i = 0; i < totalChunks; i++) {
          this.cache.remove(`${this.itemsKeyPrefix}${i}`);
        }
        this.cache.remove(`${this.itemsKeyPrefix}chunks`);
      }

      console.log(`[BatchProcessor] Cleaned up: ${this.sessionId}`);
    } catch (error) {
      console.error('[BatchProcessor] Error during cleanup:', error);
    }
  }
}
```

---

## Trigger Handler Function

This standalone function is the bridge between the time-based trigger and your `BatchProcessor` instance. When a trigger fires, GAS calls this function with an event object containing `triggerUid`.

```javascript
/**
 * Trigger handler - continues batch processing when a scheduled trigger fires.
 *
 * How it works:
 * 1. Reads triggerUid from the event object (provided by GAS)
 * 2. Looks up the session ID from the BATCH_TRIGGER_{triggerUid} mapping
 * 3. Creates a BatchProcessor for that session and calls processNextBatch()
 *
 * The event object structure (per Google docs):
 *   { triggerUid: "unique-trigger-id", ... }
 *
 * @param {Object} e - Event object from the installable trigger
 */
function continueBatchProcessing(e) {
  console.log('[continueBatchProcessing] Trigger fired');

  try {
    const props = PropertiesService.getScriptProperties();
    let targetSessionId = null;
    let matchedTriggerId = null;

    // Step 1: Get trigger ID from event object (most reliable method)
    const firedTriggerId = e && e.triggerUid;
    console.log(`[continueBatchProcessing] triggerUid: ${firedTriggerId}`);

    if (firedTriggerId) {
      // Direct lookup using trigger→session mapping
      const mappingKey = `BATCH_TRIGGER_${firedTriggerId}`;
      const sessionId = props.getProperty(mappingKey);

      if (sessionId) {
        const stateJson = props.getProperty(`batchState_${sessionId}`);
        if (stateJson) {
          const state = JSON.parse(stateJson);
          if (state.status === 'processing' || state.status === 'pending') {
            targetSessionId = sessionId;
            matchedTriggerId = firedTriggerId;
          }
        }
      }
    }

    // Step 2: Fallback - scan all mappings if direct lookup failed
    if (!targetSessionId) {
      console.log('[continueBatchProcessing] Falling back to scanning all mappings');
      const allProps = props.getProperties();

      for (const key of Object.keys(allProps)) {
        if (key.startsWith('BATCH_TRIGGER_')) {
          const sessionId = allProps[key];
          const stateJson = allProps[`batchState_${sessionId}`];
          if (stateJson) {
            const state = JSON.parse(stateJson);
            if (state.status === 'processing' || state.status === 'pending') {
              targetSessionId = sessionId;
              matchedTriggerId = key.replace('BATCH_TRIGGER_', '');
              break;
            }
          }
        }
      }
    }

    // Step 3: Clean up the trigger mapping
    if (matchedTriggerId) {
      props.deleteProperty(`BATCH_TRIGGER_${matchedTriggerId}`);
    }

    if (!targetSessionId) {
      console.log('[continueBatchProcessing] No active batch job found');
      return;
    }

    // Step 4: Continue processing
    console.log(`[continueBatchProcessing] Continuing session: ${targetSessionId}`);
    const processor = new BatchProcessor(targetSessionId);
    processor.processNextBatch();

  } catch (error) {
    console.error('[continueBatchProcessing] Error:', error);
  }
}
```

---

## Trigger Cleanup Functions

GAS one-time triggers (`.at()`) remain in the project after firing as disabled triggers. These accumulate and can hit the 20-trigger limit. These cleanup functions are essential.

```javascript
/**
 * Clean up disabled/orphaned batch triggers that have already fired.
 * Call this BEFORE creating new triggers to prevent accumulation.
 * @returns {number} Number of triggers cleaned up
 */
function cleanupDisabledBatchTriggers() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();

    // Build set of trigger IDs that are actively needed
    const activeTriggerIds = new Set();
    for (const key of Object.keys(allProps)) {
      if (key.startsWith('batchState_')) {
        try {
          const state = JSON.parse(allProps[key]);
          if ((state.status === 'processing' || state.status === 'pending') && state.triggerId) {
            activeTriggerIds.add(state.triggerId);
          }
        } catch (e) { /* skip malformed */ }
      }
    }

    let cleanedCount = 0;
    for (const trigger of triggers) {
      if (trigger.getHandlerFunction() === 'continueBatchProcessing') {
        const triggerId = trigger.getUniqueId();
        if (!activeTriggerIds.has(triggerId)) {
          ScriptApp.deleteTrigger(trigger);
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(`[cleanup] Removed ${cleanedCount} disabled/orphaned triggers`);
    }
    return cleanedCount;

  } catch (error) {
    console.error('[cleanup] Error:', error);
    return 0;
  }
}

/**
 * Clean up orphaned batch triggers, stale states, and stale trigger mappings.
 * Call after batch completion or periodically to keep the system clean.
 */
function cleanupOrphanedBatchTriggers() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    // Identify active trigger IDs and stale states
    const activeTriggerIds = new Set();
    const staleStateKeys = [];

    for (const key of Object.keys(allProps)) {
      if (key.startsWith('batchState_')) {
        try {
          const state = JSON.parse(allProps[key]);
          if (state.status === 'processing' || state.status === 'pending') {
            if (state.triggerId) activeTriggerIds.add(state.triggerId);
          } else if (state.lastUpdate && state.lastUpdate < oneHourAgo) {
            staleStateKeys.push(key);
          }
        } catch (e) { /* skip */ }
      }
    }

    // Delete orphaned triggers
    for (const trigger of triggers) {
      if (trigger.getHandlerFunction() === 'continueBatchProcessing') {
        if (!activeTriggerIds.has(trigger.getUniqueId())) {
          try { ScriptApp.deleteTrigger(trigger); } catch (e) { /* in use */ }
        }
      }
    }

    // Delete stale states
    for (const key of staleStateKeys) {
      try { props.deleteProperty(key); } catch (e) { /* ignore */ }
    }

    // Delete stale trigger mappings
    for (const key of Object.keys(allProps)) {
      if (key.startsWith('BATCH_TRIGGER_')) {
        const sessionId = allProps[key];
        const stateJson = allProps[`batchState_${sessionId}`];
        if (!stateJson) {
          props.deleteProperty(key);
        } else {
          try {
            const state = JSON.parse(stateJson);
            if (state.status !== 'processing' && state.status !== 'pending') {
              props.deleteProperty(key);
            }
          } catch (e) { /* skip */ }
        }
      }
    }

  } catch (error) {
    console.error('[cleanupOrphaned] Error:', error);
  }
}

/**
 * Emergency: Force remove ALL batch triggers and data.
 * Use when the system is stuck or you hit "too many triggers" errors.
 */
function forceCleanupAllBatchData() {
  const result = { triggersDeleted: 0, statesDeleted: 0, mappingsDeleted: 0 };
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();

  // Delete all batch triggers
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'continueBatchProcessing') {
      try { ScriptApp.deleteTrigger(trigger); result.triggersDeleted++; } catch (e) {}
    }
  }

  // Delete all batch states and trigger mappings
  for (const key of Object.keys(allProps)) {
    if (key.startsWith('batchState_')) {
      try { props.deleteProperty(key); result.statesDeleted++; } catch (e) {}
    }
    if (key.startsWith('BATCH_TRIGGER_')) {
      try { props.deleteProperty(key); result.mappingsDeleted++; } catch (e) {}
    }
  }

  console.log(`[forceCleanup] Done: ${JSON.stringify(result)}`);
  return result;
}
```

---

## Progress Tracking (Optional)

A companion class for tracking progress visible to a polling UI. Uses dual storage (UserProperties for persistence + UserCache for speed).

```javascript
/**
 * PersistentProgressTracker - Session-aware progress tracking
 * Uses UserProperties (persistent) + UserCache (fast reads) for dual storage
 */
class PersistentProgressTracker {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.userEmail = Session.getActiveUser().getEmail();
    this.properties = PropertiesService.getUserProperties();
    this.cache = CacheService.getUserCache();
  }

  getProgress() {
    try {
      // Try cache first
      const cached = this.cache.get(this.sessionId);
      if (cached) return JSON.parse(cached);

      // Fallback to persistent storage
      const stored = this.properties.getProperty(this.sessionId);
      if (stored) {
        this.cache.put(this.sessionId, stored, 600);
        return JSON.parse(stored);
      }

      return this.getDefaultProgress();
    } catch (error) {
      return this.getDefaultProgress();
    }
  }

  saveProgress(progressData) {
    try {
      const data = {
        ...progressData,
        sessionId: this.sessionId,
        lastUpdate: new Date().getTime(),
        timestamp: new Date().toISOString()
      };
      const dataString = JSON.stringify(data);
      this.properties.setProperty(this.sessionId, dataString);
      this.cache.put(this.sessionId, dataString, 600);
      return true;
    } catch (error) {
      console.error('Error saving progress:', error);
      return false;
    }
  }

  getDefaultProgress() {
    return {
      sessionId: this.sessionId,
      status: 'Initializing...',
      percent: 0,
      totalItems: 0,
      processedItems: 0,
      errors: [],
      startTime: new Date().getTime(),
      lastUpdate: new Date().getTime(),
      // Batch fields
      batchProcessing: false,
      currentBatch: 0,
      totalBatches: 0,
      batchStatus: 'none'   // none | processing | completed | error
    };
  }
}

/**
 * Update batch progress (called from BatchProcessor during processing)
 */
function updateBatchProgressWithSession(sessionId, currentBatch, totalBatches, processedCount, totalCount, batchStatus) {
  if (!sessionId) return false;

  const tracker = new PersistentProgressTracker(sessionId);
  let progress = tracker.getProgress();

  progress.batchProcessing = true;
  progress.currentBatch = currentBatch;
  progress.totalBatches = totalBatches;
  progress.processedItems = processedCount;
  progress.totalItems = totalCount;
  progress.batchStatus = batchStatus;

  if (totalCount > 0) {
    progress.percent = Math.round((processedCount / totalCount) * 100);
  }

  if (batchStatus === 'completed') {
    progress.status = `Complete! All ${totalBatches} batches processed.`;
    progress.percent = 100;
  } else if (batchStatus === 'error') {
    progress.status = `Error in batch ${currentBatch}/${totalBatches}`;
  } else {
    progress.status = `Processing batch ${currentBatch}/${totalBatches} (${processedCount}/${totalCount} items)`;
  }

  return tracker.saveProgress(progress);
}

/**
 * Get batch progress for UI polling
 */
function getBatchProgressStatus(sessionId) {
  if (!sessionId) return null;

  const tracker = new PersistentProgressTracker(sessionId);
  const progress = tracker.getProgress();

  return {
    sessionId: sessionId,
    isBatchJob: progress.batchProcessing || false,
    status: progress.status,
    percent: progress.percent,
    currentBatch: progress.currentBatch || 0,
    totalBatches: progress.totalBatches || 0,
    processedCount: progress.processedItems,
    totalItems: progress.totalItems,
    isComplete: progress.percent >= 100 || progress.batchStatus === 'completed',
    isError: progress.batchStatus === 'error',
    errors: progress.errors || []
  };
}
```

---

## Entry Point Pattern

Shows how to decide between inline processing and batch processing based on item count.

```javascript
/**
 * Main generation entry point
 * Decides between inline (fast) and batch (safe for large jobs) processing
 */
function processItems(items, params, sessionId) {
  // Validate items first
  const validItems = validateItems(items);

  if (validItems.length === 0) {
    console.log('No valid items to process');
    return { success: false, error: 'No valid items' };
  }

  // Decide processing strategy
  if (validItems.length >= BATCH_THRESHOLD) {
    // Large job → batch processing
    console.log(`Using BATCH processing for ${validItems.length} items`);
    return processWithBatching(validItems, params, sessionId);
  }

  // Small job → inline processing (fast, no triggers needed)
  console.log(`Using INLINE processing for ${validItems.length} items`);
  return processInline(validItems, params, sessionId);
}

/**
 * Initialize batch processing and run the first batch
 */
function processWithBatching(validItems, params, sessionId) {
  const processor = new BatchProcessor(sessionId);
  processor.initializeBatch(validItems, {
    // Store only minimal config needed across batches
    showNames: params.showNames || false,
    outputId: params.outputId
  });

  // Process first batch immediately (within the current execution)
  const firstResult = processor.processNextBatch();

  if (firstResult.status === 'completed') {
    return { success: true, ...firstResult };
  }

  // More batches will be handled by triggers
  return {
    success: true,
    batchProcessing: true,
    currentBatch: 1,
    totalBatches: firstResult.totalBatches,
    status: 'processing'
  };
}
```

---

## UI Polling Pattern (Client-Side)

For HTML Service UIs that need to display batch progress:

```html
<script>
  let pollInterval = null;
  const SESSION_ID = 'your-session-id'; // Set when generation starts

  function startPolling() {
    pollInterval = setInterval(checkProgress, 3000); // Poll every 3 seconds
  }

  function checkProgress() {
    google.script.run
      .withSuccessHandler(handleProgress)
      .withFailureHandler(handleError)
      .getBatchProgressStatus(SESSION_ID);
  }

  function handleProgress(progress) {
    if (!progress) return;

    // Update UI
    document.getElementById('status').textContent = progress.status;
    document.getElementById('progressBar').style.width = progress.percent + '%';
    document.getElementById('batchInfo').textContent =
      progress.isBatchJob
        ? `Batch ${progress.currentBatch}/${progress.totalBatches}`
        : '';

    // Stop polling when done
    if (progress.isComplete || progress.isError) {
      clearInterval(pollInterval);
      if (progress.isComplete) {
        showCompletionMessage(progress);
      } else {
        showErrorMessage(progress.errors);
      }
    }
  }

  function handleError(error) {
    console.error('Polling error:', error);
    // Don't stop polling on transient errors - just log and retry
  }
</script>
```

---

## Storage Key Reference

All keys used in PropertiesService and CacheService by the batch system:

| Key Pattern | Storage | Purpose | Lifecycle |
|---|---|---|---|
| `batchState_{sessionId}` | Properties + Cache | Job state (status, progress, config) | Created at init, deleted on cleanup |
| `batchItems_{sessionId}_chunks` | Cache | Number of item data chunks | Created at init, expires with TTL |
| `batchItems_{sessionId}_{N}` | Cache | Item data chunk N | Created at init, expires with TTL |
| `BATCH_TRIGGER_{triggerId}` | Properties | Maps trigger ID → session ID | Created per batch, deleted after firing |

---

## Checklist for Adapting to a New Project

1. **Copy the core code**: `BatchProcessor` class, `continueBatchProcessing()` handler, and all cleanup functions
2. **Rename the trigger handler** function name in both `scheduleNextBatch()` and `cleanupTriggers()` to match your project
3. **Override `processBatchItems()`** with your business logic (e.g., writing rows, sending emails, placing images)
4. **Override `recoverItems()`** to reload your data from source if cache expires mid-job
5. **Override `onComplete()`** for post-completion actions (emails, notifications, sheet updates)
6. **Set `BATCH_CONFIG` values** appropriate for your workload:
   - `ITEMS_PER_BATCH`: How many items your logic can handle in ~4 minutes
   - `TRIGGER_DELAY_MS`: Gap between batches (30s is usually safe)
7. **Add progress tracking** if you have a UI that polls for updates
8. **Wire up the entry point** to decide between inline and batch processing
9. **Add cleanup functions to a menu** so administrators can recover from stuck jobs
10. **Test with small batches first** (set `BATCH_THRESHOLD` low, e.g., 5) to verify the trigger chain works

---

## Common Pitfalls

| Pitfall | Solution |
|---|---|
| `.after(ms)` has timezone bugs | Use `.at(new Date(Date.now() + ms))` instead |
| State JSON exceeds 9KB | Keep `jobConfig` minimal; trim errors array in `saveState()` |
| Cache expires between batches | Implement `recoverItems()` to reload from source |
| Trigger accumulation ("too many triggers") | Call `cleanupDisabledBatchTriggers()` before creating new triggers |
| Can't identify which session a trigger belongs to | Use `BATCH_TRIGGER_{triggerUid}` mapping in PropertiesService |
| Trigger handler can't find session | Fallback scan of all `BATCH_TRIGGER_*` mappings |
| Batch fails mid-execution | Retry with `retryCount` tracking and `MAX_RETRIES` limit |
| Orphaned state from crashed jobs | `cleanupOrphanedBatchTriggers()` removes states older than 1 hour |

---

## Source Files in This Project

| File | Role |
|---|---|
| `BatchLogoProcessor` | Full implementation of `BatchLogoProcessor` class with logo-specific logic |
| `SlideGenerationNonSegmented` | Entry point that decides between inline and batch processing |
| `SlideGenerationProgress` | `PersistentProgressTracker` class and all progress update functions |
| `helpersessionprogresstrack` | Session recovery, cleanup, and statistics helpers |
| `PropertyStorageManagement` | Property storage cleanup and emergency reset functions |
| `Config` | Global `CONFIG` and `BATCH_CONFIG` constants |
