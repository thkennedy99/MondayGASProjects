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
const APPROVALS_2026_BOARD_ID = '18389979949';
const APPROVALS_2026_SHEET_NAME = 'Approvals2026';
const GW_BOARD_1_ID = '9791255941';
const GW_BOARD_1_NAME = 'Partner Management Tracker';
const GW_BOARD_1_SHEET = 'GW_PartnerManagementActivities';
const GW_BOARD_2_ID = '9791272390';
const GW_BOARD_2_NAME = 'Solution Ops Tracker';
const GW_BOARD_2_SHEET = 'GW_TechOpsActivities';
const GW_BOARD_3_ID = '18374691224';
const GW_BOARD_3_NAME = 'Marketing Projects';
const GW_BOARD_3_SHEET = 'GW_MarketingActivities';
const GW_BOARD_4_ID = '18375013360';
const GW_BOARD_4_NAME = 'Compliance';
const GW_BOARD_4_SHEET = 'GW_IntegrationComplianceActivities';
const GW_MONDAY_SHEET_NAME = 'GWMondayData';

// Array of all GW board IDs for easy lookup
const GW_BOARD_IDS = [GW_BOARD_1_ID, GW_BOARD_2_ID, GW_BOARD_3_ID, GW_BOARD_4_ID];

// Map of GW board IDs to their sheet names
const GW_BOARD_SHEET_MAP = {
  [GW_BOARD_1_ID]: GW_BOARD_1_SHEET,
  [GW_BOARD_2_ID]: GW_BOARD_2_SHEET,
  [GW_BOARD_3_ID]: GW_BOARD_3_SHEET,
  [GW_BOARD_4_ID]: GW_BOARD_4_SHEET
};

// Map of GW board IDs to their names
const GW_BOARD_NAME_MAP = {
  [GW_BOARD_1_ID]: GW_BOARD_1_NAME,
  [GW_BOARD_2_ID]: GW_BOARD_2_NAME,
  [GW_BOARD_3_ID]: GW_BOARD_3_NAME,
  [GW_BOARD_4_ID]: GW_BOARD_4_NAME
};

// Partner Activities board (MondayData)
const PARTNER_BOARD_ID = '8463767815';

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
    },
    {
      boardName: '2026 Approvals',
      partnerName: 'Marketing Team',
      boardId: APPROVALS_2026_BOARD_ID,
      targetSheetName: APPROVALS_2026_SHEET_NAME
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

    // Ensure all spreadsheet writes are committed before clearing cache
    SpreadsheetApp.flush();

    // Clear marketing caches to ensure fresh data is loaded after sync
    clearMarketingCaches();

    console.log('Marketing boards sync complete');

  } catch (error) {
    console.error('Error syncing marketing boards:', error);
   // SpreadsheetApp.getUi().alert('Error syncing marketing boards: ' + error.toString());
  }
}

/**
 * Clear all marketing-related caches (approvals and calendar)
 * This ensures that fresh data is loaded after syncing from Monday.com
 */
function clearMarketingCaches() {
  try {
    const cache = CacheService.getScriptCache();

    // Get list of all managers to clear their specific cache keys
    const managers = getManagerList();

    // Build list of cache keys to clear
    const cacheKeysToRemove = [];

    managers.forEach(managerEmail => {
      // Clear marketing approvals cache for each manager
      cacheKeysToRemove.push(`marketing_approvals_${managerEmail}`);
      // Clear marketing calendar cache for each manager
      cacheKeysToRemove.push(`marketing_calendar_${managerEmail}`);
    });

    // Also clear any general marketing cache keys
    cacheKeysToRemove.push('marketing_approvals_all');
    cacheKeysToRemove.push('marketing_calendar_all');
    cacheKeysToRemove.push('all_marketing_approvals');
    cacheKeysToRemove.push('all_marketing_calendar');

    // Clear 2026 Approvals cache keys
    cacheKeysToRemove.push('all_2026_approvals');
    managers.forEach(managerEmail => {
      cacheKeysToRemove.push(`approvals_2026_${managerEmail}`);
    });

    // Remove all cache keys (GAS allows removing up to 100 keys at once)
    if (cacheKeysToRemove.length > 0) {
      cache.removeAll(cacheKeysToRemove);
      console.log(`Cleared ${cacheKeysToRemove.length} marketing cache keys`);
    }

    console.log('Marketing caches cleared successfully');

  } catch (error) {
    console.error('Error clearing marketing caches:', error);
    // Don't throw - cache clearing failure shouldn't break the sync
  }
}

/**
 * Refresh all data from Monday.com
 * This syncs ALL boards to spreadsheets and clears ALL caches
 * Called by the Marketing Manager Portal "Refresh Data" button
 */
function refreshMarketingDataFromMonday() {
  try {
    console.log('Starting full data refresh from Monday.com...');

    // Step 1: Sync all Monday data (Dashboard, Partner Activities, Marketing, Guidewire)
    console.log('Step 1: Syncing all Monday.com boards...');
    syncMondayData();

    // Step 2: Sync 2026 Approvals board
    console.log('Step 2: Syncing 2026 Approvals board...');
    sync2026ApprovalsBoard();

    // Step 3: Clear ALL data caches (marketing, activities, heatmap, etc.)
    console.log('Step 3: Clearing all data caches...');
    clearAllDataCaches();

    // Step 4: Also clear internal activity caches
    console.log('Step 4: Clearing internal activity caches...');
    clearInternalActivityCaches();

    // Step 5: Clear 2026 approvals caches
    console.log('Step 5: Clearing 2026 approvals caches...');
    clear2026ApprovalsCaches();

    console.log('Full data refresh completed successfully');
    return { success: true, message: 'All data refreshed from Monday.com' };

  } catch (error) {
    console.error('Error refreshing data from Monday:', error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Clear only Marketing Approval caches
 * Use this for targeted cache invalidation when only approvals are affected
 */
function clearMarketingApprovalCaches() {
  try {
    const cache = CacheService.getScriptCache();
    const managers = getManagerList();
    const cacheKeysToRemove = [];

    managers.forEach(managerEmail => {
      cacheKeysToRemove.push(`marketing_approvals_${managerEmail}`);
    });

    cacheKeysToRemove.push('marketing_approvals_all');
    cacheKeysToRemove.push('all_marketing_approvals');

    if (cacheKeysToRemove.length > 0) {
      cache.removeAll(cacheKeysToRemove);
      console.log(`Cleared ${cacheKeysToRemove.length} marketing approval cache keys`);
    }

  } catch (error) {
    console.error('Error clearing marketing approval caches:', error);
  }
}

/**
 * Clear only Marketing Calendar caches
 * Use this for targeted cache invalidation when only calendar is affected
 */
function clearMarketingCalendarCaches() {
  try {
    const cache = CacheService.getScriptCache();
    const managers = getManagerList();
    const cacheKeysToRemove = [];

    managers.forEach(managerEmail => {
      cacheKeysToRemove.push(`marketing_calendar_${managerEmail}`);
    });

    cacheKeysToRemove.push('marketing_calendar_all');
    cacheKeysToRemove.push('all_marketing_calendar');

    if (cacheKeysToRemove.length > 0) {
      cache.removeAll(cacheKeysToRemove);
      console.log(`Cleared ${cacheKeysToRemove.length} marketing calendar cache keys`);
    }

  } catch (error) {
    console.error('Error clearing marketing calendar caches:', error);
  }
}

/**
 * Clear only 2026 Approvals caches
 * Use this for targeted cache invalidation when only 2026 approvals are affected
 */
function clear2026ApprovalsCaches() {
  try {
    const cache = CacheService.getScriptCache();
    const managers = getManagerList();
    const cacheKeysToRemove = [];

    managers.forEach(managerEmail => {
      cacheKeysToRemove.push(`approvals_2026_${managerEmail}`);
    });

    cacheKeysToRemove.push('all_2026_approvals');

    if (cacheKeysToRemove.length > 0) {
      cache.removeAll(cacheKeysToRemove);
      console.log(`Cleared ${cacheKeysToRemove.length} 2026 approvals cache keys`);
    }

  } catch (error) {
    console.error('Error clearing 2026 approvals caches:', error);
  }
}

/**
 * Clear only Internal Activity caches (GW boards)
 * Use this for targeted cache invalidation when only internal activities are affected
 */
function clearInternalActivityCaches() {
  try {
    const cache = CacheService.getScriptCache();
    const managers = getManagerList();
    const cacheKeysToRemove = [];

    managers.forEach(managerEmail => {
      for (let page = 1; page <= 10; page++) {
        cacheKeysToRemove.push(`activity_internal_${managerEmail}_page${page}`);
      }
      cacheKeysToRemove.push(`activity_internal_${managerEmail}_recent`);
    });

    if (cacheKeysToRemove.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < cacheKeysToRemove.length; i += batchSize) {
        const batch = cacheKeysToRemove.slice(i, i + batchSize);
        cache.removeAll(batch);
      }
      console.log(`Cleared ${cacheKeysToRemove.length} internal activity cache keys`);
    }

  } catch (error) {
    console.error('Error clearing internal activity caches:', error);
  }
}

/**
 * Clear all activity-related caches (partner and internal activities)
 * This ensures that fresh data is loaded after syncing from Monday.com
 */
function clearActivityCaches() {
  try {
    const cache = CacheService.getScriptCache();
    const managers = getManagerList();
    const cacheKeysToRemove = [];

    // Activity caches use pattern: activity_${type}_${manager}_${hash}
    // Since we can't predict all hash values, we need to clear by pattern
    // However, GAS doesn't support pattern-based removal, so we track common patterns

    managers.forEach(managerEmail => {
      // Clear partner activity caches (various pagination/filter combinations)
      // We'll clear the most common patterns
      for (let page = 1; page <= 10; page++) {
        cacheKeysToRemove.push(`activity_partner_${managerEmail}_page${page}`);
        cacheKeysToRemove.push(`activity_internal_${managerEmail}_page${page}`);
      }
      // Also try common hash patterns (these are the default/common requests)
      cacheKeysToRemove.push(`activity_partner_${managerEmail}_recent`);
      cacheKeysToRemove.push(`activity_internal_${managerEmail}_recent`);
    });

    // Remove all cache keys
    if (cacheKeysToRemove.length > 0) {
      // GAS removeAll can handle up to ~100 keys, so batch if needed
      const batchSize = 100;
      for (let i = 0; i < cacheKeysToRemove.length; i += batchSize) {
        const batch = cacheKeysToRemove.slice(i, i + batchSize);
        cache.removeAll(batch);
      }
      console.log(`Cleared ${cacheKeysToRemove.length} activity cache keys`);
    }

    console.log('Activity caches cleared successfully');

  } catch (error) {
    console.error('Error clearing activity caches:', error);
  }
}

/**
 * Clear partner heatmap caches
 * This ensures that fresh data is loaded after syncing from Monday.com
 */
function clearHeatmapCaches() {
  try {
    const cache = CacheService.getScriptCache();
    const managers = getManagerList();
    const cacheKeysToRemove = [];

    managers.forEach(managerEmail => {
      cacheKeysToRemove.push(`heatmap_${managerEmail}`);
    });

    // Also clear any general heatmap cache keys
    cacheKeysToRemove.push('heatmap_all');
    cacheKeysToRemove.push('partner_heatmap_all');

    if (cacheKeysToRemove.length > 0) {
      cache.removeAll(cacheKeysToRemove);
      console.log(`Cleared ${cacheKeysToRemove.length} heatmap cache keys`);
    }

    console.log('Heatmap caches cleared successfully');

  } catch (error) {
    console.error('Error clearing heatmap caches:', error);
  }
}

/**
 * Clear ALL data caches (marketing, activities, heatmap)
 * Call this for comprehensive cache invalidation
 */
function clearAllDataCaches() {
  console.log('Clearing all data caches...');
  clearMarketingCaches();
  clearActivityCaches();
  clearHeatmapCaches();
  console.log('All data caches cleared');
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

    // Clear partner activity and heatmap caches after sync
    // (Marketing and GW caches are cleared in their respective sync functions)
    console.log('\n=== Clearing Partner Activity and Heatmap Caches ===');
    clearActivityCaches();
    clearHeatmapCaches();

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
 * Includes automatic retry for rate limiting (429) errors
 */
function makeApiRequest(query, retryCount = 0) {
  const MAX_RETRIES = 3;

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

  // Handle rate limiting (429) with automatic retry
  if (responseCode === 429) {
    if (retryCount >= MAX_RETRIES) {
      console.error('Max retries exceeded for rate limiting');
      throw new Error(`HTTP Error ${responseCode}: ${responseText}`);
    }

    // Try to parse the retry delay from response
    let retryDelay = 3000; // Default 3 seconds
    try {
      const errorResponse = JSON.parse(responseText);
      if (errorResponse.error_data && errorResponse.error_data.retry_in_seconds) {
        retryDelay = (errorResponse.error_data.retry_in_seconds + 1) * 1000; // Add 1 second buffer
      }
    } catch (e) {
      // Use default delay if can't parse
    }

    console.log(`Rate limited (429). Waiting ${retryDelay/1000} seconds before retry ${retryCount + 1}/${MAX_RETRIES}...`);
    Utilities.sleep(retryDelay);
    return makeApiRequest(query, retryCount + 1);
  }

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
          sheetName: GW_BOARD_1_SHEET,
          targetSheetName: GW_MONDAY_SHEET_NAME
        },
        {
          boardName: GW_BOARD_2_NAME,
          partnerName: 'Guidewire',
          boardId: GW_BOARD_2_ID,
          sheetName: GW_BOARD_2_SHEET,
          targetSheetName: GW_MONDAY_SHEET_NAME
        },
        {
          boardName: GW_BOARD_3_NAME,
          partnerName: 'Guidewire',
          boardId: GW_BOARD_3_ID,
          sheetName: GW_BOARD_3_SHEET,
          targetSheetName: GW_MONDAY_SHEET_NAME
        },
        {
          boardName: GW_BOARD_4_NAME,
          partnerName: 'Guidewire',
          boardId: GW_BOARD_4_ID,
          sheetName: GW_BOARD_4_SHEET,
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
    const sheetNameIndex = headers.indexOf('SheetName');

    if (boardNameIndex === -1 || idIndex === -1) {
      console.error('InternalBoards sheet missing required columns (BoardName, ID)');
      return [];
    }

    const boards = [];
    for (let i = 1; i < data.length; i++) {
      const boardName = data[i][boardNameIndex];
      const boardId = data[i][idIndex];
      const sheetName = sheetNameIndex !== -1 ? data[i][sheetNameIndex] : null;

      if (boardName && boardId) {
        boards.push({
          boardName: String(boardName).trim(),
          partnerName: 'Guidewire',
          boardId: String(boardId).trim(),
          sheetName: sheetName ? String(sheetName).trim() : null,
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
 * Now reads from InternalBoards sheet dynamically
 */
function syncGuidewireBoards() {
  try {
    console.log('Starting Guidewire boards sync (dynamic board architecture)...');

    // Get partner translation lookup map for post-processing
    const partnerTranslateMap = getPartnerTranslateLookup();
    let totalItems = 0;

    // Get board configurations from InternalBoards sheet (dynamic)
    const boardConfigs = getGuidewireBoardConfigurations();

    if (boardConfigs.length === 0) {
      console.error('No internal boards configured in InternalBoards sheet');
      return;
    }

    // Build boardSheets array dynamically from InternalBoards sheet
    // Use SheetName from config if provided, otherwise generate from board name
    const boardSheets = boardConfigs.map(config => ({
      boardId: config.boardId,
      boardName: config.boardName,
      sheetName: config.sheetName || generateGWSheetName(config.boardName)
    }));

    console.log(`Found ${boardSheets.length} internal boards to sync from InternalBoards sheet`);

    for (let i = 0; i < boardSheets.length; i++) {
      const { boardId, boardName, sheetName } = boardSheets[i];
      console.log(`\n=== Syncing GW Board ${i + 1}/${boardSheets.length}: ${boardName} -> ${sheetName} (${boardId}) ===`);

      try {
        // Sync this board to its individual sheet, passing board name and sheet name
        const result = syncSingleGWBoard(boardId, boardName, sheetName);
        const itemCount = result.itemCount || 0;
        totalItems += itemCount;

        // Apply post-processing to this individual sheet
        if (itemCount > 0) {
          const sheet = getOrCreateSheet(sheetName);

          // 1. Delete completed rows
          deleteCompletedRows(sheet);

          // 2. Translate partner names (column D, index 4)
          const lastRow = sheet.getLastRow();
          if (lastRow > 1) {
            const partnerNameRange = sheet.getRange(2, 4, lastRow - 1, 1);
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

          // 3. Sort by item name
          sortDataByItemName(sheet);

          // Auto-resize columns
          const lastColumn = sheet.getLastColumn();
          for (let col = 1; col <= Math.min(lastColumn, 20); col++) {
            sheet.autoResizeColumn(col);
          }

          console.log(`Post-processing complete for ${sheetName}`);
        }

      } catch (boardError) {
        console.error(`Error processing GW board ${sheetName} (${boardId}):`, boardError);
        // Continue processing other boards even if one fails
      }
    }

    // Ensure GWMondayData formula is set up (auto-pulls from individual sheets)
    console.log('\nSetting up GWMondayData formula to aggregate individual sheets...');
    setupGWMondayDataFormula();

    console.log(`\nGuidewire boards sync complete - ${totalItems} total items across ${boardSheets.length} boards`);
    console.log('GWMondayData will auto-update via formula when individual sheets change');

    // Clear internal activity caches after GW boards sync
    console.log('Clearing internal activity caches...');
    clearActivityCaches();

  } catch (error) {
    console.error('Error syncing Guidewire boards:', error);
    throw error;
  }
}

/**
 * Generate a sheet name from a board name
 * E.g., "Tech Ops Activities" -> "GW_TechOpsActivities"
 */
function generateGWSheetName(boardName) {
  if (!boardName) return 'GW_Unknown';

  // Remove special characters and spaces, convert to PascalCase
  const cleanName = boardName
    .replace(/[^a-zA-Z0-9\s]/g, '')  // Remove special chars
    .split(/\s+/)                     // Split on whitespace
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');

  return 'GW_' + cleanName;
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

/**
 * Debug function to view cache keys and their data
 * Run this from Apps Script editor to see what's in the cache
 */
function debugViewCache() {
  const cache = CacheService.getScriptCache();
  const managers = getManagerList();

  console.log('=== CACHE DEBUG VIEW ===');
  console.log('Manager list:', managers);
  console.log('');

  const cacheReport = [];

  // Check marketing approval caches
  console.log('--- Marketing Approval Caches ---');
  managers.forEach(email => {
    const key = `marketing_approvals_${email}`;
    const value = cache.get(key);
    if (value) {
      const data = JSON.parse(value);
      console.log(`✓ ${key}: ${data.length} items`);
      cacheReport.push({ key, itemCount: data.length, type: 'marketing_approvals' });
    } else {
      console.log(`✗ ${key}: EMPTY`);
    }
  });

  // Check all_marketing_approvals
  const allApprovals = cache.get('all_marketing_approvals');
  if (allApprovals) {
    const data = JSON.parse(allApprovals);
    console.log(`✓ all_marketing_approvals: ${data.length} items`);
    cacheReport.push({ key: 'all_marketing_approvals', itemCount: data.length, type: 'marketing_approvals' });
  } else {
    console.log('✗ all_marketing_approvals: EMPTY');
  }

  // Check marketing calendar caches
  console.log('');
  console.log('--- Marketing Calendar Caches ---');
  managers.forEach(email => {
    const key = `marketing_calendar_${email}`;
    const value = cache.get(key);
    if (value) {
      const data = JSON.parse(value);
      console.log(`✓ ${key}: ${data.length} items`);
      cacheReport.push({ key, itemCount: data.length, type: 'marketing_calendar' });
    } else {
      console.log(`✗ ${key}: EMPTY`);
    }
  });

  // Check heatmap caches
  console.log('');
  console.log('--- Heatmap Caches ---');
  managers.forEach(email => {
    const key = `heatmap_${email}`;
    const value = cache.get(key);
    if (value) {
      const data = JSON.parse(value);
      console.log(`✓ ${key}: ${data.length} items`);
      cacheReport.push({ key, itemCount: data.length, type: 'heatmap' });
    } else {
      console.log(`✗ ${key}: EMPTY`);
    }
  });

  // Check manager partners caches
  console.log('');
  console.log('--- Manager Partners Caches ---');
  managers.forEach(email => {
    const key = `manager_partners_${email}`;
    const value = cache.get(key);
    if (value) {
      const data = JSON.parse(value);
      console.log(`✓ ${key}: ${data.length} partners`);
      cacheReport.push({ key, itemCount: data.length, type: 'manager_partners' });
    } else {
      console.log(`✗ ${key}: EMPTY`);
    }
  });

  // Check manager name caches
  console.log('');
  console.log('--- Manager Name Caches ---');
  managers.forEach(email => {
    const key = `manager_name_${email}`;
    const value = cache.get(key);
    if (value) {
      console.log(`✓ ${key}: "${value}"`);
      cacheReport.push({ key, value, type: 'manager_name' });
    } else {
      console.log(`✗ ${key}: EMPTY`);
    }
  });

  // Check manager list cache
  console.log('');
  console.log('--- Other Caches ---');
  const managerListCache = cache.get('manager_list');
  if (managerListCache) {
    const data = JSON.parse(managerListCache);
    console.log(`✓ manager_list: ${data.length} managers`);
    cacheReport.push({ key: 'manager_list', itemCount: data.length, type: 'manager_list' });
  } else {
    console.log('✗ manager_list: EMPTY');
  }

  // Summary
  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Total cached entries found: ${cacheReport.length}`);
  console.log(`Managers checked: ${managers.length}`);

  return cacheReport;
}

/**
 * Debug function to view a specific cache key's full data
 * @param {string} cacheKey - The cache key to inspect
 */
function debugViewCacheKey(cacheKey) {
  const cache = CacheService.getScriptCache();
  const value = cache.get(cacheKey);

  console.log(`=== CACHE KEY: ${cacheKey} ===`);

  if (!value) {
    console.log('Status: EMPTY/NOT FOUND');
    return null;
  }

  try {
    const data = JSON.parse(value);
    console.log('Status: FOUND');
    console.log('Type:', typeof data);
    console.log('Is Array:', Array.isArray(data));

    if (Array.isArray(data)) {
      console.log('Item count:', data.length);
      if (data.length > 0) {
        console.log('First item keys:', Object.keys(data[0]));
        console.log('First item:', JSON.stringify(data[0], null, 2));
      }
    } else {
      console.log('Data:', JSON.stringify(data, null, 2));
    }

    return data;
  } catch (e) {
    console.log('Raw value (not JSON):', value);
    return value;
  }
}

/**
 * Debug function to test if CacheService operations actually work
 * This verifies that put, get, remove, and removeAll are functional
 */
function debugTestCacheOperations() {
  const cache = CacheService.getScriptCache();
  const testKey = 'debug_test_cache_key_12345';
  const testValue = JSON.stringify({ test: true, timestamp: new Date().toISOString() });

  console.log('=== CACHE OPERATIONS TEST ===');
  console.log('');

  // Test 1: Put a value
  console.log('1. Testing cache.put()...');
  cache.put(testKey, testValue, 300);
  console.log(`   Put test value with key: ${testKey}`);

  // Test 2: Get the value
  console.log('2. Testing cache.get()...');
  const retrieved = cache.get(testKey);
  if (retrieved === testValue) {
    console.log('   ✓ GET works - value retrieved matches');
  } else if (retrieved) {
    console.log('   ⚠ GET returned different value');
    console.log('   Expected:', testValue);
    console.log('   Got:', retrieved);
  } else {
    console.log('   ✗ GET failed - value not found');
    return { success: false, error: 'cache.get() failed' };
  }

  // Test 3: Remove the value
  console.log('3. Testing cache.remove()...');
  cache.remove(testKey);
  const afterRemove = cache.get(testKey);
  if (afterRemove === null) {
    console.log('   ✓ REMOVE works - value was deleted');
  } else {
    console.log('   ✗ REMOVE failed - value still exists:', afterRemove);
    return { success: false, error: 'cache.remove() failed' };
  }

  // Test 4: Test removeAll
  console.log('4. Testing cache.removeAll()...');
  const testKeys = ['debug_test_1', 'debug_test_2', 'debug_test_3'];
  testKeys.forEach(key => cache.put(key, 'test_value', 300));
  console.log('   Put 3 test values');

  // Verify they exist
  const beforeRemoveAll = testKeys.map(key => cache.get(key));
  console.log('   Before removeAll:', beforeRemoveAll.map(v => v ? 'EXISTS' : 'EMPTY'));

  cache.removeAll(testKeys);

  const afterRemoveAll = testKeys.map(key => cache.get(key));
  console.log('   After removeAll:', afterRemoveAll.map(v => v ? 'EXISTS' : 'EMPTY'));

  if (afterRemoveAll.every(v => v === null)) {
    console.log('   ✓ REMOVEALL works - all values deleted');
  } else {
    console.log('   ✗ REMOVEALL failed - some values still exist');
    return { success: false, error: 'cache.removeAll() failed' };
  }

  console.log('');
  console.log('=== ALL CACHE OPERATIONS WORKING ===');
  return { success: true };
}

/**
 * Debug function to specifically test clearing marketing approval cache
 * Explicitly clears a specific key and verifies it's gone
 */
function debugTestMarketingCacheClear() {
  const cache = CacheService.getScriptCache();
  const managers = getManagerList();

  console.log('=== MARKETING APPROVAL CACHE CLEAR TEST ===');
  console.log('Managers found:', managers.length);
  console.log('Manager list:', managers.join(', '));
  console.log('');

  // Check each manager's cache
  managers.forEach(email => {
    const key = `marketing_approvals_${email}`;
    const before = cache.get(key);

    console.log(`--- Testing key: ${key} ---`);
    console.log('Before clear:', before ? `EXISTS (${JSON.parse(before).length} items)` : 'EMPTY');

    if (before) {
      // Try to remove it
      cache.remove(key);
      Utilities.sleep(100); // Small delay to ensure operation completes

      const after = cache.get(key);
      console.log('After cache.remove():', after ? `STILL EXISTS (${JSON.parse(after).length} items)` : 'DELETED');

      if (after) {
        console.log('⚠ WARNING: Cache key was NOT removed!');
      } else {
        console.log('✓ Cache key successfully removed');
      }
    }
    console.log('');
  });

  // Also test the general keys
  ['marketing_approvals_all', 'all_marketing_approvals'].forEach(key => {
    const before = cache.get(key);
    console.log(`--- Testing key: ${key} ---`);
    console.log('Before clear:', before ? 'EXISTS' : 'EMPTY');

    if (before) {
      cache.remove(key);
      const after = cache.get(key);
      console.log('After cache.remove():', after ? 'STILL EXISTS' : 'DELETED');
    }
    console.log('');
  });

  console.log('=== TEST COMPLETE ===');
}

/**
 * Force clear a specific cache key by email - use this for direct testing
 * @param {string} email - Manager email address (will be normalized to lowercase)
 */
function forceClearMarketingCacheForEmail(email) {
  const cache = CacheService.getScriptCache();
  const normalizedEmail = email ? email.trim().toLowerCase() : '';
  const key = `marketing_approvals_${normalizedEmail}`;

  console.log('=== FORCE CLEAR SPECIFIC CACHE KEY ===');
  console.log(`Email: ${email}`);
  console.log(`Normalized: ${normalizedEmail}`);
  console.log(`Cache key: ${key}`);

  const before = cache.get(key);
  console.log('Before clear:', before ? `EXISTS (${JSON.parse(before).length} items)` : 'EMPTY');

  // Force remove using the direct cache reference
  cache.remove(key);
  Utilities.sleep(200);

  const after = cache.get(key);
  console.log('After cache.remove():', after ? `STILL EXISTS (${JSON.parse(after).length} items)` : 'DELETED');

  if (after) {
    console.log('');
    console.log('⚠ Cache remove FAILED - trying alternative approach...');

    // Try removeAll with single key
    cache.removeAll([key]);
    Utilities.sleep(200);

    const afterRemoveAll = cache.get(key);
    console.log('After cache.removeAll([key]):', afterRemoveAll ? `STILL EXISTS` : 'DELETED');

    if (afterRemoveAll) {
      // Try putting null/empty
      console.log('Trying to overwrite with empty array...');
      cache.put(key, JSON.stringify([]), 1); // 1 second TTL
      Utilities.sleep(1500);

      const afterOverwrite = cache.get(key);
      console.log('After overwrite with 1s TTL:', afterOverwrite ? `STILL EXISTS` : 'EXPIRED/DELETED');
    }
  } else {
    console.log('✓ Cache key successfully removed');
  }

  return { key, cleared: !cache.get(key) };
}

/**
 * Nuclear option: Clear ALL script cache by iterating through known patterns
 * Use this when normal clearing doesn't work
 */
function nuclearClearAllMarketingCaches() {
  const cache = CacheService.getScriptCache();

  console.log('=== NUCLEAR CACHE CLEAR ===');
  console.log('This will attempt to clear ALL possible marketing cache keys');
  console.log('');

  // Get managers from sheet
  let managers = [];
  try {
    managers = getManagerList();
    console.log(`Found ${managers.length} managers from getManagerList()`);
  } catch (e) {
    console.log('getManagerList() failed, will try direct sheet access');
  }

  // Also try direct sheet access as backup
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('AllianceManager');
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        for (let j = 0; j < data[i].length; j++) {
          const val = data[i][j];
          if (val && String(val).includes('@') && String(val).includes('.')) {
            const email = String(val).trim().toLowerCase();
            if (!managers.includes(email)) {
              managers.push(email);
            }
          }
        }
      }
      console.log(`After direct sheet scan: ${managers.length} managers`);
    }
  } catch (e) {
    console.log('Direct sheet access failed:', e);
  }

  // Build comprehensive list of keys to clear
  const keysToRemove = [];

  managers.forEach(email => {
    keysToRemove.push(`marketing_approvals_${email}`);
    keysToRemove.push(`marketing_calendar_${email}`);
    keysToRemove.push(`approvals_2026_${email}`);
    keysToRemove.push(`heatmap_${email}`);
    keysToRemove.push(`manager_partners_${email}`);
    keysToRemove.push(`manager_name_${email}`);
  });

  // Add common keys
  keysToRemove.push('marketing_approvals_all');
  keysToRemove.push('all_marketing_approvals');
  keysToRemove.push('marketing_calendar_all');
  keysToRemove.push('all_marketing_calendar');
  keysToRemove.push('all_2026_approvals');
  keysToRemove.push('heatmap_all');
  keysToRemove.push('manager_list');

  console.log(`Total keys to clear: ${keysToRemove.length}`);
  console.log('Keys:', keysToRemove.slice(0, 10).join(', '), '...');
  console.log('');

  // Check which keys exist before clearing
  let existingCount = 0;
  keysToRemove.forEach(key => {
    if (cache.get(key)) {
      existingCount++;
      console.log(`EXISTS: ${key}`);
    }
  });
  console.log(`Found ${existingCount} existing cache entries`);
  console.log('');

  // Clear in batches of 100 (GAS limit)
  console.log('Clearing caches...');
  const batchSize = 100;
  for (let i = 0; i < keysToRemove.length; i += batchSize) {
    const batch = keysToRemove.slice(i, i + batchSize);
    cache.removeAll(batch);
    console.log(`Cleared batch ${Math.floor(i / batchSize) + 1}`);
  }

  Utilities.sleep(500);

  // Verify clearing worked
  console.log('');
  console.log('Verifying clear...');
  let remainingCount = 0;
  keysToRemove.forEach(key => {
    if (cache.get(key)) {
      remainingCount++;
      console.log(`⚠ STILL EXISTS: ${key}`);
    }
  });

  if (remainingCount === 0) {
    console.log('✓ All cache keys successfully cleared!');
  } else {
    console.log(`⚠ ${remainingCount} cache keys still exist after clear`);
  }

  console.log('');
  console.log('=== NUCLEAR CLEAR COMPLETE ===');

  return { totalKeys: keysToRemove.length, existingBefore: existingCount, remainingAfter: remainingCount };
}
