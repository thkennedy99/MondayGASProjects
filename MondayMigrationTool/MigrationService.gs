/**
 * MigrationService.gs - Core workspace migration logic.
 * Clones a workspace to a new workspace — same or different Monday.com account.
 * For same-account: people columns are preserved by user ID.
 * For cross-account: a target API key is used for all write operations.
 *
 * Supports selectable migration components:
 *   MANDATORY: boards, columns, items (rows)
 *   OPTIONAL:  groups, subscribers (users), guests, documents
 */

// ── Migration Component Definitions ──────────────────────────────────────────

var MIGRATION_COMPONENTS = {
  boards:         { label: 'Boards',            mandatory: true,  description: 'Board structure (always included)' },
  columns:        { label: 'Columns',           mandatory: true,  description: 'Column definitions (always included)' },
  items:          { label: 'Items (Rows)',      mandatory: true,  description: 'All item data (always included)' },
  groups:         { label: 'Groups',            mandatory: false, description: 'Board groups / sections', defaultOn: true },
  folders:        { label: 'Directory Structure', mandatory: false, description: 'Recreate folder hierarchy in the target workspace (if off, all boards go to workspace root)', defaultOn: true },
  useTemplates:   { label: 'Template Clone',    mandatory: false, description: 'Use duplicate_board to preserve views, automations, formulas, and managed column links (recommended)', defaultOn: true },
  managedColumns: { label: 'Managed Columns',   mandatory: false, description: 'Preserve account-level managed column links for status/dropdown consistency (used when Template Clone is off)', defaultOn: true },
  documents:      { label: 'Documents',          mandatory: false, description: 'Export docs as markdown, backup to Google Drive, and recreate in target workspace', defaultOn: true }
};

/**
 * Return the component definitions so the UI can render checkboxes.
 */
function getMigrationComponents() {
  return safeReturn({ success: true, data: MIGRATION_COMPONENTS });
}

// ── Migration State (stored in PropertiesService + CacheService) ─────────────

function getMigrationProgress(migrationId) {
  try {
    if (!migrationId) throw new Error('migrationId is required');

    var cache = CacheService.getScriptCache();
    var cached = cache.get('mig_' + migrationId);
    if (cached) return safeReturn({ success: true, progress: JSON.parse(cached) });

    var props = PropertiesService.getScriptProperties();
    var stored = props.getProperty('mig_' + migrationId);
    if (stored) return safeReturn({ success: true, progress: JSON.parse(stored) });

    return safeReturn({
      success: true,
      progress: {
        id: migrationId,
        state: 'not_found',
        percent: 0,
        message: 'Migration not found',
        errors: []
      }
    });
  } catch (error) {
    return handleError('getMigrationProgress', error, migrationId);
  }
}

function updateMigrationProgress(migrationId, patch) {
  var cache = CacheService.getScriptCache();
  var props = PropertiesService.getScriptProperties();

  var currentStr = cache.get('mig_' + migrationId) || props.getProperty('mig_' + migrationId);
  var current = currentStr ? JSON.parse(currentStr) : {
    id: migrationId,
    state: 'initializing',
    percent: 0,
    message: 'Starting...',
    errors: [],
    boardsTotal: 0,
    boardsCompleted: 0,
    itemsTotal: 0,
    itemsMigrated: 0,
    startTime: new Date().toISOString(),
    lastUpdate: new Date().toISOString()
  };

  if (patch.errors && current.errors) {
    patch.errors = current.errors.concat(patch.errors);
  }

  var merged = Object.assign({}, current, patch, { lastUpdate: new Date().toISOString() });
  var json = JSON.stringify(merged);

  props.setProperty('mig_' + migrationId, json);
  try {
    if (json.length < 90000) {
      cache.put('mig_' + migrationId, json, 600);
    }
  } catch (e) {}

  return merged;
}

function clearMigrationProgress(migrationId) {
  CacheService.getScriptCache().remove('mig_' + migrationId);
  PropertiesService.getScriptProperties().deleteProperty('mig_' + migrationId);
}

// ── Test Migration (Dry Run) ─────────────────────────────────────────────────

/**
 * Perform a dry run — analyzes what would happen without making changes.
 * @param {string} workspaceId - Source workspace ID
 * @param {Object} components - Which components to include { groups: true, subscribers: true, ... }
 * @returns {Object} Migration plan with estimated operations
 */
function testMigration(workspaceId, components) {
  try {
    if (!workspaceId) throw new Error('workspaceId is required');
    components = components || {};

    var wsDetail = getWorkspaceDetails(workspaceId);
    if (!wsDetail) throw new Error('Workspace not found: ' + workspaceId);

    var boards = getBoardsInWorkspace(workspaceId);

    var plan = {
      sourceWorkspace: {
        id: String(wsDetail.id),
        name: wsDetail.name,
        kind: wsDetail.kind
      },
      selectedComponents: components,
      boards: [],
      totals: {
        boards: boards.length,
        groups: 0,
        columns: 0,
        items: 0,
        managedColumns: 0,
        documents: 0
      },
      estimatedApiCalls: 0,
      estimatedDuration: '',
      warnings: [],
      notes: [
        'Migration runs within the same Monday.com account.',
        'People columns will be preserved because user IDs remain the same.',
        'A new workspace will be created with " (Migrated)" suffix by default.',
        'Users, guests, and board subscribers should be assigned separately via the Users & Guests tab after migration.'
      ]
    };

    var hasComplexColumns = false;
    boards.forEach(function(board) {
      var itemCount = 0;
      try { itemCount = getBoardItemCount(board.id); } catch (e) {
        plan.warnings.push('Could not get item count for board: ' + board.name);
      }

      var groupCount = board.groups ? board.groups.length : 0;
      // Exclude non-creatable/system column types from count so totals
      // reflect only what actually gets migrated to the target.
      var nonCreatableTypes = ['subtasks', 'board_relation', 'mirror', 'formula', 'auto_number',
                               'creation_log', 'last_updated', 'button', 'dependency', 'item_id'];
      var columnCount = (board.columns || []).filter(function(c) {
        return nonCreatableTypes.indexOf(c.type) < 0;
      }).length;

      // Detect complex column types that benefit from template cloning
      var complexTypes = ['mirror', 'board_relation', 'formula', 'auto_number', 'dependency'];
      var complexCols = (board.columns || []).filter(function(c) {
        return complexTypes.indexOf(c.type) >= 0;
      });
      if (complexCols.length > 0) hasComplexColumns = true;

      plan.boards.push({
        id: String(board.id),
        name: board.name,
        kind: board.board_kind || 'public',
        groups: groupCount,
        columns: columnCount,
        items: itemCount,
        columnTypes: (board.columns || []).map(function(c) { return c.type; }),
        complexColumns: complexCols.map(function(c) { return { title: c.title, type: c.type }; })
      });

      plan.totals.groups += groupCount;
      plan.totals.columns += columnCount;
      plan.totals.items += itemCount;
    });

    // Template clone analysis
    if (components.useTemplates) {
      plan.useTemplates = true;
      plan.notes.push('Template Clone is ON: boards will be duplicated via duplicate_board, preserving views, automations, formulas, and managed column links. Only item data will be migrated separately.');
      if (hasComplexColumns) {
        plan.notes.push('Complex columns detected (mirror, formula, dependency, etc.) — Template Clone will preserve these correctly.');
      }
    }

    // Documents analysis
    if (components.documents) {
      try {
        var docAnalysis = analyzeDocumentsForMigration(workspaceId);
        plan.totals.documents = docAnalysis.totalCount;
        plan.documentAnalysis = {
          totalCount: docAnalysis.totalCount,
          exportableCount: docAnalysis.exportableCount,
          emptyCount: docAnalysis.emptyCount,
          errorCount: docAnalysis.errorCount,
          totalMarkdownSize: docAnalysis.totalMarkdownSize,
          docs: docAnalysis.docs
        };
        if (docAnalysis.errorCount > 0) {
          plan.warnings.push(docAnalysis.errorCount + ' document(s) could not be exported and will be skipped.');
        }
        if (docAnalysis.totalCount > 0) {
          var sizeKb = Math.round(docAnalysis.totalMarkdownSize / 1024);
          plan.notes.push(docAnalysis.exportableCount + ' document(s) will be exported as markdown, backed up to Google Drive, and recreated in the target workspace. (~' + sizeKb + ' KB total)');
        }
      } catch (e) {
        plan.warnings.push('Could not analyze documents: ' + e.toString());
      }
    }

    // Managed columns analysis
    if (components.managedColumns !== false) {
      try {
        var managedCols = getActiveManagedColumns();
        var managedMatches = [];
        boards.forEach(function(board) {
          try {
            var matches = detectManagedColumnsOnBoard(board.id, board.columns);
            matches.forEach(function(m) {
              m.boardName = board.name;
              m.boardId = String(board.id);
              managedMatches.push(m);
            });
          } catch (e) {
            console.warn('Failed to detect managed columns on board ' + board.name + ':', e);
          }
        });
        plan.managedColumns = {
          accountTotal: managedCols.length,
          detectedOnBoards: managedMatches.length,
          matches: managedMatches
        };
        plan.totals.managedColumns = managedMatches.length;
        if (managedMatches.length > 0) {
          plan.notes.push(managedMatches.length + ' managed column link(s) detected across boards — these will be attached (not recreated) on the target to preserve account-level consistency.');
        }
      } catch (e) {
        plan.warnings.push('Could not analyze managed columns: ' + e.toString());
      }
    }

    // Estimate API calls
    var apiCalls = plan.totals.boards + plan.totals.columns + plan.totals.items + 10;
    if (components.groups !== false) apiCalls += plan.totals.groups;
    if (components.managedColumns !== false) apiCalls += plan.totals.managedColumns;
    if (components.documents) apiCalls += plan.totals.documents;
    plan.estimatedApiCalls = apiCalls;

    var estimatedSeconds = Math.ceil(apiCalls * 0.3);
    plan.estimatedDuration = estimatedSeconds < 60
      ? estimatedSeconds + ' seconds'
      : Math.ceil(estimatedSeconds / 60) + ' minutes';

    // Warnings for complex column types
    var manualSetup = ['mirror', 'board_relation', 'formula'];
    boards.forEach(function(board) {
      (board.columns || []).forEach(function(col) {
        if (manualSetup.indexOf(col.type) >= 0) {
          plan.warnings.push('Board "' + board.name + '" has ' + col.type + ' column "' + col.title + '" — requires manual setup after migration.');
        }
      });
    });

    if (plan.totals.items > 5000) {
      plan.warnings.push('Large migration (' + plan.totals.items + ' items). May approach API rate limits.');
    }

    if (!components.groups) {
      plan.notes.push('Groups are excluded — all items will go into default groups.');
    }

    return safeReturn({ success: true, data: plan });
  } catch (error) {
    return handleError('testMigration', error);
  }
}

// ── Target API Helpers ────────────────────────────────────────────────────────
// These wrappers call the target Monday.com account when a targetApiKey is
// provided, otherwise they fall back to the source (same-account) API key.

function _targetAPI(targetApiKey, query, variables) {
  if (targetApiKey) {
    return callMondayAPIWithKey(targetApiKey, query, variables);
  }
  return callMondayAPI(query, variables);
}

function createWorkspaceOnTarget(targetApiKey, name, kind, description) {
  var data = _targetAPI(targetApiKey,
    'mutation ($name: String!, $kind: WorkspaceKind!, $desc: String) { create_workspace (name: $name, kind: $kind, description: $desc) { id name } }',
    { name: name, kind: kind, desc: description || '' }
  );
  return data.create_workspace;
}

function createBoardOnTarget(targetApiKey, name, kind, workspaceId) {
  var data = _targetAPI(targetApiKey,
    'mutation ($name: String!, $kind: BoardKind!, $wsId: ID) { create_board (board_name: $name, board_kind: $kind, workspace_id: $wsId) { id name } }',
    { name: name, kind: kind, wsId: workspaceId ? Number(workspaceId) : null }
  );
  return data.create_board;
}

function createFolderOnTarget(targetApiKey, workspaceId, name, parentFolderId, color) {
  var variables = {
    wsId: Number(workspaceId),
    name: name
  };
  var args = '$wsId: ID!, $name: String!';
  var params = 'workspace_id: $wsId, name: $name';

  if (parentFolderId) {
    variables.parentFolderId = Number(parentFolderId);
    args += ', $parentFolderId: ID';
    params += ', parent_folder_id: $parentFolderId';
  }
  if (color) {
    variables.color = color;
    args += ', $color: FolderColor';
    params += ', color: $color';
  }

  var data = _targetAPI(targetApiKey,
    'mutation (' + args + ') { create_folder (' + params + ') { id name } }',
    variables
  );
  return data.create_folder;
}

function moveBoardToFolderOnTarget(targetApiKey, boardId, folderId) {
  var data = _targetAPI(targetApiKey,
    'mutation ($boardId: ID!, $attrs: UpdateBoardHierarchyAttributesInput!) { update_board_hierarchy (board_id: $boardId, attributes: $attrs) { success message } }',
    { boardId: Number(boardId), attrs: { folder_id: Number(folderId) } }
  );
  return data.update_board_hierarchy;
}

function createGroupOnTarget(targetApiKey, boardId, groupName) {
  var data = _targetAPI(targetApiKey,
    'mutation ($boardId: ID!, $name: String!) { create_group (board_id: $boardId, group_name: $name) { id title } }',
    { boardId: Number(boardId), name: groupName }
  );
  return data.create_group;
}

function deleteGroupOnTarget(targetApiKey, boardId, groupId) {
  var data = _targetAPI(targetApiKey,
    'mutation ($boardId: ID!, $groupId: String!) { delete_group (board_id: $boardId, group_id: $groupId) { id } }',
    { boardId: Number(boardId), groupId: groupId }
  );
  return data.delete_group;
}

function deleteItemOnTarget(targetApiKey, itemId) {
  var data = _targetAPI(targetApiKey,
    'mutation ($itemId: ID!) { delete_item (item_id: $itemId) { id } }',
    { itemId: Number(itemId) }
  );
  return data.delete_item;
}

function getGroupItemsOnTarget(targetApiKey, boardId, groupId) {
  var data = _targetAPI(targetApiKey,
    'query ($boardId: [ID!]!) { boards (ids: $boardId) { groups { id title items_page (limit: 50) { items { id name } } } } }',
    { boardId: [Number(boardId)] }
  );
  var board = data.boards && data.boards[0];
  if (!board) return [];
  var group = (board.groups || []).find(function(g) { return g.id === groupId; });
  if (!group || !group.items_page) return [];
  return group.items_page.items || [];
}

function createColumnOnTarget(targetApiKey, boardId, title, columnType, defaults) {
  var variables = {
    boardId: Number(boardId),
    title: title,
    type: columnType
  };

  var query;
  if (defaults) {
    query = 'mutation ($boardId: ID!, $title: String!, $type: ColumnType!, $defaults: JSON!) { create_column (board_id: $boardId, title: $title, column_type: $type, defaults: $defaults) { id title type } }';
    variables.defaults = typeof defaults === 'string' ? defaults : JSON.stringify(defaults);
  } else {
    query = 'mutation ($boardId: ID!, $title: String!, $type: ColumnType!) { create_column (board_id: $boardId, title: $title, column_type: $type) { id title type } }';
  }

  var data = _targetAPI(targetApiKey, query, variables);
  return data.create_column;
}

function createItemOnTarget(targetApiKey, boardId, itemName, groupId, columnValues) {
  var variables = {
    boardId: Number(boardId),
    name: itemName,
    groupId: groupId
  };

  var query;
  if (columnValues) {
    query = 'mutation ($boardId: ID!, $name: String!, $groupId: String, $values: JSON!) { create_item (board_id: $boardId, item_name: $name, group_id: $groupId, column_values: $values) { id name } }';
    variables.values = JSON.stringify(columnValues);
  } else {
    query = 'mutation ($boardId: ID!, $name: String!, $groupId: String) { create_item (board_id: $boardId, item_name: $name, group_id: $groupId) { id name } }';
  }

  var data = _targetAPI(targetApiKey, query, variables);
  return data.create_item;
}

function createSubitemOnTarget(targetApiKey, parentItemId, subitemName, columnValues) {
  var variables = {
    parentId: Number(parentItemId),
    name: subitemName
  };

  var query;
  if (columnValues) {
    query = 'mutation ($parentId: ID!, $name: String!, $values: JSON!) { create_subitem (parent_item_id: $parentId, item_name: $name, column_values: $values) { id name } }';
    variables.values = JSON.stringify(columnValues);
  } else {
    query = 'mutation ($parentId: ID!, $name: String!) { create_subitem (parent_item_id: $parentId, item_name: $name) { id name } }';
  }

  var data = _targetAPI(targetApiKey, query, variables);
  return data.create_subitem;
}

// ── Batch Item/Subitem Creation (Optimized) ─────────────────────────────────

/**
 * Create multiple items in parallel using multi-mutation GraphQL + fetchAll.
 * Each item: { name, groupId, columnValues }
 * Returns array of { id, name } or { error } in same order.
 *
 * @param {string|null} targetApiKey
 * @param {number|string} boardId
 * @param {Array<{name: string, groupId: string|null, columnValues: Object|null}>} items
 * @param {number} [batchSize=5] - Mutations per GraphQL request
 * @param {number} [concurrency=8] - Parallel requests via fetchAll
 * @returns {Array<{id: string, name: string}|{error: string}>}
 */
function createItemsBatch(targetApiKey, boardId, items, batchSize, concurrency) {
  if (!items || items.length === 0) return [];
  batchSize = batchSize || 5;
  concurrency = concurrency || 8;

  // Build multi-mutation requests: each request has up to batchSize mutations
  var graphqlRequests = [];
  var requestItemRanges = []; // track which items each request covers

  for (var i = 0; i < items.length; i += batchSize) {
    var chunk = items.slice(i, Math.min(i + batchSize, items.length));
    var mutationParts = [];
    var variables = {};

    for (var c = 0; c < chunk.length; c++) {
      var item = chunk[c];
      var alias = 'item' + c;
      var boardVar = alias + '_board';
      var nameVar = alias + '_name';
      var groupVar = alias + '_group';

      variables[boardVar] = Number(boardId);
      variables[nameVar] = item.name;

      if (item.columnValues && Object.keys(item.columnValues).length > 0) {
        var valVar = alias + '_vals';
        variables[valVar] = JSON.stringify(item.columnValues);
        if (item.groupId) {
          variables[groupVar] = item.groupId;
          mutationParts.push(
            alias + ': create_item (board_id: $' + boardVar + ', item_name: $' + nameVar +
            ', group_id: $' + groupVar + ', column_values: $' + valVar + ') { id name }'
          );
        } else {
          mutationParts.push(
            alias + ': create_item (board_id: $' + boardVar + ', item_name: $' + nameVar +
            ', column_values: $' + valVar + ') { id name }'
          );
        }
      } else {
        if (item.groupId) {
          variables[groupVar] = item.groupId;
          mutationParts.push(
            alias + ': create_item (board_id: $' + boardVar + ', item_name: $' + nameVar +
            ', group_id: $' + groupVar + ') { id name }'
          );
        } else {
          mutationParts.push(
            alias + ': create_item (board_id: $' + boardVar + ', item_name: $' + nameVar + ') { id name }'
          );
        }
      }
    }

    // Build variable declarations
    var varDecls = [];
    for (var vk in variables) {
      if (vk.indexOf('_board') >= 0) varDecls.push('$' + vk + ': ID!');
      else if (vk.indexOf('_name') >= 0) varDecls.push('$' + vk + ': String!');
      else if (vk.indexOf('_group') >= 0) varDecls.push('$' + vk + ': String');
      else if (vk.indexOf('_vals') >= 0) varDecls.push('$' + vk + ': JSON!');
    }

    var query = 'mutation (' + varDecls.join(', ') + ') { ' + mutationParts.join(' ') + ' }';
    graphqlRequests.push({ query: query, variables: variables });
    requestItemRanges.push({ start: i, count: chunk.length });
  }

  // Execute in parallel
  var apiResults = batchMondayAPICalls(targetApiKey, graphqlRequests, concurrency);

  // Map results back to items
  var results = new Array(items.length);
  for (var ri = 0; ri < apiResults.length; ri++) {
    var range = requestItemRanges[ri];
    var data = apiResults[ri];

    for (var ci = 0; ci < range.count; ci++) {
      var itemIdx = range.start + ci;
      var alias = 'item' + ci;

      if (data && data.error) {
        results[itemIdx] = { error: data.error };
      } else if (data && data[alias]) {
        results[itemIdx] = { id: String(data[alias].id), name: data[alias].name };
      } else {
        results[itemIdx] = { error: 'No result for ' + alias };
      }
    }
  }

  return results;
}

/**
 * Create multiple subitems in parallel using multi-mutation GraphQL + fetchAll.
 * Each entry: { parentItemId, name, columnValues }
 * Returns array of { id, name } or { error }.
 */
function createSubitemsBatch(targetApiKey, subitems, batchSize, concurrency) {
  if (!subitems || subitems.length === 0) return [];
  batchSize = batchSize || 5;
  concurrency = concurrency || 8;

  var graphqlRequests = [];
  var requestRanges = [];

  for (var i = 0; i < subitems.length; i += batchSize) {
    var chunk = subitems.slice(i, Math.min(i + batchSize, subitems.length));
    var mutationParts = [];
    var variables = {};

    for (var c = 0; c < chunk.length; c++) {
      var sub = chunk[c];
      var alias = 'sub' + c;
      var parentVar = alias + '_parent';
      var nameVar = alias + '_name';

      variables[parentVar] = Number(sub.parentItemId);
      variables[nameVar] = sub.name;

      if (sub.columnValues && Object.keys(sub.columnValues).length > 0) {
        var valVar = alias + '_vals';
        variables[valVar] = JSON.stringify(sub.columnValues);
        mutationParts.push(
          alias + ': create_subitem (parent_item_id: $' + parentVar +
          ', item_name: $' + nameVar + ', column_values: $' + valVar + ') { id name }'
        );
      } else {
        mutationParts.push(
          alias + ': create_subitem (parent_item_id: $' + parentVar +
          ', item_name: $' + nameVar + ') { id name }'
        );
      }
    }

    var varDecls = [];
    for (var vk in variables) {
      if (vk.indexOf('_parent') >= 0) varDecls.push('$' + vk + ': ID!');
      else if (vk.indexOf('_name') >= 0) varDecls.push('$' + vk + ': String!');
      else if (vk.indexOf('_vals') >= 0) varDecls.push('$' + vk + ': JSON!');
    }

    var query = 'mutation (' + varDecls.join(', ') + ') { ' + mutationParts.join(' ') + ' }';
    graphqlRequests.push({ query: query, variables: variables });
    requestRanges.push({ start: i, count: chunk.length });
  }

  var apiResults = batchMondayAPICalls(targetApiKey, graphqlRequests, concurrency);

  var results = new Array(subitems.length);
  for (var ri = 0; ri < apiResults.length; ri++) {
    var range = requestRanges[ri];
    var data = apiResults[ri];

    for (var ci = 0; ci < range.count; ci++) {
      var idx = range.start + ci;
      var alias = 'sub' + ci;

      if (data && data.error) {
        results[idx] = { error: data.error };
      } else if (data && data[alias]) {
        results[idx] = { id: String(data[alias].id), name: data[alias].name };
      } else {
        results[idx] = { error: 'No result for ' + alias };
      }
    }
  }

  return results;
}

// ── Form Migration Helpers ────────────────────────────────────────────────────

function createFormViewOnTarget(targetApiKey, boardId, viewName) {
  var data = _targetAPI(targetApiKey,
    'mutation ($boardId: ID!, $name: String, $type: ViewKind!) { create_view (board_id: $boardId, name: $name, type: $type) { id name type view_specific_data_str } }',
    { boardId: Number(boardId), name: viewName || 'Form', type: 'FORM' }
  );
  var view = data.create_view;
  if (!view) throw new Error('create_view returned null for board ' + boardId);

  var viewData = {};
  try { viewData = JSON.parse(view.view_specific_data_str || '{}'); } catch (e) {}

  return {
    viewId: view.id,
    viewName: view.name,
    token: viewData.token || null
  };
}

function getFormByTokenOnTarget(targetApiKey, formToken) {
  var data = _targetAPI(targetApiKey,
    'query ($token: String!) { form (formToken: $token) { id token active title questions { id type title description required visible options { label } settings { display optionsOrder checkedByDefault defaultCurrentDate includeTime } } } }',
    { token: formToken }
  );
  return data.form || null;
}

function updateFormHeaderOnTarget(targetApiKey, formToken, title, description) {
  var input = {};
  if (title) input.title = title;
  if (description !== undefined && description !== null) input.description = description;
  return _targetAPI(targetApiKey,
    'mutation ($token: String!, $input: UpdateFormInput!) { update_form (formToken: $token, input: $input) { id token title } }',
    { token: formToken, input: input }
  );
}

function updateFormSettingsOnTarget(targetApiKey, formToken, settings) {
  return _targetAPI(targetApiKey,
    'mutation ($token: String!, $settings: UpdateFormSettingsInput!) { update_form_settings (formToken: $token, settings: $settings) { id token } }',
    { token: formToken, settings: settings }
  );
}

function updateFormQuestionOnTarget(targetApiKey, formToken, questionId, questionInput) {
  return _targetAPI(targetApiKey,
    'mutation ($token: String!, $qId: String!, $question: UpdateQuestionInput!) { update_form_question (formToken: $token, questionId: $qId, question: $question) { id } }',
    { token: formToken, qId: questionId, question: questionInput }
  );
}

function updateFormQuestionOrderOnTarget(targetApiKey, formToken, questionOrder) {
  return _targetAPI(targetApiKey,
    'mutation ($token: String!, $input: UpdateFormInput!) { update_form (formToken: $token, input: $input) { id } }',
    { token: formToken, input: { questions: questionOrder } }
  );
}

function activateFormOnTarget(targetApiKey, formToken) {
  return _targetAPI(targetApiKey,
    'mutation ($token: String!) { activate_form (formToken: $token) }',
    { token: formToken }
  );
}

function createFormTagOnTarget(targetApiKey, formToken, tagName, tagValue) {
  return _targetAPI(targetApiKey,
    'mutation ($token: String!, $tag: CreateFormTagInput!) { create_form_tag (formToken: $token, tag: $tag) { id name value } }',
    { token: formToken, tag: { name: tagName, value: tagValue } }
  );
}

/**
 * Migrate all forms from a source board to the target board.
 * @param {string} sourceBoardId
 * @param {string} targetBoardId
 * @param {Object} columnMapping - source col ID → { targetId, title, type }
 * @param {string|null} targetApiKey - null for same-account
 * @returns {Object} { formsMigrated, formsTotal, details[] }
 */
function migrateBoardForms(sourceBoardId, targetBoardId, columnMapping, targetApiKey, migrationId, boardContext) {
  var formViews = getBoardFormViews(sourceBoardId);
  if (formViews.length === 0) return { formsMigrated: 0, formsTotal: 0, details: [] };

  console.log('Migration: Found ' + formViews.length + ' form(s) on source board ' + sourceBoardId);
  var details = [];

  for (var f = 0; f < formViews.length; f++) {
    var formView = formViews[f];
    try {
      console.log('Migration:   Form ' + (f + 1) + '/' + formViews.length + ': "' + formView.viewName + '" (token=' + formView.token + ')');

      // 1. Read full source form config
      var sourceForm = getFormByToken(formView.token);
      if (!sourceForm) {
        console.warn('Migration:   Could not read form with token ' + formView.token);
        details.push({ name: formView.viewName, status: 'error', error: 'Could not read source form' });
        continue;
      }

      // 2. Create form view on target board
      var targetFormView;
      if (targetApiKey) {
        targetFormView = createFormViewOnTarget(targetApiKey, targetBoardId, formView.viewName);
      } else {
        targetFormView = createFormViewOnBoard(targetBoardId, formView.viewName);
      }

      if (!targetFormView.token) {
        console.warn('Migration:   Form view created but no token returned');
        details.push({ name: formView.viewName, status: 'error', error: 'No token on new form view' });
        continue;
      }

      console.log('Migration:   Target form created: token=' + targetFormView.token);
      Utilities.sleep(200);

      // 3. Read the auto-created target form to get its default questions
      var targetForm;
      if (targetApiKey) {
        targetForm = getFormByTokenOnTarget(targetApiKey, targetFormView.token);
      } else {
        targetForm = getFormByToken(targetFormView.token);
      }

      // Build a lookup of target question IDs (these correspond to target column IDs)
      var targetQuestionMap = {};
      if (targetForm && targetForm.questions) {
        targetForm.questions.forEach(function(q) { targetQuestionMap[q.id] = q; });
      }

      // Build reverse column mapping: target col ID → source col ID
      var targetToSource = {};
      Object.keys(columnMapping).forEach(function(srcId) {
        targetToSource[columnMapping[srcId].targetId] = srcId;
      });

      // 4. Update form title and description
      try {
        if (targetApiKey) {
          updateFormHeaderOnTarget(targetApiKey, targetFormView.token, sourceForm.title, sourceForm.description);
        } else {
          updateFormHeader(targetFormView.token, sourceForm.title, sourceForm.description);
        }
      } catch (e) {
        console.warn('Migration:   Could not update form header: ' + e);
      }

      // 5. Update form settings (features, appearance, accessibility)
      try {
        var settings = {};

        // Features — sanitize each sub-object to match FormFeaturesInput schema.
        // The source form returns extra/null fields that the mutation rejects.
        if (sourceForm.features) {
          var features = {};
          var srcF = sourceForm.features;
          if (srcF.reCaptchaChallenge != null) features.reCaptchaChallenge = !!srcF.reCaptchaChallenge;
          if (srcF.draftSubmission && srcF.draftSubmission.enabled != null) {
            features.draftSubmission = { enabled: !!srcF.draftSubmission.enabled };
          }
          if (srcF.requireLogin) {
            var rl = {};
            if (srcF.requireLogin.enabled != null) rl.enabled = !!srcF.requireLogin.enabled;
            if (srcF.requireLogin.redirectToLogin != null) rl.redirectToLogin = !!srcF.requireLogin.redirectToLogin;
            if (Object.keys(rl).length > 0) features.requireLogin = rl;
          }
          if (srcF.responseLimit) {
            var rsl = {};
            if (srcF.responseLimit.enabled != null) rsl.enabled = !!srcF.responseLimit.enabled;
            if (srcF.responseLimit.limit != null && typeof srcF.responseLimit.limit === 'number') {
              rsl.limit = srcF.responseLimit.limit;
            }
            if (Object.keys(rsl).length > 0) features.responseLimit = rsl;
          }
          if (srcF.closeDate) {
            var cd = {};
            if (srcF.closeDate.enabled != null) cd.enabled = !!srcF.closeDate.enabled;
            if (srcF.closeDate.date && typeof srcF.closeDate.date === 'string') cd.date = srcF.closeDate.date;
            if (Object.keys(cd).length > 0) features.closeDate = cd;
          }
          if (srcF.preSubmissionView) {
            var psv = {};
            if (srcF.preSubmissionView.enabled != null) psv.enabled = !!srcF.preSubmissionView.enabled;
            if (srcF.preSubmissionView.title) psv.title = srcF.preSubmissionView.title;
            if (srcF.preSubmissionView.description) psv.description = srcF.preSubmissionView.description;
            if (srcF.preSubmissionView.startButton && srcF.preSubmissionView.startButton.text) {
              psv.startButton = { text: srcF.preSubmissionView.startButton.text };
            }
            if (Object.keys(psv).length > 0) features.preSubmissionView = psv;
          }
          if (srcF.afterSubmissionView) {
            var asv = {};
            if (srcF.afterSubmissionView.title) asv.title = srcF.afterSubmissionView.title;
            if (srcF.afterSubmissionView.description) asv.description = srcF.afterSubmissionView.description;
            if (srcF.afterSubmissionView.allowResubmit != null) asv.allowResubmit = !!srcF.afterSubmissionView.allowResubmit;
            if (srcF.afterSubmissionView.showSuccessImage != null) asv.showSuccessImage = !!srcF.afterSubmissionView.showSuccessImage;
            if (srcF.afterSubmissionView.allowEditSubmission != null) asv.allowEditSubmission = !!srcF.afterSubmissionView.allowEditSubmission;
            if (srcF.afterSubmissionView.allowViewSubmission != null) asv.allowViewSubmission = !!srcF.afterSubmissionView.allowViewSubmission;
            if (srcF.afterSubmissionView.redirectAfterSubmission) {
              var ras = srcF.afterSubmissionView.redirectAfterSubmission;
              // Only include if redirectUrl is a valid string — API rejects null/undefined
              if (ras.redirectUrl && typeof ras.redirectUrl === 'string') {
                asv.redirectAfterSubmission = ras;
              }
            }
            if (Object.keys(asv).length > 0) features.afterSubmissionView = asv;
          }
          if (srcF.monday) {
            var mon = {};
            if (srcF.monday.itemGroupId) mon.itemGroupId = srcF.monday.itemGroupId;
            if (srcF.monday.includeNameQuestion != null) mon.includeNameQuestion = !!srcF.monday.includeNameQuestion;
            if (srcF.monday.includeUpdateQuestion != null) mon.includeUpdateQuestion = !!srcF.monday.includeUpdateQuestion;
            if (srcF.monday.syncQuestionAndColumnsTitles != null) mon.syncQuestionAndColumnsTitles = !!srcF.monday.syncQuestionAndColumnsTitles;
            if (Object.keys(mon).length > 0) features.monday = mon;
          }
          // password is excluded — must use set_form_password mutation separately
          if (Object.keys(features).length > 0) {
            settings.features = features;
          }
        }
        if (sourceForm.appearance) {
          // Sanitize appearance to only include fields from FormAppearanceInput schema.
          // The source form returns extra read-only fields that the mutation rejects.
          var appearance = {};
          var srcApp = sourceForm.appearance;
          if (srcApp.hideBranding != null) appearance.hideBranding = !!srcApp.hideBranding;
          if (srcApp.showProgressBar != null) appearance.showProgressBar = !!srcApp.showProgressBar;
          if (srcApp.primaryColor && typeof srcApp.primaryColor === 'string') appearance.primaryColor = srcApp.primaryColor;

          // layout: { format, alignment, direction }
          if (srcApp.layout) {
            var layout = {};
            if (srcApp.layout.format) layout.format = srcApp.layout.format;
            if (srcApp.layout.alignment) layout.alignment = srcApp.layout.alignment;
            if (srcApp.layout.direction) layout.direction = srcApp.layout.direction;
            if (Object.keys(layout).length > 0) appearance.layout = layout;
          }

          // background: { type: FormBackgrounds!, value: String }
          if (srcApp.background && srcApp.background.type) {
            var validBgTypes = ['Image', 'Color', 'None'];
            if (validBgTypes.indexOf(srcApp.background.type) >= 0) {
              var bg = { type: srcApp.background.type };
              // Only include value when type is Image or Color (not None)
              if (srcApp.background.type !== 'None' && srcApp.background.value) {
                bg.value = srcApp.background.value;
              }
              appearance.background = bg;
            }
          }

          // text: { font, color, size }
          if (srcApp.text) {
            var text = {};
            if (srcApp.text.font) text.font = srcApp.text.font;
            if (srcApp.text.color) text.color = srcApp.text.color;
            if (srcApp.text.size) text.size = srcApp.text.size;
            if (Object.keys(text).length > 0) appearance.text = text;
          }

          // logo: { position, size }
          if (srcApp.logo) {
            var logo = {};
            if (srcApp.logo.position) logo.position = srcApp.logo.position;
            if (srcApp.logo.size) logo.size = srcApp.logo.size;
            if (Object.keys(logo).length > 0) appearance.logo = logo;
          }

          // submitButton: { text }
          if (srcApp.submitButton && srcApp.submitButton.text) {
            appearance.submitButton = { text: srcApp.submitButton.text };
          }

          if (Object.keys(appearance).length > 0) {
            settings.appearance = appearance;
          }
        }
        if (sourceForm.accessibility) {
          // Sanitize accessibility: strip null values (logoAltText must be a string if present)
          var accessibility = {};
          if (sourceForm.accessibility.language && typeof sourceForm.accessibility.language === 'string') {
            accessibility.language = sourceForm.accessibility.language;
          }
          if (sourceForm.accessibility.logoAltText && typeof sourceForm.accessibility.logoAltText === 'string') {
            accessibility.logoAltText = sourceForm.accessibility.logoAltText;
          }
          if (Object.keys(accessibility).length > 0) {
            settings.accessibility = accessibility;
          }
        }

        if (Object.keys(settings).length > 0) {
          if (targetApiKey) {
            updateFormSettingsOnTarget(targetApiKey, targetFormView.token, settings);
          } else {
            updateFormSettings(targetFormView.token, settings);
          }
        }
      } catch (e) {
        console.warn('Migration:   Could not update form settings: ' + e);
      }

      // 6. Configure questions — batch all updates via fetchAll for speed
      var questionsConfigured = 0;
      var questionOrder = [];
      var totalQuestions = (sourceForm.questions || []).length;
      var questionBatchRequests = []; // Collect all question update mutations

      if (sourceForm.questions) {
        for (var q = 0; q < sourceForm.questions.length; q++) {
          var srcQ = sourceForm.questions[q];

          // Map source question ID (= source column ID) to target column ID
          var targetQId = null;

          if (srcQ.id === 'subitems') {
            // Subitems is not a form-fillable question — skip silently
            continue;
          } else if (srcQ.id === 'name') {
            // System question — same ID on target
            targetQId = srcQ.id;
          } else if (columnMapping[srcQ.id]) {
            targetQId = columnMapping[srcQ.id].targetId;
          }

          if (targetQId && targetQuestionMap[targetQId]) {
            var updateInput = {
              type: srcQ.type, // Required field — e.g. "Name", "ShortText", "Email", "MultiSelect"
              visible: srcQ.visible,
              required: srcQ.required
            };
            if (srcQ.description) updateInput.description = srcQ.description;
            if (srcQ.settings) {
              var settingsInput = {};
              if (srcQ.settings.display) settingsInput.display = srcQ.settings.display;
              if (srcQ.settings.optionsOrder) settingsInput.optionsOrder = srcQ.settings.optionsOrder;
              if (srcQ.settings.checkedByDefault !== null) settingsInput.checkedByDefault = srcQ.settings.checkedByDefault;
              if (srcQ.settings.defaultCurrentDate !== null) settingsInput.defaultCurrentDate = srcQ.settings.defaultCurrentDate;
              if (srcQ.settings.includeTime !== null) settingsInput.includeTime = srcQ.settings.includeTime;
              if (Object.keys(settingsInput).length > 0) updateInput.settings = settingsInput;
            }

            questionBatchRequests.push({
              query: 'mutation ($token: String!, $qId: String!, $question: UpdateQuestionInput!) { update_form_question (formToken: $token, questionId: $qId, question: $question) { id } }',
              variables: { token: targetFormView.token, qId: targetQId, question: updateInput },
              _srcTitle: srcQ.title // For error reporting
            });

            questionOrder.push({ id: targetQId });
          } else {
            console.warn('Migration:   No target match for question "' + srcQ.title + '" (srcId=' + srcQ.id + ')');
          }
        }
      }

      // Execute all question updates in parallel batches
      if (questionBatchRequests.length > 0) {
        if (migrationId && boardContext) {
          updateMigrationProgress(migrationId, {
            message: 'Board ' + boardContext.index + '/' + boardContext.total + ': "' + boardContext.name + '" — configuring ' + questionBatchRequests.length + ' form questions'
          });
        }
        var apiKey = targetApiKey || null;
        var qResults = batchMondayAPICalls(apiKey, questionBatchRequests, 6);
        for (var qr = 0; qr < qResults.length; qr++) {
          if (qResults[qr].success) {
            questionsConfigured++;
          } else {
            console.warn('Migration:   Could not update question "' + questionBatchRequests[qr]._srcTitle + '": ' + (qResults[qr].error || 'unknown'));
          }
        }
      }

      // 7. Set question order
      if (questionOrder.length > 0) {
        try {
          // Include any remaining target questions not in source (append at end)
          var orderedIds = {};
          questionOrder.forEach(function(qo) { orderedIds[qo.id] = true; });
          Object.keys(targetQuestionMap).forEach(function(tqId) {
            if (!orderedIds[tqId]) {
              questionOrder.push({ id: tqId });
            }
          });

          if (targetApiKey) {
            updateFormQuestionOrderOnTarget(targetApiKey, targetFormView.token, questionOrder);
          } else {
            updateFormQuestionOrder(targetFormView.token, questionOrder);
          }
        } catch (e) {
          console.warn('Migration:   Could not set question order: ' + e);
        }
      }

      // 8. Recreate tags
      if (sourceForm.tags && sourceForm.tags.length > 0) {
        sourceForm.tags.forEach(function(tag) {
          try {
            var tagValue = (tag.value != null) ? String(tag.value) : '';
            if (targetApiKey) {
              createFormTagOnTarget(targetApiKey, targetFormView.token, tag.name, tagValue);
            } else {
              createFormTag(targetFormView.token, tag.name, tagValue);
            }
          } catch (e) {
            console.warn('Migration:   Could not create tag "' + tag.name + '": ' + e);
          }
        });
      }

      // 9. Activate form if source was active
      if (sourceForm.active) {
        try {
          if (targetApiKey) {
            activateFormOnTarget(targetApiKey, targetFormView.token);
          } else {
            activateForm(targetFormView.token);
          }
        } catch (e) {
          console.warn('Migration:   Could not activate form: ' + e);
        }
      }

      console.log('Migration:   Form "' + sourceForm.title + '" migrated successfully (' + questionsConfigured + ' questions configured)');
      details.push({
        name: sourceForm.title || formView.viewName,
        sourceToken: formView.token,
        targetToken: targetFormView.token,
        status: 'success',
        questionsConfigured: questionsConfigured,
        questionsTotal: (sourceForm.questions || []).length
      });

    } catch (formError) {
      console.error('Migration:   Form migration failed for "' + formView.viewName + '": ' + formError);
      details.push({ name: formView.viewName, status: 'error', error: formError.toString() });
    }
  }

  return {
    formsMigrated: details.filter(function(d) { return d.status === 'success'; }).length,
    formsTotal: formViews.length,
    details: details
  };
}

// ── Board Subscriber Helpers ─────────────────────────────────────────────────

function addUsersToBoardOnTarget(targetApiKey, boardId, userIds) {
  var data = _targetAPI(targetApiKey,
    'mutation ($boardId: ID!, $userIds: [ID!]!) { add_users_to_board (board_id: $boardId, user_ids: $userIds) { id } }',
    { boardId: Number(boardId), userIds: userIds.map(Number) }
  );
  return data.add_users_to_board;
}

function duplicateBoardStructureOnTarget(targetApiKey, sourceBoardId, targetWorkspaceId, boardName, keepSubscribers) {
  var variables = {
    boardId: Number(sourceBoardId),
    duplicateType: 'duplicate_board_with_structure',
    wsId: Number(targetWorkspaceId)
  };
  if (keepSubscribers) variables.keepSubs = true;

  var args = '$boardId: ID!, $duplicateType: DuplicateBoardType!, $wsId: ID';
  var params = 'board_id: $boardId, duplicate_type: $duplicateType, workspace_id: $wsId';
  if (boardName) {
    variables.boardName = boardName;
    args += ', $boardName: String';
    params += ', board_name: $boardName';
  }
  if (keepSubscribers) {
    args += ', $keepSubs: Boolean';
    params += ', keep_subscribers: $keepSubs';
  }

  var data = _targetAPI(targetApiKey,
    'mutation (' + args + ') { duplicate_board (' + params + ') { board { id name columns { id title type } groups { id title } } is_async } }',
    variables
  );

  return {
    board: data.duplicate_board.board,
    isAsync: data.duplicate_board.is_async
  };
}

function attachStatusManagedColumnOnTarget(targetApiKey, boardId, managedColumnId, title, description) {
  var variables = {
    boardId: Number(boardId),
    managedColumnId: managedColumnId
  };
  var args = '$boardId: ID!, $managedColumnId: ID!';
  var params = 'board_id: $boardId, managed_column_id: $managedColumnId';

  if (title) { variables.title = title; args += ', $title: String'; params += ', title: $title'; }
  if (description) { variables.description = description; args += ', $description: String'; params += ', description: $description'; }

  var data = _targetAPI(targetApiKey,
    'mutation (' + args + ') { attach_status_managed_column (' + params + ') { id title type } }',
    variables
  );
  return data.attach_status_managed_column;
}

function attachDropdownManagedColumnOnTarget(targetApiKey, boardId, managedColumnId, title, description) {
  var variables = {
    boardId: Number(boardId),
    managedColumnId: managedColumnId
  };
  var args = '$boardId: ID!, $managedColumnId: ID!';
  var params = 'board_id: $boardId, managed_column_id: $managedColumnId';

  if (title) { variables.title = title; args += ', $title: String'; params += ', title: $title'; }
  if (description) { variables.description = description; args += ', $description: String'; params += ', description: $description'; }

  var data = _targetAPI(targetApiKey,
    'mutation (' + args + ') { attach_dropdown_managed_column (' + params + ') { id title type } }',
    variables
  );
  return data.attach_dropdown_managed_column;
}

function createDocOnTarget(targetApiKey, workspaceId, name, kind, folderId) {
  var workspace = {
    workspace_id: Number(workspaceId),
    name: name || 'Untitled Document'
  };
  if (kind) workspace.kind = kind;
  if (folderId) workspace.folder_id = Number(folderId);

  var data = _targetAPI(targetApiKey,
    'mutation ($location: CreateDocInput!) { create_doc (location: $location) { id object_id } }',
    { location: { workspace: workspace } }
  );

  return data.create_doc;
}

function addMarkdownToDocOnTarget(targetApiKey, docId, markdown) {
  var data = _targetAPI(targetApiKey,
    'mutation ($docId: ID!, $markdown: String!) { add_content_to_doc_from_markdown (docId: $docId, markdown: $markdown) { success block_ids error } }',
    { docId: Number(docId), markdown: markdown }
  );
  return data.add_content_to_doc_from_markdown;
}

// ── Execute Migration ────────────────────────────────────────────────────────

/**
 * Initialize a migration session — validates inputs, generates ID, stores params.
 * Returns immediately so the client can start polling before firing runMigration().
 * @param {Object} params - { sourceWorkspaceId, targetWorkspaceName, targetAccountId, components }
 * @returns {Object} { success, migrationId }
 */
function initMigration(params) {
  try {
    if (!params || !params.sourceWorkspaceId) {
      throw new Error('sourceWorkspaceId is required');
    }

    var migrationId = generateMigrationId();

    // Store params so runMigration() can retrieve them
    var json = JSON.stringify(params);
    PropertiesService.getScriptProperties().setProperty('migParams_' + migrationId, json);
    try {
      CacheService.getScriptCache().put('migParams_' + migrationId, json, 600);
    } catch (e) {}

    // Initialize progress state
    updateMigrationProgress(migrationId, {
      state: 'running',
      percent: 1,
      message: 'Initializing migration...',
      sourceWorkspaceId: params.sourceWorkspaceId,
      isCrossAccount: !!params.targetAccountId
    });

    return safeReturn({ success: true, migrationId: migrationId });
  } catch (error) {
    return handleError('initMigration', error);
  }
}

/**
 * Execute the migration (fire-and-forget from client).
 * Reads stored params for the given migrationId, then runs the full migration.
 * @param {string} migrationId
 */
function runMigration(migrationId) {
  try {
    // Retrieve stored params
    var paramStr = CacheService.getScriptCache().get('migParams_' + migrationId)
      || PropertiesService.getScriptProperties().getProperty('migParams_' + migrationId);
    if (!paramStr) throw new Error('Migration params not found for: ' + migrationId);
    var params = JSON.parse(paramStr);

    // Clean up stored params
    CacheService.getScriptCache().remove('migParams_' + migrationId);
    PropertiesService.getScriptProperties().deleteProperty('migParams_' + migrationId);

    // Delegate to the batched migration logic (chains via triggers to avoid 6-min limit)
    return _executeMigrationBatched(migrationId, params);
  } catch (error) {
    if (migrationId) {
      updateMigrationProgress(migrationId, {
        state: 'error',
        percent: 0,
        message: 'Migration failed: ' + error.toString()
      });
    }
    return handleError('runMigration', error, migrationId);
  }
}

/**
 * Legacy entry point — validates, generates ID, and runs the full migration in one call.
 * Kept for backward compatibility. New UI should use initMigration() + runMigration().
 * @param {Object} params - {
 *   sourceWorkspaceId, targetWorkspaceName, targetApiKey (optional),
 *   components: { groups: true, subscribers: true, guests: false, documents: false }
 * }
 * @returns {Object} { success, migrationId }
 */
function startMigration(params) {
  var migrationId;

  try {
    if (!params || !params.sourceWorkspaceId) {
      throw new Error('sourceWorkspaceId is required');
    }

    migrationId = generateMigrationId();
    return _executeMigrationBatched(migrationId, params);
  } catch (error) {
    if (migrationId) {
      updateMigrationProgress(migrationId, {
        state: 'error',
        percent: 0,
        message: 'Migration failed: ' + error.toString()
      });
      logMigrationAction(migrationId, 'ERROR', params.sourceWorkspaceId, '', 'error', error.toString());
    }
    return handleError('startMigration', error, migrationId);
  }
}

/**
 * Internal: executes the full migration workflow.
 */
function _executeMigration(migrationId, params) {
  try {
    var sourceWsId = params.sourceWorkspaceId;
    var targetName = params.targetWorkspaceName || null;
    var components = params.components || {};
    var targetApiKey = params.targetApiKey || (params.targetAccountId ? getTargetApiKeyForAccount(params.targetAccountId) : null) || null;
    var isCrossAccount = !!targetApiKey;

    console.log('Migration: ═══════════════════════════════════════════════════════');
    console.log('Migration: STARTING MIGRATION ' + migrationId);
    console.log('Migration: Source workspace ID: ' + sourceWsId);
    console.log('Migration: Target name: ' + (targetName || '(auto)'));
    console.log('Migration: Cross-account: ' + isCrossAccount);
    console.log('Migration: Components: ' + JSON.stringify(components));
    console.log('Migration: ═══════════════════════════════════════════════════════');

    // Mandatory components are always on
    components.boards = true;
    components.columns = true;
    components.items = true;

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

    // Step 1: Get source workspace info
    console.log('Migration: Step 1 - Fetching source workspace details...');
    var sourceWs = getWorkspaceDetails(sourceWsId);
    if (!sourceWs) throw new Error('Source workspace not found (ID: ' + sourceWsId + '). Verify the workspace exists and the API key has access.');
    console.log('Migration: Step 1 DONE - Source: "' + sourceWs.name + '" (kind=' + sourceWs.kind + ')');

    updateMigrationProgress(migrationId, { percent: 5, message: 'Creating new workspace...' });

    // Step 2: Create new workspace (in target account if cross-account)
    console.log('Migration: Step 2 - Creating target workspace...');
    var wsName = targetName || sourceWs.name + ' (Migrated)';
    var targetWs = createWorkspaceOnTarget(targetApiKey, wsName, sourceWs.kind || 'open', sourceWs.description || '');
    console.log('Migration: Step 2 DONE - Target workspace created: "' + wsName + '" (id=' + targetWs.id + ')');

    updateMigrationProgress(migrationId, {
      percent: 10,
      message: 'Workspace "' + wsName + '" created. Scanning boards...',
      targetWorkspaceId: String(targetWs.id)
    });

    // Step 3: Get source boards
    console.log('Migration: Step 3 - Fetching boards from source workspace ' + sourceWsId + '...');
    var sourceBoards = getBoardsInWorkspace(sourceWsId);

    // Filter out subitem boards — these are referenced in parent boards' subtasks column settings
    // but often report board_kind="public" instead of "sub_items_board"
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
    var removedSubitemBoards = [];
    sourceBoards.forEach(function(board) {
      if (subitemBoardIds[String(board.id)]) {
        removedSubitemBoards.push(board);
      } else {
        filteredBoards.push(board);
      }
    });

    if (removedSubitemBoards.length > 0) {
      console.log('Migration: Filtered out ' + removedSubitemBoards.length + ' subitem boards:');
      removedSubitemBoards.forEach(function(b) {
        console.log('Migration:   Subitem board excluded: "' + b.name + '" (id=' + b.id + ', parent="' + subitemBoardIds[String(b.id)] + '")');
      });
    }

    sourceBoards = filteredBoards;
    console.log('Migration: Step 3 DONE - Found ' + sourceBoards.length + ' boards (after excluding ' + removedSubitemBoards.length + ' subitem boards)');

    if (sourceBoards.length === 0) {
      console.warn('Migration: ⚠ WARNING - 0 boards found in source workspace "' + sourceWs.name + '" (id=' + sourceWsId + ', kind=' + sourceWs.kind + ')');
      console.warn('Migration: Possible causes:');
      console.warn('Migration:   1. Workspace genuinely has no boards');
      console.warn('Migration:   2. API key user is not a member of this closed workspace');
      console.warn('Migration:   3. All boards are archived (state != active)');
      console.warn('Migration:   4. Incorrect workspace ID');

      updateMigrationProgress(migrationId, {
        boardsTotal: 0,
        message: 'WARNING: No boards found in source workspace "' + sourceWs.name + '". The workspace may be empty or the API key may lack access.',
        errors: [{ board: 'Workspace', msg: 'No boards found in source workspace "' + sourceWs.name + '" (kind=' + sourceWs.kind + '). If boards exist, check API key permissions.' }]
      });
    } else {
      updateMigrationProgress(migrationId, {
        boardsTotal: sourceBoards.length,
        message: 'Found ' + sourceBoards.length + ' boards to migrate.'
      });
    }

    // Step 3b: Recreate folder structure from source workspace in target workspace
    var folderMapping = {}; // source folder ID -> target folder ID
    var folderList = []; // flattened list of all folders (for name lookup during board moves)
    try {
      console.log('Migration: Step 3b - Fetching source workspace folder structure...');
      updateMigrationProgress(migrationId, { message: 'Scanning workspace folder structure...' });
      var sourceFolders = getWorkspaceFolders(sourceWsId);
      if (sourceFolders.length > 0) {
        console.log('Migration: Found ' + sourceFolders.length + ' top-level folders');

        // Flatten the folder tree into a list with parent references for ordered creation
        folderList = [];
        var flattenFolders = function(folders, parentSourceId) {
          folders.forEach(function(folder) {
            folderList.push({
              id: String(folder.id),
              name: folder.name,
              color: folder.color || null,
              parentSourceId: parentSourceId
            });
            if (folder.sub_folders && folder.sub_folders.length > 0) {
              flattenFolders(folder.sub_folders, String(folder.id));
            }
          });
        };
        flattenFolders(sourceFolders, null);

        console.log('Migration: Total folders (including nested): ' + folderList.length);
        updateMigrationProgress(migrationId, {
          message: 'Recreating ' + folderList.length + ' folder(s) in target workspace...'
        });

        // Create folders in order (parents before children since we flattened depth-first from the tree)
        for (var fi = 0; fi < folderList.length; fi++) {
          var sf = folderList[fi];
          try {
            var targetParentFolderId = sf.parentSourceId ? (folderMapping[sf.parentSourceId] || null) : null;
            var newFolder = createFolderOnTarget(targetApiKey, targetWs.id, sf.name, targetParentFolderId, sf.color);
            folderMapping[sf.id] = String(newFolder.id);
            console.log('Migration:   Folder created: "' + sf.name + '" (source=' + sf.id + ' → target=' + newFolder.id + (sf.parentSourceId ? ', parent=' + sf.parentSourceId : '') + ')');
          } catch (folderErr) {
            console.warn('Migration:   Failed to create folder "' + sf.name + '": ' + folderErr);
            updateMigrationProgress(migrationId, {
              errors: [{ board: 'Folder: ' + sf.name, msg: folderErr.toString() }]
            });
          }
        }
        console.log('Migration: Step 3b DONE - Created ' + Object.keys(folderMapping).length + '/' + folderList.length + ' folders');
      } else {
        console.log('Migration: Step 3b - No folders in source workspace (boards are at workspace root)');
      }
    } catch (folderError) {
      console.warn('Migration: Step 3b - Folder structure migration failed: ' + folderError);
      updateMigrationProgress(migrationId, {
        errors: [{ board: 'Folders', msg: 'Could not recreate folder structure: ' + folderError.toString() }]
      });
    }

    // Build a board-to-folder lookup from the source boards
    var boardFolderLookup = {};
    sourceBoards.forEach(function(b) {
      if (b.board_folder_id) {
        boardFolderLookup[String(b.id)] = String(b.board_folder_id);
      }
    });

    // Step 4: Migrate each board
    console.log('Migration: Step 4 - Starting board migration loop (' + sourceBoards.length + ' boards)...');
    var boardMapping = [];
    var totalItemsMigrated = 0;
    var totalItemsExpected = 0;
    var totalSubitemsMigrated = 0;

    for (var i = 0; i < sourceBoards.length; i++) {
      var sourceBoard = sourceBoards[i];
      var boardPercent = 10 + Math.floor(((i + 1) / sourceBoards.length) * 75);

      updateMigrationProgress(migrationId, {
        percent: Math.min(boardPercent, 88),
        message: 'Migrating board ' + (i + 1) + '/' + sourceBoards.length + ': ' + sourceBoard.name,
        boardsCompleted: i
      });

      var boardContext = { index: i + 1, total: sourceBoards.length, name: sourceBoard.name };

      try {
        console.log('Migration: Board ' + (i + 1) + '/' + sourceBoards.length + ' - Starting: "' + sourceBoard.name + '" (id=' + sourceBoard.id + ', kind=' + sourceBoard.board_kind + ')');
        var result = migrateBoard(sourceBoard, targetWs.id, components, migrationId, targetApiKey, boardContext);
        boardMapping.push(result);
        totalItemsMigrated += result.itemsMigrated;
        totalItemsExpected += result.itemsTotal;
        totalSubitemsMigrated += (result.subitemsMigrated || 0);
        console.log('Migration: Board ' + (i + 1) + '/' + sourceBoards.length + ' - SUCCESS: "' + sourceBoard.name + '" → target id=' + result.targetBoardId + ' (' + result.itemsMigrated + '/' + result.itemsTotal + ' items, ' + (result.subitemsMigrated || 0) + ' subitems, ' + (result.formsMigrated || 0) + '/' + (result.formsTotal || 0) + ' forms, method=' + (result.migrationMethod || 'manual') + ')');

        // Move board to correct folder if it was in a folder in the source workspace
        var sourceFolderId = boardFolderLookup[String(sourceBoard.id)];
        if (sourceFolderId && folderMapping[sourceFolderId] && result.targetBoardId) {
          try {
            moveBoardToFolderOnTarget(targetApiKey, result.targetBoardId, folderMapping[sourceFolderId]);
            // Find folder name for UI display
            var folderName = '';
            for (var fi2 = 0; fi2 < folderList.length; fi2++) {
              if (folderList[fi2].id === sourceFolderId) { folderName = folderList[fi2].name; break; }
            }
            result.targetFolderId = folderMapping[sourceFolderId];
            result.folderName = folderName;
            console.log('Migration:   Moved board "' + sourceBoard.name + '" to target folder "' + folderName + '" (source folder=' + sourceFolderId + ' → target folder=' + folderMapping[sourceFolderId] + ')');
          } catch (moveErr) {
            console.warn('Migration:   Failed to move board "' + sourceBoard.name + '" to folder: ' + moveErr);
          }
        }
      } catch (boardError) {
        console.error('Migration: Board ' + (i + 1) + '/' + sourceBoards.length + ' - FAILED: "' + sourceBoard.name + '": ' + boardError.toString());
        console.error('Migration: Board error stack:', boardError.stack || 'no stack');
        boardMapping.push({
          sourceBoardId: String(sourceBoard.id),
          sourceBoardName: sourceBoard.name,
          targetBoardId: null,
          status: 'error',
          error: boardError.toString(),
          itemsMigrated: 0,
          itemsTotal: 0,
          columnMapping: {},
          groupMapping: {}
        });

        updateMigrationProgress(migrationId, {
          errors: [{ board: sourceBoard.name, msg: boardError.toString() }]
        });
      }
    }

    // Step 5: Migrate documents with Drive backup (if selected)
    console.log('Migration: Step 4 DONE - Board loop complete. Migrated ' + boardMapping.length + ' boards (' + totalItemsMigrated + '/' + totalItemsExpected + ' items, ' + totalSubitemsMigrated + ' subitems)');
    console.log('Migration: Board results: ' + JSON.stringify(boardMapping.map(function(b) { return { name: b.sourceBoardName, status: b.status, items: b.itemsMigrated + '/' + b.itemsTotal }; })));
    var docMapping = [];
    var docMigrationResult = null;
    if (components.documents) {
      console.log('Migration: Step 5 - Migrating documents...');
      updateMigrationProgress(migrationId, { percent: 88, message: 'Migrating documents (export, backup to Drive, import)...' });
      try {
        docMigrationResult = migrateDocuments(
          sourceWsId,
          String(targetWs.id),
          migrationId,
          function(msg) {
            updateMigrationProgress(migrationId, { message: msg });
          },
          targetApiKey,
          folderMapping
        );
        docMapping = docMigrationResult.docMapping || [];

        if (docMigrationResult.errors && docMigrationResult.errors.length > 0) {
          docMigrationResult.errors.forEach(function(e) {
            updateMigrationProgress(migrationId, {
              errors: [{ board: 'Doc: ' + (e.docName || e.docId), msg: e.msg }]
            });
          });
        }
      } catch (e) {
        console.warn('Document migration failed:', e);
        updateMigrationProgress(migrationId, {
          errors: [{ board: 'Documents', msg: e.toString() }]
        });
      }
    }

    // Step 6: Persist before/after mapping to spreadsheet
    updateMigrationProgress(migrationId, { percent: 95, message: 'Saving migration mapping...' });
    saveMigrationMapping(migrationId, sourceWsId, String(targetWs.id), wsName, boardMapping, docMapping);

    // Final status
    var successCount = boardMapping.filter(function(b) { return b.status === 'success'; }).length;
    var errorCount = boardMapping.filter(function(b) { return b.status !== 'success'; }).length;
    var finalState = boardMapping.every(function(b) { return b.status === 'success'; })
      ? 'completed' : 'completed_with_errors';
    console.log('Migration: ═══════════════════════════════════════════════════════');
    console.log('Migration: MIGRATION ' + migrationId + ' FINISHED');
    console.log('Migration: State: ' + finalState);
    console.log('Migration: Boards: ' + successCount + ' succeeded, ' + errorCount + ' failed, ' + sourceBoards.length + ' total');
    console.log('Migration: Items: ' + totalItemsMigrated + ' migrated / ' + totalItemsExpected + ' expected (' + totalSubitemsMigrated + ' subitems)');
    console.log('Migration: Docs: ' + (docMigrationResult ? docMigrationResult.docsMigrated + ' migrated' : 'skipped'));
    console.log('Migration: ═══════════════════════════════════════════════════════');

    // Build completion message
    var foldersCreated = Object.keys(folderMapping).length;
    var completionMsg = finalState === 'completed'
      ? 'Migration complete! ' + sourceBoards.length + ' boards cloned to "' + wsName + '".'
      : 'Migration finished with some errors. Check details.';

    if (foldersCreated > 0) {
      completionMsg += ' ' + foldersCreated + ' folder(s) recreated.';
    }
    if (docMigrationResult && docMigrationResult.docsMigrated > 0) {
      completionMsg += ' ' + docMigrationResult.docsMigrated + ' document(s) migrated with Drive backup.';
    }

    updateMigrationProgress(migrationId, {
      state: finalState,
      percent: 100,
      message: completionMsg,
      boardsCompleted: sourceBoards.length,
      itemsTotal: totalItemsExpected,
      itemsMigrated: totalItemsMigrated,
      foldersCreated: foldersCreated,
      foldersTotal: folderList.length,
      targetWorkspaceId: String(targetWs.id),
      targetWorkspaceName: wsName,
      boardMapping: boardMapping.map(function(bm) {
        return {
          sourceBoardId: bm.sourceBoardId,
          sourceBoardName: bm.sourceBoardName,
          targetBoardId: bm.targetBoardId,
          targetBoardName: bm.targetBoardName,
          status: bm.status,
          migrationMethod: bm.migrationMethod || 'manual',
          itemsMigrated: bm.itemsMigrated,
          itemsTotal: bm.itemsTotal,
          subitemsMigrated: bm.subitemsMigrated || 0,
          formsMigrated: bm.formsMigrated || 0,
          formsTotal: bm.formsTotal || 0,
          managedColumnsAttached: bm.managedColumnsAttached || 0,
          folderName: bm.folderName || null,
          targetFolderId: bm.targetFolderId || null
        };
      }),
      docMapping: docMapping,
      documentMigration: docMigrationResult ? {
        docsTotal: docMigrationResult.docsTotal,
        docsMigrated: docMigrationResult.docsMigrated,
        docsSkipped: docMigrationResult.docsSkipped,
        driveFolder: docMigrationResult.driveFolder,
        errors: docMigrationResult.errors
      } : null,
      endTime: new Date().toISOString()
    });

    logMigrationAction(migrationId, 'COMPLETE', sourceWsId, wsName, finalState, {
      boards: sourceBoards.length,
      items: totalItemsMigrated
    });

    return safeReturn({
      success: true,
      migrationId: migrationId,
      targetWorkspaceId: String(targetWs.id),
      state: finalState
    });
  } catch (error) {
    if (migrationId) {
      updateMigrationProgress(migrationId, {
        state: 'error',
        percent: 0,
        message: 'Migration failed: ' + error.toString()
      });
      logMigrationAction(migrationId, 'ERROR', params.sourceWorkspaceId, '', 'error', error.toString());
    }
    return handleError('_executeMigration', error, migrationId);
  }
}

// ── Board Migration ──────────────────────────────────────────────────────────

/**
 * Migrate a single board. Routes to template-based or manual approach.
 */
function migrateBoard(sourceBoard, targetWorkspaceId, components, migrationId, targetApiKey, boardContext) {
  var result;
  if (components.useTemplates && !targetApiKey) {
    // Template clone only works within the same account
    result = migrateBoardViaTemplate(sourceBoard, targetWorkspaceId, components, migrationId, boardContext);
  } else {
    result = migrateBoardManual(sourceBoard, targetWorkspaceId, components, migrationId, targetApiKey, boardContext);
  }

  // Migrate forms if the board was migrated successfully
  if (result.status === 'success' && result.targetBoardId) {
    try {
      if (migrationId && boardContext) {
        updateMigrationProgress(migrationId, {
          message: 'Board ' + boardContext.index + '/' + boardContext.total + ': "' + boardContext.name + '" — migrating forms...'
        });
      }
      var formResult = migrateBoardForms(
        result.sourceBoardId,
        result.targetBoardId,
        result.columnMapping || {},
        targetApiKey,
        migrationId,
        boardContext
      );
      result.formsMigrated = formResult.formsMigrated;
      result.formsTotal = formResult.formsTotal;
      result.formDetails = formResult.details;
      if (formResult.formsTotal > 0) {
        console.log('Migration: Forms: ' + formResult.formsMigrated + '/' + formResult.formsTotal + ' migrated for board "' + result.sourceBoardName + '"');
      }
    } catch (formError) {
      console.warn('Migration: Form migration failed for board "' + result.sourceBoardName + '": ' + formError);
      result.formsMigrated = 0;
      result.formsTotal = -1;
      result.formError = formError.toString();
    }
  }

  return result;
}

/**
 * Migrate subitems of a source item to a newly created target parent item.
 * Subitem column values are written directly (no column mapping needed since
 * subitems get their own auto-created subitem board on the target).
 * Returns the count of subitems migrated.
 */
function migrateSubitems(sourceItem, targetParentItemId, targetApiKey) {
  var subitems = sourceItem.subitems || [];
  if (subitems.length === 0) return 0;

  var migrated = 0;
  for (var s = 0; s < subitems.length; s++) {
    var sub = subitems[s];
    try {
      // Build column values from the subitem — skip system/computed types
      var colValues = {};
      (sub.column_values || []).forEach(function(cv) {
        if (cv.value) {
          try {
            var parsed = JSON.parse(cv.value);
            var skipTypes = ['mirror', 'formula', 'auto_number', 'creation_log', 'last_updated', 'board_relation', 'dependency', 'file'];
            if (skipTypes.indexOf(cv.type) < 0) {
              // For cross-account: people columns won't match (different user IDs)
              if (targetApiKey && cv.type === 'people') {
                // Skip people columns for cross-account — populated post-migration
              } else {
                colValues[cv.id] = parsed;
              }
            }
          } catch (e) {
            // unparseable value — skip
          }
        }
      });

      if (targetApiKey) {
        createSubitemOnTarget(
          targetApiKey,
          targetParentItemId,
          sub.name,
          Object.keys(colValues).length > 0 ? colValues : null
        );
      } else {
        createSubitem(
          targetParentItemId,
          sub.name,
          Object.keys(colValues).length > 0 ? colValues : null
        );
      }
      migrated++;
      Utilities.sleep(150);
    } catch (subError) {
      console.warn('Failed to migrate subitem "' + sub.name + '" under parent "' + sourceItem.name + '": ' + subError);
    }
  }
  return migrated;
}

/**
 * Template-based board migration: duplicate_board preserves views, automations,
 * formulas, managed columns, and column settings. Only items are migrated separately.
 */
function migrateBoardViaTemplate(sourceBoard, targetWorkspaceId, components, migrationId, boardContext) {
  var bc = boardContext || {};
  var progressPrefix = bc.index ? ('Board ' + bc.index + '/' + bc.total + ': "' + bc.name + '"') : ('"' + sourceBoard.name + '"');

  if (migrationId) {
    updateMigrationProgress(migrationId, {
      message: progressPrefix + ' — duplicating board structure (template)...'
    });
  }

  // Step 1: Duplicate board structure to target workspace
  var dupResult = duplicateBoardStructure(
    sourceBoard.id,
    targetWorkspaceId,
    null, // keep original name
    false // subscribers handled separately in Users & Guests tab
  );

  var targetBoard = dupResult.board;
  if (!targetBoard || !targetBoard.id) {
    throw new Error('duplicate_board returned no board for: ' + sourceBoard.name);
  }

  // If async, wait briefly for the board to be ready
  if (dupResult.isAsync) {
    Utilities.sleep(1500);
    // Re-fetch to get columns and groups
    var refreshed = getBoardOrigin(targetBoard.id);
    if (refreshed) {
      targetBoard.columns = refreshed.columns;
      targetBoard.groups = refreshed.groups;
    }
  }

  // Step 2: Use source board structure for mapping (skip re-fetch if already loaded)
  var sourceStructure = (sourceBoard.columns && sourceBoard.groups)
    ? sourceBoard
    : getBoardStructure(sourceBoard.id);
  if (!sourceStructure) throw new Error('Could not read board structure for: ' + sourceBoard.name);

  // Step 3: Build column mapping by title (source ID -> target ID)
  var colMapResult = buildColumnMappingByTitle(sourceStructure.columns, targetBoard.columns);
  var columnMapping = colMapResult.mapping;

  if (colMapResult.unmapped.length > 0) {
    console.warn('Unmapped columns for ' + sourceBoard.name + ': ' +
      colMapResult.unmapped.map(function(c) { return c.title + ' (' + c.type + ')'; }).join(', '));
  }

  // Step 4: Build group mapping by title
  var grpMapResult = buildGroupMappingByTitle(sourceStructure.groups, targetBoard.groups);
  var groupMapping = grpMapResult.mapping;

  // Step 5: Subscribers are handled by duplicate_board's keep_subscribers param

  // Step 6: Migrate items (BATCHED — parallel multi-mutation) and their subitems
  if (migrationId) {
    updateMigrationProgress(migrationId, {
      message: progressPrefix + ' — migrating items...'
    });
  }
  var allItems = getAllBoardItems(sourceBoard.id);
  var itemsTotal = allItems.length;
  var itemsMigrated = 0;
  var subitemsMigrated = 0;
  var itemIdMap = {}; // sourceItemId → targetItemId for file migration

  // Pre-process all items into batch-ready format
  var itemBatchInput = [];
  var sourceItemOrder = []; // parallel array to track source item references
  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];
    var columnValues = {};
    (item.column_values || []).forEach(function(cv) {
      var mapped = columnMapping[cv.id];
      if (cv.value && mapped) {
        try {
          var parsed = JSON.parse(cv.value);
          var skipTypes = ['mirror', 'formula', 'auto_number', 'creation_log', 'last_updated', 'board_relation', 'dependency', 'file'];
          if (skipTypes.indexOf(cv.type) < 0) {
            columnValues[mapped.targetId] = parsed;
          }
        } catch (parseError) {
          if (cv.text) {
            columnValues[mapped.targetId] = cv.text;
          }
        }
      }
    });

    var targetGroupId = null;
    if (item.group && groupMapping[item.group.id]) {
      targetGroupId = groupMapping[item.group.id].targetId;
    }

    itemBatchInput.push({
      name: item.name,
      groupId: targetGroupId,
      columnValues: Object.keys(columnValues).length > 0 ? columnValues : null
    });
    sourceItemOrder.push(item);
  }

  // Execute batched item creation (same-account: null apiKey)
  var ITEM_BATCH_SIZE = 5;   // mutations per GraphQL request
  var ITEM_CONCURRENCY = 8;  // parallel requests
  var ITEM_CHUNK = ITEM_BATCH_SIZE * ITEM_CONCURRENCY; // items per progress update

  for (var chunkStart = 0; chunkStart < itemBatchInput.length; chunkStart += ITEM_CHUNK) {
    var chunkEnd = Math.min(chunkStart + ITEM_CHUNK, itemBatchInput.length);
    var chunk = itemBatchInput.slice(chunkStart, chunkEnd);

    if (migrationId) {
      updateMigrationProgress(migrationId, {
        message: progressPrefix + ' — migrating items ' + (chunkStart + 1) + '-' + chunkEnd + '/' + itemsTotal
      });
    }

    var batchResults = createItemsBatch(null, targetBoard.id, chunk, ITEM_BATCH_SIZE, ITEM_CONCURRENCY);

    for (var bi = 0; bi < batchResults.length; bi++) {
      var globalIdx = chunkStart + bi;
      var result = batchResults[bi];
      var srcItem = sourceItemOrder[globalIdx];

      if (result && result.id) {
        itemsMigrated++;
        itemIdMap[String(srcItem.id)] = result.id;
      } else {
        console.warn('Failed to migrate item "' + srcItem.name + '": ' + (result ? result.error : 'no result'));
      }
    }
  }

  // Batch-migrate subitems for all items that have them
  var subitemBatchInput = [];
  var subitemSourceInfo = [];
  for (var si = 0; si < sourceItemOrder.length; si++) {
    var srcItem = sourceItemOrder[si];
    if (srcItem.subitems && srcItem.subitems.length > 0 && itemIdMap[String(srcItem.id)]) {
      var parentTargetId = itemIdMap[String(srcItem.id)];
      for (var sj = 0; sj < srcItem.subitems.length; sj++) {
        var sub = srcItem.subitems[sj];
        var subColValues = {};
        (sub.column_values || []).forEach(function(cv) {
          if (cv.value) {
            try {
              var parsed = JSON.parse(cv.value);
              var skipTypes = ['mirror', 'formula', 'auto_number', 'creation_log', 'last_updated', 'board_relation', 'dependency', 'file'];
              if (skipTypes.indexOf(cv.type) < 0) {
                subColValues[cv.id] = parsed;
              }
            } catch (e) {}
          }
        });
        subitemBatchInput.push({
          parentItemId: parentTargetId,
          name: sub.name,
          columnValues: Object.keys(subColValues).length > 0 ? subColValues : null
        });
        subitemSourceInfo.push({ parentName: srcItem.name, subName: sub.name });
      }
    }
  }

  if (subitemBatchInput.length > 0) {
    if (migrationId) {
      updateMigrationProgress(migrationId, {
        message: progressPrefix + ' — migrating ' + subitemBatchInput.length + ' subitems...'
      });
    }
    var subResults = createSubitemsBatch(null, subitemBatchInput, 3, 6);
    for (var sr = 0; sr < subResults.length; sr++) {
      if (subResults[sr] && subResults[sr].id) {
        subitemsMigrated++;
      } else {
        console.warn('Failed to migrate subitem "' + subitemSourceInfo[sr].subName + '" under "' + subitemSourceInfo[sr].parentName + '": ' + (subResults[sr] ? subResults[sr].error : 'no result'));
      }
    }
  }

  // Step 7: Migrate file column contents
  var filesMigrated = 0;
  var fileColumns = getFileColumns(sourceStructure.columns);
  if (fileColumns.length > 0 && Object.keys(itemIdMap).length > 0) {
    var fileResult = migrateFileColumns(
      itemIdMap, fileColumns, columnMapping, null, null, migrationId, progressPrefix
    );
    filesMigrated = fileResult.filesMigrated;
  }

  return {
    sourceBoardId: String(sourceBoard.id),
    sourceBoardName: sourceStructure.name,
    targetBoardId: String(targetBoard.id),
    targetBoardName: targetBoard.name,
    status: 'success',
    migrationMethod: 'template',
    itemsMigrated: itemsMigrated,
    itemsTotal: itemsTotal,
    columnsMapped: Object.keys(columnMapping).length,
    columnsSkipped: colMapResult.unmapped.length,
    groupsMapped: Object.keys(groupMapping).length,
    subitemsMigrated: subitemsMigrated,
    filesMigrated: filesMigrated,
    managedColumnsAttached: 0, // managed columns preserved automatically via duplicate_board
    columnMapping: columnMapping,
    groupMapping: groupMapping,
    managedColumnMapping: []
  };
}

/**
 * Manual board migration: create board from scratch, add columns individually,
 * detect and attach managed columns. Original approach.
 */
function migrateBoardManual(sourceBoard, targetWorkspaceId, components, migrationId, targetApiKey, boardContext) {
  var bc = boardContext || {};
  var progressPrefix = bc.index ? ('Board ' + bc.index + '/' + bc.total + ': "' + bc.name + '"') : ('"' + sourceBoard.name + '"');

  // Use source board structure if already loaded (skip redundant API call)
  var structure = (sourceBoard.columns && sourceBoard.groups)
    ? sourceBoard
    : getBoardStructure(sourceBoard.id);
  if (!structure) throw new Error('Could not read board structure for: ' + sourceBoard.name);

  // Create board in new workspace (target account if cross-account)
  if (migrationId) {
    updateMigrationProgress(migrationId, {
      message: progressPrefix + ' — creating board...'
    });
  }
  var targetBoard = createBoardOnTarget(
    targetApiKey,
    structure.name,
    structure.board_kind || 'public',
    targetWorkspaceId
  );

  // Detect managed column matches if enabled
  if (migrationId) {
    updateMigrationProgress(migrationId, {
      message: progressPrefix + ' — creating columns...'
    });
  }
  var managedColMap = {};
  if (components.managedColumns !== false) {
    try {
      // Pass pre-loaded columns to avoid redundant API call
      var managedMatches = detectManagedColumnsOnBoard(sourceBoard.id, structure.columns);
      managedMatches.forEach(function(m) {
        managedColMap[m.columnId] = m;
      });
    } catch (e) {
      console.warn('Could not detect managed columns for board ' + sourceBoard.name + ':', e);
    }
  }

  // Create columns (BATCHED — parallel via fetchAll for non-managed columns)
  var columnMapping = {};
  var managedColumnMapping = [];
  var skippedColumns = [];
  var systemColumnIds = ['name', 'subitems', 'item_id'];
  var nonCreatableTypes = ['subtasks', 'board_relation', 'mirror', 'formula', 'auto_number',
                           'creation_log', 'last_updated', 'button', 'dependency', 'item_id'];

  // Separate columns into managed (sequential) and regular (batchable)
  var managedColumns = [];
  var regularColumns = [];

  (structure.columns || []).forEach(function(col) {
    if (systemColumnIds.indexOf(col.id) >= 0) return;
    if (nonCreatableTypes.indexOf(col.type) >= 0) {
      console.log('Migration: Skipping non-creatable column "' + col.title + '" (type=' + col.type + ')');
      skippedColumns.push({ id: col.id, title: col.title, type: col.type, error: 'Non-creatable type' });
      return;
    }

    var managedMatch = managedColMap[col.id];
    if (managedMatch) {
      managedColumns.push({ col: col, managed: managedMatch });
    } else {
      regularColumns.push(col);
    }
  });

  // 1) Create managed columns sequentially (different mutation types)
  managedColumns.forEach(function(entry) {
    var col = entry.col;
    var managedMatch = entry.managed;
    try {
      var newCol;
      if (managedMatch.managedColumnType === 'color') {
        newCol = attachStatusManagedColumnOnTarget(targetApiKey, targetBoard.id, managedMatch.managedColumnId, col.title);
      } else {
        newCol = attachDropdownManagedColumnOnTarget(targetApiKey, targetBoard.id, managedMatch.managedColumnId, col.title);
      }
      managedColumnMapping.push({
        sourceColumnId: col.id,
        targetColumnId: newCol.id,
        managedColumnId: managedMatch.managedColumnId,
        title: col.title,
        type: col.type
      });
      columnMapping[col.id] = { targetId: newCol.id, title: col.title, type: col.type, managed: true };
    } catch (attachErr) {
      console.warn('Managed column attach failed for ' + col.title + ', adding to regular batch: ' + attachErr);
      regularColumns.push(col); // Fall back to regular creation
    }
  });

  // 2) Batch-create regular columns using fetchAll
  if (regularColumns.length > 0) {
    if (migrationId) {
      updateMigrationProgress(migrationId, {
        message: progressPrefix + ' — creating ' + regularColumns.length + ' columns...'
      });
    }

    var colRequests = regularColumns.map(function(col) {
      var defaults = null;
      if (col.settings_str && col.settings_str !== '{}') {
        try {
          var settings = JSON.parse(col.settings_str);
          if ((col.type === 'status' || col.type === 'dropdown') && settings.labels) {
            defaults = settings;
          }
        } catch (parseErr) {}
      }

      var variables = {
        boardId: Number(targetBoard.id),
        title: col.title,
        type: col.type
      };

      var query;
      if (defaults) {
        query = 'mutation ($boardId: ID!, $title: String!, $type: ColumnType!, $defaults: JSON!) { create_column (board_id: $boardId, title: $title, column_type: $type, defaults: $defaults) { id title type } }';
        variables.defaults = typeof defaults === 'string' ? defaults : JSON.stringify(defaults);
      } else {
        query = 'mutation ($boardId: ID!, $title: String!, $type: ColumnType!) { create_column (board_id: $boardId, title: $title, column_type: $type) { id title type } }';
      }

      return { query: query, variables: variables };
    });

    // Execute in parallel batches (6 at a time to avoid complexity limits)
    var colResults = batchMondayAPICalls(targetApiKey, colRequests, 6);

    for (var ci = 0; ci < colResults.length; ci++) {
      var col = regularColumns[ci];
      var result = colResults[ci];

      if (result && result.create_column && result.create_column.id) {
        columnMapping[col.id] = { targetId: result.create_column.id, title: col.title, type: col.type };
      } else {
        var errMsg = (result && result.error) ? result.error : 'No result';
        console.warn('Skipped column ' + col.title + ' (' + col.type + '): ' + errMsg);
        skippedColumns.push({ id: col.id, title: col.title, type: col.type, error: errMsg });
      }
    }
  }

  // Create groups (BATCHED via fetchAll)
  var groupMapping = {};
  if (components.groups !== false && (structure.groups || []).length > 0) {
    var groupRequests = (structure.groups || []).map(function(grp) {
      return {
        query: 'mutation ($boardId: ID!, $name: String!) { create_group (board_id: $boardId, group_name: $name) { id title } }',
        variables: { boardId: Number(targetBoard.id), name: grp.title }
      };
    });

    var grpResults = batchMondayAPICalls(targetApiKey, groupRequests, 6);

    (structure.groups || []).forEach(function(grp, gi) {
      var result = grpResults[gi];
      if (result && result.create_group && result.create_group.id) {
        groupMapping[grp.id] = { targetId: result.create_group.id, title: grp.title };
      } else {
        console.warn('Failed to create group ' + grp.title + ': ' + (result ? result.error : 'no result'));
      }
    });
  }

  // Delete the auto-created default group ("Group Title") and its default item ("Task 1")
  // Monday.com always creates this when a board is manually created via create_board
  try {
    var targetBoardGroups = _targetAPI(targetApiKey,
      'query ($boardId: [ID!]!) { boards (ids: $boardId) { groups { id title items_page (limit: 50) { items { id name } } } } }',
      { boardId: [Number(targetBoard.id)] }
    );
    var tBoard = targetBoardGroups.boards && targetBoardGroups.boards[0];
    if (tBoard && tBoard.groups) {
      tBoard.groups.forEach(function(grp) {
        // Find the default group — it's named "Group Title" and not in our groupMapping values
        var isMigratedGroup = Object.keys(groupMapping).some(function(key) {
          return groupMapping[key].targetId === grp.id;
        });
        if (!isMigratedGroup) {
          // Delete items in the default group first
          var items = (grp.items_page && grp.items_page.items) || [];
          items.forEach(function(item) {
            try {
              deleteItemOnTarget(targetApiKey, item.id);
              console.log('Deleted default item "' + item.name + '" (id=' + item.id + ') from group "' + grp.title + '"');
            } catch (delItemErr) {
              console.warn('Failed to delete default item "' + item.name + '": ' + delItemErr);
            }
          });
          // Now delete the group itself
          try {
            deleteGroupOnTarget(targetApiKey, targetBoard.id, grp.id);
            console.log('Deleted default group "' + grp.title + '" (id=' + grp.id + ') from board ' + targetBoard.id);
          } catch (delGrpErr) {
            console.warn('Failed to delete default group "' + grp.title + '": ' + delGrpErr);
          }
        }
      });
    }
  } catch (cleanupErr) {
    console.warn('Failed to clean up default group on board ' + targetBoard.id + ':', cleanupErr);
  }

  // Note: Subscribers/guests are handled separately via the Users & Guests tab

  // Migrate items (BATCHED — parallel multi-mutation) and their subitems
  if (migrationId) {
    updateMigrationProgress(migrationId, {
      message: progressPrefix + ' — migrating items...'
    });
  }
  var allItems = getAllBoardItems(sourceBoard.id);
  var itemsTotal = allItems.length;
  var itemsMigrated = 0;
  var subitemsMigrated = 0;
  var itemIdMap = {}; // sourceItemId → targetItemId for file migration

  // Pre-process all items into batch-ready format
  var itemBatchInput = [];
  var sourceItemOrder = [];
  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];
    var columnValues = {};
    (item.column_values || []).forEach(function(cv) {
      var mapped = columnMapping[cv.id];
      if (cv.value && mapped) {
        try {
          var parsed = JSON.parse(cv.value);
          var skipTypes = ['mirror', 'formula', 'auto_number', 'creation_log', 'last_updated', 'board_relation', 'file'];
          if (skipTypes.indexOf(cv.type) < 0) {
            if (targetApiKey && cv.type === 'people') {
              // Skip people columns for cross-account — populated post-migration
            } else {
              columnValues[mapped.targetId] = parsed;
            }
          }
        } catch (parseError) {
          if (cv.text) {
            columnValues[mapped.targetId] = cv.text;
          }
        }
      }
    });

    var targetGroupId = null;
    if (components.groups !== false && item.group && groupMapping[item.group.id]) {
      targetGroupId = groupMapping[item.group.id].targetId;
    }

    itemBatchInput.push({
      name: item.name,
      groupId: targetGroupId,
      columnValues: Object.keys(columnValues).length > 0 ? columnValues : null
    });
    sourceItemOrder.push(item);
  }

  // Execute batched item creation
  var ITEM_BATCH_SIZE = 5;
  var ITEM_CONCURRENCY = 8;
  var ITEM_CHUNK = ITEM_BATCH_SIZE * ITEM_CONCURRENCY;

  for (var chunkStart = 0; chunkStart < itemBatchInput.length; chunkStart += ITEM_CHUNK) {
    var chunkEnd = Math.min(chunkStart + ITEM_CHUNK, itemBatchInput.length);
    var chunk = itemBatchInput.slice(chunkStart, chunkEnd);

    if (migrationId) {
      updateMigrationProgress(migrationId, {
        message: progressPrefix + ' — migrating items ' + (chunkStart + 1) + '-' + chunkEnd + '/' + itemsTotal
      });
    }

    var batchResults = createItemsBatch(targetApiKey, targetBoard.id, chunk, ITEM_BATCH_SIZE, ITEM_CONCURRENCY);

    for (var bi = 0; bi < batchResults.length; bi++) {
      var globalIdx = chunkStart + bi;
      var result = batchResults[bi];
      var srcItem = sourceItemOrder[globalIdx];

      if (result && result.id) {
        itemsMigrated++;
        itemIdMap[String(srcItem.id)] = result.id;
      } else {
        console.warn('Failed to migrate item "' + srcItem.name + '": ' + (result ? result.error : 'no result'));
      }
    }
  }

  // Batch-migrate subitems
  var subitemBatchInput = [];
  var subitemSourceInfo = [];
  for (var si = 0; si < sourceItemOrder.length; si++) {
    var srcItem = sourceItemOrder[si];
    if (srcItem.subitems && srcItem.subitems.length > 0 && itemIdMap[String(srcItem.id)]) {
      var parentTargetId = itemIdMap[String(srcItem.id)];
      for (var sj = 0; sj < srcItem.subitems.length; sj++) {
        var sub = srcItem.subitems[sj];
        var subColValues = {};
        (sub.column_values || []).forEach(function(cv) {
          if (cv.value) {
            try {
              var parsed = JSON.parse(cv.value);
              var skipTypes = ['mirror', 'formula', 'auto_number', 'creation_log', 'last_updated', 'board_relation', 'dependency', 'file'];
              if (skipTypes.indexOf(cv.type) < 0) {
                if (targetApiKey && cv.type === 'people') {
                  // Skip people columns for cross-account
                } else {
                  subColValues[cv.id] = parsed;
                }
              }
            } catch (e) {}
          }
        });
        subitemBatchInput.push({
          parentItemId: parentTargetId,
          name: sub.name,
          columnValues: Object.keys(subColValues).length > 0 ? subColValues : null
        });
        subitemSourceInfo.push({ parentName: srcItem.name, subName: sub.name });
      }
    }
  }

  if (subitemBatchInput.length > 0) {
    if (migrationId) {
      updateMigrationProgress(migrationId, {
        message: progressPrefix + ' — migrating ' + subitemBatchInput.length + ' subitems...'
      });
    }
    var subResults = createSubitemsBatch(targetApiKey, subitemBatchInput, 3, 6);
    for (var sr = 0; sr < subResults.length; sr++) {
      if (subResults[sr] && subResults[sr].id) {
        subitemsMigrated++;
      } else {
        console.warn('Failed to migrate subitem "' + subitemSourceInfo[sr].subName + '" under "' + subitemSourceInfo[sr].parentName + '": ' + (subResults[sr] ? subResults[sr].error : 'no result'));
      }
    }
  }

  // Migrate file column contents
  var filesMigrated = 0;
  var fileColumns = getFileColumns(structure.columns);
  if (fileColumns.length > 0 && Object.keys(itemIdMap).length > 0) {
    var fileResult = migrateFileColumns(
      itemIdMap, fileColumns, columnMapping, null, targetApiKey, migrationId, progressPrefix
    );
    filesMigrated = fileResult.filesMigrated;
  }

  return {
    sourceBoardId: String(sourceBoard.id),
    sourceBoardName: structure.name,
    targetBoardId: String(targetBoard.id),
    targetBoardName: structure.name,
    status: 'success',
    migrationMethod: 'manual',
    itemsMigrated: itemsMigrated,
    itemsTotal: itemsTotal,
    subitemsMigrated: subitemsMigrated,
    filesMigrated: filesMigrated,
    columnsMapped: Object.keys(columnMapping).length,
    columnsSkipped: skippedColumns.length,
    groupsMapped: Object.keys(groupMapping).length,
    managedColumnsAttached: managedColumnMapping.length,
    columnMapping: columnMapping,
    groupMapping: groupMapping,
    managedColumnMapping: managedColumnMapping
  };
}

// ── File Column Migration ────────────────────────────────────────────────────

/**
 * Migrate file column contents from source items to target items.
 * Downloads each file via public_url, then re-uploads to the target item's file column.
 *
 * @param {Object} itemIdMap - Map of sourceItemId → targetItemId
 * @param {Array} fileColumns - Source board file columns [{ id, title }]
 * @param {Object} columnMapping - Source→target column mapping
 * @param {string} [sourceApiKey] - API key for reading source assets (null = same account)
 * @param {string} [targetApiKey] - API key for uploading to target (null = same account)
 * @param {string} [migrationId] - Migration progress tracker ID
 * @param {string} [progressPrefix] - Progress message prefix
 * @returns {Object} { filesMigrated, filesErrored, errors }
 */
function migrateFileColumns(itemIdMap, fileColumns, columnMapping, sourceApiKey, targetApiKey, migrationId, progressPrefix) {
  var sourceItemIds = Object.keys(itemIdMap);
  var filesMigrated = 0;
  var filesErrored = 0;
  var errors = [];

  if (fileColumns.length === 0 || sourceItemIds.length === 0) {
    return { filesMigrated: 0, filesErrored: 0, errors: [] };
  }

  // Build file column ID mapping (source → target)
  var fileColMap = {};
  fileColumns.forEach(function(fc) {
    var mapped = columnMapping[fc.id];
    if (mapped) {
      fileColMap[fc.id] = mapped.targetId;
    }
  });

  if (Object.keys(fileColMap).length === 0) {
    console.log('Migration: No file columns mapped to target — skipping file migration');
    return { filesMigrated: 0, filesErrored: 0, errors: [] };
  }

  console.log('Migration: Starting file migration for ' + sourceItemIds.length + ' items, ' +
    Object.keys(fileColMap).length + ' file column(s)');

  if (migrationId) {
    updateMigrationProgress(migrationId, {
      message: (progressPrefix || '') + ' — fetching file assets...'
    });
  }

  // Fetch all assets from source items
  var assetMap = getItemAssets(sourceItemIds, sourceApiKey || null);
  var itemsWithAssets = Object.keys(assetMap).length;
  console.log('Migration: Found assets on ' + itemsWithAssets + ' of ' + sourceItemIds.length + ' items');

  if (itemsWithAssets === 0) {
    return { filesMigrated: 0, filesErrored: 0, errors: [] };
  }

  // Process each source item that has assets
  var processed = 0;
  var totalWithAssets = itemsWithAssets;

  for (var srcItemId in assetMap) {
    if (!assetMap.hasOwnProperty(srcItemId)) continue;

    var targetItemId = itemIdMap[srcItemId];
    if (!targetItemId) continue;

    var assets = assetMap[srcItemId];
    processed++;

    if (migrationId && (processed === 1 || processed % 5 === 0 || processed === totalWithAssets)) {
      updateMigrationProgress(migrationId, {
        message: (progressPrefix || '') + ' — migrating files ' + processed + '/' + totalWithAssets +
          ' items (' + filesMigrated + ' files uploaded)'
      });
    }

    // Upload each asset to the first mapped file column on the target item
    // (Monday.com items() assets query returns all assets across all file columns)
    var targetFileColIds = Object.keys(fileColMap).map(function(k) { return fileColMap[k]; });
    var primaryTargetColId = targetFileColIds[0]; // upload to first file column

    for (var a = 0; a < assets.length; a++) {
      var asset = assets[a];
      if (!asset.public_url) {
        console.warn('Migration: Skipping asset "' + asset.name + '" — no public_url');
        continue;
      }

      try {
        // Download the file
        var fileName = asset.name || ('file_' + asset.id + (asset.file_extension ? '.' + asset.file_extension : ''));
        var blob = downloadMondayAsset(asset.public_url, fileName);

        // Check file size (GAS UrlFetchApp payload limit ~50MB, Monday limit 500MB)
        var sizeBytes = blob.getBytes().length;
        if (sizeBytes > 50 * 1024 * 1024) {
          console.warn('Migration: Skipping file "' + fileName + '" — too large (' +
            Math.round(sizeBytes / 1024 / 1024) + 'MB) for GAS transfer');
          errors.push({ item: srcItemId, file: fileName, error: 'File too large for GAS transfer' });
          filesErrored++;
          continue;
        }

        // Upload to target
        uploadFileToMondayItem(targetItemId, primaryTargetColId, blob, targetApiKey || null);
        filesMigrated++;
        console.log('Migration: Uploaded file "' + fileName + '" to target item ' + targetItemId);

        // Brief pause between file uploads (multipart, can't batch via fetchAll)
        Utilities.sleep(200);
      } catch (fileErr) {
        filesErrored++;
        var errMsg = 'Failed to migrate file "' + (asset.name || asset.id) + '" for item ' + srcItemId + ': ' + fileErr;
        console.warn('Migration: ' + errMsg);
        errors.push({ item: srcItemId, file: asset.name || asset.id, error: fileErr.toString() });
      }
    }
  }

  console.log('Migration: File migration complete — ' + filesMigrated + ' uploaded, ' + filesErrored + ' errors');
  return { filesMigrated: filesMigrated, filesErrored: filesErrored, errors: errors };
}

/**
 * Check if an email looks like a guest (simple heuristic).
 */
function isGuestUser(email) {
  if (!email) return false;
  // Guest emails are typically external (not your company domain)
  // This is a placeholder — adjust the domain check as needed
  return false;
}

// ── Mapping Persistence ──────────────────────────────────────────────────────

/**
 * Save the complete before/after mapping to the spreadsheet.
 * Each migration gets a dedicated tab with full column, group, and item mappings.
 */
function saveMigrationMapping(migrationId, sourceWsId, targetWsId, targetWsName, boardMapping, docMapping) {
  try {
    if (!CONFIG.SPREADSHEET_ID) return;

    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

    // 1. Write to BoardMapping sheet (summary)
    var mapSheet = ss.getSheetByName('BoardMapping');
    if (mapSheet) {
      boardMapping.forEach(function(bm) {
        mapSheet.appendRow([
          migrationId,
          bm.sourceBoardId,
          bm.sourceBoardName,
          bm.targetBoardId || '',
          bm.targetBoardName || '',
          bm.status,
          bm.itemsMigrated,
          bm.itemsTotal
        ]);
      });
    }

    // 2. Create a dedicated mapping tab for this migration
    var tabName = 'Map_' + migrationId.replace('mig_', '').substring(0, 8);
    var detailSheet = ss.insertSheet(tabName);

    // Header section
    var headerRows = [
      ['Migration ID', migrationId],
      ['Timestamp', new Date().toISOString()],
      ['Source Workspace ID', sourceWsId],
      ['Target Workspace ID', targetWsId],
      ['Target Workspace Name', targetWsName],
      ['User', Session.getActiveUser().getEmail()],
      [''],
      ['=== BOARD MAPPING ==='],
      ['Source Board ID', 'Source Board Name', 'Target Board ID', 'Target Board Name', 'Status', 'Items Migrated', 'Items Total']
    ];

    boardMapping.forEach(function(bm) {
      headerRows.push([
        bm.sourceBoardId,
        bm.sourceBoardName,
        bm.targetBoardId || 'N/A',
        bm.targetBoardName || 'N/A',
        bm.status,
        bm.itemsMigrated,
        bm.itemsTotal
      ]);
    });

    // Column mapping details
    headerRows.push(['']);
    headerRows.push(['=== COLUMN MAPPING ===']);
    headerRows.push(['Board', 'Source Column ID', 'Column Title', 'Column Type', 'Target Column ID']);

    boardMapping.forEach(function(bm) {
      if (bm.columnMapping) {
        Object.keys(bm.columnMapping).forEach(function(srcId) {
          var col = bm.columnMapping[srcId];
          headerRows.push([
            bm.sourceBoardName,
            srcId,
            col.title,
            col.type,
            col.targetId
          ]);
        });
      }
    });

    // Group mapping details
    headerRows.push(['']);
    headerRows.push(['=== GROUP MAPPING ===']);
    headerRows.push(['Board', 'Source Group ID', 'Group Title', 'Target Group ID']);

    boardMapping.forEach(function(bm) {
      if (bm.groupMapping) {
        Object.keys(bm.groupMapping).forEach(function(srcId) {
          var grp = bm.groupMapping[srcId];
          headerRows.push([
            bm.sourceBoardName,
            srcId,
            grp.title,
            grp.targetId
          ]);
        });
      }
    });

    // Managed column mapping
    var hasManagedCols = false;
    boardMapping.forEach(function(bm) {
      if (bm.managedColumnMapping && bm.managedColumnMapping.length > 0) hasManagedCols = true;
    });
    if (hasManagedCols) {
      headerRows.push(['']);
      headerRows.push(['=== MANAGED COLUMN MAPPING ===']);
      headerRows.push(['Board', 'Source Column ID', 'Column Title', 'Target Column ID', 'Managed Column ID']);
      boardMapping.forEach(function(bm) {
        if (bm.managedColumnMapping) {
          bm.managedColumnMapping.forEach(function(mc) {
            headerRows.push([
              bm.sourceBoardName,
              mc.sourceColumnId,
              mc.title,
              mc.targetColumnId,
              mc.managedColumnId
            ]);
          });
        }
      });
    }

    // Document mapping
    if (docMapping && docMapping.length > 0) {
      headerRows.push(['']);
      headerRows.push(['=== DOCUMENT MAPPING ===']);
      headerRows.push(['Source Doc ID', 'Source Doc Name', 'Target Doc ID', 'Status', 'Drive File URL', 'Blocks Created', 'Note']);
      docMapping.forEach(function(dm) {
        headerRows.push([
          dm.sourceDocId,
          dm.sourceDocName || dm.sourceDocTitle || '',
          dm.targetDocId || 'N/A',
          dm.status || '',
          dm.driveFileUrl || '',
          dm.blocksCreated || 0,
          dm.note || ''
        ]);
      });
    }

    // Write all rows
    if (headerRows.length > 0) {
      detailSheet.getRange(1, 1, headerRows.length, 7).setValues(
        headerRows.map(function(row) {
          while (row.length < 7) row.push('');
          return row.slice(0, 7);
        })
      );
    }

    // Format header
    detailSheet.getRange(1, 1, 6, 1).setFontWeight('bold');
    detailSheet.setFrozenRows(0);

    // Log to MigrationLog
    logMigrationAction(migrationId, 'MAPPING_SAVED', sourceWsId, targetWsName, 'success',
      'Mapping saved to tab: ' + tabName);

  } catch (e) {
    console.error('Failed to save migration mapping:', e);
  }
}

/**
 * Get saved migration mappings from spreadsheet.
 */
function getSavedMigrations() {
  try {
    if (!CONFIG.SPREADSHEET_ID) {
      return safeReturn({ success: true, data: [] });
    }

    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var logSheet = ss.getSheetByName('MigrationLog');
    if (!logSheet || logSheet.getLastRow() < 2) {
      return safeReturn({ success: true, data: [] });
    }

    var data = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 8).getValues();
    var migrations = {};

    data.forEach(function(row) {
      var id = row[1];
      if (!migrations[id]) {
        migrations[id] = {
          migrationId: id,
          sourceWorkspace: row[3],
          targetWorkspace: row[4],
          actions: []
        };
      }
      migrations[id].actions.push({
        timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0]),
        action: row[2],
        status: row[5],
        details: row[6],
        user: row[7]
      });
    });

    var result = Object.values(migrations).map(function(m) {
      var lastAction = m.actions[m.actions.length - 1];
      return {
        migrationId: m.migrationId,
        sourceWorkspace: m.sourceWorkspace,
        targetWorkspace: m.targetWorkspace,
        lastAction: lastAction.action,
        lastStatus: lastAction.status,
        lastTimestamp: lastAction.timestamp,
        user: lastAction.user
      };
    });

    result.reverse(); // Most recent first

    return safeReturn({ success: true, data: result });
  } catch (error) {
    return handleError('getSavedMigrations', error);
  }
}

/**
 * Cancel an active migration.
 */
function cancelMigration(migrationId) {
  try {
    // Cancel any pending batch triggers for this migration
    var batchState = _getBatchState(migrationId);
    if (batchState) {
      batchState.phase = 'cancelled';
      _saveBatchState(migrationId, batchState);
      _cleanupMigrationTriggers();
    }

    updateMigrationProgress(migrationId, {
      state: 'cancelled',
      message: 'Migration cancelled by user.'
    });
    logMigrationAction(migrationId, 'CANCEL', '', '', 'cancelled', 'User cancelled');
    return { success: true };
  } catch (error) {
    return handleError('cancelMigration', error, migrationId);
  }
}
