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
  useTemplates:   { label: 'Template Clone',    mandatory: false, description: 'Use duplicate_board to preserve views, automations, formulas, and managed column links (recommended)', defaultOn: true },
  managedColumns: { label: 'Managed Columns',   mandatory: false, description: 'Preserve account-level managed column links for status/dropdown consistency (used when Template Clone is off)', defaultOn: true },
  subscribers:    { label: 'Board Subscribers',  mandatory: false, description: 'Add existing users as board subscribers', defaultOn: true },
  guests:         { label: 'Guest Users',        mandatory: false, description: 'Assign guest users to boards', defaultOn: false },
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
        subscribers: 0,
        managedColumns: 0,
        documents: 0
      },
      estimatedApiCalls: 0,
      estimatedDuration: '',
      warnings: [],
      notes: [
        'Migration runs within the same Monday.com account.',
        'Users and guests are already in the system — no invitations will be sent.',
        'People columns will be preserved because user IDs remain the same.',
        'A new workspace will be created with " (Migrated)" suffix by default.'
      ]
    };

    var hasComplexColumns = false;
    boards.forEach(function(board) {
      var itemCount = 0;
      try { itemCount = getBoardItemCount(board.id); } catch (e) {
        plan.warnings.push('Could not get item count for board: ' + board.name);
      }

      var subscribers = [];
      if (components.subscribers !== false) {
        try { subscribers = getBoardSubscribers(board.id); } catch (e) {}
      }

      var groupCount = board.groups ? board.groups.length : 0;
      var columnCount = board.columns ? board.columns.length : 0;

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
        subscribers: subscribers.length,
        columnTypes: (board.columns || []).map(function(c) { return c.type; }),
        complexColumns: complexCols.map(function(c) { return { title: c.title, type: c.type }; })
      });

      plan.totals.groups += groupCount;
      plan.totals.columns += columnCount;
      plan.totals.items += itemCount;
      plan.totals.subscribers += subscribers.length;
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
            var matches = detectManagedColumnsOnBoard(board.id);
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
    if (components.subscribers) apiCalls += plan.totals.boards; // 1 call per board for subscribers
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

function createGroupOnTarget(targetApiKey, boardId, groupName) {
  var data = _targetAPI(targetApiKey,
    'mutation ($boardId: ID!, $name: String!) { create_group (board_id: $boardId, group_name: $name) { id title } }',
    { boardId: Number(boardId), name: groupName }
  );
  return data.create_group;
}

function createColumnOnTarget(targetApiKey, boardId, title, columnType) {
  var data = _targetAPI(targetApiKey,
    'mutation ($boardId: ID!, $title: String!, $type: ColumnType!) { create_column (board_id: $boardId, title: $title, column_type: $type) { id title type } }',
    { boardId: Number(boardId), title: title, type: columnType }
  );
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
    'mutation ($token: String!) { activate_form (formToken: $token) { id token active } }',
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
function migrateBoardForms(sourceBoardId, targetBoardId, columnMapping, targetApiKey) {
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
      Utilities.sleep(500);

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

        // Features (strip password.enabled since we can't set passwords via update_form_settings)
        if (sourceForm.features) {
          var features = JSON.parse(JSON.stringify(sourceForm.features));
          // Remove password — must use set_form_password mutation separately
          delete features.password;
          settings.features = features;
        }
        if (sourceForm.appearance) {
          settings.appearance = sourceForm.appearance;
        }
        if (sourceForm.accessibility) {
          settings.accessibility = sourceForm.accessibility;
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

      // 6. Configure questions — match source questions to target questions via column mapping
      var questionsConfigured = 0;
      var questionOrder = [];

      if (sourceForm.questions) {
        for (var q = 0; q < sourceForm.questions.length; q++) {
          var srcQ = sourceForm.questions[q];
          // Map source question ID (= source column ID) to target column ID
          var targetQId = null;

          if (srcQ.id === 'name' || srcQ.id === 'subitems') {
            // System questions — same ID on target
            targetQId = srcQ.id;
          } else if (columnMapping[srcQ.id]) {
            targetQId = columnMapping[srcQ.id].targetId;
          }

          if (targetQId && targetQuestionMap[targetQId]) {
            // Update the matching target question
            try {
              var updateInput = {
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

              if (targetApiKey) {
                updateFormQuestionOnTarget(targetApiKey, targetFormView.token, targetQId, updateInput);
              } else {
                updateFormQuestion(targetFormView.token, targetQId, updateInput);
              }
              questionsConfigured++;
              Utilities.sleep(100);
            } catch (qErr) {
              console.warn('Migration:   Could not update question "' + srcQ.title + '": ' + qErr);
            }

            questionOrder.push({ id: targetQId });
          } else {
            console.warn('Migration:   No target match for question "' + srcQ.title + '" (srcId=' + srcQ.id + ')');
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
            if (targetApiKey) {
              createFormTagOnTarget(targetApiKey, targetFormView.token, tag.name, tag.value);
            } else {
              createFormTag(targetFormView.token, tag.name, tag.value);
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

    Utilities.sleep(300);
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

function createDocOnTarget(targetApiKey, workspaceId, name, kind) {
  var variables = {
    workspace: { workspace_id: Number(workspaceId) },
    doc: {}
  };
  if (kind) variables.doc.kind = kind;

  var data = _targetAPI(targetApiKey,
    'mutation ($workspace: CreateDocWorkspaceInput!, $doc: CreateDocInput) { create_doc (workspace: $workspace, doc: $doc) { id object_id } }',
    variables
  );

  var doc = data.create_doc;

  if (name && doc && doc.id) {
    try {
      _targetAPI(targetApiKey,
        'mutation ($docId: ID!, $name: String!) { update_doc_name (docId: $docId, name: $name) { id } }',
        { docId: Number(doc.id), name: name }
      );
    } catch (e) {
      console.warn('Failed to rename doc to "' + name + '":', e);
    }
  }

  return doc;
}

function addMarkdownToDocOnTarget(targetApiKey, docId, markdown) {
  var data = _targetAPI(targetApiKey,
    'mutation ($docId: ID!, $markdown: String!) { add_content_to_doc_from_markdown (docId: $docId, markdown: $markdown) { ids } }',
    { docId: Number(docId), markdown: markdown }
  );
  return data.add_content_to_doc_from_markdown;
}

// ── Execute Migration ────────────────────────────────────────────────────────

/**
 * Clone a workspace to a new workspace (same or different account).
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
    console.log('Migration: Step 3 DONE - Found ' + sourceBoards.length + ' boards');

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

      try {
        console.log('Migration: Board ' + (i + 1) + '/' + sourceBoards.length + ' - Starting: "' + sourceBoard.name + '" (id=' + sourceBoard.id + ', kind=' + sourceBoard.board_kind + ')');
        var result = migrateBoard(sourceBoard, targetWs.id, components, migrationId, targetApiKey);
        boardMapping.push(result);
        totalItemsMigrated += result.itemsMigrated;
        totalItemsExpected += result.itemsTotal;
        totalSubitemsMigrated += (result.subitemsMigrated || 0);
        console.log('Migration: Board ' + (i + 1) + '/' + sourceBoards.length + ' - SUCCESS: "' + sourceBoard.name + '" → target id=' + result.targetBoardId + ' (' + result.itemsMigrated + '/' + result.itemsTotal + ' items, ' + (result.subitemsMigrated || 0) + ' subitems, ' + (result.formsMigrated || 0) + '/' + (result.formsTotal || 0) + ' forms, method=' + (result.migrationMethod || 'manual') + ')');
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

      Utilities.sleep(300);
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
          targetApiKey
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
    var completionMsg = finalState === 'completed'
      ? 'Migration complete! ' + sourceBoards.length + ' boards cloned to "' + wsName + '".'
      : 'Migration finished with some errors. Check details.';

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
          managedColumnsAttached: bm.managedColumnsAttached || 0
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
    return handleError('startMigration', error, migrationId);
  }
}

// ── Board Migration ──────────────────────────────────────────────────────────

/**
 * Migrate a single board. Routes to template-based or manual approach.
 */
function migrateBoard(sourceBoard, targetWorkspaceId, components, migrationId, targetApiKey) {
  var result;
  if (components.useTemplates && !targetApiKey) {
    // Template clone only works within the same account
    result = migrateBoardViaTemplate(sourceBoard, targetWorkspaceId, components, migrationId);
  } else {
    result = migrateBoardManual(sourceBoard, targetWorkspaceId, components, migrationId, targetApiKey);
  }

  // Migrate forms if the board was migrated successfully
  if (result.status === 'success' && result.targetBoardId) {
    try {
      var formResult = migrateBoardForms(
        result.sourceBoardId,
        result.targetBoardId,
        result.columnMapping || {},
        targetApiKey
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
            var skipTypes = ['mirror', 'formula', 'auto_number', 'creation_log', 'last_updated', 'board_relation', 'dependency'];
            if (skipTypes.indexOf(cv.type) < 0) {
              colValues[cv.id] = parsed;
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
function migrateBoardViaTemplate(sourceBoard, targetWorkspaceId, components, migrationId) {
  // Step 1: Duplicate board structure to target workspace
  var dupResult = duplicateBoardStructure(
    sourceBoard.id,
    targetWorkspaceId,
    null, // keep original name
    !!components.subscribers
  );

  var targetBoard = dupResult.board;
  if (!targetBoard || !targetBoard.id) {
    throw new Error('duplicate_board returned no board for: ' + sourceBoard.name);
  }

  // If async, wait briefly for the board to be ready
  if (dupResult.isAsync) {
    Utilities.sleep(3000);
    // Re-fetch to get columns and groups
    var refreshed = getBoardOrigin(targetBoard.id);
    if (refreshed) {
      targetBoard.columns = refreshed.columns;
      targetBoard.groups = refreshed.groups;
    }
  }

  // Step 2: Get source board structure for mapping
  var sourceStructure = getBoardStructure(sourceBoard.id);
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

  // Step 6: Migrate items (only writable column values) and their subitems
  var allItems = getAllBoardItems(sourceBoard.id);
  var itemsTotal = allItems.length;
  var itemsMigrated = 0;
  var subitemsMigrated = 0;

  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];

    try {
      var columnValues = {};
      (item.column_values || []).forEach(function(cv) {
        var mapped = columnMapping[cv.id];
        if (cv.value && mapped) {
          try {
            var parsed = JSON.parse(cv.value);
            var skipTypes = ['mirror', 'formula', 'auto_number', 'creation_log', 'last_updated', 'board_relation', 'dependency'];
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

      var newItem = createItem(
        targetBoard.id,
        item.name,
        targetGroupId,
        Object.keys(columnValues).length > 0 ? columnValues : null
      );

      itemsMigrated++;

      // Migrate subitems if present
      if (item.subitems && item.subitems.length > 0 && newItem && newItem.id) {
        var subCount = migrateSubitems(item, newItem.id, null);
        subitemsMigrated += subCount;
        console.log('Migration:   Migrated ' + subCount + '/' + item.subitems.length + ' subitems for item "' + item.name + '"');
      }

      Utilities.sleep(150);
    } catch (itemError) {
      console.warn('Failed to migrate item "' + item.name + '":', itemError);
    }
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
function migrateBoardManual(sourceBoard, targetWorkspaceId, components, migrationId, targetApiKey) {
  var structure = getBoardStructure(sourceBoard.id);
  if (!structure) throw new Error('Could not read board structure for: ' + sourceBoard.name);

  // Create board in new workspace (target account if cross-account)
  var targetBoard = createBoardOnTarget(
    targetApiKey,
    structure.name,
    structure.board_kind || 'public',
    targetWorkspaceId
  );

  // Detect managed column matches if enabled
  var managedColMap = {};
  if (components.managedColumns !== false) {
    try {
      var managedMatches = detectManagedColumnsOnBoard(sourceBoard.id);
      managedMatches.forEach(function(m) {
        managedColMap[m.columnId] = m;
      });
    } catch (e) {
      console.warn('Could not detect managed columns for board ' + sourceBoard.name + ':', e);
    }
  }

  // Create columns (mandatory — skip system columns)
  var columnMapping = {};
  var managedColumnMapping = [];
  var skippedColumns = [];
  var systemColumns = ['name', 'subitems', 'item_id'];

  (structure.columns || []).forEach(function(col) {
    if (systemColumns.indexOf(col.id) >= 0 || systemColumns.indexOf(col.type) >= 0) return;

    try {
      var newCol;

      // Check if this column should be attached as a managed column
      var managedMatch = managedColMap[col.id];
      if (managedMatch) {
        try {
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
          Utilities.sleep(100);
          return; // Skip normal createColumn
        } catch (attachErr) {
          console.warn('Managed column attach failed for ' + col.title + ', falling back to regular column: ' + attachErr);
          // Fall through to regular createColumn
        }
      }

      newCol = createColumnOnTarget(targetApiKey, targetBoard.id, col.title, col.type);
      columnMapping[col.id] = { targetId: newCol.id, title: col.title, type: col.type };
      Utilities.sleep(100);
    } catch (e) {
      console.warn('Skipped column ' + col.title + ' (' + col.type + '): ' + e);
      skippedColumns.push({ id: col.id, title: col.title, type: col.type, error: e.toString() });
    }
  });

  // Create groups (optional)
  var groupMapping = {};
  if (components.groups !== false) {
    (structure.groups || []).forEach(function(grp) {
      try {
        var newGroup = createGroupOnTarget(targetApiKey, targetBoard.id, grp.title);
        groupMapping[grp.id] = { targetId: newGroup.id, title: grp.title };
        Utilities.sleep(100);
      } catch (e) {
        console.warn('Failed to create group ' + grp.title + ':', e);
      }
    });
  }

  // Add subscribers (optional — only for same-account; skip for cross-account)
  if (components.subscribers && !targetApiKey) {
    try {
      var subscribers = getBoardSubscribers(sourceBoard.id);
      var subscriberIds = [];
      subscribers.forEach(function(s) {
        if (components.guests || !isGuestUser(s.email)) {
          subscriberIds.push(String(s.id));
        }
      });
      if (subscriberIds.length > 0) {
        addUsersToBoardOnTarget(targetApiKey, targetBoard.id, subscriberIds);
      }
    } catch (e) {
      console.warn('Failed to add subscribers to board ' + structure.name + ':', e);
    }
  }

  // Migrate items (mandatory) and their subitems
  var allItems = getAllBoardItems(sourceBoard.id);
  var itemsTotal = allItems.length;
  var itemsMigrated = 0;
  var subitemsMigrated = 0;

  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];

    try {
      var columnValues = {};
      (item.column_values || []).forEach(function(cv) {
        var mapped = columnMapping[cv.id];
        if (cv.value && mapped) {
          try {
            var parsed = JSON.parse(cv.value);
            var skipTypes = ['mirror', 'formula', 'auto_number', 'creation_log', 'last_updated', 'board_relation'];
            if (skipTypes.indexOf(cv.type) < 0) {
              // For cross-account: people columns won't match (different user IDs)
              if (targetApiKey && cv.type === 'people') {
                // Skip people columns for cross-account migration
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

      var newItem = createItemOnTarget(
        targetApiKey,
        targetBoard.id,
        item.name,
        targetGroupId,
        Object.keys(columnValues).length > 0 ? columnValues : null
      );

      itemsMigrated++;

      // Migrate subitems if present
      if (item.subitems && item.subitems.length > 0 && newItem && newItem.id) {
        var subCount = migrateSubitems(item, newItem.id, targetApiKey);
        subitemsMigrated += subCount;
        console.log('Migration:   Migrated ' + subCount + '/' + item.subitems.length + ' subitems for item "' + item.name + '"');
      }

      Utilities.sleep(150);
    } catch (itemError) {
      console.warn('Failed to migrate item "' + item.name + '":', itemError);
    }
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
    columnsMapped: Object.keys(columnMapping).length,
    columnsSkipped: skippedColumns.length,
    groupsMapped: Object.keys(groupMapping).length,
    managedColumnsAttached: managedColumnMapping.length,
    columnMapping: columnMapping,
    groupMapping: groupMapping,
    managedColumnMapping: managedColumnMapping
  };
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
