
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
      const result = JSON.parse(response.getContentText());
      
      if (result.errors) {
        console.error('Monday.com API errors:', result.errors);
        throw new Error(result.errors[0].message);
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
        // Status/color columns - use label name format for better API compatibility
        // Monday.com API accepts both {index: N} and {label: "Name"} but label format is more reliable
        if (settings && settings.labels) {
          const deactivatedLabels = settings.deactivated_labels || [];

          // Find all label IDs that match this label name
          const matchingLabelIds = Object.keys(settings.labels).filter(
            id => settings.labels[id] === value
          );

          // If there are multiple matches, filter out deactivated ones
          if (matchingLabelIds.length > 1) {
            const activeLabelId = matchingLabelIds.find(id => !deactivatedLabels.includes(id));

            if (activeLabelId) {
              console.log(`Debug: Using label "${value}" (ID: ${activeLabelId}, found ${matchingLabelIds.length} matches, ${deactivatedLabels.length} deactivated)`);
              // Use label format for better API compatibility
              return { label: value };
            } else {
              console.warn(`All matching labels for "${value}" are deactivated`);
              return null;
            }
          } else if (matchingLabelIds.length === 1) {
            const labelId = matchingLabelIds[0];
            // Check if this label is deactivated
            if (deactivatedLabels.includes(labelId)) {
              console.warn(`Label "${value}" (ID: ${labelId}) is deactivated`);
              return null;
            }
            // Single match and not deactivated - use label format
            console.log(`Debug: Using label "${value}" (ID: ${labelId}) for status column`);
            return { label: value };
          } else {
            console.warn(`Label "${value}" not found in column settings`);
            return null;
          }
        }
        // Fallback if settings not available - return null to prevent errors
        console.warn(`Status/color column has no settings - cannot format value safely`);
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
 */
function deleteMondayItem(itemId) {
  try {
    const monday = new MondayAPI();
    const result = monday.deleteItem(itemId);
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

    // Create a map of column titles to column info
    const columnMap = {};
    columnMetadata.forEach(col => {
      columnMap[col.title] = col;
    });

    // Build the column values object with proper formatting
    const columnValues = {};

    // Non-updatable column types
    const nonUpdatableTypes = ['formula', 'mirror', 'board-relation', 'dependency', 'file', 'subtasks', 'auto-number'];

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

    // Check if we have any values to update
    if (Object.keys(columnValues).length === 0) {
      console.log('No valid columns to update');
      return { success: true, message: 'No columns to update' };
    }

    // Update using the Monday API
    const result = monday.updateMultipleColumns(boardId, itemId, columnValues);

    return { success: true, result: DataService.ensureSerializable(result) };

  } catch (error) {
    console.error('Update error:', error);
    return { success: false, error: String(error.message) };
  }
}

/**
 * Update item name (exposed to client)
 */
function updateMondayItemName(boardId, itemId, newName) {
  try {
    const monday = new MondayAPI();

    // Use change_simple_column_value for the name column
    const graphqlQuery = `
      mutation UpdateItemName($boardId: ID!, $itemId: ID!, $newName: String!) {
        change_simple_column_value(
          board_id: $boardId,
          item_id: $itemId,
          column_id: "name",
          value: $newName
        ) {
          id
          name
        }
      }
    `;

    const result = monday.query(graphqlQuery, {
      boardId: String(boardId),
      itemId: String(itemId),
      newName: String(newName)
    });

    return { success: true, result: DataService.ensureSerializable(result) };
  } catch (error) {
    console.error('Update item name error:', error);
    return { success: false, error: String(error.message) };
  }
}

/**
 * Get partner names from Partner sheet (exposed to client)
 * Reads from column A starting at row 2 (A2:A)
 */
function getPartnerNamesFromSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Partner');

    if (!sheet) {
      console.warn('Partner sheet not found');
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
    const partnerNames = values
      .map(row => row[0])
      .filter(name => name && String(name).trim() !== '')
      .map(name => String(name).trim());

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
    try {
      const MARKETING_APPROVAL_BOARD_ID = '9710279044';
      const MARKETING_CALENDAR_BOARD_ID = '9770467355';

      if (boardId === MARKETING_APPROVAL_BOARD_ID) {
        console.log('Triggering Marketing Approval notification email...');
        const emailResult = sendMarketingApprovalNotification({
          itemName: itemName,
          columnValues: columnValues,
          boardId: boardId
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
          boardId: boardId
        });

        if (emailResult.success) {
          console.log('Marketing Calendar notification email sent successfully');
        } else {
          console.error('Failed to send Marketing Calendar notification:', emailResult.error);
        }
      }
    } catch (emailError) {
      // Log email error but don't fail the item creation
      console.error('Error sending notification email:', emailError);
      console.error('Item was created successfully, but email notification failed');
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

    const boardId = CONFIG.MARKETING_APPROVAL_BOARD_ID;
    const targetSheetName = CONFIG.MARKETING_APPROVAL_SHEET_NAME || 'MarketingApproval';

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

    const boardId = CONFIG.MARKETING_CALENDAR_BOARD_ID;
    const targetSheetName = CONFIG.MARKETING_CALENDAR_SHEET_NAME || 'MarketingCalendar';

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

    console.log('Marketing Calendar Board sync complete');
    return { success: true, itemCount: items.length };

  } catch (error) {
    console.error('Error syncing Marketing Calendar Board:', error);
    throw error;
  }
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
