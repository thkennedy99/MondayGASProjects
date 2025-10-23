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
