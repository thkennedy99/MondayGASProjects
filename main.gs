/**
 * Main.gs - Core functions for Monday.com to Google Sheets Integration
 * 
 * Setup:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Create 3 files: Main.gs, DataFetcher.gs, and TestFunctions.gs
 * 4. Copy the respective code into each file
 * 5. Save all files
 * 6. Run syncMondayData() to pull data
 */

// Configuration - Update these values
const MONDAY_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ3MjI3MDMwNywiYWFpIjoxMSwidWlkIjo2MzU1MTg0NCwiaWFkIjoiMjAyNS0wMi0xM1QxNjowOTozNC4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjQ0MzgzMjcsInJnbiI6InVzZTEifQ.8QsKLrmBSa7DyaRlefC9KBx38ZI0y7EUdlsVTPw7fS8';
const BOARD_ID = '8463767815';
const SHEET_TAB_NAME = 'MondayData';
const DASHBOARD_BOARD_ID = '8705508201';
const DASHBOARD_SHEET_NAME = 'MondayDashboard';

// New Marketing Boards Configuration
const MARKETING_APPROVAL_BOARD_ID = '9710279044';
const MARKETING_APPROVAL_SHEET_NAME = 'MarketingApproval';
const MARKETING_CALENDAR_BOARD_ID = '9770467355';
const MARKETING_CALENDAR_SHEET_NAME = 'MarketingCalendar';
const GW_BOARD_1_ID = '9791255941';
const GW_BOARD_1_NAME = 'Partner Management Tracker';
const GW_BOARD_2_ID = '9791272390';
const GW_BOARD_2_NAME = 'Solution Ops Tracker';
const GW_BOARD_3_ID = '18374691224';
const GW_BOARD_3_NAME = 'Marketing Projects';
const GW_MONDAY_SHEET_NAME = 'GWMondayData';

const MONDAY_API_URL = 'https://api.monday.com/v2';

/**
 * Get marketing board configurations
 */
function getMarketingBoardConfigurations() {
  return [
    {
      boardName: 'Marketing Events Approval Requests',
      partnerName: 'Marketing Team',
      boardId: MARKETING_APPROVAL_BOARD_ID,
      targetSheetName: MARKETING_APPROVAL_SHEET_NAME
    },
    {
      boardName: 'Marketing Event Calendar',
      partnerName: 'Marketing Team',
      boardId: MARKETING_CALENDAR_BOARD_ID,
      targetSheetName: MARKETING_CALENDAR_SHEET_NAME
    }
  ];
}

/**
 * Get board configurations from the MondayDashboard sheet PartnerBoard column
 */
function getBoardConfigurations() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const dashboardSheet = spreadsheet.getSheetByName('MondayDashboard');
    
    if (!dashboardSheet) {
      console.log('MondayDashboard sheet not found. Using fallback board ID: ' + BOARD_ID);
      return [{ boardName: 'Default Board', partnerName: 'Default Partner', boardId: BOARD_ID, targetSheetName: SHEET_TAB_NAME }];
    }
    
    const lastRow = dashboardSheet.getLastRow();
    if (lastRow < 2) {
      console.log('No data found in MondayDashboard sheet. Using fallback board ID: ' + BOARD_ID);
      return [{ boardName: 'Default Board', partnerName: 'Default Partner', boardId: BOARD_ID, targetSheetName: SHEET_TAB_NAME }];
    }
    
    // Get all data from the sheet to find column indices
    const headerRow = dashboardSheet.getRange(1, 1, 1, dashboardSheet.getLastColumn()).getValues()[0];
    
    // Find column indices
    const partnerNameIndex = headerRow.indexOf('Partner Name');
    const partnerBoardIndex = headerRow.indexOf('PartnerBoard');
    
    if (partnerNameIndex === -1 || partnerBoardIndex === -1) {
      console.log('Required columns not found in MondayDashboard sheet. Using fallback board ID: ' + BOARD_ID);
      return [{ boardName: 'Default Board', partnerName: 'Default Partner', boardId: BOARD_ID, targetSheetName: SHEET_TAB_NAME }];
    }
    
    // Get the data rows
    const dataRange = dashboardSheet.getRange(2, 1, lastRow - 1, dashboardSheet.getLastColumn());
    const data = dataRange.getValues();
    
    const boardConfigs = [];
    
    data.forEach((row, index) => {
      const partnerName = row[partnerNameIndex];
      const partnerBoard = row[partnerBoardIndex];
      
      // Skip empty rows
      if (partnerBoard && partnerBoard.toString().trim() !== '') {
        boardConfigs.push({
          boardName: `${partnerName} Board` || `Board ${index + 1}`,
          partnerName: partnerName || 'Unknown Partner',
          boardId: partnerBoard.toString().trim(),
          targetSheetName: SHEET_TAB_NAME // All dashboard boards go to MondayData sheet
        });
      }
    });
    
    if (boardConfigs.length === 0) {
      console.log('No valid board IDs found in MondayDashboard sheet. Using fallback board ID: ' + BOARD_ID);
      return [{ boardName: 'Default Board', partnerName: 'Default Partner', boardId: BOARD_ID, targetSheetName: SHEET_TAB_NAME }];
    }
    
    console.log(`Found ${boardConfigs.length} board configurations from MondayDashboard:`, boardConfigs.map(b => `${b.boardName} (${b.boardId})`));
    return boardConfigs;
    
  } catch (error) {
    console.error('Error reading board configurations from MondayDashboard:', error);
    console.log('Using fallback board ID: ' + BOARD_ID);
    return [{ boardName: 'Default Board', partnerName: 'Default Partner', boardId: BOARD_ID, targetSheetName: SHEET_TAB_NAME }];
  }
}

/**
 * Get partner translation lookup map from PartnerTranslate sheet
 */
function getPartnerTranslateLookup() {
  try {
    console.log('Loading partner translation lookup data...');
    
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const translateSheet = spreadsheet.getSheetByName('PartnerTranslate');
    
    if (!translateSheet) {
      console.log('PartnerTranslate sheet not found. Partner name translations will be pass-through.');
      return new Map();
    }
    
    const lastRow = translateSheet.getLastRow();
    if (lastRow < 2) {
      console.log('No data found in PartnerTranslate sheet.');
      return new Map();
    }
    
    // Get data from A2 onwards (original name) and B2 onwards (translated name)
    const translationData = translateSheet.getRange(2, 1, lastRow - 1, 2).getValues();
    
    // Create lookup map
    const translationMap = new Map();
    
    translationData.forEach(row => {
      const originalName = row[0];
      const translatedName = row[1];
      
      if (originalName && originalName.toString().trim() !== '') {
        const key = originalName.toString().trim();
        const value = translatedName ? translatedName.toString().trim() : key;
        translationMap.set(key, value);
      }
    });
    
    console.log(`Loaded ${translationMap.size} partner translation mappings`);
    return translationMap;
    
  } catch (error) {
    console.error('Error loading partner translation lookup:', error);
    return new Map();
  }
}

/**
 * Lookup partner translation for a given original name
 */
function lookupPartnerTranslation(originalName, translationMap) {
  if (!originalName || !translationMap) {
    return originalName || '';
  }
  
  const trimmedOriginalName = originalName.toString().trim();
  
  // Try exact match first
  if (translationMap.has(trimmedOriginalName)) {
    return translationMap.get(trimmedOriginalName);
  }
  
  // Try case-insensitive match
  for (const [key, value] of translationMap) {
    if (key.toLowerCase() === trimmedOriginalName.toLowerCase()) {
      return value;
    }
  }
  
  // No translation found, return original
  return trimmedOriginalName;
}

/**
 * Sync the MondayDashboard from the specific dashboard board
 */
function syncMondayDashboard() {
  try {
    console.log(`Starting MondayDashboard sync from board ${DASHBOARD_BOARD_ID}...`);
    
    // Get the dashboard sheet
    const dashboardSheet = getOrCreateSheet(DASHBOARD_SHEET_NAME);
    
    // Clear existing data from row 2 onwards
    clearDashboardSheetData(dashboardSheet);
    
    // Get board structure (columns)
    console.log('Fetching dashboard board structure...');
    const boardStructure = getBoardStructure(DASHBOARD_BOARD_ID);
    console.log('Dashboard board name:', boardStructure.name);
    console.log('Number of columns:', boardStructure.columns.length);
    console.log('Number of groups:', boardStructure.groups.length);
    
    // Get all items from the dashboard board
    const items = getAllBoardItems(DASHBOARD_BOARD_ID);
    console.log(`Dashboard items retrieved: ${items.length}`);
    
    // Process and write dashboard data to sheet
    if (items.length > 0) {
      writeDashboardDataToSheet(dashboardSheet, boardStructure, items, DASHBOARD_BOARD_ID);
      console.log('Dashboard data successfully written to sheet');
    } else {
      console.log('No items found on the dashboard board');
    }
    
  } catch (error) {
    console.error('Error syncing MondayDashboard:', error);
    throw error; // Re-throw because we need the dashboard to work for the main sync
  }
}

/**
 * Sync only marketing boards
 */
function syncMarketingBoards() {
  try {
    console.log('Starting Marketing boards sync...');
    
    const marketingConfigs = getMarketingBoardConfigurations();
    
    for (let i = 0; i < marketingConfigs.length; i++) {
      const boardConfig = marketingConfigs[i];
      console.log(`\n=== Processing Marketing Board ${i + 1}/${marketingConfigs.length}: ${boardConfig.boardName} ===`);
      console.log('Board ID:', boardConfig.boardId);
      console.log('Target Sheet:', boardConfig.targetSheetName);
      
      try {
        // Get or create the target sheet
        const targetSheet = getOrCreateSheet(boardConfig.targetSheetName);
        
        // Clear existing data from row 2 onwards
        clearSheetData(targetSheet);
        
        // Get board structure (columns)
        console.log('Fetching board structure...');
        const boardStructure = getBoardStructure(boardConfig.boardId);
        console.log('Board name:', boardStructure.name);
        console.log('Number of columns:', boardStructure.columns.length);
        console.log('Number of groups:', boardStructure.groups.length);
        
        // Get all items from the board
        const items = getAllBoardItems(boardConfig.boardId);
        console.log(`Items retrieved for ${boardConfig.boardName}: ${items.length}`);
        
        // Process and write data to sheet
        if (items.length > 0) {
          // Add board info to each item for identification
          items.forEach(item => {
            item.partnerName = boardConfig.partnerName;
            item.boardName = boardConfig.boardName;
            item.boardId = boardConfig.boardId;
          });
          
          writeDataToSheet(targetSheet, boardStructure, items, true, boardConfig);
          console.log(`Data successfully written to ${boardConfig.targetSheetName}`);
        } else {
          console.log(`No items found on board: ${boardConfig.boardName}`);
        }
        
      } catch (boardError) {
        console.error(`Error processing marketing board ${boardConfig.boardName} (${boardConfig.boardId}):`, boardError);
      }
    }
    
    console.log('Marketing boards sync complete');
    
  } catch (error) {
    console.error('Error syncing marketing boards:', error);
   // SpreadsheetApp.getUi().alert('Error syncing marketing boards: ' + error.toString());
  }
}

/**
 * Main function to sync Monday.com data to Google Sheets (Dashboard first, then Data)
 */
function syncMondayData() {
  try {
    console.log('Starting Monday.com multi-stage sync...');
    
    // STAGE 1: Sync MondayDashboard first
    console.log('\n=== STAGE 1: Syncing MondayDashboard ===');
    syncMondayDashboard();
    
    // STAGE 2: Sync MondayData using board IDs from MondayDashboard
    console.log('\n=== STAGE 2: Syncing MondayData ===');
    
    // Get the MondayData sheet
    const sheet = getOrCreateSheet(SHEET_TAB_NAME);
    
    // Clear existing data from row 2 onwards
    clearSheetData(sheet);
    
    // Get board configurations from MondayDashboard
    const boardConfigs = getBoardConfigurations();
    
    let totalItems = 0;
    let allBoardsProcessed = false;
    
    for (let i = 0; i < boardConfigs.length; i++) {
      const boardConfig = boardConfigs[i];
      const isFirstBoard = (i === 0);
      const isLastBoard = (i === boardConfigs.length - 1);

      console.log(`Processing ${i + 1}/${boardConfigs.length}: ${boardConfig.boardName}`);

      try {
        // Get board structure (columns)
        const boardStructure = getBoardStructure(boardConfig.boardId);

        // Get all items from the board
        const items = getAllBoardItems(boardConfig.boardId);

        // Process and write data to sheet
        if (items.length > 0) {
          // Add board info to each item for identification
          items.forEach(item => {
            item.partnerName = boardConfig.partnerName;
            item.boardName = boardConfig.boardName;
            item.boardId = boardConfig.boardId;
          });

          writeDataToSheet(sheet, boardStructure, items, isFirstBoard, boardConfig);
          totalItems += items.length;
        }
        
        // Mark all boards as processed if this is the last board
        if (isLastBoard) {
          allBoardsProcessed = true;
        }
        
      } catch (boardError) {
        console.error(`Error processing board ${boardConfig.boardName} (${boardConfig.boardId}):`, boardError);
        // Continue with next board instead of stopping entire sync
        if (isLastBoard) {
          allBoardsProcessed = true;
        }
      }
    }
    
    // Apply post-processing after all boards are processed
    if (allBoardsProcessed) {
      console.log('\n=== Starting Post-Processing ===');
      
      // 1. Delete rows where column B (Group) equals completed statuses
      deleteCompletedRows(sheet);
      
      // 2. Apply partner name translations
      translatePartnerNames();
      
      // 3. Sort the data by column A (Item Name)
      sortDataByItemName(sheet);
      
      // Auto-resize columns for better visibility
      const lastColumn = sheet.getLastColumn();
      for (let i = 1; i <= lastColumn; i++) {
        sheet.autoResizeColumn(i);
      }
      
      console.log('Post-processing complete');
    }
    
    // STAGE 3: Sync Marketing Boards
    console.log('\n=== STAGE 3: Syncing Marketing Boards ===');
    syncMarketingBoards();
    
    console.log(`\n=== Sync Complete ===`);
    console.log(`Dashboard synced successfully`);
    console.log(`Total items synced from ${boardConfigs.length} dashboard boards: ${totalItems}`);
    console.log(`Marketing boards synced separately`);

   // STAGE 4: Sync Guidewire Boards
    syncGuidewireBoards();   
 
    
  } catch (error) {
    console.error('Error syncing Monday data:', error);
  //  SpreadsheetApp.getUi().alert('Error: ' + error.toString());
  }
}

/**
 * Sync all Monday.com data including marketing boards (comprehensive sync)
 */
function syncAllMondayData() {
  try {
    console.log('Starting comprehensive Monday.com sync (Dashboard + Data + Marketing)...');
    
    // First sync the main data
    syncMondayData();
    
    console.log('Comprehensive sync complete!');
    
  } catch (error) {
    console.error('Error in comprehensive sync:', error);
  // SpreadsheetApp.getUi().alert('Error in comprehensive sync: ' + error.toString());
  }
}


/**
 * Get or create the target sheet
 */
function getOrCreateSheet(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  
  if (!sheet) {
    console.log(`Creating new sheet: ${sheetName}`);
    sheet = spreadsheet.insertSheet(sheetName);
  }
  
  return sheet;
}

/**
 * Clear sheet data from row 2 onwards
 */
function clearSheetData(sheet) {
  const lastRow = sheet.getLastRow();
  var fRange = sheet.getFilter();
    if (fRange) {
      fRange.remove();
     }
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clear();
  }
}


/**
 * Make API request to Monday.com
 */
function makeApiRequest(query) {
  const options = {
    method: 'post',
    headers: {
      'Authorization': MONDAY_API_KEY,
      'Content-Type': 'application/json',
      'API-Version': '2024-01'
    },
    payload: JSON.stringify({ query: query }),
    muteHttpExceptions: true
  };
  
 // console.log('Making API request...');
  const response = UrlFetchApp.fetch(MONDAY_API_URL, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();
  
 // console.log('Response code:', responseCode);
  
  if (responseCode !== 200) {
    console.error('HTTP Error:', responseCode);
    console.error('Response:', responseText);
    throw new Error(`HTTP Error ${responseCode}: ${responseText}`);
  }
  
  let result;
  try {
    result = JSON.parse(responseText);
  } catch (e) {
    console.error('Failed to parse response:', responseText);
    throw new Error('Invalid JSON response from Monday.com API');
  }
  
  if (result.errors) {
    console.error('API Errors:', JSON.stringify(result.errors));
    throw new Error('Monday.com API Error: ' + JSON.stringify(result.errors));
  }
  
  return result;
}

/**
 * Menu item to manually trigger sync
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Monday.com Sync')
    .addItem('Sync Dashboard Only', 'syncMondayDashboard')
    .addItem('Sync All (Dashboard + Data)', 'syncMondayData')
    .addItem('Sync Marketing Boards Only', 'syncMarketingBoards')
    .addItem('Sync GW Boards Only', 'syncGuidewireBoards')
    .addItem('Sync Everything (Dashboard + Data + Marketing)', 'syncAllMondayData')
    .addItem('Sync Data Only (No Pagination)', 'syncMondayDataNoPagination')
    .addItem('Fetch Document from Link', 'showDocumentLinkModal')
    .addItem('Setup Hourly Sync', 'setupHourlyTrigger')
    .addItem('Remove Hourly Sync', 'removeHourlyTrigger')
    .addToUi();
}

/**
 * Setup hourly trigger for automatic sync
 */
function setupHourlyTrigger() {
  // Remove existing triggers
  removeHourlyTrigger();
  
  // Create new hourly trigger for comprehensive sync
  ScriptApp.newTrigger('syncAllMondayData')
    .timeBased()
    .everyHours(1)
    .create();
  
 // SpreadsheetApp.getUi().alert('Hourly sync has been set up successfully (includes all boards)!');
}

/**
 * Remove hourly trigger
 */
function removeHourlyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncMondayData' || trigger.getHandlerFunction() === 'syncAllMondayData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function getGuidewireBoardConfigurations() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const internalBoardsSheet = spreadsheet.getSheetByName('InternalBoards');

    if (!internalBoardsSheet) {
      console.error('InternalBoards sheet not found, using fallback configuration');
      // Fallback to hardcoded values if sheet doesn't exist
      return [
        {
          boardName: GW_BOARD_1_NAME,
          partnerName: 'Guidewire',
          boardId: GW_BOARD_1_ID,
          targetSheetName: GW_MONDAY_SHEET_NAME
        },
        {
          boardName: GW_BOARD_2_NAME,
          partnerName: 'Guidewire',
          boardId: GW_BOARD_2_ID,
          targetSheetName: GW_MONDAY_SHEET_NAME
        },
        {
          boardName: GW_BOARD_3_NAME,
          partnerName: 'Guidewire',
          boardId: GW_BOARD_3_ID,
          targetSheetName: GW_MONDAY_SHEET_NAME
        }
      ];
    }

    const data = internalBoardsSheet.getDataRange().getValues();

    if (data.length < 2) {
      console.error('InternalBoards sheet has no data, using fallback configuration');
      return [];
    }

    const headers = data[0];
    const boardNameIndex = headers.indexOf('BoardName');
    const idIndex = headers.indexOf('ID');

    if (boardNameIndex === -1 || idIndex === -1) {
      console.error('InternalBoards sheet missing required columns (BoardName, ID)');
      return [];
    }

    const boards = [];
    for (let i = 1; i < data.length; i++) {
      const boardName = data[i][boardNameIndex];
      const boardId = data[i][idIndex];

      if (boardName && boardId) {
        boards.push({
          boardName: String(boardName).trim(),
          partnerName: 'Guidewire',
          boardId: String(boardId).trim(),
          targetSheetName: GW_MONDAY_SHEET_NAME
        });
      }
    }

    console.log(`Loaded ${boards.length} internal boards from InternalBoards sheet for sync`);
    return boards;

  } catch (error) {
    console.error('Error reading InternalBoards sheet:', error);
    return [];
  }
}

/**
 * Sync Guidewire Monday boards to GWMondayData sheet
 */
/**
 * Sync Guidewire Monday boards to GWMondayData sheet
 */
function syncGuidewireBoards() {
  try {
    console.log('Starting Guidewire boards sync...');

    // Get or create the GWMondayData sheet
    const gwSheet = getOrCreateSheet(GW_MONDAY_SHEET_NAME);

    // Clear existing data from row 2 onwards
    clearSheetData(gwSheet);

    // Get partner translation lookup map
    const partnerTranslateMap = getPartnerTranslateLookup();

    // Get alliance manager lookup map
    const allianceManagerMap = getAllianceManagerLookup();

    const guidewireConfigs = getGuidewireBoardConfigurations();
    let totalItems = 0;

    // Process each board individually to handle different column structures
    for (let i = 0; i < guidewireConfigs.length; i++) {
      const boardConfig = guidewireConfigs[i];
      const isFirstBoard = (i === 0);

      console.log(`\n=== Processing Guidewire Board ${i + 1}/${guidewireConfigs.length}: ${boardConfig.boardName} ===`);
      console.log('Board ID:', boardConfig.boardId);

      try {
        // Fetch board structure for THIS specific board (don't assume all boards are the same)
        console.log('Fetching board structure...');
        const boardStructure = getBoardStructure(boardConfig.boardId);
        console.log('Board name from Monday:', boardStructure.name);
        console.log('Number of columns:', boardStructure.columns.length);
        console.log('Number of groups:', boardStructure.groups.length);

        // Get all items from this board
        const items = getAllBoardItems(boardConfig.boardId);
        console.log(`Items retrieved from ${boardStructure.name}: ${items.length}`);

        // Process and write this board's data
        if (items.length > 0) {
          // Add board info to each item using the ACTUAL board name from Monday
          items.forEach(item => {
            item.partnerName = boardConfig.partnerName;
            item.boardName = boardStructure.name;  // Use actual board name from Monday
            item.boardId = boardConfig.boardId;
          });

          // Write this board's data to the sheet
          // First board writes headers, subsequent boards append
          writeDataToSheet(gwSheet, boardStructure, items, isFirstBoard, boardConfig);
          totalItems += items.length;

          console.log(`Written ${items.length} items from ${boardStructure.name}`);
        } else {
          console.log(`No items found on board: ${boardStructure.name}`);
        }

      } catch (boardError) {
        console.error(`Error processing Guidewire board ${boardConfig.boardName} (${boardConfig.boardId}):`, boardError);
        // Continue processing other boards even if one fails
      }
    }

    // Apply post-processing to all data
    if (totalItems > 0) {
      console.log(`\nApplying post-processing to ${totalItems} total items...`);

      // 1. Delete rows where column B (Group) equals completed statuses
      deleteCompletedRows(gwSheet);

      // 2. Translate partner names if needed
      const lastRow = gwSheet.getLastRow();
      if (lastRow > 1) {
        const partnerNameRange = gwSheet.getRange(2, 4, lastRow - 1, 1);
        const partnerNames = partnerNameRange.getValues();

        const updatedNames = partnerNames.map(row => {
          const originalName = row[0];
          if (originalName) {
            const translatedName = lookupPartnerTranslation(originalName.toString().trim(), partnerTranslateMap);
            return [translatedName];
          }
          return row;
        });

        partnerNameRange.setValues(updatedNames);
      }

      // 3. Sort the data by column A (Item Name)
      sortDataByItemName(gwSheet);

      // Auto-resize columns for better visibility
      const lastColumn = gwSheet.getLastColumn();
      for (let i = 1; i <= lastColumn; i++) {
        gwSheet.autoResizeColumn(i);
      }

      console.log('Guidewire boards sync complete');
      console.log(`Success! Synced ${totalItems} items from Guidewire Monday.com boards to ${GW_MONDAY_SHEET_NAME}`);
    } else {
      console.log('No items found on any Guidewire boards');
    }

  } catch (error) {
    console.error('Error syncing Guidewire boards:', error);
    throw error; // Re-throw to be handled by caller
  }
}

/**
 * Sync all data including Guidewire boards
 */
function syncAllDataIncludingGuidewire() {
  try {
    console.log('Starting comprehensive sync including Guidewire boards...');
    
    // First sync the main data
    syncMondayData();
    
    // Then sync Guidewire boards
    syncGuidewireBoards();
    
    console.log('Comprehensive sync with Guidewire complete!');
    
  } catch (error) {
    console.error('Error in comprehensive sync with Guidewire:', error);
   // SpreadsheetApp.getUi().alert('Error in comprehensive sync: ' + error.toString());
  }
}
