
/**
 * MondayAPI.gs - Monday.com API Integration
 * Handles all Monday.com API operations
 */

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
        'Authorization': this.apiKey
      },
      payload: JSON.stringify({
        query: graphqlQuery,
        variables: variables
      }),
      muteHttpExceptions: true
    };
    
    try {
      const response = UrlFetchApp.fetch(this.apiUrl, options);
      const responseText = response.getContentText();
      const responseCode = response.getResponseCode();

      console.log(`Debug: Monday API response code: ${responseCode}`);
      console.log(`Debug: Monday API raw response: ${responseText.substring(0, 1000)}`);

      const result = JSON.parse(responseText);

      if (result.errors) {
        console.error('Monday.com API errors:', result.errors);
        throw new Error(result.errors[0].message);
      }

      // Log any warnings or account_id info that might be in the response
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

// Board configuration mappings
const BOARD_CONFIGS = {
  'MondayData': {
    boardId: '8463767815',
    columns: {
      'Name': 'name',
      'Partner Name': 'status_1_mkn1xbbx',
      'Activity Status': 'color_mktakkpw',
      'Owner': 'person',
      'Assigned By': 'text_mktj11qa',
      'Importance': 'color_mkthcvny',
      'Date Created': 'date_1_mkn1x66b',
      'Date Due': 'date_1_mkn1rbp8',
      'Actual Completion': 'dup__of_date_due_mkn1zx06',
      'Files': 'files_mkn15ep0',
      'Comments/Notes': 'status_1_mkn1ekgr',
      'Subitems': 'subtasks_mkp7am7a'
    }
  },
  'GWMondayData': {
    boardIds: ['9791255941', '9791272390', '9855494527'],
    columns: {
      'Name': 'name',
      'Activity Status': 'color_mktakkpw',
      'Owner': 'person',
      'Assigned By': 'text_mktj11qa',
      'Importance': 'color_mkthcvny',
      'Date Created': 'date_1_mkn1x66b',
      'Date Due': 'date_1_mkn1rbp8',
      'Actual Completion': 'dup__of_date_due_mkn1zx06',
      'Files': 'files_mkn15ep0',
      'Comments/Notes': 'status_1_mkn1ekgr',
      'Tech Board Type': '9791140449__color_mktqwq7c'
    }
  },
  'MarketingApproval': {
    boardId: '9710279044',
    columns: {
      'Marketing Event Name': 'name',
      'Approval Status': 'status_mkti9n71',
      'Owner': 'person',
      'Alliance Manager': 'text_mktkrhhj',
      'Requesting Department': 'status_1',
      'Cost': 'numeric_mktjxtjk',
      'Date and Location': 'text_mktjwnj7',
      'Partner Name': 'text_mktk183a',
      'Event Summary': 'long_text_mktk2jsh',
      'Date Requested': 'date_mktkhyxy',
      'Approval Date': 'date_mktko0ff',
      'Comments': 'long_text_mktkphg5'
    }
  },
  'MarketingCalendar': {
    boardId: '9770467355',
    columns: {
      'Event Title': 'name',
      'Month': 'color_mktk2s2a',
      'Event Type': 'status_mktkrfhp',
      'Link': 'url_mktkikii',
      'Formula': 'formula_mktkajwy',
      'EventDate': 'date_mktkyhta'
    }
  }
};

/**
 * Sync board to sheet
 */
function syncBoardToSheet(boardId, sheetName) {
  try {
    const monday = new MondayAPI();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // Get or create sheet
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }
    
    // Get board data
    const boardData = monday.getBoardData(boardId);
    const columns = monday.getBoardColumns(boardId);
    
    // Build header row
    const headers = ['Item ID', 'Name', 'Group'];
    const columnMap = {};
    
    columns.forEach(col => {
      headers.push(col.title);
      columnMap[col.id] = col.title;
    });
    
    // Clear sheet and set headers
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // Process items
    const rows = [];
    boardData.items_page.items.forEach(item => {
      const row = [item.id, item.name, item.group.title];
      
      columns.forEach(col => {
        const columnValue = item.column_values.find(cv => cv.id === col.id);
        row.push(columnValue ? columnValue.text : '');
      });
      
      rows.push(row);
    });
    
    // Write data
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    
    // Format sheet
    sheet.autoResizeColumns(1, headers.length);
    sheet.setFrozenRows(1);
    
    return {
      success: true,
      rowsImported: rows.length,
      columns: headers.length
    };
    
  } catch (error) {
    console.error('Sync error:', error);
    throw error;
  }
}

/**
 * Update Monday.com item
 */
function updateMondayItem(itemId, boardId, updates) {
  try {
    const monday = new MondayAPI();
    const config = Object.values(BOARD_CONFIGS).find(c => c.boardId === boardId);
    
    if (!config) {
      throw new Error(`Board configuration not found for board ${boardId}`);
    }
    
    // Update each column
    const results = [];
    for (const [field, value] of Object.entries(updates)) {
      const columnId = config.columns[field];
      if (columnId) {
        const result = monday.updateItemColumnValue(boardId, itemId, columnId, value);
        results.push(result);
      }
    }
    
    return { success: true, updates: results.length };
    
  } catch (error) {
    console.error('Update error:', error);
    throw error;
  }
}

/**
 * Delete Monday.com item
 * @param {string} itemId - Monday.com item ID to delete
 * @param {string} boardId - Board ID where the item belongs (for post-delete sync)
 */
function deleteMondayItem(itemId, boardId) {
  try {
    const monday = new MondayAPI();
    const result = monday.deleteItem(itemId);

    // Full sync of the board from Monday.com to spreadsheet after item deletion
    // This ensures fresh data is available for the UI
    // Uses global constants from main.gs: MARKETING_APPROVAL_BOARD_ID, MARKETING_CALENDAR_BOARD_ID, GW_BOARD_IDS
    if (boardId) {
      try {
        if (boardId === MARKETING_APPROVAL_BOARD_ID) {
          console.log('Syncing Marketing Approval board after item deletion...');
          syncMarketingApprovalBoard();
          console.log('Marketing Approval board sync complete');
        } else if (boardId === MARKETING_CALENDAR_BOARD_ID) {
          console.log('Syncing Marketing Calendar board after item deletion...');
          syncMarketingCalendarBoard();
          console.log('Marketing Calendar board sync complete');
        } else if (boardId === APPROVALS_2026_BOARD_ID) {
          console.log('Syncing 2026 Approvals board after item deletion...');
          sync2026ApprovalsBoard();
          clear2026ApprovalsCaches();
          console.log('2026 Approvals board sync and cache clear complete');
        } else if (GW_BOARD_IDS.includes(boardId)) {
          // Sync only the specific GW board that was affected
          console.log(`Syncing single GW board ${boardId} after item deletion...`);
          // Add a short delay to allow Monday to process the deletion (eventual consistency)
          Utilities.sleep(1500);
          syncSingleGWBoard(boardId);
          // GWMondayData auto-updates via formula
          // Clear internal activity caches so UI gets fresh data
          clearInternalActivityCaches();
          console.log('GW board sync and cache clear complete');
        } else if (boardId === PARTNER_BOARD_ID) {
          // For partner board, sync just the partner activities
          console.log('Syncing Partner Activities board after item deletion...');
          syncPartnerActivitiesData();
          console.log('Partner Activities sync complete');
        }
      } catch (syncError) {
        // Log sync error but don't fail the delete
        console.error('Error syncing board after item deletion:', syncError);
      }
    }

    return { success: true, result };

  } catch (error) {
    console.error('Delete error:', error);
    throw error;
  }
}

/**
 * Get column metadata for a board (exposed to client)
 * @param {string} boardId - Monday.com board ID
 * @returns {Object[]} Array of column metadata with settings
 */
function getMondayBoardColumns(boardId) {
  try {
    const monday = new MondayAPI();
    const columns = monday.getBoardColumnsWithSettings(boardId);

    // Ensure all data is serializable
    return DataService.ensureSerializable(columns);

  } catch (error) {
    console.error('Error getting board columns:', error);
    return [];
  }
}

/**
 * Get users for a board (exposed to client)
 * @param {string} boardId - Monday.com board ID
 * @returns {Object[]} Array of users
 */
function getMondayBoardUsers(boardId) {
  try {
    const monday = new MondayAPI();
    const users = monday.getBoardUsers(boardId);

    // Ensure all data is serializable
    return DataService.ensureSerializable(users);

  } catch (error) {
    console.error('Error getting board users:', error);
    return [];
  }
}

/**
 * Update Monday.com item with multiple columns
 * @param {string} boardId - Monday.com board ID
 * @param {string} itemId - Monday.com item ID
 * @param {Object} updates - Object with column titles as keys and new values
 * @param {Object} columnMetadata - Column metadata (from getMondayBoardColumns)
 * @returns {Object} Success/error result
 */
function updateMondayItemMultipleColumns(boardId, itemId, updates, columnMetadata) {
  try {
    const monday = new MondayAPI();

    // Handle case where columnMetadata is not provided
    if (!columnMetadata || !Array.isArray(columnMetadata) || columnMetadata.length === 0) {
      console.log('No column metadata provided - using direct update approach');

      // Check if Name/Item Name needs to be updated separately
      let newItemName = null;
      if (updates['Name'] !== undefined && updates['Name'] !== null && updates['Name'] !== '') {
        newItemName = updates['Name'];
      }
      if (updates['Item Name'] !== undefined && updates['Item Name'] !== null && updates['Item Name'] !== '') {
        newItemName = updates['Item Name'];
      }

      // Update item name first if needed
      if (newItemName) {
        console.log(`Updating item name to: "${newItemName}"`);
        const nameResult = updateMondayItemName(boardId, itemId, newItemName);
        if (!nameResult.success) {
          console.error('Failed to update item name:', nameResult.error);
        }
      }

      // Build column values directly from updates (excluding name fields)
      const columnValues = {};
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'Name' || key === 'Item Name' || key === 'Monday Item ID' || key === 'Board ID') {
          continue;
        }
        if (value === null || value === undefined || value === '') {
          continue;
        }
        columnValues[key] = value;
      }

      if (Object.keys(columnValues).length === 0) {
        console.log('No column values to update');
        return { success: true, message: 'No columns to update (only item name was updated)' };
      }

      // Use change_multiple_column_values with direct column ID mapping
      const graphqlQuery = `
        mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
          change_multiple_column_values(
            board_id: $boardId,
            item_id: $itemId,
            column_values: $columnValues
          ) {
            id
          }
        }
      `;

      const result = monday.query(graphqlQuery, {
        boardId: String(boardId),
        itemId: String(itemId),
        columnValues: JSON.stringify(columnValues)
      });

      return { success: true, result: DataService.ensureSerializable(result) };
    }

    // Create a map of column titles to column info
    const columnMap = {};
    columnMetadata.forEach(col => {
      columnMap[col.title] = col;
    });

    // Check if Name column is being updated - it requires a separate API call
    let newItemName = null;
    if (updates['Name'] !== undefined && updates['Name'] !== null && updates['Name'] !== '') {
      newItemName = updates['Name'];
      console.log(`Debug: Item name will be updated separately to: "${newItemName}"`);
    }

    // Build the column values object with proper formatting
    const columnValues = {};

    // Non-updatable column types
    const nonUpdatableTypes = ['formula', 'mirror', 'board-relation', 'dependency', 'file', 'subtasks', 'auto-number', 'name'];

    // Non-updatable column ID patterns
    const nonUpdatablePatterns = ['formula_', 'files_', 'subtasks_', 'subitems', 'link_to_item'];

    for (const [columnTitle, newValue] of Object.entries(updates)) {
      const column = columnMap[columnTitle];

      if (!column) {
        console.warn(`Column not found: ${columnTitle}`);
        continue;
      }

      // Skip non-updatable column types
      if (nonUpdatableTypes.includes(column.type)) {
        console.log(`Skipping non-updatable column type '${column.type}': ${columnTitle}`);
        continue;
      }

      // Skip columns with non-updatable ID patterns
      const hasNonUpdatablePattern = nonUpdatablePatterns.some(pattern => column.id.includes(pattern));
      if (hasNonUpdatablePattern) {
        console.log(`Skipping non-updatable column ID pattern: ${columnTitle} (${column.id})`);
        continue;
      }

      // Skip empty or null values
      if (newValue === null || newValue === undefined || newValue === '') {
        console.log(`Skipping empty value for column: ${columnTitle}`);
        continue;
      }

      // Debug: Log column info before formatting
      console.log(`Debug: Formatting column "${columnTitle}" (ID: ${column.id}, Type: ${column.type}) with value:`, newValue);

      // Format the value based on column type
      const formattedValue = monday.formatColumnValue(column.type, newValue, column.settings, column.id);

      // Debug: Log formatted value
      console.log(`Debug: Formatted value for "${columnTitle}":`, JSON.stringify(formattedValue));

      // Validate formatted value
      if (formattedValue === null || formattedValue === undefined) {
        console.log(`Skipping null formatted value for column: ${columnTitle}`);
        continue;
      }

      // Special validation for people columns - ensure IDs are valid
      if (column.type === 'people' && formattedValue.personsAndTeams) {
        const validPersons = formattedValue.personsAndTeams.filter(person => {
          const isValid = person.id && !isNaN(person.id) && person.id !== null;
          if (!isValid) {
            console.warn(`Skipping invalid person ID in ${columnTitle}:`, person.id);
          }
          return isValid;
        });

        if (validPersons.length === 0) {
          console.log(`Skipping people column with no valid IDs: ${columnTitle}`);
          continue;
        }

        formattedValue.personsAndTeams = validPersons;
      }

      // Special validation for status columns - ensure label is not empty
      if ((column.type === 'status' || column.type === 'color') && formattedValue.label === '') {
        console.log(`Skipping status column with empty label: ${columnTitle}`);
        continue;
      }

      // Special validation for status/color columns - ensure label exists in column settings
      if ((column.type === 'status' || column.type === 'color') && formattedValue.label) {
        if (column.settings && column.settings.labels) {
          // Check if the label exists in the available labels
          const labelExists = Object.values(column.settings.labels).includes(formattedValue.label);
          if (!labelExists) {
            console.warn(`Skipping status column '${columnTitle}' - label '${formattedValue.label}' has been deactivated or doesn't exist in column settings`);
            console.warn(`Available labels for ${columnTitle}:`, Object.values(column.settings.labels));
            continue;
          }
        }
      }

      // Special validation for dropdown columns - ensure ids are not empty
      if (column.type === 'dropdown' && formattedValue.ids && formattedValue.ids.length === 0) {
        console.log(`Skipping dropdown column with no selected ids: ${columnTitle}`);
        continue;
      }

      columnValues[column.id] = formattedValue;
    }

    console.log('Debug Updating item:', itemId, 'with values:', JSON.stringify(columnValues));

    // Update item name first if it was changed (requires separate API call)
    if (newItemName) {
      console.log(`Updating item name to: "${newItemName}"`);
      const nameResult = updateMondayItemName(boardId, itemId, newItemName);
      if (!nameResult.success) {
        console.error('Failed to update item name:', nameResult.error);
      } else {
        console.log('Item name updated successfully');
      }
    }

    // Check if we have any other column values to update
    if (Object.keys(columnValues).length === 0) {
      console.log('No other columns to update');
      return { success: true, message: newItemName ? 'Name updated' : 'No columns to update' };
    }

    // Update other columns using the Monday API
    const result = monday.updateMultipleColumns(boardId, itemId, columnValues);

    // Full sync of the board from Monday.com to spreadsheet after item update
    // This ensures fresh data is available for the UI
    // Uses global constants from main.gs
    try {
      if (boardId === MARKETING_APPROVAL_BOARD_ID) {
        console.log('Syncing Marketing Approval board after item update...');
        syncMarketingApprovalBoard();
        console.log('Marketing Approval board sync complete');
      } else if (boardId === MARKETING_CALENDAR_BOARD_ID) {
        console.log('Syncing Marketing Calendar board after item update...');
        syncMarketingCalendarBoard();
        console.log('Marketing Calendar board sync complete');
      } else if (boardId === APPROVALS_2026_BOARD_ID) {
        console.log('Syncing 2026 Approvals board after item update...');
        sync2026ApprovalsBoard();
        clear2026ApprovalsCaches();
        console.log('2026 Approvals board sync and cache clear complete');
      } else if (GW_BOARD_IDS.includes(boardId)) {
        // Sync only the specific GW board that was affected
        console.log(`Syncing single GW board ${boardId} after item update...`);
        // Add a short delay to allow Monday to process the update (eventual consistency)
        Utilities.sleep(1500);
        syncSingleGWBoard(boardId);
        // GWMondayData auto-updates via formula
        // Clear internal activity caches so UI gets fresh data
        clearInternalActivityCaches();
        console.log('GW board sync and cache clear complete');
      } else if (boardId === PARTNER_BOARD_ID) {
        // For partner board, sync just the partner activities
        console.log('Syncing Partner Activities board after item update...');
        syncPartnerActivitiesData();
        console.log('Partner Activities sync complete');
      }
    } catch (syncError) {
      // Log sync error but don't fail the update
      console.error('Error syncing board after item update:', syncError);
    }

    return { success: true, result: DataService.ensureSerializable(result) };

  } catch (error) {
    console.error('Update error:', error);
    return { success: false, error: String(error.message) };
  }
}

/**
 * Update Monday item columns using direct column IDs (pre-formatted values)
 * Use this when you have column IDs as keys and properly formatted values
 * @param {string} boardId - Monday board ID
 * @param {string} itemId - Monday item ID
 * @param {Object} columnValues - Object with column IDs as keys and pre-formatted values
 * @returns {Object} Success/error result
 */
function updateMondayItemDirectColumns(boardId, itemId, columnValues) {
  try {
    const monday = new MondayAPI();

    console.log('updateMondayItemDirectColumns called with:', {
      boardId,
      itemId,
      columnValues: JSON.stringify(columnValues)
    });

    if (!columnValues || Object.keys(columnValues).length === 0) {
      console.log('No column values to update');
      return { success: true, message: 'No columns to update' };
    }

    const graphqlQuery = `
      mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          board_id: $boardId,
          item_id: $itemId,
          column_values: $columnValues
        ) {
          id
        }
      }
    `;

    const result = monday.query(graphqlQuery, {
      boardId: String(boardId),
      itemId: String(itemId),
      columnValues: JSON.stringify(columnValues)
    });

    console.log('Update result:', JSON.stringify(result));
    return { success: true, result: DataService.ensureSerializable(result) };

  } catch (error) {
    console.error('updateMondayItemDirectColumns error:', error);
    return { success: false, error: String(error.message || error) };
  }
}

/**
 * Fetch a single item from Monday.com by item ID
 * Returns fresh data directly from Monday, not from the cached sheet
 * @param {string} boardId - Monday board ID
 * @param {string} itemId - Monday item ID
 * @returns {Object} Item data with all column values
 */
function getMondayItemById(boardId, itemId) {
  try {
    const monday = new MondayAPI();

    console.log('Fetching item from Monday:', { boardId, itemId });

    const graphqlQuery = `
      query GetItem($boardId: [ID!]!, $itemId: [ID!]!) {
        boards(ids: $boardId) {
          items_page(limit: 1, query_params: { ids: $itemId }) {
            items {
              id
              name
              group {
                id
                title
              }
              column_values {
                id
                type
                text
                value
              }
            }
          }
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;

    const result = monday.query(graphqlQuery, {
      boardId: [String(boardId)],
      itemId: [String(itemId)]
    });

    if (!result || !result.data || !result.data.boards || result.data.boards.length === 0) {
      console.error('Failed to fetch item - no board data');
      return { success: false, error: 'Board not found' };
    }

    const board = result.data.boards[0];
    const items = board.items_page?.items || [];

    if (items.length === 0) {
      console.error('Item not found:', itemId);
      return { success: false, error: 'Item not found' };
    }

    const item = items[0];
    const columns = board.columns || [];

    // Build a column ID to title map
    const columnMap = {};
    columns.forEach(col => {
      columnMap[col.id] = col.title;
    });

    // Convert column values to a readable format
    const itemData = {
      'Monday Item ID': item.id,
      'Board ID': String(boardId),
      'Item Name': item.name,
      'Name': item.name,
      'Group': item.group?.title || ''
    };

    // Process each column value
    item.column_values.forEach(cv => {
      const title = columnMap[cv.id] || cv.id;
      // Use text representation for display
      itemData[title] = cv.text || '';
    });

    console.log('Fetched item data:', JSON.stringify(itemData));
    return { success: true, item: DataService.ensureSerializable(itemData) };

  } catch (error) {
    console.error('getMondayItemById error:', error);
    return { success: false, error: String(error.message || error) };
  }
}

/**
 * Update item name (exposed to client)
 * Per Monday API docs, item name must be updated via change_multiple_column_values
 * with a JSON string: {"name": "New Name"}
 */
function updateMondayItemName(boardId, itemId, newName) {
  try {
    const monday = new MondayAPI();

    // Use change_multiple_column_values with JSON format for the name column
    // This is the documented way to update item names in Monday.com API
    const graphqlQuery = `
      mutation UpdateItemName($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          board_id: $boardId,
          item_id: $itemId,
          column_values: $columnValues
        ) {
          id
          name
        }
      }
    `;

    // Name must be passed as JSON object with "name" key
    const columnValues = { name: String(newName) };
    console.log(`Updating item ${itemId} name to: "${newName}" via change_multiple_column_values`);

    const result = monday.query(graphqlQuery, {
      boardId: String(boardId),
      itemId: String(itemId),
      columnValues: JSON.stringify(columnValues)
    });

    return { success: true, result: DataService.ensureSerializable(result) };
  } catch (error) {
    console.error('Update item name error:', error);
    return { success: false, error: String(error.message) };
  }
}

/**
 * Get partner names from Partner sheet Account Name column (exposed to client)
 * Reads the Account Name column from the Partner sheet
 */
function getPartnerNamesFromSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Partner');

    if (!sheet) {
      console.warn('Partner sheet not found');
      return [];
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      return [];
    }

    // Get header row to find Account Name column
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const accountNameIndex = headers.indexOf('Account Name');

    if (accountNameIndex === -1) {
      console.warn('Account Name column not found in Partner sheet. Available columns:', headers.join(', '));
      // Fallback to column A if Account Name not found
      const range = sheet.getRange('A2:A' + lastRow);
      const values = range.getValues();
      return values
        .map(row => row[0])
        .filter(name => name && String(name).trim() !== '')
        .map(name => String(name).trim())
        .sort();
    }

    // Get values from Account Name column (column index is 0-based, range is 1-based)
    const range = sheet.getRange(2, accountNameIndex + 1, lastRow - 1, 1);
    const values = range.getValues();

    // Filter out empty values, flatten, and sort
    const partnerNames = values
      .map(row => row[0])
      .filter(name => name && String(name).trim() !== '')
      .map(name => String(name).trim())
      .sort();

    console.log(`Loaded ${partnerNames.length} partner names from Partner sheet Account Name column`);
    return partnerNames;
  } catch (error) {
    console.error('Error getting partner names from sheet:', error);
    return [];
  }
}

/**
 * Get alliance manager names from TechAllianceManager sheet (A2:A)
 */
function getAllianceManagerNamesFromSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('TechAllianceManager');

    if (!sheet) {
      console.warn('TechAllianceManager sheet not found');
      return [];
    }

    // Get values from A2 down to the last row with data
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }

    const range = sheet.getRange('A2:A' + lastRow);
    const values = range.getValues();

    // Filter out empty values and flatten
    const managerNames = values
      .map(row => row[0])
      .filter(name => name && String(name).trim() !== '')
      .map(name => String(name).trim());

    return managerNames;
  } catch (error) {
    console.error('Error getting alliance manager names from sheet:', error);
    return [];
  }
}

/**
 * Get unique partner names from a board's Partner column (exposed to client)
 */
function getPartnerNamesFromBoard(boardId) {
  try {
    const monday = new MondayAPI();

    // Query to get board items with column values
    const graphqlQuery = `
      query GetBoardPartners($boardId: ID!) {
        boards(ids: [$boardId]) {
          items_page(limit: 500) {
            items {
              column_values {
                id
                type
                text
              }
            }
          }
          columns {
            id
            title
            type
          }
        }
      }
    `;

    const result = monday.query(graphqlQuery, { boardId: boardId });

    if (!result.boards || result.boards.length === 0) {
      console.log('No board found for ID:', boardId);
      return [];
    }

    const board = result.boards[0];
    const columns = board.columns;

    // Find the Partner column ID (look only for "Partner", not "Partner Name")
    const partnerColumn = columns.find(col => col.title === 'Partner');

    if (!partnerColumn) {
      console.log('No Partner column found in board:', boardId);
      console.log('Available columns:', columns.map(c => c.title).join(', '));
      return [];
    }

    console.log('Found Partner column:', partnerColumn.title, 'ID:', partnerColumn.id);

    // Extract partner names from items
    const partnerNames = new Set();

    board.items_page.items.forEach(item => {
      const partnerValue = item.column_values.find(cv => cv.id === partnerColumn.id);
      if (partnerValue && partnerValue.text) {
        const partnerName = partnerValue.text.trim();
        if (partnerName && partnerName !== '') {
          partnerNames.add(partnerName);
        }
      }
    });

    const resultArray = Array.from(partnerNames).sort();
    console.log(`Extracted ${resultArray.length} unique partner names from board ${boardId}`);

    return resultArray;
  } catch (error) {
    console.error('Error getting partner names from board:', error);
    return [];
  }
}

/**
 * Create a new item in Monday.com (exposed to client)
 */
function createMondayItem(boardId, itemName, columnValues, columnMetadata) {
  try {
    console.log('=== CREATE MONDAY ITEM START ===');
    console.log('Board ID:', boardId);
    console.log('Item Name:', itemName);
    console.log('Column Values:', JSON.stringify(columnValues));
    console.log('Column Metadata Count:', columnMetadata ? columnMetadata.length : 0);

    // Calculate Month and Week from Event Date if present
    if (columnValues && (columnValues['EventDate'] || columnValues['Event Date'])) {
      const eventDateValue = columnValues['EventDate'] || columnValues['Event Date'];
      console.log('Event Date found:', eventDateValue);

      try {
        const eventDate = new Date(eventDateValue);

        if (!isNaN(eventDate.getTime())) {
          // Calculate Month (full month name)
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                             'July', 'August', 'September', 'October', 'November', 'December'];
          const monthName = monthNames[eventDate.getMonth()];
          columnValues['Month'] = monthName;
          console.log('Calculated Month:', monthName);

          // Calculate Week (1-5 based on which week of the month)
          const dayOfMonth = eventDate.getDate();
          const weekNumber = Math.ceil(dayOfMonth / 7);
          columnValues['Week'] = String(weekNumber);
          console.log('Calculated Week:', weekNumber);
        } else {
          console.warn('Invalid Event Date format:', eventDateValue);
        }
      } catch (dateError) {
        console.error('Error parsing Event Date:', dateError);
      }
    }

    const monday = new MondayAPI();

    // First, create the item with just the name
    console.log('Creating item with name only...');
    const createMutation = `
      mutation CreateItem($boardId: ID!, $itemName: String!) {
        create_item(board_id: $boardId, item_name: $itemName) {
          id
        }
      }
    `;

    const createResult = monday.query(createMutation, {
      boardId: String(boardId),
      itemName: String(itemName)
    });

    console.log('Create result:', JSON.stringify(createResult));

    if (!createResult || !createResult.create_item) {
      console.error('Failed to create item - no data returned');
      console.error('Create result:', JSON.stringify(createResult));
      return { success: false, error: 'Failed to create item' };
    }

    const newItemId = createResult.create_item.id;
    console.log('Successfully created item with ID:', newItemId);

    // If there are column values to set, update them
    if (columnValues && Object.keys(columnValues).length > 0) {
      console.log('Formatting column values for new item...');
      // Format column values by column ID with same validation as update
      const formattedValues = {};

      // Non-updatable column types
      const nonUpdatableTypes = ['formula', 'mirror', 'board-relation', 'dependency', 'file', 'subtasks', 'auto-number'];

      // Non-updatable column ID patterns
      const nonUpdatablePatterns = ['formula_', 'files_', 'subtasks_', 'subitems', 'link_to_item'];

      Object.keys(columnValues).forEach(columnTitle => {
        const column = columnMetadata.find(col => col.title === columnTitle);
        if (!column) {
          console.warn(`Column not found in metadata: ${columnTitle}`);
          return;
        }

        // Skip non-updatable column types
        if (nonUpdatableTypes.includes(column.type)) {
          console.log(`Skipping non-updatable column type: ${columnTitle} (${column.type})`);
          return;
        }

        // Skip columns with non-updatable ID patterns
        const hasNonUpdatablePattern = nonUpdatablePatterns.some(pattern => column.id.includes(pattern));
        if (hasNonUpdatablePattern) {
          console.log(`Skipping non-updatable column pattern: ${columnTitle} (${column.id})`);
          return;
        }

        const value = columnValues[columnTitle];

        // Skip empty or null values
        if (value === null || value === undefined || value === '') {
          console.log(`Skipping empty value for column: ${columnTitle}`);
          return;
        }

        console.log(`Debug: Formatting column "${columnTitle}" (ID: ${column.id}, Type: ${column.type}) with value:`, value);

        const formattedValue = monday.formatColumnValue(
          column.type,
          value,
          column.settings || {},
          column.id
        );

        console.log(`Debug: Formatted value for "${columnTitle}":`, JSON.stringify(formattedValue));

        // Validate formatted value
        if (formattedValue === null || formattedValue === undefined) {
          console.log(`Skipping column ${columnTitle} - formatted value is null/undefined`);
          return;
        }

        // Special validation for people columns - ensure IDs are valid
        if (column.type === 'people' && formattedValue.personsAndTeams) {
          const validPersons = formattedValue.personsAndTeams.filter(person => {
            return person.id && !isNaN(person.id) && person.id !== null;
          });

          if (validPersons.length === 0) {
            console.log(`Skipping people column ${columnTitle} - no valid person IDs`);
            return;
          }

          formattedValue.personsAndTeams = validPersons;
        }

        // Special validation for status/color columns - ensure index is valid
        // NOTE: We now use formattedValue.index instead of formattedValue.label (fix for deactivated label bug)
        if ((column.type === 'status' || column.type === 'color') && formattedValue.index !== undefined) {
          if (column.settings && column.settings.labels) {
            // Check if the index exists in the available labels
            const labelExists = column.settings.labels[formattedValue.index] !== undefined;
            if (!labelExists) {
              console.warn(`Skipping status column '${columnTitle}' during create - index '${formattedValue.index}' doesn't exist`);
              return;
            }
          }
        }

        // Special validation for dropdown columns - ensure ids are not empty
        if (column.type === 'dropdown' && formattedValue.ids && formattedValue.ids.length === 0) {
          console.log(`Skipping dropdown column ${columnTitle} - no valid IDs`);
          return;
        }

        formattedValues[column.id] = formattedValue;
        console.log(`Added formatted value for column ${columnTitle}`);
      });

      if (Object.keys(formattedValues).length > 0) {
        console.log(`Updating ${Object.keys(formattedValues).length} columns for new item...`);
        console.log('Formatted values:', JSON.stringify(formattedValues));

        // updateMultipleColumns handles JSON.stringify internally
        const updateResult = monday.updateMultipleColumns(boardId, newItemId, formattedValues);
        console.log('Column update result:', JSON.stringify(updateResult));
        console.log('Created item and updated columns:', newItemId);
      } else {
        console.log('No columns to update - item created with name only');
      }
    }

    console.log('=== CREATE MONDAY ITEM SUCCESS ===');
    console.log('New Item ID:', newItemId);

    // Send email notifications for Marketing boards
     // Send email notifications for Marketing boards
    try {
      const MARKETING_APPROVAL_BOARD_ID = '9710279044';
      const MARKETING_CALENDAR_BOARD_ID = '9770467355';

      if (boardId === MARKETING_APPROVAL_BOARD_ID) {
        console.log('Triggering Marketing Approval notification email...');
        const emailResult = sendMarketingApprovalNotification({
          itemName: itemName,
          columnValues: columnValues,
          boardId: boardId,
          itemId: newItemId
        });

        if (emailResult.success) {
          console.log('Marketing Approval notification email sent successfully');
        } else {
          console.error('Failed to send Marketing Approval notification:', emailResult.error);
        }
      } else if (boardId === MARKETING_CALENDAR_BOARD_ID) {
        console.log('Triggering Marketing Calendar notification email...');
        const emailResult = sendMarketingCalendarNotification({
          itemName: itemName,
          columnValues: columnValues,
          boardId: boardId,
          itemId: newItemId
        });

        if (emailResult.success) {
          console.log('Marketing Calendar notification email sent successfully');
        } else {
          console.error('Failed to send Marketing Calendar notification:', emailResult.error);
        }
      } else if (boardId === APPROVALS_2026_BOARD_ID) {
        console.log('Triggering 2026 Approvals notification email...');
        const emailResult = send2026ApprovalsNotification({
          itemName: itemName,
          columnValues: columnValues,
          boardId: boardId,
          itemId: newItemId
        });

        if (emailResult.success) {
          console.log('2026 Approvals notification email sent successfully');
        } else {
          console.error('Failed to send 2026 Approvals notification:', emailResult.error);
        }
      }
    } catch (emailError) {
      // Log email error but don't fail the item creation
      console.error('Error sending notification email:', emailError);
      console.error('Item was created successfully, but email notification failed');
    }

    // Full sync of the board from Monday.com to spreadsheet after item creation
    // This ensures fresh data is available for the UI
    // Uses global constants from main.gs
    try {
      if (boardId === MARKETING_APPROVAL_BOARD_ID) {
        console.log('Syncing Marketing Approval board after item creation...');
        syncMarketingApprovalBoard();
        console.log('Marketing Approval board sync complete');
      } else if (boardId === MARKETING_CALENDAR_BOARD_ID) {
        console.log('Syncing Marketing Calendar board after item creation...');
        syncMarketingCalendarBoard();
        console.log('Marketing Calendar board sync complete');
      } else if (boardId === APPROVALS_2026_BOARD_ID) {
        console.log('Syncing 2026 Approvals board after item creation...');
        sync2026ApprovalsBoard();
        clear2026ApprovalsCaches();
        console.log('2026 Approvals board sync and cache clear complete');
      } else if (GW_BOARD_IDS.includes(boardId)) {
        // Sync only the specific GW board that was affected
        console.log(`Syncing single GW board ${boardId} after item creation...`);
        // Add a short delay to allow Monday to process the creation (eventual consistency)
        Utilities.sleep(1500);
        syncSingleGWBoard(boardId);
        // GWMondayData auto-updates via formula
        // Clear internal activity caches so UI gets fresh data
        clearInternalActivityCaches();
        console.log('GW board sync and cache clear complete');
      } else if (boardId === PARTNER_BOARD_ID) {
        // For partner board, sync just the partner activities
        console.log('Syncing Partner Activities board after item creation...');
        syncPartnerActivitiesData();
        console.log('Partner Activities sync complete');
      }
    } catch (syncError) {
      // Log sync error but don't fail the item creation
      console.error('Error syncing board after item creation:', syncError);
      console.error('Item was created in Monday.com, but board sync failed');
    }

    return { success: true, itemId: newItemId };
  } catch (error) {
    console.error('=== CREATE MONDAY ITEM ERROR ===');
    console.error('Error:', error);
    console.error('Stack trace:', error.stack);
    return { success: false, error: String(error.message) };
  }
}

/**
 * SIMPLEST MIGRATION FUNCTION - NO PARAMETERS NEEDED
 * Migrates partner names from Monday.com short names to Salesforce full names
 *
 * Reads translations from PartnerTranslate sheet (From -> To columns)
 * Updates Partner fields in Marketing Calendar and GW boards
 *
 * Usage: Just run migratePartnerNames() from Apps Script editor
 */
function migratePartnerNames() {
  console.log('=== PARTNER NAME MIGRATION START ===');

  // Hardcoded board configurations - update these if needed
  const configs = [
    { boardId: '9770467355', columnTitle: 'Partner' },       // Marketing Calendar
    { boardId: '9791255941', columnTitle: 'Partner Name' },  // GW Board 1
    { boardId: '9791272390', columnTitle: 'Partner Name' }   // GW Board 2
  ];

  console.log('Processing boards:');
  configs.forEach(c => console.log(`  - Board ${c.boardId}, Column: ${c.columnTitle}`));

  const report = {
    success: true,
    translationMap: {},
    boardResults: [],
    totalItemsScanned: 0,
    totalItemsUpdated: 0,
    totalItemsFailed: 0,
    errors: []
  };

  try {
    // Step 1: Read PartnerTranslate sheet
    console.log('\nStep 1: Reading PartnerTranslate sheet...');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const translateSheet = ss.getSheetByName('PartnerTranslate');

    if (!translateSheet) {
      throw new Error('PartnerTranslate sheet not found');
    }

    const lastRow = translateSheet.getLastRow();
    if (lastRow < 2) {
      throw new Error('PartnerTranslate sheet has no data');
    }

    // Get headers and find From/To columns
    const headers = translateSheet.getRange(1, 1, 1, translateSheet.getLastColumn()).getValues()[0];
    const fromColIndex = headers.indexOf('From');
    const toColIndex = headers.indexOf('To');

    if (fromColIndex === -1 || toColIndex === -1) {
      throw new Error('PartnerTranslate sheet must have "From" and "To" columns');
    }

    // Build translation map
    const data = translateSheet.getRange(2, 1, lastRow - 1, translateSheet.getLastColumn()).getValues();
    data.forEach(row => {
      const fromName = row[fromColIndex];
      const toName = row[toColIndex];

      if (!fromName || !toName ||
          String(fromName).trim() === '' ||
          String(toName).trim() === '') {
        return;
      }

      const fromKey = String(fromName).trim();
      const toValue = String(toName).trim();
      report.translationMap[fromKey] = toValue;
      console.log(`  "${fromKey}" -> "${toValue}"`);
    });

    console.log(`\nBuilt translation map with ${Object.keys(report.translationMap).length} entries`);

    if (Object.keys(report.translationMap).length === 0) {
      throw new Error('No valid translations found');
    }

    // Step 2: Process each board
    const monday = new MondayAPI();

    for (const config of configs) {
      console.log(`\n=== Processing Board ${config.boardId}, Column: ${config.columnTitle} ===`);

      const boardResult = {
        boardId: config.boardId,
        columnTitle: config.columnTitle,
        itemsScanned: 0,
        itemsUpdated: 0,
        itemsFailed: 0,
        updates: [],
        errors: []
      };

      try {
        // First, get board columns to find the partner column ID
        console.log('Getting board columns...');
        const columnsQuery = `
          query GetBoardColumns($boardId: ID!) {
            boards(ids: [$boardId]) {
              columns {
                id
                title
                type
              }
            }
          }
        `;

        const columnsResult = monday.query(columnsQuery, { boardId: String(config.boardId) });

        if (!columnsResult.boards || !columnsResult.boards[0]) {
          throw new Error('Failed to fetch board columns');
        }

        const partnerColumn = columnsResult.boards[0].columns.find(col => col.title === config.columnTitle);

        if (!partnerColumn) {
          throw new Error(`Column "${config.columnTitle}" not found on board`);
        }

        console.log(`Found partner column: ${partnerColumn.title} (ID: ${partnerColumn.id}, Type: ${partnerColumn.type})`);

        // Now get all items with their column values
        console.log('Fetching board items...');
        const itemsQuery = `
          query GetBoardItems($boardId: ID!) {
            boards(ids: [$boardId]) {
              items_page(limit: 500) {
                items {
                  id
                  name
                  column_values {
                    id
                    text
                  }
                }
              }
            }
          }
        `;

        const itemsResult = monday.query(itemsQuery, { boardId: String(config.boardId) });

        if (!itemsResult.boards || !itemsResult.boards[0] || !itemsResult.boards[0].items_page) {
          throw new Error('Failed to fetch board items');
        }

        const items = itemsResult.boards[0].items_page.items;
        console.log(`Found ${items.length} items`);

        // Process each item
        for (const item of items) {
          boardResult.itemsScanned++;
          report.totalItemsScanned++;

          // Find the partner column value by matching column ID
          const partnerValue = item.column_values.find(col => col.id === partnerColumn.id);

          if (!partnerValue) {
            console.log(`Item ${item.id} (${item.name}): Partner column not found`);
            continue;
          }

          const currentPartnerName = partnerValue.text;

          // Skip if blank
          if (!currentPartnerName || String(currentPartnerName).trim() === '') {
            console.log(`Item ${item.id} (${item.name}): Partner is blank, skipping`);
            continue;
          }

          const trimmedPartnerName = String(currentPartnerName).trim();
          const newPartnerName = report.translationMap[trimmedPartnerName];

          // Skip if not in translation map
          if (!newPartnerName) {
            console.log(`Item ${item.id} (${item.name}): Partner "${trimmedPartnerName}" not in translation map, skipping`);
            continue;
          }

          // Skip if already correct
          if (trimmedPartnerName === newPartnerName) {
            console.log(`Item ${item.id} (${item.name}): Partner "${trimmedPartnerName}" already correct, skipping`);
            continue;
          }

          // Update the item
          console.log(`Item ${item.id} (${item.name}): Updating "${trimmedPartnerName}" -> "${newPartnerName}"`);

          try {
            const updateMutation = `
              mutation UpdateColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
                change_simple_column_value(
                  board_id: $boardId,
                  item_id: $itemId,
                  column_id: $columnId,
                  value: $value
                ) {
                  id
                }
              }
            `;

            const updateResult = monday.query(updateMutation, {
              boardId: String(config.boardId),
              itemId: String(item.id),
              columnId: partnerColumn.id,
              value: newPartnerName
            });

            if (updateResult.change_simple_column_value) {
              boardResult.itemsUpdated++;
              report.totalItemsUpdated++;
              boardResult.updates.push({
                itemId: item.id,
                itemName: item.name,
                oldValue: trimmedPartnerName,
                newValue: newPartnerName
              });
              console.log(`✓ Successfully updated item ${item.id}`);
            } else {
              throw new Error('Update returned no result');
            }
          } catch (updateError) {
            boardResult.itemsFailed++;
            report.totalItemsFailed++;
            const errorMsg = `Failed to update item ${item.id}: ${updateError.message}`;
            console.error(errorMsg);
            boardResult.errors.push(errorMsg);
            report.errors.push(errorMsg);
          }
        }

        report.boardResults.push(boardResult);
        console.log(`Board ${config.boardId}: ${boardResult.itemsUpdated} updated, ${boardResult.itemsFailed} failed, ${boardResult.itemsScanned} scanned`);

      } catch (boardError) {
        const errorMsg = `Error processing board ${config.boardId}: ${boardError.message}`;
        console.error(errorMsg);
        boardResult.errors.push(errorMsg);
        report.errors.push(errorMsg);
        report.boardResults.push(boardResult);
      }
    }

    console.log('\n=== MIGRATION COMPLETE ===');
    console.log(`Total: ${report.totalItemsUpdated} updated, ${report.totalItemsFailed} failed, ${report.totalItemsScanned} scanned`);

    if (report.errors.length > 0) {
      console.error('\nErrors:', report.errors);
    }

    return report;

  } catch (error) {
    console.error('\n=== MIGRATION ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    report.success = false;
    report.errors.push(error.message);
    return report;
  }
}

/**
 * Sync Marketing Approval Board from Monday to Google Sheets
 * Exposed function that can be called from the UI
 */
function syncMarketingApprovalBoard() {
  try {
    console.log('Starting Marketing Approval Board sync...');

    // Use the global constants from main.gs
    const boardId = MARKETING_APPROVAL_BOARD_ID;  // '9710279044'
    const targetSheetName = MARKETING_APPROVAL_SHEET_NAME || 'MarketingApproval';

    console.log(`Using board ID: ${boardId}, target sheet: ${targetSheetName}`);

    // Get or create the target sheet
    const targetSheet = getOrCreateSheet(targetSheetName);

    // Clear existing data from row 2 onwards
    clearSheetData(targetSheet);

    // Get board structure (columns)
    console.log('Fetching board structure...');
    const boardStructure = getBoardStructure(boardId);
    console.log('Board name:', boardStructure.name);
    console.log('Number of columns:', boardStructure.columns.length);

    // Get all items from the board
    const items = getAllBoardItems(boardId);
    console.log(`Items retrieved: ${items.length}`);

    // Process and write data to sheet
    if (items.length > 0) {
      items.forEach(item => {
        item.boardName = 'Marketing Events Approval Requests';
        item.boardId = boardId;
      });

      writeDataToSheet(targetSheet, boardStructure, items, true, {
        boardName: 'Marketing Events Approval Requests',
        boardId: boardId,
        targetSheetName: targetSheetName
      });
      console.log(`Data successfully written to ${targetSheetName}`);
    } else {
      console.log('No items found on board');
    }

    // Clear marketing approval caches after sync to ensure fresh data
    console.log('Clearing marketing approval caches...');
    clearMarketingApprovalCaches();

    console.log('Marketing Approval Board sync complete');
    return { success: true, itemCount: items.length };

  } catch (error) {
    console.error('Error syncing Marketing Approval Board:', error);
    throw error;
  }
}

/**
 * Sync Marketing Calendar Board from Monday to Google Sheets
 * Exposed function that can be called from the UI
 */
function syncMarketingCalendarBoard() {
  try {
    console.log('Starting Marketing Calendar Board sync...');

    // Use the global constants from main.gs
    const boardId = MARKETING_CALENDAR_BOARD_ID;  // '9770467355'
    const targetSheetName = MARKETING_CALENDAR_SHEET_NAME || 'MarketingCalendar';

    console.log(`Using board ID: ${boardId}, target sheet: ${targetSheetName}`);

    // Get or create the target sheet
    const targetSheet = getOrCreateSheet(targetSheetName);

    // Clear existing data from row 2 onwards
    clearSheetData(targetSheet);

    // Get board structure (columns)
    console.log('Fetching board structure...');
    const boardStructure = getBoardStructure(boardId);
    console.log('Board name:', boardStructure.name);
    console.log('Number of columns:', boardStructure.columns.length);

    // Get all items from the board
    const items = getAllBoardItems(boardId);
    console.log(`Items retrieved: ${items.length}`);

    // Process and write data to sheet
    if (items.length > 0) {
      items.forEach(item => {
        item.boardName = 'Marketing Event Calendar';
        item.boardId = boardId;
      });

      writeDataToSheet(targetSheet, boardStructure, items, true, {
        boardName: 'Marketing Event Calendar',
        boardId: boardId,
        targetSheetName: targetSheetName
      });
      console.log(`Data successfully written to ${targetSheetName}`);
    } else {
      console.log('No items found on board');
    }

    // Clear marketing calendar caches after sync to ensure fresh data
    console.log('Clearing marketing calendar caches...');
    clearMarketingCalendarCaches();

    console.log('Marketing Calendar Board sync complete');
    return { success: true, itemCount: items.length };

  } catch (error) {
    console.error('Error syncing Marketing Calendar Board:', error);
    throw error;
  }
}

/**
 * Sync 2026 Approvals Board from Monday to Google Sheets
 * Exposed function that can be called from the UI
 */
function sync2026ApprovalsBoard() {
  try {
    console.log('=== sync2026ApprovalsBoard START ===');

    // Use the global constants from main.gs
    const boardId = APPROVALS_2026_BOARD_ID;  // '18389979949'
    const targetSheetName = APPROVALS_2026_SHEET_NAME || 'Approvals2026';

    console.log(`Board ID: ${boardId}`);
    console.log(`Target sheet name: ${targetSheetName}`);

    // Get or create the target sheet
    console.log('Getting or creating target sheet...');
    const targetSheet = getOrCreateSheet(targetSheetName);
    console.log(`Target sheet obtained: ${targetSheet.getName()}`);

    // Clear existing data from row 2 onwards
    console.log('Clearing existing sheet data...');
    clearSheetData(targetSheet);

    // Get board structure (columns)
    console.log('Fetching board structure from Monday.com...');
    const boardStructure = getBoardStructure(boardId);
    console.log('Board name from Monday:', boardStructure.name);
    console.log('Number of columns:', boardStructure.columns.length);
    console.log('Column names:', boardStructure.columns.map(c => c.title).join(', '));

    // Get all items from the board
    console.log('Fetching all items from Monday board...');
    const items = getAllBoardItems(boardId);
    console.log(`Items retrieved from Monday: ${items.length}`);

    if (items.length > 0) {
      console.log('Sample item from Monday:', JSON.stringify(items[0], null, 2));
    }

    // Process and write data to sheet
    if (items.length > 0) {
      console.log('Processing items for sheet...');
      items.forEach(item => {
        item.boardName = '2026 Approvals';
        item.boardId = boardId;
      });

      console.log('Writing data to sheet...');
      writeDataToSheet(targetSheet, boardStructure, items, true, {
        boardName: '2026 Approvals',
        boardId: boardId,
        targetSheetName: targetSheetName
      });
      console.log(`Data successfully written to ${targetSheetName}`);

      // Verify data was written
      const verifyData = targetSheet.getDataRange().getValues();
      console.log(`Sheet now has ${verifyData.length} rows (including header)`);
    } else {
      console.log('WARNING: No items found on Monday board');
    }

    // Clear 2026 approvals caches after sync to ensure fresh data
    console.log('Clearing 2026 approvals caches...');
    clear2026ApprovalsCaches();

    console.log('=== sync2026ApprovalsBoard END ===');
    return { success: true, itemCount: items.length };

  } catch (error) {
    console.error('ERROR in sync2026ApprovalsBoard:', error);
    console.error('Stack:', error.stack);
    throw error;
  }
}

/**
 * Sync ALL Marketing Boards from Monday to Google Sheets
 * Run this function to populate all marketing-related sheets
 * Includes: Marketing Approval, Marketing Calendar, 2026 Approvals
 */
function syncAllMarketingBoards() {
  console.log('=== syncAllMarketingBoards START ===');

  const results = {
    marketingApproval: null,
    marketingCalendar: null,
    approvals2026: null
  };

  try {
    console.log('1. Syncing Marketing Approval Board...');
    results.marketingApproval = syncMarketingApprovalBoard();
    console.log('   Marketing Approval sync complete:', results.marketingApproval);
  } catch (e) {
    console.error('   Marketing Approval sync failed:', e);
    results.marketingApproval = { success: false, error: e.toString() };
  }

  try {
    console.log('2. Syncing Marketing Calendar Board...');
    results.marketingCalendar = syncMarketingCalendarBoard();
    console.log('   Marketing Calendar sync complete:', results.marketingCalendar);
  } catch (e) {
    console.error('   Marketing Calendar sync failed:', e);
    results.marketingCalendar = { success: false, error: e.toString() };
  }

  try {
    console.log('3. Syncing 2026 Approvals Board...');
    results.approvals2026 = sync2026ApprovalsBoard();
    console.log('   2026 Approvals sync complete:', results.approvals2026);
  } catch (e) {
    console.error('   2026 Approvals sync failed:', e);
    results.approvals2026 = { success: false, error: e.toString() };
  }

  console.log('=== syncAllMarketingBoards END ===');
  console.log('Results:', JSON.stringify(results, null, 2));

  return results;
}

/**
 * Sync Partner Activities (MondayData sheet) from Monday to Google Sheets
 * Exposed function that can be called from the UI
 */
function syncPartnerActivitiesData() {
  try {
    console.log('Starting Partner Activities (MondayData) sync...');
    // Call the main syncMondayData function which handles MondayData sheet
    syncMondayData();
    console.log('Partner Activities sync complete');
    return { success: true };
  } catch (error) {
    console.error('Error syncing Partner Activities:', error);
    throw error;
  }
}

/**
 * Sync Internal Activities (GWMondayData sheet) from Monday to Google Sheets
 * Exposed function that can be called from the UI
 */
function syncInternalActivitiesData() {
  try {
    console.log('Starting Internal Activities (GWMondayData) sync...');
    // Call the syncGuidewireBoards function which handles GWMondayData sheet
    syncGuidewireBoards();
    console.log('Internal Activities sync complete');
    return { success: true };
  } catch (error) {
    console.error('Error syncing Internal Activities:', error);
    throw error;
  }
}

/**
 * Sync a single GW board to its individual sheet tab
 * @param {string} boardId - The GW board ID to sync
 * @param {string} [overrideBoardName] - Optional board name to use instead of hardcoded map
 * @param {string} [overrideSheetName] - Optional sheet name to use instead of hardcoded map
 * @returns {Object} Result with success status
 */
function syncSingleGWBoard(boardId, overrideBoardName, overrideSheetName) {
  try {
    // Use override values if provided, otherwise fall back to hardcoded maps
    const sheetName = overrideSheetName || GW_BOARD_SHEET_MAP[boardId];
    const boardName = overrideBoardName || GW_BOARD_NAME_MAP[boardId];

    if (!sheetName) {
      throw new Error(`Unknown GW board ID: ${boardId}. Please provide sheetName or add to InternalBoards sheet.`);
    }

    console.log(`Syncing GW board ${boardId} (${boardName}) to sheet ${sheetName}...`);

    // Get or create the target sheet
    const targetSheet = getOrCreateSheet(sheetName);

    // Clear existing data from row 2 onwards
    clearSheetData(targetSheet);

    // Get board structure (columns)
    const boardStructure = getBoardStructure(boardId);
    console.log(`Board: ${boardStructure.name}, Columns: ${boardStructure.columns.length}`);

    // Get all items from the board
    const items = getAllBoardItems(boardId);
    console.log(`Items retrieved: ${items.length}`);

    // Process and write data to sheet
    if (items.length > 0) {
      items.forEach(item => {
        item.boardName = boardName;
        item.boardId = boardId;
      });

      console.log(`Writing ${items.length} items to sheet ${sheetName}...`);
      writeDataToSheet(targetSheet, boardStructure, items, true, {
        boardName: boardName,
        boardId: boardId,
        targetSheetName: sheetName
      });

      // Verify data was written
      const rowCount = targetSheet.getLastRow();
      console.log(`Sheet ${sheetName} now has ${rowCount} rows (including header)`);
    }

    // Clear internal activity caches after sync to ensure fresh data
    console.log('Clearing internal activity caches...');
    clearInternalActivityCaches();

    console.log(`GW board ${boardId} sync complete - ${items.length} items`);
    return { success: true, itemCount: items.length };

  } catch (error) {
    console.error(`Error syncing GW board ${boardId}:`, error);
    throw error;
  }
}

/**
 * Set up GWMondayData sheet with a formula that pulls from all individual GW board sheets
 * Now reads dynamically from InternalBoards sheet
 */
function setupGWMondayDataFormula() {
  try {
    console.log('Setting up GWMondayData formula dynamically...');

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const mainSheet = getOrCreateSheet(GW_MONDAY_SHEET_NAME);

    // Get board configurations from InternalBoards sheet
    const boardConfigs = getGuidewireBoardConfigurations();

    if (boardConfigs.length === 0) {
      console.error('No internal boards configured in InternalBoards sheet');
      return { success: false, error: 'No internal boards configured' };
    }

    // Get sheet names from config or generate from board names
    const sheetNames = boardConfigs.map(config => config.sheetName || generateGWSheetName(config.boardName));

    console.log(`Building formula for ${sheetNames.length} sheets: ${sheetNames.join(', ')}`);

    // Clear the sheet first
    mainSheet.clear();

    // Build the formula dynamically
    // First sheet includes headers (A:Z), subsequent sheets skip headers (A2:Z)
    let formulaParts = [];
    sheetNames.forEach((sheetName, index) => {
      if (index === 0) {
        formulaParts.push(`'${sheetName}'!A:Z`);
      } else {
        formulaParts.push(`'${sheetName}'!A2:Z`);
      }
    });

    const formula = `=QUERY({${formulaParts.join(';')}}, "SELECT * WHERE Col1 IS NOT NULL", 1)`;

    mainSheet.getRange('A1').setFormula(formula);

    console.log(`GWMondayData formula set with ${sheetNames.length} sheets - will auto-update when individual sheets change`);
    return { success: true, sheetCount: sheetNames.length };

  } catch (error) {
    console.error('Error setting up GWMondayData formula:', error);
    throw error;
  }
}

/**
 * One-time setup function to create the individual GW board sheets and formula
 * Run this once to set up the new architecture, then use syncGuidewireBoards() for regular syncs
 */
function setupIndividualGWBoardSheets() {
  try {
    console.log('=== Setting up Individual GW Board Sheets ===');

    // Step 1: Sync each GW board to its individual sheet (creates sheets if needed)
    const boardSheets = [
      { boardId: GW_BOARD_1_ID, sheetName: GW_BOARD_1_SHEET, name: 'Partner Management' },
      { boardId: GW_BOARD_2_ID, sheetName: GW_BOARD_2_SHEET, name: 'Solution Ops' },
      { boardId: GW_BOARD_3_ID, sheetName: GW_BOARD_3_SHEET, name: 'Marketing' },
      { boardId: GW_BOARD_4_ID, sheetName: GW_BOARD_4_SHEET, name: 'Compliance' }
    ];

    console.log('Creating/syncing individual GW board sheets...');
    for (const board of boardSheets) {
      console.log(`Setting up ${board.sheetName} for ${board.name}...`);
      syncSingleGWBoard(board.boardId);
    }

    // Step 2: Set up the formula in GWMondayData
    console.log('Setting up GWMondayData formula...');
    setupGWMondayDataFormula();

    console.log('=== Individual GW Board Setup Complete ===');
    console.log('Created sheets: ' + boardSheets.map(b => b.sheetName).join(', '));
    console.log('GWMondayData now auto-aggregates from these sheets via formula');

    return { success: true, sheetsCreated: boardSheets.map(b => b.sheetName) };

  } catch (error) {
    console.error('Error setting up individual GW board sheets:', error);
    throw error;
  }
}

/**
 * Sync all individual GW board sheets
 * GWMondayData auto-updates via formula
 */
function syncAllGWBoardsIndividually() {
  try {
    console.log('=== Syncing all GW boards individually ===');

    // Sync each board to its individual sheet
    for (const boardId of GW_BOARD_IDS) {
      syncSingleGWBoard(boardId);
    }

    // GWMondayData auto-updates via formula set by setupGWMondayDataFormula()
    console.log('=== All GW boards synced (GWMondayData updates automatically) ===');
    return { success: true };

  } catch (error) {
    console.error('Error syncing all GW boards:', error);
    throw error;
  }
}

/**
 * Sync a single partner's board data
 * Deletes all rows for the specified partner from MondayData sheet
 * and syncs only that partner's board from Monday.com
 * @param {string} partnerName - The partner name to sync
 * @returns {Object} Result with success status and sync details
 */
function syncSinglePartnerBoard(partnerName) {
  try {
    console.log(`=== Syncing Single Partner Board: ${partnerName} ===`);

    if (!partnerName || partnerName.trim() === '') {
      throw new Error('Partner name is required');
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // Step 1: Get the board configuration for this partner from MondayDashboard
    const dashboardSheet = spreadsheet.getSheetByName('MondayDashboard');
    if (!dashboardSheet) {
      throw new Error('MondayDashboard sheet not found');
    }

    const headerRow = dashboardSheet.getRange(1, 1, 1, dashboardSheet.getLastColumn()).getValues()[0];
    const partnerNameIndex = headerRow.indexOf('Partner Name');
    const partnerBoardIndex = headerRow.indexOf('PartnerBoard');

    if (partnerNameIndex === -1 || partnerBoardIndex === -1) {
      throw new Error('Required columns (Partner Name, PartnerBoard) not found in MondayDashboard');
    }

    const lastRow = dashboardSheet.getLastRow();
    const dataRange = dashboardSheet.getRange(2, 1, lastRow - 1, dashboardSheet.getLastColumn());
    const dashboardData = dataRange.getValues();

    // Find the partner's board configuration
    let partnerBoardId = null;
    for (const row of dashboardData) {
      const rowPartnerName = row[partnerNameIndex];
      if (rowPartnerName && rowPartnerName.toString().toLowerCase().trim() === partnerName.toLowerCase().trim()) {
        partnerBoardId = row[partnerBoardIndex];
        break;
      }
    }

    if (!partnerBoardId) {
      throw new Error(`Board ID not found for partner: ${partnerName}`);
    }

    console.log(`Found board ID for partner ${partnerName}: ${partnerBoardId}`);

    // Step 2: Delete all rows for this partner from MondayData sheet
    const mondayDataSheet = spreadsheet.getSheetByName('MondayData');
    if (!mondayDataSheet) {
      throw new Error('MondayData sheet not found');
    }

    const mondayDataHeaders = mondayDataSheet.getRange(1, 1, 1, mondayDataSheet.getLastColumn()).getValues()[0];
    const partnerColumnIndex = mondayDataHeaders.indexOf('Partner Name');

    if (partnerColumnIndex === -1) {
      console.log('Partner Name column not found in MondayData, trying Board ID column');
    }

    const boardIdColumnIndex = mondayDataHeaders.indexOf('Board ID');

    // Get all data from MondayData
    const mondayDataLastRow = mondayDataSheet.getLastRow();
    if (mondayDataLastRow > 1) {
      const mondayDataRange = mondayDataSheet.getRange(2, 1, mondayDataLastRow - 1, mondayDataSheet.getLastColumn());
      const mondayDataValues = mondayDataRange.getValues();

      // Find and delete rows that match this partner (delete from bottom to top to preserve row indices)
      const rowsToDelete = [];
      for (let i = mondayDataValues.length - 1; i >= 0; i--) {
        let shouldDelete = false;

        // Check by Partner Name column
        if (partnerColumnIndex !== -1) {
          const rowPartnerName = mondayDataValues[i][partnerColumnIndex];
          if (rowPartnerName && rowPartnerName.toString().toLowerCase().trim() === partnerName.toLowerCase().trim()) {
            shouldDelete = true;
          }
        }

        // Also check by Board ID
        if (!shouldDelete && boardIdColumnIndex !== -1) {
          const rowBoardId = mondayDataValues[i][boardIdColumnIndex];
          if (rowBoardId && rowBoardId.toString() === partnerBoardId.toString()) {
            shouldDelete = true;
          }
        }

        if (shouldDelete) {
          rowsToDelete.push(i + 2); // +2 because data starts at row 2 and i is 0-indexed
        }
      }

      console.log(`Found ${rowsToDelete.length} rows to delete for partner ${partnerName}`);

      // Delete rows from bottom to top
      for (const rowIndex of rowsToDelete) {
        mondayDataSheet.deleteRow(rowIndex);
      }

      console.log(`Deleted ${rowsToDelete.length} rows from MondayData`);
    }

    // Step 3: Sync only this partner's board from Monday.com
    console.log(`Syncing board ${partnerBoardId} for partner ${partnerName}...`);

    // Get board structure
    const boardStructure = getBoardStructure(partnerBoardId);

    // Get all items from the board
    const items = getAllBoardItems(partnerBoardId);

    console.log(`Retrieved ${items.length} items from board ${partnerBoardId}`);

    if (items.length > 0) {
      // Add board info to each item for identification
      items.forEach(item => {
        item.partnerName = partnerName;
        item.boardName = `${partnerName} Board`;
        item.boardId = partnerBoardId;
      });

      // Get the sheet again (in case structure changed)
      const sheet = spreadsheet.getSheetByName('MondayData');

      // Find the last row with data
      const lastDataRow = sheet.getLastRow();

      // Create board config for writeDataToSheet
      const boardConfig = {
        boardName: `${partnerName} Board`,
        partnerName: partnerName,
        boardId: partnerBoardId,
        targetSheetName: 'MondayData'
      };

      // Append data to the sheet (not overwrite - since we only deleted this partner's rows)
      writeDataToSheet(sheet, boardStructure, items, lastDataRow === 1, boardConfig);

      console.log(`Synced ${items.length} items for partner ${partnerName}`);
    }

    console.log(`=== Single Partner Board Sync Complete: ${partnerName} ===`);

    return {
      success: true,
      partnerName: partnerName,
      boardId: partnerBoardId,
      itemsSynced: items.length
    };

  } catch (error) {
    console.error(`Error syncing partner board for ${partnerName}:`, error);
    return {
      success: false,
      partnerName: partnerName,
      error: error.message
    };
  }
}

/**
 * Delete partner activities from MondayData and sync that partner's board
 * This is the function to call when a change is made to a partner board
 * @param {string} partnerName - The partner name whose data should be refreshed
 */
function refreshPartnerData(partnerName) {
  console.log(`Refreshing partner data for: ${partnerName}`);
  return syncSinglePartnerBoard(partnerName);
}
