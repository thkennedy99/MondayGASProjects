/**
 * MondayAPI.gs - Monday.com API Integration
 * Reuses the proven MondayAPI class from the parent project.
 * Single-account operations — same API key for source and target workspaces.
 * Users/guests already exist, so people columns are preserved by user ID.
 */

// ── Proven MondayAPI Class (copied from parent project) ──────────────────────

class MondayAPI {
  constructor() {
    this.apiKey = CONFIG.MONDAY_API_KEY;
    this.apiUrl = CONFIG.MONDAY_API_URL;

    if (!this.apiKey) {
      throw new Error('Monday.com API key not configured');
    }
  }

  /**
   * Execute GraphQL query
   */
  query(graphqlQuery, variables = {}) {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey,
        'API-Version': '2025-07'
      },
      payload: JSON.stringify({
        query: graphqlQuery,
        variables: variables
      }),
      muteHttpExceptions: true
    };

    try {
      const response = retryableFetch(this.apiUrl, options);
      const responseText = response.getContentText();
      const responseCode = response.getResponseCode();

      console.log(`Debug: Monday API response code: ${responseCode}`);
      console.log(`Debug: Monday API raw response: ${responseText.substring(0, 1000)}`);

      const result = JSON.parse(responseText);

      if (result.errors) {
        console.error('Monday.com API errors:', result.errors);
        throw new Error(result.errors[0].message);
      }

      if (result.account_id) {
        console.log(`Debug: Monday account_id: ${result.account_id}`);
      }

      return result.data;
    } catch (error) {
      console.error('Monday.com API request failed:', error);
      throw error;
    }
  }

  /**
   * Get board data
   */
  getBoardData(boardId, limit = 500) {
    const graphqlQuery = `
      query GetBoardData($boardId: ID!, $limit: Int) {
        boards(ids: [$boardId]) {
          name
          items_page(limit: $limit) {
            items {
              id
              name
              created_at
              updated_at
              column_values {
                id
                text
                value
              }
              group {
                id
                title
              }
            }
          }
        }
      }
    `;

    const result = this.query(graphqlQuery, { boardId: boardId, limit: limit });
    return result.boards[0];
  }

  /**
   * Get board columns
   */
  getBoardColumns(boardId) {
    const graphqlQuery = `
      query GetBoardColumns($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;

    const result = this.query(graphqlQuery, { boardId: boardId });
    return result.boards[0].columns;
  }

  /**
   * Update item column value
   */
  updateItemColumnValue(boardId, itemId, columnId, value) {
    const graphqlQuery = `
      mutation UpdateItemColumnValue($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          board_id: $boardId,
          item_id: $itemId,
          column_id: $columnId,
          value: $value
        ) {
          id
        }
      }
    `;

    return this.query(graphqlQuery, {
      boardId: boardId,
      itemId: itemId,
      columnId: columnId,
      value: JSON.stringify(value)
    });
  }

  /**
   * Create new item
   */
  createItem(boardId, groupId, itemName, columnValues = {}) {
    const graphqlQuery = `
      mutation CreateItem($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
        create_item(
          board_id: $boardId,
          group_id: $groupId,
          item_name: $itemName,
          column_values: $columnValues
        ) {
          id
          name
        }
      }
    `;

    return this.query(graphqlQuery, {
      boardId: boardId,
      groupId: groupId,
      itemName: itemName,
      columnValues: JSON.stringify(columnValues)
    });
  }

  /**
   * Delete item
   */
  deleteItem(itemId) {
    const graphqlQuery = `
      mutation DeleteItem($itemId: ID!) {
        delete_item(item_id: $itemId) {
          id
        }
      }
    `;

    return this.query(graphqlQuery, { itemId: itemId });
  }

  /**
   * Get board columns with settings (for dropdowns and other column types)
   */
  getBoardColumnsWithSettings(boardId) {
    const graphqlQuery = `
      query GetBoardColumnsWithSettings($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;

    const result = this.query(graphqlQuery, { boardId: boardId });

    if (!result.boards || result.boards.length === 0) {
      return [];
    }

    // Parse settings_str for each column
    const columns = result.boards[0].columns.map(col => {
      let settings = {};
      try {
        if (col.settings_str) {
          settings = JSON.parse(col.settings_str);
        }
      } catch (e) {
        console.error(`Failed to parse settings for column ${col.title}:`, e);
      }

      return {
        id: col.id,
        title: col.title,
        type: col.type,
        settings: settings
      };
    });

    return columns;
  }

  /**
   * Get users on the board/workspace
   */
  getBoardUsers(boardId) {
    const graphqlQuery = `
      query GetBoardUsers($boardId: ID!) {
        boards(ids: [$boardId]) {
          owners {
            id
            name
            email
          }
          subscribers {
            id
            name
            email
          }
        }
      }
    `;

    const result = this.query(graphqlQuery, { boardId: boardId });

    if (!result.boards || result.boards.length === 0) {
      return [];
    }

    const board = result.boards[0];

    // Combine owners and subscribers, remove duplicates
    const usersMap = new Map();

    if (board.owners) {
      board.owners.forEach(user => {
        usersMap.set(user.id, user);
      });
    }

    if (board.subscribers) {
      board.subscribers.forEach(user => {
        usersMap.set(user.id, user);
      });
    }

    return Array.from(usersMap.values());
  }

  /**
   * Update multiple columns at once
   */
  updateMultipleColumns(boardId, itemId, columnValues) {
    const graphqlQuery = `
      mutation UpdateMultipleColumns($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          board_id: $boardId,
          item_id: $itemId,
          column_values: $columnValues
        ) {
          id
        }
      }
    `;

    console.log('Debug: Column values for API:', JSON.stringify(columnValues));

    return this.query(graphqlQuery, {
      boardId: boardId,
      itemId: itemId,
      columnValues: JSON.stringify(columnValues)
    });
  }

  /**
   * Format column value based on column type
   */
  formatColumnValue(columnType, value, settings = {}, columnId = '') {
    switch (columnType) {
      case 'text':
        // Plain text columns - return value as-is
        return value;

      case 'long-text':
      case 'long_text':
        // Long text columns - Monday.com expects {"text": "value"} format
        return { text: value };

      case 'status':
      case 'color':
        // Status/color columns - detailed logging for debugging
        console.log(`Debug: STATUS COLUMN FORMATTING for columnId="${columnId}"`);
        console.log(`Debug: Input value: "${value}"`);
        console.log(`Debug: Settings available: ${!!settings}`);
        console.log(`Debug: Labels in settings: ${settings && settings.labels ? JSON.stringify(settings.labels) : 'none'}`);

        if (settings && settings.labels) {
          // Convert deactivated_labels to integers for consistent comparison
          const deactivatedLabels = (settings.deactivated_labels || []).map(id => parseInt(id));
          console.log(`Debug: Deactivated labels: ${JSON.stringify(deactivatedLabels)}`);

          // Find all label IDs that match this label name
          const matchingLabelIds = Object.keys(settings.labels).filter(
            id => settings.labels[id] === value
          );
          console.log(`Debug: Matching label IDs for "${value}": ${JSON.stringify(matchingLabelIds)}`);

          // Filter out deactivated labels from matches (compare as integers)
          const activeLabelIds = matchingLabelIds.filter(id => !deactivatedLabels.includes(parseInt(id)));
          console.log(`Debug: Active (non-deactivated) label IDs: ${JSON.stringify(activeLabelIds)}`);

          if (activeLabelIds.length > 0) {
            // Use the first active label
            const activeLabelId = activeLabelIds[0];
            console.log(`Debug: Using label "${value}" (ID: ${activeLabelId}, found ${matchingLabelIds.length} matches, ${activeLabelIds.length} active)`);
            // Use index format to ensure we select the exact label ID
            const result = { index: parseInt(activeLabelId) };
            console.log(`Debug: Returning status value: ${JSON.stringify(result)}`);
            return result;
          } else if (matchingLabelIds.length > 0) {
            // All matching labels are deactivated
            console.warn(`All matching labels for "${value}" are deactivated: ${JSON.stringify(matchingLabelIds)}`);
            return null;
          } else {
            console.warn(`Label "${value}" not found in column settings. Available labels: ${JSON.stringify(Object.values(settings.labels))}`);
            return null;
          }
        }
        // Fallback if settings not available - return null to prevent errors
        console.warn(`Status/color column "${columnId}" has no settings - cannot format value safely`);
        return null;

      case 'date':
        // Date format: YYYY-MM-DD
        if (value) {
          // Ensure date is in correct format (remove time if present)
          const dateStr = String(value).split('T')[0];
          return { date: dateStr };
        }
        return null;

      case 'people':
      case 'multiple-person':
        // People column expects person IDs
        // value should be array of person IDs or single ID
        if (Array.isArray(value)) {
          const persons = value
            .map(id => parseInt(id))
            .filter(id => !isNaN(id) && id !== null)
            .map(id => ({ id: id, kind: 'person' }));

          return persons.length > 0 ? { personsAndTeams: persons } : null;
        } else if (value) {
          const personId = parseInt(value);
          if (!isNaN(personId) && personId !== null) {
            return { personsAndTeams: [{ id: personId, kind: 'person' }] };
          }
        }
        return null;

      case 'numeric':
      case 'numbers':
        if (value === '' || value === null || value === undefined) {
          return null;
        }
        const numValue = parseFloat(value);
        return !isNaN(numValue) ? numValue : null;

      case 'dropdown':
        // Dropdown expects ids array
        // Helper function to find label ID by name (handles both object and string labels)
        // Returns the actual label ID (from label.id property if object, or the key if string label)
        const findDropdownLabelId = (labels, searchValue) => {
          for (const key of Object.keys(labels)) {
            const label = labels[key];
            // Dropdown labels can be objects with {id, name} or simple strings
            if (label && typeof label === 'object' && label.name) {
              if (label.name === searchValue) {
                // Use the label's id property, not the key
                console.log(`Debug: Found dropdown label "${searchValue}" with id=${label.id} (key=${key})`);
                return label.id;
              }
            } else if (label === searchValue) {
              // Simple string label - use the key as the ID
              return parseInt(key);
            }
          }
          return null;
        };

        // First, check if settings has labels to look up the ID
        if (settings && settings.labels && typeof value === 'string') {
          // Try to find the label ID by matching the label name
          const labelId = findDropdownLabelId(settings.labels, value);
          if (labelId) {
            return { ids: [parseInt(labelId)] };
          }
        }

        // Handle array of values (could be string names OR numeric IDs)
        if (Array.isArray(value)) {
          const ids = [];

          for (const v of value) {
            // First, try to look up as string name in settings.labels
            if (settings && settings.labels && typeof v === 'string') {
              const labelId = findDropdownLabelId(settings.labels, v);
              if (labelId) {
                ids.push(parseInt(labelId));
                continue;
              }
            }

            // Fallback: try to parse as numeric ID
            const numericId = parseInt(v);
            if (!isNaN(numericId)) {
              ids.push(numericId);
            }
          }

          if (ids.length > 0) {
            console.log(`Debug: Dropdown formatted ${value.length} values to IDs: [${ids.join(', ')}]`);
            return { ids: ids };
          }
          console.warn(`Dropdown array values could not be resolved: ${JSON.stringify(value)}`);
          return null;
        } else if (value) {
          // Single non-array value - try as numeric ID
          const dropdownId = parseInt(value);
          if (!isNaN(dropdownId)) {
            return { ids: [dropdownId] };
          }
        }

        console.warn(`Dropdown value "${value}" not found in settings and is not a valid ID`);
        return null;

      case 'link':
      case 'url':
        return value ? { url: value, text: value } : null;

      default:
        // Unknown column type - return value as-is
        // Do NOT make assumptions based on column ID, as it can be misleading
        // (e.g., status_1_mkn1ekgr is actually a long_text column)
        console.warn(`Unknown column type "${columnType}" for column ID "${columnId}" - returning value as-is`);
        return value;
    }
  }

  /**
   * Get user info
   */
  getUserInfo() {
    const graphqlQuery = `
      query GetUserInfo {
        me {
          id
          name
          email
          teams {
            id
            name
          }
        }
      }
    `;

    return this.query(graphqlQuery);
  }

  /**
   * Archive item
   */
  archiveItem(itemId) {
    const graphqlQuery = `
      mutation ArchiveItem($itemId: ID!) {
        archive_item(item_id: $itemId) {
          id
        }
      }
    `;

    return this.query(graphqlQuery, { itemId: itemId });
  }

  /**
   * Move item to group
   */
  moveItemToGroup(itemId, groupId) {
    const graphqlQuery = `
      mutation MoveItemToGroup($itemId: ID!, $groupId: String!) {
        move_item_to_group(item_id: $itemId, group_id: $groupId) {
          id
        }
      }
    `;

    return this.query(graphqlQuery, { itemId: itemId, groupId: groupId });
  }

  /**
   * Add update to item
   */
  addUpdate(itemId, body) {
    const graphqlQuery = `
      mutation AddUpdate($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) {
          id
          body
          created_at
        }
      }
    `;

    return this.query(graphqlQuery, { itemId: itemId, body: body });
  }
}

// ── Retry Helper ─────────────────────────────────────────────────────────────

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

// ── Shared instance ──────────────────────────────────────────────────────────
// All standalone functions below use this instance to call the proven class methods.

function _monday() {
  return new MondayAPI();
}

// ── Standalone Functions (migration-specific + wrappers) ─────────────────────
// These are called from InventoryService, MigrationService, ValidationService.
// They delegate to the proven MondayAPI class wherever possible.

function callMondayAPI(query, variables) {
  return _monday().query(query, variables);
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

function getBoardColumnsWithSettings(boardId) {
  return _monday().getBoardColumnsWithSettings(boardId);
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

function getBoardUsers(boardId) {
  return _monday().getBoardUsers(boardId);
}

function getUserInfo() {
  return _monday().getUserInfo();
}

// ── Mutation Wrappers ────────────────────────────────────────────────────────

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

// ── Class method wrappers for use outside the class ──────────────────────────

function updateItemColumnValue(boardId, itemId, columnId, value) {
  return _monday().updateItemColumnValue(boardId, itemId, columnId, value);
}

function updateMultipleColumns(boardId, itemId, columnValues) {
  return _monday().updateMultipleColumns(boardId, itemId, columnValues);
}

function deleteItem(itemId) {
  return _monday().deleteItem(itemId);
}

function archiveItem(itemId) {
  return _monday().archiveItem(itemId);
}

function moveItemToGroup(itemId, groupId) {
  return _monday().moveItemToGroup(itemId, groupId);
}

function addUpdate(itemId, body) {
  return _monday().addUpdate(itemId, body);
}

function formatColumnValue(columnType, value, settings, columnId) {
  return _monday().formatColumnValue(columnType, value, settings || {}, columnId || '');
}

// ── Migration-specific functions (not in parent project) ─────────────────────

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

// ── Managed Column Functions ─────────────────────────────────────────────────
// Managed columns enforce account-level consistency for status and dropdown
// columns across boards (e.g. the Tech Alliance Management workspace uses these).

/**
 * Get all managed columns in the account.
 * Returns array of managed column objects with id, title, description, state,
 * revision, settings_json (contains type + labels).
 */
function getManagedColumns() {
  var data = callMondayAPI(
    'query { managed_column { id title description state revision settings_json } }'
  );
  return data.managed_column || [];
}

/**
 * Get only active managed columns.
 */
function getActiveManagedColumns() {
  var all = getManagedColumns();
  return all.filter(function(mc) { return mc.state === 'active'; });
}

/**
 * Create a managed status column.
 * @param {string} title - Column title
 * @param {string} description - Column description
 * @param {Array} labels - Array of { label, color, index, description?, is_done? }
 * @returns {Object} Created managed column
 */
function createStatusManagedColumn(title, description, labels) {
  var data = callMondayAPI(
    'mutation ($title: String!, $description: String, $settings: CreateStatusColumnSettingsInput!) { create_status_managed_column (title: $title, description: $description, settings: $settings) { id title state } }',
    {
      title: title,
      description: description || '',
      settings: { labels: labels }
    }
  );
  return data.create_status_managed_column;
}

/**
 * Create a managed dropdown column.
 * @param {string} title - Column title
 * @param {string} description - Column description
 * @param {Array} labels - Array of { label }
 * @returns {Object} Created managed column
 */
function createDropdownManagedColumn(title, description, labels) {
  var data = callMondayAPI(
    'mutation ($title: String!, $description: String, $settings: CreateDropdownColumnSettingsInput!) { create_dropdown_managed_column (title: $title, description: $description, settings: $settings) { id title state } }',
    {
      title: title,
      description: description || '',
      settings: { labels: labels }
    }
  );
  return data.create_dropdown_managed_column;
}

/**
 * Attach a managed status column to a board.
 * Creates a new column on the board linked to the managed column definition.
 * @param {string} boardId - Target board ID
 * @param {string} managedColumnId - Managed column UUID
 * @param {string} title - Optional title override
 * @param {string} description - Optional description override
 * @returns {Object} Created column
 */
function attachStatusManagedColumn(boardId, managedColumnId, title, description) {
  var variables = {
    boardId: Number(boardId),
    managedColumnId: managedColumnId
  };
  var args = '$boardId: ID!, $managedColumnId: ID!';
  var params = 'board_id: $boardId, managed_column_id: $managedColumnId';

  if (title) {
    variables.title = title;
    args += ', $title: String';
    params += ', title: $title';
  }
  if (description) {
    variables.description = description;
    args += ', $description: String';
    params += ', description: $description';
  }

  var data = callMondayAPI(
    'mutation (' + args + ') { attach_status_managed_column (' + params + ') { id title type } }',
    variables
  );
  return data.attach_status_managed_column;
}

/**
 * Attach a managed dropdown column to a board.
 * @param {string} boardId - Target board ID
 * @param {string} managedColumnId - Managed column UUID
 * @param {string} title - Optional title override
 * @param {string} description - Optional description override
 * @returns {Object} Created column
 */
function attachDropdownManagedColumn(boardId, managedColumnId, title, description) {
  var variables = {
    boardId: Number(boardId),
    managedColumnId: managedColumnId
  };
  var args = '$boardId: ID!, $managedColumnId: ID!';
  var params = 'board_id: $boardId, managed_column_id: $managedColumnId';

  if (title) {
    variables.title = title;
    args += ', $title: String';
    params += ', title: $title';
  }
  if (description) {
    variables.description = description;
    args += ', $description: String';
    params += ', description: $description';
  }

  var data = callMondayAPI(
    'mutation (' + args + ') { attach_dropdown_managed_column (' + params + ') { id title type } }',
    variables
  );
  return data.attach_dropdown_managed_column;
}

/**
 * Detect which columns on a source board are linked to managed columns.
 * Compares board column settings_str against managed column settings_json
 * to find matches by title + label structure.
 * @param {string} boardId - Source board ID
 * @returns {Array} Array of { columnId, columnTitle, columnType, managedColumnId, managedColumnTitle }
 */
function detectManagedColumnsOnBoard(boardId) {
  var boardColumns = getBoardColumnsWithSettings(boardId);
  var managedCols = getActiveManagedColumns();
  var matches = [];

  boardColumns.forEach(function(col) {
    if (col.type !== 'color' && col.type !== 'dropdown') return;

    // Try to match by title and label content
    managedCols.forEach(function(mc) {
      var mcSettings = mc.settings_json;
      if (!mcSettings) return;

      // Type check: 'color' maps to managed 'status', 'dropdown' to 'dropdown'
      var mcType = mcSettings.type === 'color' ? 'color' : mcSettings.type;
      if (col.type !== mcType && !(col.type === 'color' && mcSettings.type === 'color')) return;

      // Compare titles (case-insensitive)
      if (col.title.toLowerCase() !== mc.title.toLowerCase()) return;

      // Compare label names for confirmation
      var colLabels = [];
      if (col.settings && col.settings.labels) {
        var labelsObj = col.settings.labels;
        if (Array.isArray(labelsObj)) {
          colLabels = labelsObj.map(function(l) { return l.name || l.label || ''; });
        } else {
          colLabels = Object.values(labelsObj).map(function(v) {
            return typeof v === 'object' ? (v.name || v.label || '') : String(v);
          });
        }
      }

      var mcLabels = (mcSettings.labels || []).map(function(l) { return l.label || ''; });

      // If at least 50% of managed column labels exist in the board column, it's a match
      if (mcLabels.length > 0) {
        var matchCount = 0;
        mcLabels.forEach(function(ml) {
          if (colLabels.indexOf(ml) >= 0) matchCount++;
        });
        var matchRate = matchCount / mcLabels.length;
        if (matchRate >= 0.5) {
          matches.push({
            columnId: col.id,
            columnTitle: col.title,
            columnType: col.type,
            managedColumnId: mc.id,
            managedColumnTitle: mc.title,
            managedColumnType: mcSettings.type,
            matchRate: Math.round(matchRate * 100)
          });
        }
      }
    });
  });

  return matches;
}

// ── Document Migration Functions ──────────────────────────────────────────────
// Export doc content as markdown, create docs in target workspace, and import
// markdown content. Used by DocumentMigrationService.gs.

/**
 * Get docs in a workspace with full metadata including blocks.
 * @param {string} workspaceId - Workspace ID
 * @returns {Array} Array of doc objects with id, name, doc_kind, object_id, created_at
 */
function getDocsWithDetails(workspaceId) {
  var data = callMondayAPI(
    'query ($wsId: [ID!]) { docs (workspace_ids: $wsId, limit: 200) { id name object_id doc_kind created_at url relative_url doc_folder_id } }',
    { wsId: [Number(workspaceId)] }
  );
  return data.docs || [];
}

/**
 * Export a document's content as markdown.
 * @param {string} docId - The document's unique ID (not object_id)
 * @returns {Object} { success: boolean, markdown: string, error?: string }
 */
function exportDocAsMarkdown(docId) {
  var data = callMondayAPI(
    'query ($docId: ID!) { export_markdown_from_doc (docId: $docId) { success markdown error } }',
    { docId: Number(docId) }
  );
  return data.export_markdown_from_doc;
}

/**
 * Create a new doc in a workspace.
 * @param {string} workspaceId - Target workspace ID
 * @param {string} name - Document name
 * @param {string} kind - 'public' or 'private'
 * @returns {Object} Created document with id and object_id
 */
function createDoc(workspaceId, name, kind) {
  var variables = {
    workspace: { workspace_id: Number(workspaceId) },
    doc: {}
  };
  if (kind) {
    variables.doc.kind = kind;
  }

  var data = callMondayAPI(
    'mutation ($workspace: CreateDocWorkspaceInput!, $doc: CreateDocInput) { create_doc (workspace: $workspace, doc: $doc) { id object_id } }',
    variables
  );

  var doc = data.create_doc;

  // Rename the doc (create_doc doesn't accept a name directly)
  if (name && doc && doc.id) {
    try {
      callMondayAPI(
        'mutation ($docId: ID!, $name: String!) { update_doc_name (docId: $docId, name: $name) { id } }',
        { docId: Number(doc.id), name: name }
      );
    } catch (e) {
      console.warn('Failed to rename doc to "' + name + '":', e);
    }
  }

  return doc;
}

/**
 * Add markdown content to an existing document.
 * @param {string} docId - Target document ID
 * @param {string} markdown - Markdown content to add
 * @returns {Object} Result with created block IDs
 */
function addMarkdownToDoc(docId, markdown) {
  var data = callMondayAPI(
    'mutation ($docId: ID!, $markdown: String!) { add_content_to_doc_from_markdown (docId: $docId, markdown: $markdown) { ids } }',
    { docId: Number(docId), markdown: markdown }
  );
  return data.add_content_to_doc_from_markdown;
}

/**
 * Get document blocks for a doc (used for verification).
 * @param {string} docId - Document ID
 * @returns {Array} Array of document blocks
 */
function getDocBlocks(docId) {
  var data = callMondayAPI(
    'query ($docId: [ID!]!) { docs (ids: $docId) { id name blocks { id type content } } }',
    { docId: [Number(docId)] }
  );
  var docs = data.docs || [];
  return docs.length > 0 ? docs[0].blocks || [] : [];
}

/**
 * Get workspace folders for doc organization.
 * @param {string} workspaceId - Workspace ID
 * @returns {Array} Array of folder objects
 */
function getWorkspaceFolders(workspaceId) {
  var data = callMondayAPI(
    'query ($wsId: [ID!]) { folders (workspace_ids: $wsId) { id name } }',
    { wsId: [Number(workspaceId)] }
  );
  return data.folders || [];
}

// ── Template-Based Migration Functions ────────────────────────────────────────
// duplicate_board preserves views, automations, column settings, formulas, and
// managed column links — things that manual column-by-column creation loses.

/**
 * Get board metadata including created_from_board_id to detect template origin.
 * @param {string} boardId - Board ID
 * @returns {Object} Board metadata with created_from_board_id
 */
function getBoardOrigin(boardId) {
  var data = callMondayAPI(
    'query ($id: [ID!]!) { boards (ids: $id) { id name board_kind created_from_board_id columns { id title type } groups { id title } } }',
    { id: [Number(boardId)] }
  );
  var boards = data.boards || [];
  return boards.length > 0 ? boards[0] : null;
}

/**
 * Duplicate a board with structure only (no items) into a target workspace.
 * Preserves: columns with settings, groups, views, automations, managed columns.
 * @param {string} sourceBoardId - Source board ID
 * @param {string} targetWorkspaceId - Target workspace ID
 * @param {string} boardName - Optional name override
 * @param {boolean} keepSubscribers - Whether to keep subscribers
 * @returns {Object} { board: { id, name }, isAsync }
 */
function duplicateBoardStructure(sourceBoardId, targetWorkspaceId, boardName, keepSubscribers) {
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

  var data = callMondayAPI(
    'mutation (' + args + ') { duplicate_board (' + params + ') { board { id name columns { id title type } groups { id title } } is_async } }',
    variables
  );

  return {
    board: data.duplicate_board.board,
    isAsync: data.duplicate_board.is_async
  };
}

/**
 * Build a column mapping between source and target boards by matching column titles.
 * Used after duplicate_board to map source column IDs to target column IDs for item migration.
 * @param {Array} sourceColumns - Source board columns [{ id, title, type }]
 * @param {Array} targetColumns - Target board columns [{ id, title, type }]
 * @returns {Object} { mapping: { sourceId: { targetId, title, type } }, unmapped: [] }
 */
function buildColumnMappingByTitle(sourceColumns, targetColumns) {
  var mapping = {};
  var unmapped = [];

  // Build a lookup by title+type for the target
  var targetLookup = {};
  (targetColumns || []).forEach(function(col) {
    var key = col.title.toLowerCase() + '::' + col.type;
    if (!targetLookup[key]) {
      targetLookup[key] = col;
    }
  });

  // Also build a title-only fallback lookup
  var titleOnlyLookup = {};
  (targetColumns || []).forEach(function(col) {
    var key = col.title.toLowerCase();
    if (!titleOnlyLookup[key]) {
      titleOnlyLookup[key] = col;
    }
  });

  (sourceColumns || []).forEach(function(srcCol) {
    var key = srcCol.title.toLowerCase() + '::' + srcCol.type;
    var match = targetLookup[key];

    // Fallback to title-only match
    if (!match) {
      match = titleOnlyLookup[srcCol.title.toLowerCase()];
    }

    if (match) {
      mapping[srcCol.id] = {
        targetId: match.id,
        title: srcCol.title,
        type: srcCol.type,
        duplicated: true
      };
    } else {
      unmapped.push({ id: srcCol.id, title: srcCol.title, type: srcCol.type });
    }
  });

  return { mapping: mapping, unmapped: unmapped };
}

/**
 * Build a group mapping between source and target boards by matching group titles.
 * @param {Array} sourceGroups - Source board groups [{ id, title }]
 * @param {Array} targetGroups - Target board groups [{ id, title }]
 * @returns {Object} { mapping: { sourceId: { targetId, title } }, unmapped: [] }
 */
function buildGroupMappingByTitle(sourceGroups, targetGroups) {
  var mapping = {};
  var unmapped = [];

  var targetLookup = {};
  (targetGroups || []).forEach(function(grp) {
    targetLookup[grp.title.toLowerCase()] = grp;
  });

  (sourceGroups || []).forEach(function(srcGrp) {
    var match = targetLookup[srcGrp.title.toLowerCase()];
    if (match) {
      mapping[srcGrp.id] = { targetId: match.id, title: srcGrp.title };
    } else {
      unmapped.push({ id: srcGrp.id, title: srcGrp.title });
    }
  });

  return { mapping: mapping, unmapped: unmapped };
}
