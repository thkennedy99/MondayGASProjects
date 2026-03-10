/**
 * MondayAPI.gs - Monday.com GraphQL API wrapper
 * Single-account operations — same API key for source and target workspaces.
 * Users/guests already exist, so people columns are preserved by user ID.
 */

// ── Core API Call ────────────────────────────────────────────────────────────

/**
 * Execute a GraphQL query/mutation against Monday.com API.
 * @param {string} query - GraphQL query string
 * @param {Object} variables - Query variables
 * @returns {Object} API response data
 */
function callMondayAPI(query, variables) {
  var apiKey = CONFIG.MONDAY_API_KEY;

  if (!apiKey) {
    throw new Error('MONDAY_API_KEY not configured in Script Properties');
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': apiKey },
    payload: JSON.stringify({ query: query, variables: variables || {} }),
    muteHttpExceptions: true
  };

  var result = retryableFetch(CONFIG.MONDAY_API_URL, options);
  var parsed = JSON.parse(result.getContentText());

  if (parsed.errors) {
    throw new Error('Monday API error: ' + JSON.stringify(parsed.errors));
  }

  return parsed.data;
}

/**
 * Retry-capable UrlFetchApp.fetch with exponential backoff.
 */
function retryableFetch(url, options, maxAttempts) {
  maxAttempts = maxAttempts || CONFIG.MAX_RETRIES;
  var lastError;

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        return response;
      }
      if (code === 429 || code >= 500) {
        lastError = new Error('HTTP ' + code + ': ' + response.getContentText().substring(0, 200));
        if (attempt < maxAttempts) {
          Utilities.sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
      }
      throw new Error('HTTP ' + code + ': ' + response.getContentText().substring(0, 500));
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        Utilities.sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  throw new Error('Failed after ' + maxAttempts + ' attempts: ' + lastError);
}

// ── Workspace Queries ────────────────────────────────────────────────────────

function getWorkspaces() {
  var data = callMondayAPI(
    'query { workspaces (limit: 100) { id name kind description created_at } }'
  );
  return data.workspaces || [];
}

function getWorkspaceDetails(workspaceId) {
  var data = callMondayAPI(
    'query ($ids: [ID!]) { workspaces (ids: $ids) { id name kind description } }',
    { ids: [Number(workspaceId)] }
  );
  return data.workspaces && data.workspaces[0] ? data.workspaces[0] : null;
}

// ── Board Queries ────────────────────────────────────────────────────────────

function getBoardsInWorkspace(workspaceId) {
  var data = callMondayAPI(
    'query ($wsId: [ID!]) { boards (workspace_ids: $wsId, limit: 200) { id name board_kind state columns { id title type settings_str } groups { id title color } } }',
    { wsId: [Number(workspaceId)] }
  );
  return data.boards || [];
}

function getBoardItemCount(boardId) {
  var data = callMondayAPI(
    'query ($boardId: [ID!]) { boards (ids: $boardId) { id name items_count } }',
    { boardId: [Number(boardId)] }
  );
  var board = data.boards && data.boards[0];
  return board ? (board.items_count || 0) : 0;
}

function getBoardItems(boardId, cursor) {
  var query;
  var variables;

  if (cursor) {
    query = 'query ($cursor: String!) { next_items_page (cursor: $cursor, limit: 500) { cursor items { id name group { id title } column_values { id type text value } } } }';
    variables = { cursor: cursor };
  } else {
    query = 'query ($boardId: [ID!]) { boards (ids: $boardId) { items_page (limit: 500) { cursor items { id name group { id title } column_values { id type text value } } } } }';
    variables = { boardId: [Number(boardId)] };
  }

  var data = callMondayAPI(query, variables);

  if (cursor) {
    return {
      cursor: data.next_items_page.cursor,
      items: data.next_items_page.items
    };
  }

  var page = data.boards[0].items_page;
  return {
    cursor: page.cursor,
    items: page.items
  };
}

/**
 * Get ALL items from a board using cursor pagination.
 */
function getAllBoardItems(boardId) {
  var allItems = [];
  var result = getBoardItems(boardId);
  allItems = allItems.concat(result.items);

  while (result.cursor) {
    Utilities.sleep(200);
    result = getBoardItems(boardId, result.cursor);
    allItems = allItems.concat(result.items);
  }

  return allItems;
}

// ── Board Structure ──────────────────────────────────────────────────────────

function getBoardStructure(boardId) {
  var data = callMondayAPI(
    'query ($boardId: [ID!]) { boards (ids: $boardId) { id name board_kind description columns { id title type settings_str } groups { id title color position } } }',
    { boardId: [Number(boardId)] }
  );
  return data.boards && data.boards[0] ? data.boards[0] : null;
}

// ── User Queries ─────────────────────────────────────────────────────────────

function getAccountUsers() {
  var allUsers = [];
  var page = 1;

  while (true) {
    var data = callMondayAPI(
      'query ($page: Int!) { users (limit: 100, page: $page) { id name email is_guest enabled account { id } } }',
      { page: page }
    );

    var users = data.users || [];
    if (users.length === 0) break;

    allUsers = allUsers.concat(users);
    page++;

    if (users.length < 100) break;
    Utilities.sleep(200);
  }

  return allUsers;
}

function getBoardSubscribers(boardId) {
  var data = callMondayAPI(
    'query ($boardId: [ID!]) { boards (ids: $boardId) { subscribers { id name email } } }',
    { boardId: [Number(boardId)] }
  );
  var board = data.boards && data.boards[0];
  return board ? (board.subscribers || []) : [];
}

// ── Mutation Helpers ─────────────────────────────────────────────────────────

function createBoard(name, kind, workspaceId) {
  var data = callMondayAPI(
    'mutation ($name: String!, $kind: BoardKind!, $wsId: ID) { create_board (board_name: $name, board_kind: $kind, workspace_id: $wsId) { id name } }',
    { name: name, kind: kind, wsId: workspaceId ? Number(workspaceId) : null }
  );
  return data.create_board;
}

function createGroup(boardId, groupName) {
  var data = callMondayAPI(
    'mutation ($boardId: ID!, $name: String!) { create_group (board_id: $boardId, group_name: $name) { id title } }',
    { boardId: Number(boardId), name: groupName }
  );
  return data.create_group;
}

function createColumn(boardId, title, columnType) {
  var data = callMondayAPI(
    'mutation ($boardId: ID!, $title: String!, $type: ColumnType!) { create_column (board_id: $boardId, title: $title, column_type: $type) { id title type } }',
    { boardId: Number(boardId), title: title, type: columnType }
  );
  return data.create_column;
}

function createItem(boardId, itemName, groupId, columnValues) {
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

  var data = callMondayAPI(query, variables);
  return data.create_item;
}

function createWorkspace(name, kind, description) {
  var data = callMondayAPI(
    'mutation ($name: String!, $kind: WorkspaceKind!, $desc: String) { create_workspace (name: $name, kind: $kind, description: $desc) { id name } }',
    { name: name, kind: kind, desc: description || '' }
  );
  return data.create_workspace;
}

function addUsersToWorkspace(workspaceId, userIds, kind) {
  var data = callMondayAPI(
    'mutation ($wsId: ID!, $userIds: [ID!]!, $kind: WorkspaceMembershipKind) { add_users_to_workspace (workspace_id: $wsId, user_ids: $userIds, kind: $kind) { id } }',
    { wsId: Number(workspaceId), userIds: userIds.map(Number), kind: kind || 'subscriber' }
  );
  return data.add_users_to_workspace;
}

function addUsersToBoard(boardId, userIds) {
  var data = callMondayAPI(
    'mutation ($boardId: ID!, $userIds: [ID!]!) { add_users_to_board (board_id: $boardId, user_ids: $userIds) { id } }',
    { boardId: Number(boardId), userIds: userIds.map(Number) }
  );
  return data.add_users_to_board;
}

// ── Additional API functions (ported from parent project) ────────────────────

function updateItemColumnValue(boardId, itemId, columnId, value) {
  var data = callMondayAPI(
    'mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) { change_column_value (board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id } }',
    { boardId: String(boardId), itemId: String(itemId), columnId: columnId, value: JSON.stringify(value) }
  );
  return data.change_column_value;
}

function updateMultipleColumns(boardId, itemId, columnValues) {
  var data = callMondayAPI(
    'mutation ($boardId: ID!, $itemId: ID!, $values: JSON!) { change_multiple_column_values (board_id: $boardId, item_id: $itemId, column_values: $values) { id } }',
    { boardId: String(boardId), itemId: String(itemId), values: JSON.stringify(columnValues) }
  );
  return data.change_multiple_column_values;
}

function deleteItem(itemId) {
  var data = callMondayAPI(
    'mutation ($itemId: ID!) { delete_item (item_id: $itemId) { id } }',
    { itemId: String(itemId) }
  );
  return data.delete_item;
}

function archiveItem(itemId) {
  var data = callMondayAPI(
    'mutation ($itemId: ID!) { archive_item (item_id: $itemId) { id } }',
    { itemId: String(itemId) }
  );
  return data.archive_item;
}

function moveItemToGroup(itemId, groupId) {
  var data = callMondayAPI(
    'mutation ($itemId: ID!, $groupId: String!) { move_item_to_group (item_id: $itemId, group_id: $groupId) { id } }',
    { itemId: String(itemId), groupId: groupId }
  );
  return data.move_item_to_group;
}

function addUpdate(itemId, body) {
  var data = callMondayAPI(
    'mutation ($itemId: ID!, $body: String!) { create_update (item_id: $itemId, body: $body) { id } }',
    { itemId: String(itemId), body: body }
  );
  return data.create_update;
}

function getUserInfo() {
  var data = callMondayAPI(
    'query { me { id name email teams { id name } } }'
  );
  return data.me;
}

function getBoardColumnsWithSettings(boardId) {
  var data = callMondayAPI(
    'query ($boardId: [ID!]) { boards (ids: $boardId) { columns { id title type settings_str } } }',
    { boardId: [Number(boardId)] }
  );
  var board = data.boards && data.boards[0];
  if (!board) return [];

  return board.columns.map(function(col) {
    var settings = {};
    try {
      settings = JSON.parse(col.settings_str || '{}');
    } catch (e) {}
    return {
      id: col.id,
      title: col.title,
      type: col.type,
      settings: settings
    };
  });
}

function getDocs(workspaceId) {
  var data = callMondayAPI(
    'query ($wsId: [ID!]) { docs (workspace_ids: $wsId, limit: 200) { id title created_at } }',
    { wsId: [Number(workspaceId)] }
  );
  return data.docs || [];
}

function duplicateBoard(boardId, duplicateType, workspaceId) {
  var variables = {
    boardId: Number(boardId),
    duplicateType: duplicateType || 'duplicate_board_with_structure'
  };
  if (workspaceId) variables.wsId = Number(workspaceId);

  var data = callMondayAPI(
    'mutation ($boardId: ID!, $duplicateType: DuplicateBoardType!, $wsId: ID) { duplicate_board (board_id: $boardId, duplicate_type: $duplicateType, workspace_id: $wsId) { board { id name } } }',
    variables
  );
  return data.duplicate_board.board;
}

/**
 * Format a column value for the Monday.com API.
 * Ported from parent project MondayAPI class.
 */
function formatColumnValue(columnType, value, settings, columnId) {
  settings = settings || {};
  columnId = columnId || '';

  switch (columnType) {
    case 'text':
      return value;

    case 'long-text':
    case 'long_text':
      return { text: value };

    case 'status':
    case 'color':
      if (settings && settings.labels) {
        var deactivatedLabels = (settings.deactivated_labels || []).map(function(id) { return parseInt(id); });
        var matchingLabelIds = Object.keys(settings.labels).filter(function(id) {
          return settings.labels[id] === value;
        });
        var activeLabelIds = matchingLabelIds.filter(function(id) {
          return deactivatedLabels.indexOf(parseInt(id)) < 0;
        });

        if (activeLabelIds.length > 0) {
          return { index: parseInt(activeLabelIds[0]) };
        }
        return null;
      }
      return null;

    case 'date':
      if (value) {
        var dateStr = String(value).split('T')[0];
        return { date: dateStr };
      }
      return null;

    case 'people':
    case 'multiple-person':
      if (Array.isArray(value)) {
        var persons = value
          .map(function(id) { return parseInt(id); })
          .filter(function(id) { return !isNaN(id); })
          .map(function(id) { return { id: id, kind: 'person' }; });
        return persons.length > 0 ? { personsAndTeams: persons } : null;
      } else if (value) {
        var personId = parseInt(value);
        if (!isNaN(personId)) {
          return { personsAndTeams: [{ id: personId, kind: 'person' }] };
        }
      }
      return null;

    case 'numeric':
    case 'numbers':
      if (value === '' || value === null || value === undefined) return null;
      var numValue = parseFloat(value);
      return !isNaN(numValue) ? numValue : null;

    case 'dropdown':
      if (settings && settings.labels && typeof value === 'string') {
        var keys = Object.keys(settings.labels);
        for (var i = 0; i < keys.length; i++) {
          var label = settings.labels[keys[i]];
          if (label && typeof label === 'object' && label.name === value) {
            return { ids: [parseInt(label.id)] };
          } else if (label === value) {
            return { ids: [parseInt(keys[i])] };
          }
        }
      }
      if (Array.isArray(value)) {
        var ids = value.map(function(v) { return parseInt(v); }).filter(function(id) { return !isNaN(id); });
        return ids.length > 0 ? { ids: ids } : null;
      }
      if (value) {
        var dropdownId = parseInt(value);
        if (!isNaN(dropdownId)) return { ids: [dropdownId] };
      }
      return null;

    case 'link':
    case 'url':
      return value ? { url: value, text: value } : null;

    default:
      return value;
  }
}
