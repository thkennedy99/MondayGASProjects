/**
 * BatchMigrationProcessor.gs - Batch processing for workspace migration.
 *
 * Breaks the long-running _executeMigration into phases that chain via
 * time-based triggers, avoiding the 6-minute GAS execution limit.
 *
 * Phases:
 *   1. INIT       — create workspace, scan boards, create folders
 *   2. BOARDS     — migrate boards one at a time (yields between boards)
 *   3. DOCUMENTS  — migrate documents
 *   4. FINALIZE   — save mapping, update progress to 100%
 *
 * State is persisted in ScriptProperties (durable) + ScriptCache (fast).
 * The UI polls getMigrationProgress() which reads the same progress state
 * that already exists — no UI changes needed for basic functionality.
 */

// ── Batch Configuration ─────────────────────────────────────────────────────

var BATCH_MIGRATION_CONFIG = {
  MAX_EXECUTION_MS: 330000,     // 5.5 minutes — closer to GAS 6-min limit for fewer yields
  TRIGGER_DELAY_MS: 5000,       // 5 seconds between phases (was 30s — unnecessary)
  STATE_TTL: 21600,             // 6 hours cache TTL
  CACHE_CHUNK_SIZE: 50000,      // 50KB per cache chunk (CacheService limit: 100KB/value)
  MAX_RETRIES: 2                // Max retries for a failed board
};

// ── Batch State Management ──────────────────────────────────────────────────

/**
 * Read batch migration state from storage (cache-first, then properties).
 */
function _getBatchState(migrationId) {
  var key = 'migBatch_' + migrationId;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty(key);
  if (stored) {
    try {
      var state = JSON.parse(stored);
      cache.put(key, stored, BATCH_MIGRATION_CONFIG.STATE_TTL);
      return state;
    } catch (e) {}
  }
  return null;
}

/**
 * Save batch migration state to dual storage.
 * boardMapping is stored separately in chunked cache to keep state under 9KB.
 */
function _saveBatchState(migrationId, state) {
  var key = 'migBatch_' + migrationId;
  state.lastUpdate = new Date().toISOString();

  // Store boardMapping separately (can grow large with many boards)
  if (state.boardMapping && state.boardMapping.length > 0) {
    _saveBoardMapping(migrationId, state.boardMapping);
  }

  // Build a lean state object without boardMapping for Properties storage
  var leanState = Object.assign({}, state);
  leanState.boardMapping = undefined; // Don't serialize into state
  leanState._boardMappingCount = (state.boardMapping || []).length;

  var json = JSON.stringify(leanState);

  // Trim errors if state still exceeds 9KB PropertiesService limit
  if (json.length > 8500) {
    leanState.errors = (leanState.errors || []).slice(-5);
    leanState.folderList = []; // folderList only needed during INIT phase
    json = JSON.stringify(leanState);
  }

  PropertiesService.getScriptProperties().setProperty(key, json);
  try {
    CacheService.getScriptCache().put(key, json, BATCH_MIGRATION_CONFIG.STATE_TTL);
  } catch (e) {}
}

/**
 * Read batch migration state and re-attach boardMapping from chunked cache.
 */
function _getBatchStateWithMapping(migrationId) {
  var state = _getBatchState(migrationId);
  if (!state) return null;

  // Re-attach boardMapping from separate storage
  state.boardMapping = _getBoardMapping(migrationId) || [];
  return state;
}

/**
 * Save boardMapping to CacheService in chunks (large arrays).
 */
function _saveBoardMapping(migrationId, boardMapping) {
  var prefix = 'migBoardMap_' + migrationId + '_';
  var cache = CacheService.getScriptCache();
  var json = JSON.stringify(boardMapping);
  var totalChunks = Math.ceil(json.length / BATCH_MIGRATION_CONFIG.CACHE_CHUNK_SIZE);

  cache.put(prefix + 'chunks', String(totalChunks), BATCH_MIGRATION_CONFIG.STATE_TTL);
  for (var i = 0; i < totalChunks; i++) {
    var start = i * BATCH_MIGRATION_CONFIG.CACHE_CHUNK_SIZE;
    var end = start + BATCH_MIGRATION_CONFIG.CACHE_CHUNK_SIZE;
    cache.put(prefix + i, json.substring(start, end), BATCH_MIGRATION_CONFIG.STATE_TTL);
  }

  // Also persist to Properties as backup (if it fits)
  if (json.length < 9000) {
    PropertiesService.getScriptProperties().setProperty(prefix + 'data', json);
  }
}

/**
 * Get boardMapping from chunked cache, with Properties fallback.
 */
function _getBoardMapping(migrationId) {
  var prefix = 'migBoardMap_' + migrationId + '_';
  var cache = CacheService.getScriptCache();

  // Try cache first
  var chunksStr = cache.get(prefix + 'chunks');
  if (chunksStr) {
    var totalChunks = parseInt(chunksStr);
    var json = '';
    var allFound = true;
    for (var i = 0; i < totalChunks; i++) {
      var chunk = cache.get(prefix + i);
      if (!chunk) { allFound = false; break; }
      json += chunk;
    }
    if (allFound) {
      try { return JSON.parse(json); } catch (e) {}
    }
  }

  // Fallback to Properties
  var stored = PropertiesService.getScriptProperties().getProperty(prefix + 'data');
  if (stored) {
    try {
      var mapping = JSON.parse(stored);
      // Re-cache for future reads
      _saveBoardMapping(migrationId, mapping);
      return mapping;
    } catch (e) {}
  }

  return [];
}

/**
 * Clean up batch state and boardMapping after completion.
 */
function _clearBatchState(migrationId) {
  var key = 'migBatch_' + migrationId;
  var prefix = 'migBoardMap_' + migrationId + '_';
  var cache = CacheService.getScriptCache();
  var props = PropertiesService.getScriptProperties();

  try {
    props.deleteProperty(key);
    cache.remove(key);

    // Clean up boardMapping chunks
    var chunksStr = cache.get(prefix + 'chunks');
    if (chunksStr) {
      var totalChunks = parseInt(chunksStr);
      for (var i = 0; i < totalChunks; i++) {
        cache.remove(prefix + i);
      }
      cache.remove(prefix + 'chunks');
    }
    props.deleteProperty(prefix + 'data');
  } catch (e) {}
}

// ── Trigger Management ──────────────────────────────────────────────────────

/**
 * Schedule the next phase of migration via a time-based trigger.
 */
function _scheduleMigrationContinuation(migrationId) {
  try {
    // Clean up disabled triggers first to stay under the 20-trigger limit
    _cleanupMigrationTriggers();

    var triggerTime = new Date(Date.now() + BATCH_MIGRATION_CONFIG.TRIGGER_DELAY_MS);
    var trigger = ScriptApp.newTrigger('continueMigrationBatch')
      .timeBased()
      .at(triggerTime)
      .create();

    var triggerId = trigger.getUniqueId();

    // Store trigger → migration mapping
    PropertiesService.getScriptProperties().setProperty(
      'MIG_TRIGGER_' + triggerId, migrationId
    );

    console.log('Migration: Scheduled continuation trigger ' + triggerId + ' at ' + triggerTime.toISOString());
    return triggerId;
  } catch (error) {
    console.error('Migration: Failed to schedule continuation:', error);
    throw error;
  }
}

/**
 * Trigger handler — called by GAS when a scheduled trigger fires.
 * Looks up the migration ID from the trigger mapping and continues processing.
 */
function continueMigrationBatch(e) {
  console.log('Migration: continueMigrationBatch trigger fired');
  var props = PropertiesService.getScriptProperties();
  var targetMigrationId = null;

  // Step 1: Direct lookup via triggerUid
  var firedTriggerId = e && e.triggerUid;
  if (firedTriggerId) {
    var mappingKey = 'MIG_TRIGGER_' + firedTriggerId;
    targetMigrationId = props.getProperty(mappingKey);
    if (targetMigrationId) {
      props.deleteProperty(mappingKey);
    }
  }

  // Step 2: Fallback scan if direct lookup failed
  if (!targetMigrationId) {
    console.log('Migration: Fallback — scanning all MIG_TRIGGER_ mappings');
    var allProps = props.getProperties();
    for (var key in allProps) {
      if (key.indexOf('MIG_TRIGGER_') === 0) {
        var candidateId = allProps[key];
        var candidateState = _getBatchState(candidateId);
        if (candidateState && candidateState.phase !== 'completed' && candidateState.phase !== 'error' && candidateState.phase !== 'cancelled') {
          targetMigrationId = candidateId;
          props.deleteProperty(key);
          break;
        }
      }
    }
  }

  if (!targetMigrationId) {
    console.log('Migration: No active migration found for trigger');
    return;
  }

  console.log('Migration: Continuing migration ' + targetMigrationId);

  try {
    _executeMigrationPhase(targetMigrationId);
  } catch (error) {
    console.error('Migration: Phase execution error:', error);
    updateMigrationProgress(targetMigrationId, {
      state: 'error',
      message: 'Migration failed: ' + error.toString()
    });
    var state = _getBatchState(targetMigrationId);
    if (state) {
      state.phase = 'error';
      _saveBatchState(targetMigrationId, state);
    }
  }
}

/**
 * Clean up disabled/orphaned migration triggers.
 */
function _cleanupMigrationTriggers() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();

    // Build set of trigger IDs that are actively needed
    var activeTriggerIds = {};
    for (var key in allProps) {
      if (key.indexOf('MIG_TRIGGER_') === 0) {
        var tId = key.replace('MIG_TRIGGER_', '');
        var migId = allProps[key];
        var batchState = _getBatchState(migId);
        if (batchState && batchState.phase !== 'completed' && batchState.phase !== 'error' && batchState.phase !== 'cancelled') {
          activeTriggerIds[tId] = true;
        } else {
          // Stale mapping — clean up
          props.deleteProperty(key);
        }
      }
    }

    var cleaned = 0;
    for (var i = 0; i < triggers.length; i++) {
      var trigger = triggers[i];
      if (trigger.getHandlerFunction() === 'continueMigrationBatch') {
        if (!activeTriggerIds[trigger.getUniqueId()]) {
          ScriptApp.deleteTrigger(trigger);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      console.log('Migration: Cleaned up ' + cleaned + ' stale migration triggers');
    }
  } catch (error) {
    console.error('Migration: Trigger cleanup error:', error);
  }
}

/**
 * Clean up orphaned batch states and stale trigger mappings.
 * Call periodically or after batch completion to keep storage clean.
 * Removes states older than 1 hour that are in terminal states.
 */
function cleanupOrphanedMigrationState() {
  try {
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var oneHourAgo = Date.now() - (60 * 60 * 1000);
    var cleaned = { states: 0, mappings: 0 };

    for (var key in allProps) {
      // Clean up stale batch states
      if (key.indexOf('migBatch_') === 0) {
        try {
          var state = JSON.parse(allProps[key]);
          var isTerminal = (state.phase === 'completed' || state.phase === 'error' || state.phase === 'cancelled');
          var lastUpdate = state.lastUpdate ? new Date(state.lastUpdate).getTime() : 0;
          if (isTerminal && lastUpdate < oneHourAgo) {
            var migId = key.replace('migBatch_', '');
            _clearBatchState(migId);
            cleaned.states++;
          }
        } catch (e) { /* skip malformed */ }
      }

      // Clean up orphaned trigger mappings (no matching active state)
      if (key.indexOf('MIG_TRIGGER_') === 0) {
        var mappedMigId = allProps[key];
        var stateJson = allProps['migBatch_' + mappedMigId];
        if (!stateJson) {
          props.deleteProperty(key);
          cleaned.mappings++;
        } else {
          try {
            var mappedState = JSON.parse(stateJson);
            if (mappedState.phase === 'completed' || mappedState.phase === 'error' || mappedState.phase === 'cancelled') {
              props.deleteProperty(key);
              cleaned.mappings++;
            }
          } catch (e) { /* skip */ }
        }
      }
    }

    if (cleaned.states > 0 || cleaned.mappings > 0) {
      console.log('Migration: Orphan cleanup: ' + JSON.stringify(cleaned));
    }
    return cleaned;
  } catch (error) {
    console.error('Migration: Orphan cleanup error:', error);
    return { states: 0, mappings: 0 };
  }
}

/**
 * Emergency cleanup: remove ALL migration triggers and batch state.
 * Run from the Apps Script editor if things get stuck.
 */
function forceCleanupMigrationBatchData() {
  var result = { triggersDeleted: 0, statesDeleted: 0, mappingsDeleted: 0 };
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();

  for (var i = 0; i < ScriptApp.getProjectTriggers().length; i++) {
    var trigger = ScriptApp.getProjectTriggers()[i];
    if (trigger.getHandlerFunction() === 'continueMigrationBatch') {
      try { ScriptApp.deleteTrigger(trigger); result.triggersDeleted++; } catch (e) {}
    }
  }

  for (var key in allProps) {
    if (key.indexOf('migBatch_') === 0) {
      try { props.deleteProperty(key); result.statesDeleted++; } catch (e) {}
    }
    if (key.indexOf('MIG_TRIGGER_') === 0) {
      try { props.deleteProperty(key); result.mappingsDeleted++; } catch (e) {}
    }
    if (key.indexOf('migBoardMap_') === 0) {
      try { props.deleteProperty(key); result.mappingsDeleted++; } catch (e) {}
    }
  }

  console.log('Migration: Force cleanup: ' + JSON.stringify(result));
  return result;
}

// ── Phase-Based Migration Execution ─────────────────────────────────────────

/**
 * Initialize a batch migration — replaces the old fire-and-forget runMigration.
 * Sets up state and immediately starts the first phase.
 *
 * Called from runMigration() as a drop-in replacement for _executeMigration().
 */
function _executeMigrationBatched(migrationId, params) {
  var sourceWsId = params.sourceWorkspaceId;
  var targetName = params.targetWorkspaceName || null;
  var components = params.components || {};
  var targetApiKey = params.targetApiKey || (params.targetAccountId ? getTargetApiKeyForAccount(params.targetAccountId) : null) || null;
  var isCrossAccount = !!targetApiKey;

  // Mandatory components are always on
  components.boards = true;
  components.columns = true;
  components.items = true;

  // Initialize batch state
  var batchState = {
    migrationId: migrationId,
    phase: 'init',          // init | boards | documents | finalize | completed | error
    sourceWsId: sourceWsId,
    targetName: targetName,
    components: components,
    targetApiKey: targetApiKey,
    isCrossAccount: isCrossAccount,
    selectedBoardIds: params.selectedBoardIds || null,
    // Populated during INIT phase
    targetWsId: null,
    targetWsName: null,
    sourceBoards: null,     // stored minimal: [{id, name, board_kind, board_folder_id}]
    folderMapping: {},
    folderList: [],
    boardFolderLookup: {},
    // Populated during BOARDS phase
    boardIndex: 0,           // next board to process
    boardMapping: [],
    totalItemsMigrated: 0,
    totalItemsExpected: 0,
    totalSubitemsMigrated: 0,
    // Populated during DOCUMENTS phase
    docMapping: [],
    docMigrationResult: null,
    // Timing
    startTime: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    retryCount: 0,
    errors: []
  };

  _saveBatchState(migrationId, batchState);

  console.log('Migration: ═══════════════════════════════════════════════════════');
  console.log('Migration: STARTING BATCHED MIGRATION ' + migrationId);
  console.log('Migration: Source workspace ID: ' + sourceWsId);
  console.log('Migration: Target name: ' + (targetName || '(auto)'));
  console.log('Migration: Cross-account: ' + isCrossAccount);
  console.log('Migration: Components: ' + JSON.stringify(components));
  console.log('Migration: ═══════════════════════════════════════════════════════');

  updateMigrationProgress(migrationId, {
    state: 'running',
    percent: 2,
    message: 'Initializing migration...' + (isCrossAccount ? ' (cross-account)' : ''),
    sourceWorkspaceId: sourceWsId,
    components: components,
    isCrossAccount: isCrossAccount
  });

  logMigrationAction(migrationId, 'START', sourceWsId, '', 'running',
    Object.assign({}, params, { targetApiKey: targetApiKey ? '[REDACTED]' : null }));

  // Start the first phase immediately
  _executeMigrationPhase(migrationId);

  return safeReturn({
    success: true,
    migrationId: migrationId,
    state: 'running',
    batched: true
  });
}

/**
 * Main phase dispatcher — reads current phase from batch state and runs it.
 * After each phase completes (or yields), schedules a trigger for the next.
 */
function _executeMigrationPhase(migrationId) {
  var state = _getBatchState(migrationId);
  if (!state) {
    throw new Error('Batch state not found for migration: ' + migrationId);
  }

  var phase = state.phase;
  console.log('Migration: Executing phase "' + phase + '" for ' + migrationId);

  // Check for cancellation
  if (phase === 'cancelled') {
    console.log('Migration: ' + migrationId + ' was cancelled — skipping phase execution');
    _cleanupMigrationTriggers();
    return;
  }

  // Also check the progress state (UI may have set it to cancelled)
  var progressStr = CacheService.getScriptCache().get('mig_' + migrationId)
    || PropertiesService.getScriptProperties().getProperty('mig_' + migrationId);
  if (progressStr) {
    try {
      var progressState = JSON.parse(progressStr);
      if (progressState.state === 'cancelled') {
        console.log('Migration: ' + migrationId + ' cancelled via progress state — aborting');
        state.phase = 'cancelled';
        _saveBatchState(migrationId, state);
        _cleanupMigrationTriggers();
        return;
      }
    } catch (e) {}
  }

  try {
    switch (phase) {
      case 'init':
        _phaseInit(migrationId, state);
        break;
      case 'boards':
        _phaseBoards(migrationId, state);
        break;
      case 'documents':
        _phaseDocuments(migrationId, state);
        break;
      case 'finalize':
        _phaseFinalize(migrationId, state);
        break;
      default:
        console.log('Migration: Phase "' + phase + '" — nothing to do');
        return;
    }
  } catch (error) {
    console.error('Migration: Phase "' + phase + '" error:', error);
    state.phase = 'error';
    state.errors.push({ phase: phase, msg: error.toString() });
    _saveBatchState(migrationId, state);

    updateMigrationProgress(migrationId, {
      state: 'error',
      message: 'Migration failed during ' + phase + ': ' + error.toString(),
      errors: [{ board: 'Phase: ' + phase, msg: error.toString() }]
    });

    logMigrationAction(migrationId, 'ERROR', state.sourceWsId, '', 'error', error.toString());
  }
}

// ── Phase: INIT ─────────────────────────────────────────────────────────────

/**
 * Create target workspace, scan boards, recreate folder structure.
 * Transitions to BOARDS phase.
 */
function _phaseInit(migrationId, state) {
  var sourceWsId = state.sourceWsId;
  var targetApiKey = state.targetApiKey;

  // Step 1: Get source workspace info
  console.log('Migration: Step 1 - Fetching source workspace details...');
  var sourceWs = getWorkspaceDetails(sourceWsId);
  if (!sourceWs) throw new Error('Source workspace not found (ID: ' + sourceWsId + ').');
  console.log('Migration: Step 1 DONE - Source: "' + sourceWs.name + '"');

  updateMigrationProgress(migrationId, { percent: 5, message: 'Creating new workspace...' });

  // Step 2: Create target workspace
  console.log('Migration: Step 2 - Creating target workspace...');
  var wsName = state.targetName || sourceWs.name + ' (Migrated)';
  var targetWs = createWorkspaceOnTarget(targetApiKey, wsName, sourceWs.kind || 'open', sourceWs.description || '');
  console.log('Migration: Step 2 DONE - Target workspace: "' + wsName + '" (id=' + targetWs.id + ')');

  state.targetWsId = String(targetWs.id);
  state.targetWsName = wsName;

  updateMigrationProgress(migrationId, {
    percent: 8,
    message: 'Workspace "' + wsName + '" created. Scanning boards...',
    targetWorkspaceId: state.targetWsId
  });

  // Step 3: Get source boards and filter subitem boards
  console.log('Migration: Step 3 - Fetching boards...');
  var sourceBoards = getBoardsInWorkspace(sourceWsId);

  var subitemBoardIds = {};
  sourceBoards.forEach(function(board) {
    (board.columns || []).forEach(function(col) {
      if (col.type === 'subtasks' && col.settings_str) {
        try {
          var settings = JSON.parse(col.settings_str);
          if (settings.boardIds) {
            settings.boardIds.forEach(function(bid) {
              subitemBoardIds[String(bid)] = board.name;
            });
          }
        } catch (e) {}
      }
    });
  });

  var filteredBoards = [];
  sourceBoards.forEach(function(board) {
    if (!subitemBoardIds[String(board.id)]) {
      filteredBoards.push(board);
    }
  });
  sourceBoards = filteredBoards;

  // Step 3b: Apply user-selected board filter (if provided)
  if (state.selectedBoardIds && state.selectedBoardIds.length > 0) {
    var selectedSet = {};
    state.selectedBoardIds.forEach(function(bid) { selectedSet[String(bid)] = true; });
    var beforeCount = sourceBoards.length;
    sourceBoards = sourceBoards.filter(function(board) {
      return selectedSet[String(board.id)];
    });
    console.log('Migration: Board filter applied — ' + sourceBoards.length + ' of ' + beforeCount + ' boards selected by user');
  }

  console.log('Migration: Step 3 DONE - Found ' + sourceBoards.length + ' boards');

  // Store minimal board info in state (keep state small)
  state.sourceBoards = sourceBoards.map(function(b) {
    return {
      id: String(b.id),
      name: b.name,
      board_kind: b.board_kind || 'public',
      board_folder_id: b.board_folder_id || null
    };
  });

  updateMigrationProgress(migrationId, {
    percent: 10,
    boardsTotal: sourceBoards.length,
    message: 'Found ' + sourceBoards.length + ' boards. Creating folders...'
  });

  // Step 3b: Recreate folder structure (skip if folders component is off)
  var folderMapping = {};
  var folderList = [];
  var skipFolders = state.components && state.components.folders === false;
  if (skipFolders) {
    console.log('Migration: Directory structure disabled — all boards will go to workspace root');
  } else {
    try {
      var sourceFolders = getWorkspaceFolders(sourceWsId);
      // Monday.com folders query returns ALL folders flat (including subfolders at root level
      // with parent set). Filter to only root folders, then walk sub_folders recursively
      // to avoid creating duplicates.
      var rootFolders = sourceFolders.filter(function(f) { return !f.parent; });
      if (rootFolders.length > 0) {
        var seenFolderIds = {};
        var flattenFolders = function(folders, parentSourceId) {
          folders.forEach(function(folder) {
            var fId = String(folder.id);
            if (seenFolderIds[fId]) return; // Skip duplicates
            seenFolderIds[fId] = true;
            folderList.push({
              id: fId,
              name: folder.name,
              color: folder.color || null,
              parentSourceId: parentSourceId
            });
            if (folder.sub_folders && folder.sub_folders.length > 0) {
              flattenFolders(folder.sub_folders, fId);
            }
          });
        };
        flattenFolders(rootFolders, null);

        updateMigrationProgress(migrationId, {
          message: 'Recreating ' + folderList.length + ' folder(s)...'
        });

        for (var fi = 0; fi < folderList.length; fi++) {
          var sf = folderList[fi];
          try {
            var targetParentFolderId = sf.parentSourceId ? (folderMapping[sf.parentSourceId] || null) : null;
            var newFolder = createFolderOnTarget(targetApiKey, targetWs.id, sf.name, targetParentFolderId, sf.color);
            folderMapping[sf.id] = String(newFolder.id);
            console.log('Migration:   Folder: "' + sf.name + '" → ' + newFolder.id);
          } catch (folderErr) {
            console.warn('Migration:   Failed folder "' + sf.name + '": ' + folderErr);
          }
        }
      }
    } catch (folderError) {
      console.warn('Migration: Folder migration failed: ' + folderError);
    }
  }

  state.folderMapping = folderMapping;
  state.folderList = folderList;

  // Build board → folder lookup: boardId → SOURCE folder ID
  // The move code will then look up folderMapping[sourceFolderId] to get the target folder ID.
  var boardFolderLookup = {};
  state.sourceBoards.forEach(function(b) {
    if (b.board_folder_id && folderMapping[String(b.board_folder_id)]) {
      boardFolderLookup[b.id] = String(b.board_folder_id);
    }
  });
  state.boardFolderLookup = boardFolderLookup;

  // Detect managed templates if enabled
  if (state.components && state.components.useManagedTemplates) {
    console.log('Migration: Detecting managed templates for source boards...');
    var templateSetId = state.components._templateSetId || null;
    var tplResult = detectManagedTemplatesForBoards(state.sourceBoards, targetApiKey, templateSetId);
    state.templateMapping = tplResult.templateMapping;

    var mappedCount = Object.keys(tplResult.templateMapping).length;
    var unmappedCount = tplResult.unmappedBoards.length;
    console.log('Migration: Template detection — ' + mappedCount + ' boards with templates, ' + unmappedCount + ' standalone');

    if (unmappedCount > 0) {
      console.log('Migration: Standalone boards (no template): ' +
        tplResult.unmappedBoards.map(function(b) { return '"' + b.name + '"'; }).join(', '));
    }
  }

  // Transition to BOARDS phase
  state.phase = 'boards';
  state.boardIndex = 0;
  state.boardMapping = [];
  _saveBatchState(migrationId, state);

  console.log('Migration: INIT phase complete. Scheduling BOARDS phase...');

  // Schedule next phase via trigger
  _scheduleMigrationContinuation(migrationId);
}

// ── Phase: BOARDS ───────────────────────────────────────────────────────────

/**
 * Migrate boards one at a time. Yields between boards if approaching
 * the execution time limit, then schedules a continuation trigger.
 * Retries failed boards up to MAX_RETRIES times before moving on.
 */
function _phaseBoards(migrationId, state) {
  var sourceBoards = state.sourceBoards || [];
  var components = state.components;
  var targetApiKey = state.targetApiKey;
  var targetWsId = state.targetWsId;
  var phaseStart = Date.now();

  // Re-attach boardMapping from chunked cache
  state.boardMapping = _getBoardMapping(migrationId) || [];

  console.log('Migration: BOARDS phase — starting at board ' + (state.boardIndex + 1) + '/' + sourceBoards.length);

  while (state.boardIndex < sourceBoards.length) {
    // Check execution time before starting next board
    var elapsed = Date.now() - phaseStart;
    if (elapsed > BATCH_MIGRATION_CONFIG.MAX_EXECUTION_MS) {
      console.log('Migration: Yielding after ' + Math.round(elapsed / 1000) + 's — processed boards ' +
        (state.boardIndex) + '/' + sourceBoards.length);
      _saveBatchState(migrationId, state);
      _scheduleMigrationContinuation(migrationId);
      return; // Yield — trigger will resume
    }

    // Check for cancellation mid-loop
    var progressStr = CacheService.getScriptCache().get('mig_' + migrationId)
      || PropertiesService.getScriptProperties().getProperty('mig_' + migrationId);
    if (progressStr) {
      try {
        var progressCheck = JSON.parse(progressStr);
        if (progressCheck.state === 'cancelled') {
          console.log('Migration: Cancelled during board loop at board ' + (state.boardIndex + 1));
          state.phase = 'cancelled';
          _saveBatchState(migrationId, state);
          _cleanupMigrationTriggers();
          return;
        }
      } catch (e) {}
    }

    var i = state.boardIndex;
    var boardInfo = sourceBoards[i];
    var boardPercent = 10 + Math.floor(((i + 1) / sourceBoards.length) * 75);

    updateMigrationProgress(migrationId, {
      percent: Math.min(boardPercent, 88),
      message: 'Migrating board ' + (i + 1) + '/' + sourceBoards.length + ': ' + boardInfo.name,
      boardsCompleted: i
    });

    var boardContext = { index: i + 1, total: sourceBoards.length, name: boardInfo.name };

    // Retry logic for board migration
    var boardSuccess = false;
    var boardRetries = 0;

    while (!boardSuccess && boardRetries <= BATCH_MIGRATION_CONFIG.MAX_RETRIES) {
      try {
        if (boardRetries > 0) {
          console.log('Migration: Retrying board "' + boardInfo.name + '" (attempt ' + (boardRetries + 1) + '/' + (BATCH_MIGRATION_CONFIG.MAX_RETRIES + 1) + ')');
          updateMigrationProgress(migrationId, {
            message: 'Retrying board ' + (i + 1) + '/' + sourceBoards.length + ': ' + boardInfo.name + ' (attempt ' + (boardRetries + 1) + ')'
          });
          // Exponential backoff: 2s, 4s
          Utilities.sleep(Math.pow(2, boardRetries) * 1000);
        } else {
          console.log('Migration: Board ' + (i + 1) + '/' + sourceBoards.length + ' - Starting: "' + boardInfo.name + '"');
        }

        // Re-fetch full board structure (not stored in state to keep it small)
        var fullBoard = _fetchFullBoard(boardInfo.id);
        if (!fullBoard) throw new Error('Could not fetch board structure for id=' + boardInfo.id);

        // Attach template mapping and folder lookup to components for the board migration
        if (state.templateMapping) {
          components._templateMapping = state.templateMapping;
        }
        // Derive target folder lookup on the fly from boardFolderLookup + folderMapping
        // to avoid storing duplicate data in state
        if (state.boardFolderLookup && state.folderMapping) {
          var targetFolderLookup = {};
          for (var bId in state.boardFolderLookup) {
            var srcFolderId = state.boardFolderLookup[bId];
            if (srcFolderId && state.folderMapping[srcFolderId]) {
              targetFolderLookup[bId] = state.folderMapping[srcFolderId];
            }
          }
          components._boardFolderLookup = targetFolderLookup;
        }

        var result = migrateBoard(fullBoard, targetWsId, components, migrationId, targetApiKey, boardContext);
        state.boardMapping.push(_summarizeBoardResult(result));
        state.totalItemsMigrated += result.itemsMigrated;
        state.totalItemsExpected += result.itemsTotal;
        state.totalSubitemsMigrated += (result.subitemsMigrated || 0);

        console.log('Migration: Board ' + (i + 1) + '/' + sourceBoards.length + ' - SUCCESS: "' + boardInfo.name +
          '" → ' + result.targetBoardId + ' (' + result.itemsMigrated + '/' + result.itemsTotal + ' items)');

        // Move board to correct folder
        var sourceFolderId = state.boardFolderLookup[boardInfo.id];
        if (sourceFolderId && state.folderMapping[sourceFolderId] && result.targetBoardId) {
          try {
            moveBoardToFolderOnTarget(targetApiKey, result.targetBoardId, state.folderMapping[sourceFolderId]);
            var lastResult = state.boardMapping[state.boardMapping.length - 1];
            lastResult.targetFolderId = state.folderMapping[sourceFolderId];
            // Find folder name
            for (var fi = 0; fi < state.folderList.length; fi++) {
              if (state.folderList[fi].id === sourceFolderId) {
                lastResult.folderName = state.folderList[fi].name;
                break;
              }
            }
          } catch (moveErr) {
            console.warn('Migration: Failed to move board to folder: ' + moveErr);
          }
        }

        boardSuccess = true;

      } catch (boardError) {
        boardRetries++;
        if (boardRetries > BATCH_MIGRATION_CONFIG.MAX_RETRIES) {
          console.error('Migration: Board ' + (i + 1) + ' FAILED after ' + boardRetries + ' attempts: ' + boardError.toString());
          state.boardMapping.push({
            sourceBoardId: boardInfo.id,
            sourceBoardName: boardInfo.name,
            targetBoardId: null,
            status: 'error',
            error: boardError.toString(),
            itemsMigrated: 0,
            itemsTotal: 0
          });
          updateMigrationProgress(migrationId, {
            errors: [{ board: boardInfo.name, msg: boardError.toString() }]
          });
        } else {
          console.warn('Migration: Board ' + (i + 1) + ' attempt ' + boardRetries + ' failed: ' + boardError.toString());
        }
      }
    }

    state.boardIndex = i + 1;
    state.retryCount = 0; // Reset retry count per board

    // Release references to board data to help GC reclaim memory between boards
    fullBoard = null;
    result = null;

    _saveBatchState(migrationId, state);
  }

  // All boards done — transition to DOCUMENTS or FINALIZE
  console.log('Migration: BOARDS phase complete. ' + state.boardMapping.length + ' boards processed.');

  if (state.components.documents) {
    state.phase = 'documents';
  } else {
    state.phase = 'finalize';
  }
  _saveBatchState(migrationId, state);
  _scheduleMigrationContinuation(migrationId);
}

/**
 * Re-fetch full board data for a board ID (columns, groups, etc.).
 * We don't store this in batch state to keep state small.
 */
function _fetchFullBoard(boardId) {
  try {
    var data = callMondayAPI(
      'query ($boardId: [ID!]) { boards (ids: $boardId) { id name board_kind board_folder_id state columns { id title type settings_str } groups { id title color position } } }',
      { boardId: [Number(boardId)] }
    );
    return data.boards && data.boards.length > 0 ? data.boards[0] : null;
  } catch (e) {
    console.error('Migration: _fetchFullBoard error for ' + boardId + ':', e);
    return null;
  }
}

/**
 * Summarize a board migration result for storage in batch state.
 * Keeps only the essential fields to avoid state size issues.
 */
function _summarizeBoardResult(result) {
  return {
    sourceBoardId: result.sourceBoardId,
    sourceBoardName: result.sourceBoardName,
    targetBoardId: result.targetBoardId,
    targetBoardName: result.targetBoardName,
    status: result.status,
    migrationMethod: result.migrationMethod || 'manual',
    itemsMigrated: result.itemsMigrated,
    itemsTotal: result.itemsTotal,
    subitemsMigrated: result.subitemsMigrated || 0,
    formsMigrated: result.formsMigrated || 0,
    formsTotal: result.formsTotal || 0,
    managedColumnsAttached: result.managedColumnsAttached || 0,
    columnsSkipped: result.columnsSkipped || 0,
    folderName: result.folderName || null,
    targetFolderId: result.targetFolderId || null
  };
}

// ── Phase: DOCUMENTS ────────────────────────────────────────────────────────

/**
 * Migrate documents from source to target workspace.
 * Transitions to FINALIZE phase.
 */
function _phaseDocuments(migrationId, state) {
  console.log('Migration: DOCUMENTS phase starting...');

  updateMigrationProgress(migrationId, {
    percent: 88,
    message: 'Migrating documents (export, backup to Drive, import)...'
  });

  try {
    var docResult = migrateDocuments(
      state.sourceWsId,
      state.targetWsId,
      migrationId,
      function(msg) {
        updateMigrationProgress(migrationId, { message: msg });
      },
      state.targetApiKey,
      state.folderMapping || {}
    );

    state.docMapping = docResult.docMapping || [];
    state.docMigrationResult = {
      docsTotal: docResult.docsTotal,
      docsMigrated: docResult.docsMigrated,
      docsSkipped: docResult.docsSkipped,
      driveFolder: docResult.driveFolder,
      errors: docResult.errors || []
    };

    if (docResult.errors && docResult.errors.length > 0) {
      docResult.errors.forEach(function(e) {
        updateMigrationProgress(migrationId, {
          errors: [{ board: 'Doc: ' + (e.docName || e.docId), msg: e.msg }]
        });
      });
    }
  } catch (docError) {
    console.warn('Migration: Document migration failed:', docError);
    updateMigrationProgress(migrationId, {
      errors: [{ board: 'Documents', msg: docError.toString() }]
    });
  }

  state.phase = 'finalize';
  _saveBatchState(migrationId, state);
  _scheduleMigrationContinuation(migrationId);
}

// ── Phase: FINALIZE ─────────────────────────────────────────────────────────

/**
 * Save mapping to spreadsheet, update final progress, clean up.
 */
function _phaseFinalize(migrationId, state) {
  console.log('Migration: FINALIZE phase starting...');

  // Re-attach boardMapping from chunked cache
  state.boardMapping = _getBoardMapping(migrationId) || [];

  updateMigrationProgress(migrationId, { percent: 95, message: 'Saving migration mapping...' });

  // Clean up orphaned state from previous runs
  cleanupOrphanedMigrationState();

  // Save mapping to spreadsheet
  saveMigrationMapping(
    migrationId,
    state.sourceWsId,
    state.targetWsId,
    state.targetWsName,
    state.boardMapping,
    state.docMapping || []
  );

  // Compute final status
  var successCount = state.boardMapping.filter(function(b) { return b.status === 'success'; }).length;
  var errorCount = state.boardMapping.filter(function(b) { return b.status !== 'success'; }).length;
  var finalState = (errorCount === 0) ? 'completed' : 'completed_with_errors';

  var foldersCreated = Object.keys(state.folderMapping).length;
  var docResult = state.docMigrationResult;

  var completionMsg = finalState === 'completed'
    ? 'Migration complete! ' + state.sourceBoards.length + ' boards cloned to "' + state.targetWsName + '".'
    : 'Migration finished with some errors. Check details.';

  if (foldersCreated > 0) {
    completionMsg += ' ' + foldersCreated + ' folder(s) recreated.';
  }
  if (docResult && docResult.docsMigrated > 0) {
    completionMsg += ' ' + docResult.docsMigrated + ' document(s) migrated with Drive backup.';
  }

  console.log('Migration: ═══════════════════════════════════════════════════════');
  console.log('Migration: MIGRATION ' + migrationId + ' FINISHED');
  console.log('Migration: State: ' + finalState);
  console.log('Migration: Boards: ' + successCount + ' succeeded, ' + errorCount + ' failed');
  console.log('Migration: Items: ' + state.totalItemsMigrated + '/' + state.totalItemsExpected);
  console.log('Migration: ═══════════════════════════════════════════════════════');

  updateMigrationProgress(migrationId, {
    state: finalState,
    percent: 100,
    message: completionMsg,
    boardsCompleted: state.sourceBoards.length,
    itemsTotal: state.totalItemsExpected,
    itemsMigrated: state.totalItemsMigrated,
    foldersCreated: foldersCreated,
    foldersTotal: state.folderList.length,
    targetWorkspaceId: state.targetWsId,
    targetWorkspaceName: state.targetWsName,
    boardMapping: state.boardMapping,
    docMapping: state.docMapping || [],
    documentMigration: docResult || null,
    endTime: new Date().toISOString()
  });

  logMigrationAction(migrationId, 'COMPLETE', state.sourceWsId, state.targetWsName, finalState, {
    boards: state.sourceBoards.length,
    items: state.totalItemsMigrated
  });

  // Clean up batch state (progress state is kept for the UI to read)
  state.phase = 'completed';
  _saveBatchState(migrationId, state);
  _cleanupMigrationTriggers();
}
