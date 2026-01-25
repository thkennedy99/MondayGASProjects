/**
 * DataProcessor.gs - Functions for processing and writing Monday.com data to Google Sheets
 */

/**
 * Sanitize a value for writing to spreadsheet
 * Handles arrays, objects, dates, and other complex types
 * This is a global utility function used by all sheet write operations
 */
function sanitizeValueForSheet(value) {
  if (value === null || value === undefined) {
    return '';
  }

  // Handle arrays - extract meaningful values
  if (Array.isArray(value)) {
    // If array of objects with 'name' property (like people picker), extract names
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      const names = value.map(item => {
        if (item.name) return item.name;
        if (item.text) return item.text;
        if (item.label) return item.label;
        if (item.value) return item.value;
        return String(item);
      }).filter(n => n);
      return names.join(', ');
    }
    // Simple array of strings/numbers
    return value.map(v => String(v)).join(', ');
  }

  // Handle objects
  if (typeof value === 'object') {
    // Date objects
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // Objects with common value properties
    if (value.name) return String(value.name);
    if (value.text) return String(value.text);
    if (value.label) return String(value.label);
    if (value.value !== undefined) return String(value.value);
    if (value.date) return String(value.date);

    // Special handling for file column objects with mondayUrl
    if (value.mondayUrl !== undefined) {
      return value.mondayUrl || '';
    }

    // Fallback: stringify the object
    try {
      const stringified = JSON.stringify(value);
      // If it's just {} or [], return empty
      if (stringified === '{}' || stringified === '[]') return '';
      return stringified;
    } catch (e) {
      return '';
    }
  }

  // Handle primitives
  return String(value);
}

/**
 * Sanitize an entire row array before writing to sheet
 */
function sanitizeRowForSheet(row) {
  return row.map(value => sanitizeValueForSheet(value));
}

/**
 * Parse column value based on type
 */
function parseColumnValue(columnValue, columnInfo, itemAssets) {
  if (!columnValue) return '';
  
  const { type, text, value } = columnValue;
  
  // For file columns, check if it's the Scope Document column
  if (type === 'file') {
    // Check if this is the Scope Document column based on column info
    if (columnInfo && columnInfo.title === 'Scope Document') {
      // Parse the file value to get both URLs
      if (value) {
        try {
          const parsed = JSON.parse(value);
          
          // Handle different file types
          if (parsed.files && parsed.files.length > 0) {
            const file = parsed.files[0];
            
            // If it's a LINK type, return the link
            if (file.fileType === 'LINK' && file.linkToFile) {
              return {
                mondayUrl: file.linkToFile,
                publicUrl: file.linkToFile
              };
            }
            
            // If it's an ASSET type, find matching asset by ID
            if (file.fileType === 'ASSET' && file.assetId && itemAssets && itemAssets.length > 0) {
              const asset = itemAssets.find(a => a.id == file.assetId);
              if (asset) {
                return {
                  mondayUrl: asset.url || '',
                  publicUrl: asset.public_url || asset.url || ''
                };
              }
            }
          }
        } catch (e) {
          console.log('Failed to parse Scope Document file value:', e);
        }
      }
      
      // If we have text field with URL, use it
      if (text && text.trim() !== '') {
        // Find matching asset to get public URL
        if (itemAssets && itemAssets.length > 0) {
          const asset = itemAssets[0]; // Use first asset if available
          return {
            mondayUrl: text,
            publicUrl: asset ? (asset.public_url || text) : text
          };
        }
        return {
          mondayUrl: text,
          publicUrl: text
        };
      }
    }
    // For other file columns, return empty as originally requested
    return '';
  }
  
  // For status and dropdown columns, use the text value (label)
  if (type === 'color' || type === 'dropdown') {
    if (text) return text;
    
    // If text is not available, try to parse from value
    if (value && columnInfo && columnInfo.settings_str) {
      try {
        const parsed = JSON.parse(value);
        const settings = JSON.parse(columnInfo.settings_str);
        
        // For dropdown columns with multiple values
        if (parsed.ids && Array.isArray(parsed.ids)) {
          const labels = [];
          
          if (settings.labels) {
            parsed.ids.forEach(id => {
              const label = settings.labels.find(l => l.id == id);
              if (label) labels.push(label.name);
            });
          }
          
          return labels.join(', ');
        }
        
        // For status columns
        if (parsed.label) return parsed.label;
        
        // For single dropdown values
        if (parsed.id && settings.labels) {
          const label = settings.labels.find(l => l.id == parsed.id);
          if (label) return label.name;
        }
      } catch (e) {
        // If parsing fails, return text or empty
        console.log(`Failed to parse ${type} value for column ${columnInfo ? columnInfo.title : 'unknown'}:`, e);
      }
    }
    
    return text || '';
  }
  
  // For people columns
  if (type === 'multiple-person') {
    if (text) return text;
    
    if (value) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.personsAndTeams && Array.isArray(parsed.personsAndTeams)) {
          const names = parsed.personsAndTeams.map(p => p.name || '').filter(n => n);
          return names.join(', ');
        }
      } catch (e) {
        // If parsing fails, return text
      }
    }
    
    return text || '';
  }
  
  // For date columns
  if (type === 'date') {
    if (text) return text;
    
    if (value) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.date) return parsed.date;
        if (parsed.text) return parsed.text;
      } catch (e) {
        // If parsing fails, return text
      }
    }
    
    return text || '';
  }
  
  // For all other column types, return text value
  return text || '';
}

/**
 * Standardized column order for Internal Activities (GW boards)
 * This ensures all GW sheets have the same column structure for proper aggregation
 */
const GW_STANDARD_COLUMNS = [
  'Item Name',
  'Group',
  'Board Name',
  'Partner Name',
  'Monday Item ID',
  'Board ID',
  'Activity Status',
  'Owner',
  'Assigned By',  // Monday.com column name (UI maps this to "Assigned To" for display)
  'Importance',
  'Activity Type',
  'Date Created',
  'Date Due',
  'Actual Completion',
  'Files',
  'Comments/Notes',
  'Subitems',
  'Alliance Manager'
];

/**
 * Write data to Google Sheet for GW (Internal Activities) boards
 * Uses standardized column order to ensure proper aggregation in GWMondayData
 */
function writeGWDataToSheet(sheet, boardStructure, items, boardConfig = null) {
  if (!items || items.length === 0) return;

  // Create a map of column ID to column info for parsing
  const columnInfoMap = new Map();
  boardStructure.columns.forEach(col => {
    columnInfoMap.set(col.id, {
      title: col.title,
      type: col.type,
      settings_str: col.settings_str
    });
  });

  // Create a map of column title to column ID for lookup
  const titleToIdMap = new Map();
  boardStructure.columns.forEach(col => {
    titleToIdMap.set(col.title, col.id);
  });

  // Use standardized headers
  const headers = [...GW_STANDARD_COLUMNS];

  // Get alliance manager lookup map
  const allianceManagerMap = getAllianceManagerLookup();

  // Write headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Prepare data rows
  const dataRows = items.map(item => {
    const row = new Array(headers.length).fill('');

    // Set fixed columns
    row[0] = item.name || '';  // Item Name
    row[1] = item.group ? item.group.title : '';  // Group
    row[2] = item.boardName || boardConfig?.boardName || '';  // Board Name
    row[3] = item.partnerName || boardConfig?.partnerName || '';  // Partner Name
    row[4] = item.id || '';  // Monday Item ID
    row[5] = item.boardId || boardConfig?.boardId || '';  // Board ID

    // Process column values
    item.column_values.forEach(colValue => {
      const columnInfo = columnInfoMap.get(colValue.id);
      if (!columnInfo) return;

      const parsedValue = parseColumnValue(colValue, columnInfo, item.assets);
      const title = columnInfo.title;

      // Map to standardized column index
      const colIndex = headers.indexOf(title);
      if (colIndex !== -1 && colIndex >= 6) {  // Skip fixed columns (0-5)
        row[colIndex] = parsedValue;
      }
    });

    // Set Alliance Manager in the last column
    const partnerName = item.partnerName || boardConfig?.partnerName || '';
    row[headers.length - 1] = lookupAllianceManager(partnerName, allianceManagerMap);

    return row;
  });

  // Sanitize all rows before writing
  const sanitizedDataRows = dataRows.map(row => sanitizeRowForSheet(row));

  // Write data rows
  if (sanitizedDataRows.length > 0) {
    const startRow = 2;  // Always start at row 2 since we just wrote headers
    console.log(`writeGWDataToSheet: Writing ${sanitizedDataRows.length} rows starting at row ${startRow}`);
    sheet.getRange(startRow, 1, sanitizedDataRows.length, headers.length).setValues(sanitizedDataRows);
    console.log(`writeGWDataToSheet: Successfully wrote ${sanitizedDataRows.length} rows`);

    // Force Google Sheets to apply changes
    SpreadsheetApp.flush();
  }
}

/**
 * Write data to Google Sheet
 */
function writeDataToSheet(sheet, boardStructure, items, isFirstBoard = true, boardConfig = null) {
  if (!items || items.length === 0) return;

  // Create a map of column ID to column info for parsing
  const columnInfoMap = new Map();
  let scopeDocColumnIndex = -1;

  boardStructure.columns.forEach(col => {
    columnInfoMap.set(col.id, {
      title: col.title,
      type: col.type,
      settings_str: col.settings_str
    });
  });

  let headers;
  let publicUrlColumnIndex;
  let allianceManagerColumnIndex;

  // If not first board, read existing headers from sheet
  if (!isFirstBoard) {
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    headers = existingHeaders;

    // Find the column indexes from existing headers
    publicUrlColumnIndex = headers.indexOf('Scope Document Public URL');
    allianceManagerColumnIndex = headers.indexOf('Alliance Manager');
  } else {
    // Get column headers - include Item Name, Group, Board Name, Partner Name, Monday Item ID, and Board ID as first columns
    headers = ['Item Name', 'Group', 'Board Name', 'Partner Name', 'Monday Item ID', 'Board ID'];
  }

  const columnMap = new Map();

  // Add other columns from board structure
  boardStructure.columns.forEach(col => {
    if (col.type !== 'name') { // Skip the name column as we already have Item Name
      // Skip if column title already exists in headers (prevents duplicates like Partner Name)
      if (!headers.includes(col.title)) {
        // Only add to headers array if this is the first board
        if (isFirstBoard) {
          headers.push(col.title);
          const index = headers.length - 1;
          columnMap.set(col.id, index);

          // Track the Scope Document column index
          if (col.title === 'Scope Document') {
            scopeDocColumnIndex = index;
          }
        }
        // If not first board and column doesn't exist in sheet, skip it
      } else {
        // Column already exists in headers, map the column ID to existing index
        const existingIndex = headers.indexOf(col.title);
        columnMap.set(col.id, existingIndex);

        // Track the Scope Document column index
        if (col.title === 'Scope Document') {
          scopeDocColumnIndex = existingIndex;
        }
      }
    }
  });

  // Add columns for Public URLs and Alliance Manager at the end (only for first board)
  if (isFirstBoard) {
    headers.push('Scope Document Public URL');
    publicUrlColumnIndex = headers.length - 1;

    headers.push('Alliance Manager');
    allianceManagerColumnIndex = headers.length - 1;
  }
  
  // Get alliance manager lookup map
  const allianceManagerMap = getAllianceManagerLookup();
  
  // Write headers only for the first board
  if (isFirstBoard) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  
  // Prepare data rows
  const dataRows = items.map(item => {
    const row = new Array(headers.length).fill('');
    let scopeDocPublicUrl = '';
    
    // Set Item Name
    row[0] = item.name || '';
    
    // Set Group
    row[1] = item.group ? item.group.title : '';
    
    // Set Board Name and Partner Name
    row[2] = item.boardName || boardConfig?.boardName || '';
    row[3] = item.partnerName || boardConfig?.partnerName || '';
    
    // Set Monday Item ID
    row[4] = item.id || '';
    
    // Set Board ID
    row[5] = item.boardId || boardConfig?.boardId || '';
    
    // Set column values
    item.column_values.forEach(colValue => {
      const colIndex = columnMap.get(colValue.id);
      if (colIndex !== undefined) {
        // Get column info from our map
        const columnInfo = columnInfoMap.get(colValue.id);
        // Pass item assets for file columns
        const parsedValue = parseColumnValue(colValue, columnInfo, item.assets);
        
        // Special handling for Scope Document column
        if (columnInfo.title === 'Scope Document' && typeof parsedValue === 'object' && parsedValue.mondayUrl) {
          // Put Monday URL in the Scope Document column
          row[colIndex] = parsedValue.mondayUrl;
          // Save public URL to put in the second-to-last column
          scopeDocPublicUrl = parsedValue.publicUrl;
        } else {
          row[colIndex] = parsedValue;
        }
      }
    });
    
    // Put the public URL in the second-to-last column
    row[publicUrlColumnIndex] = scopeDocPublicUrl;
    
    // Lookup and set Alliance Manager in the last column
    const partnerName = item.partnerName || boardConfig?.partnerName || '';
    row[allianceManagerColumnIndex] = lookupAllianceManager(partnerName, allianceManagerMap);
    
    return row;
  });

  // Sanitize all rows before writing to ensure no arrays/objects slip through
  const sanitizedDataRows = dataRows.map(row => sanitizeRowForSheet(row));

  // Write data rows - append to existing data
  if (sanitizedDataRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    console.log(`writeDataToSheet: Writing ${sanitizedDataRows.length} rows starting at row ${startRow}`);
    sheet.getRange(startRow, 1, sanitizedDataRows.length, headers.length).setValues(sanitizedDataRows);
    console.log(`writeDataToSheet: Successfully wrote ${sanitizedDataRows.length} rows`);

    // Force Google Sheets to apply changes and recalculate formulas (like GWMondayData)
    SpreadsheetApp.flush();
  }

  // Note: Post-processing is now handled in the calling function after all boards are processed
}


/**
 * Get alliance manager lookup map from Partner sheet
 * Includes retry logic for spreadsheet timeout errors
 */
function getAllianceManagerLookup(retryCount) {
  retryCount = retryCount || 0;
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5000, 10000, 20000]; // Longer exponential backoff: 5s, 10s, 20s

  try {
    console.log('Loading alliance manager lookup data...');

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const partnerSheet = spreadsheet.getSheetByName('Partner');

    if (!partnerSheet) {
      console.log('Partner sheet not found. Alliance Manager lookups will be empty.');
      return new Map();
    }

    const lastRow = partnerSheet.getLastRow();
    if (lastRow < 2) {
      console.log('No data found in Partner sheet.');
      return new Map();
    }

    // Get columns A and D in a single batch read (more efficient)
    // Read columns A through D, then extract what we need
    const allData = partnerSheet.getRange(2, 1, lastRow - 1, 4).getValues();

    // Create lookup map
    const allianceManagerMap = new Map();

    for (let i = 0; i < allData.length; i++) {
      const accountName = allData[i][0];  // Column A
      const accountOwner = allData[i][3]; // Column D

      if (accountName && accountName.toString().trim() !== '') {
        const key = accountName.toString().trim();
        const value = accountOwner ? accountOwner.toString().trim() : '';
        allianceManagerMap.set(key, value);
      }
    }

    console.log(`Loaded ${allianceManagerMap.size} alliance manager mappings`);
    return allianceManagerMap;

  } catch (error) {
    // Check if this is a timeout error and we can retry
    const isTimeoutError = error && error.message && error.message.includes('timed out');

    if (isTimeoutError && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.log(`Spreadsheet timeout in getAllianceManagerLookup. Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay/1000}s...`);
      // Try to flush any pending operations before retry (but don't fail if flush times out too)
      try { SpreadsheetApp.flush(); } catch (e) { /* ignore flush errors */ }
      Utilities.sleep(delay);
      return getAllianceManagerLookup(retryCount + 1);
    }

    console.error('Error loading alliance manager lookup:', error);
    return new Map();
  }
}

/**
 * Lookup alliance manager for a given partner name
 */
function lookupAllianceManager(partnerName, allianceManagerMap) {
  if (!partnerName || !allianceManagerMap) {
    return '';
  }
  
  const trimmedPartnerName = partnerName.toString().trim();
  
  // Try exact match first
  if (allianceManagerMap.has(trimmedPartnerName)) {
    return allianceManagerMap.get(trimmedPartnerName);
  }
  
  // Try case-insensitive match
  for (const [key, value] of allianceManagerMap) {
    if (key.toLowerCase() === trimmedPartnerName.toLowerCase()) {
      return value;
    }
  }
  
  // No match found
  console.log(`No alliance manager found for partner: "${trimmedPartnerName}"`);
  return '';
}

/**
 * Delete rows where column B (Group) equals "Completed"
 * Optimized to filter in memory and write back in a single batch operation
 * Includes retry logic for spreadsheet timeout errors
 */
function deleteCompletedRows(sheet, retryCount) {
  retryCount = retryCount || 0;
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5000, 10000, 20000]; // Longer exponential backoff: 5s, 10s, 20s

  // Statuses to filter out
  const COMPLETED_STATUSES = ['Completed', 'Cancelled', 'Accepted by Steer Co'];

  try {
    console.log('Filtering out rows with completed/cancelled statuses...');

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow < 2 || lastCol < 1) {
      console.log('No data rows to process');
      return;
    }

    // Read ALL data at once (row 2 onwards, excluding header)
    const allData = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const originalCount = allData.length;

    // Filter in memory - keep rows where column B (index 1) is NOT a completed status
    const filteredData = allData.filter(row => {
      const groupValue = row[1]; // Column B is index 1
      return !COMPLETED_STATUSES.includes(groupValue);
    });

    const deletedCount = originalCount - filteredData.length;
    console.log(`Filtering: ${originalCount} rows -> ${filteredData.length} rows (removing ${deletedCount} completed/cancelled)`);

    // Only update sheet if rows were actually filtered out
    if (deletedCount > 0) {
      // Clear the data area (keep header row)
      sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();

      // Write back filtered data in one operation
      if (filteredData.length > 0) {
        sheet.getRange(2, 1, filteredData.length, lastCol).setValues(filteredData);
      }

      console.log(`Removed ${deletedCount} rows with completed/cancelled statuses`);
    } else {
      console.log('No completed/cancelled rows to remove');
    }

  } catch (error) {
    // Check if this is a timeout error and we can retry
    const isTimeoutError = error && error.message && error.message.includes('timed out');

    if (isTimeoutError && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.log(`Spreadsheet timeout in deleteCompletedRows. Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay/1000}s...`);
      // Try to flush any pending operations before retry (but don't fail if flush times out too)
      try { SpreadsheetApp.flush(); } catch (e) { /* ignore flush errors */ }
      Utilities.sleep(delay);
      return deleteCompletedRows(sheet, retryCount + 1);
    }

    console.error('Error deleting completed rows:', error);
    // Don't throw - allow sync to continue
  }
}

/**
 * Clear dashboard sheet data from row 2 onwards
 */
function clearDashboardSheetData(sheet) {
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
 * Write dashboard data to MondayDashboard sheet
 */
function writeDashboardDataToSheet(sheet, boardStructure, items, boardId) {
  if (!items || items.length === 0) return;
  
  // Create a map of column ID to column info for parsing
  const columnInfoMap = new Map();
  
  boardStructure.columns.forEach(col => {
    columnInfoMap.set(col.id, {
      title: col.title,
      type: col.type,
      settings_str: col.settings_str
    });
  });
  
  // Get column headers - start with Item, Monday Item ID, Board ID
  const headers = ['Item', 'Monday Item ID', 'Board ID'];
  const columnMap = new Map();
  
  // Add other columns from board structure
  boardStructure.columns.forEach(col => {
    if (col.type !== 'name') { // Skip the name column as we already have Item
      headers.push(col.title);
      const index = headers.length - 1;
      columnMap.set(col.id, index);
    }
  });
  
  // Add Partner Name and Alliance Manager columns at the end
  headers.push('Partner Name');
  const partnerNameColumnIndex = headers.length - 1;
  
  headers.push('Alliance Manager');
  const allianceManagerColumnIndex = headers.length - 1;
  
  // Get partner translate lookup map
  const partnerTranslateMap = getPartnerTranslateLookup();
  
  // Get alliance manager lookup map
  const allianceManagerMap = getAllianceManagerLookup();
  
  // Write headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // Prepare data rows
  const dataRows = items.map(item => {
    const row = new Array(headers.length).fill('');
    
    // Set Item (original partner name from Monday)
    row[0] = item.name || '';
    
    // Set Monday Item ID
    row[1] = item.id || '';
    
    // Set Board ID
    row[2] = boardId;
    
    // Set column values
    item.column_values.forEach(colValue => {
      const colIndex = columnMap.get(colValue.id);
      if (colIndex !== undefined) {
        // Get column info from our map
        const columnInfo = columnInfoMap.get(colValue.id);
        // Parse the value
        const parsedValue = parseColumnValue(colValue, columnInfo, item.assets);
        row[colIndex] = parsedValue;
      }
    });
    
    // Translate partner name and set Partner Name
    const originalPartnerName = item.name || '';
    const translatedPartnerName = lookupPartnerTranslation(originalPartnerName, partnerTranslateMap);
    row[partnerNameColumnIndex] = translatedPartnerName;
    
    // Lookup and set Alliance Manager
    row[allianceManagerColumnIndex] = lookupAllianceManager(translatedPartnerName, allianceManagerMap);

    return row;
  });

  // Sanitize all rows before writing to ensure no arrays/objects slip through
  const sanitizedDataRows = dataRows.map(row => sanitizeRowForSheet(row));

  // Write data rows
  if (sanitizedDataRows.length > 0) {
    sheet.getRange(2, 1, sanitizedDataRows.length, headers.length).setValues(sanitizedDataRows);
  }

  // Auto-resize columns for better visibility (single batch call)
  sheet.autoResizeColumns(1, headers.length);

  console.log('Dashboard data processing complete');
}


/**
 * Translate partner names based on PartnerTranslate sheet mapping
 */
function translatePartnerNames() {
  try {
    console.log('Starting partner name translation...');
    
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // Get the PartnerTranslate sheet
    const translateSheet = spreadsheet.getSheetByName('PartnerTranslate');
    if (!translateSheet) {
      console.log('PartnerTranslate sheet not found. Skipping translation.');
      return;
    }
    
    // Get the MondayData sheet
    const mondaySheet = spreadsheet.getSheetByName(SHEET_TAB_NAME);
    if (!mondaySheet) {
      console.log('MondayData sheet not found. Skipping translation.');
      return;
    }
    
    // Get the translation mapping from PartnerTranslate
    const translateLastRow = translateSheet.getLastRow();
    if (translateLastRow < 2) {
      console.log('No translation mappings found in PartnerTranslate sheet.');
      return;
    }
    
    // Get all translation data at once (columns A and B starting from row 2)
    const translationData = translateSheet.getRange(2, 1, translateLastRow - 1, 2).getValues();
    
    // Create a map for faster lookups
    const translationMap = new Map();
    translationData.forEach(row => {
      const originalName = row[0];
      const correctName = row[1];
      if (originalName && correctName) {
        translationMap.set(originalName.toString().trim(), correctName.toString().trim());
      }
    });
    
    console.log(`Found ${translationMap.size} translation mappings`);
    
    // Get all data from MondayData column D (Partner Name - now column 4, Monday Item ID is column 5)
    const mondayLastRow = mondaySheet.getLastRow();
    if (mondayLastRow < 2) {
      console.log('No data found in MondayData sheet.');
      return;
    }
    
    // Get all values from column D (Partner Name) at once
    const range = mondaySheet.getRange(2, 4, mondayLastRow - 1, 1);
    const values = range.getValues();
    
    // Track changes
    let changesCount = 0;
    
    // Update values based on translation map
    const updatedValues = values.map(row => {
      const currentValue = row[0];
      if (currentValue) {
        const trimmedValue = currentValue.toString().trim();
        if (translationMap.has(trimmedValue)) {
          const newValue = translationMap.get(trimmedValue);
          console.log(`Translating: "${trimmedValue}" → "${newValue}"`);
          changesCount++;
          return [newValue];
        }
      }
      return row;
    });
    
    // Write all updated values back at once
    if (changesCount > 0) {
      range.setValues(updatedValues);
      console.log(`Partner name translation complete. ${changesCount} names updated.`);
    } else {
      console.log('No partner names needed translation.');
    }
    
  } catch (error) {
    console.error('Error translating partner names:', error);
    // Don't throw the error - allow the sync to continue even if translation fails
  }
}

/**
 * Translate partner names on a specific sheet (for temp sheet sync)
 * Includes retry logic for spreadsheet timeout errors
 * @param {Sheet} targetSheet - The sheet to translate partner names on
 */
function translatePartnerNamesOnSheet(targetSheet, retryCount) {
  retryCount = retryCount || 0;
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5000, 10000, 20000]; // Longer exponential backoff: 5s, 10s, 20s

  try {
    console.log('Starting partner name translation on sheet:', targetSheet.getName());

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // Get the PartnerTranslate sheet
    const translateSheet = spreadsheet.getSheetByName('PartnerTranslate');
    if (!translateSheet) {
      console.log('PartnerTranslate sheet not found. Skipping translation.');
      return;
    }

    // Get the translation mapping from PartnerTranslate
    const translateLastRow = translateSheet.getLastRow();
    if (translateLastRow < 2) {
      console.log('No translation mappings found in PartnerTranslate sheet.');
      return;
    }

    // Get all translation data at once (columns A and B starting from row 2)
    const translationData = translateSheet.getRange(2, 1, translateLastRow - 1, 2).getValues();

    // Create a map for faster lookups
    const translationMap = new Map();
    translationData.forEach(row => {
      const originalName = row[0];
      const correctName = row[1];
      if (originalName && correctName) {
        translationMap.set(originalName.toString().trim(), correctName.toString().trim());
      }
    });

    console.log(`Found ${translationMap.size} translation mappings`);

    // Get all data from target sheet column D (Partner Name)
    const lastRow = targetSheet.getLastRow();
    if (lastRow < 2) {
      console.log('No data found in target sheet.');
      return;
    }

    // Get all values from column D (Partner Name) at once
    const range = targetSheet.getRange(2, 4, lastRow - 1, 1);
    const values = range.getValues();

    // Track changes
    let changesCount = 0;

    // Update values based on translation map
    const updatedValues = values.map(row => {
      const currentValue = row[0];
      if (currentValue) {
        const trimmedValue = currentValue.toString().trim();
        if (translationMap.has(trimmedValue)) {
          const newValue = translationMap.get(trimmedValue);
          changesCount++;
          return [newValue];
        }
      }
      return row;
    });

    // Write all updated values back at once
    if (changesCount > 0) {
      range.setValues(updatedValues);
      console.log(`Partner name translation complete. ${changesCount} names updated.`);
    } else {
      console.log('No partner names needed translation.');
    }

  } catch (error) {
    // Check if this is a timeout error and we can retry
    const isTimeoutError = error && error.message && error.message.includes('timed out');

    if (isTimeoutError && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.log(`Spreadsheet timeout in translatePartnerNamesOnSheet. Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay/1000}s...`);
      // Try to flush any pending operations before retry (but don't fail if flush times out too)
      try { SpreadsheetApp.flush(); } catch (e) { /* ignore flush errors */ }
      Utilities.sleep(delay);
      return translatePartnerNamesOnSheet(targetSheet, retryCount + 1);
    }

    console.error('Error translating partner names on sheet:', error);
    // Don't throw the error - allow the sync to continue even if translation fails
  }
}

/**
 * Sort the data by column A (Item Name)
 * Includes retry logic for spreadsheet timeout errors
 */
function sortDataByItemName(sheet, retryCount) {
  retryCount = retryCount || 0;
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5000, 10000, 20000]; // Longer exponential backoff: 5s, 10s, 20s

  try {
    console.log('Sorting data by Item Name (column A)...');

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();

    if (lastRow > 1) {
      const dataRange = sheet.getRange(2, 1, lastRow - 1, lastColumn);
      dataRange.sort({column: 1, ascending: true});
      console.log('Data sorted successfully');
    } else {
      console.log('No data to sort');
    }

  } catch (error) {
    // Check if this is a timeout error and we can retry
    const isTimeoutError = error && error.message && error.message.includes('timed out');

    if (isTimeoutError && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.log(`Spreadsheet timeout in sortDataByItemName. Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay/1000}s...`);
      // Try to flush any pending operations before retry (but don't fail if flush times out too)
      try { SpreadsheetApp.flush(); } catch (e) { /* ignore flush errors */ }
      Utilities.sleep(delay);
      return sortDataByItemName(sheet, retryCount + 1);
    }

    console.error('Error sorting data:', error);
    // Don't throw - allow sync to continue
  }
}

/**
 * Append a newly created item directly to the spreadsheet
 * This bypasses the Monday.com API delay for immediate UI updates
 *
 * @param {string} sheetName - Name of the target sheet (e.g., 'MarketingApproval')
 * @param {string} itemName - Name of the new item
 * @param {string} itemId - Monday.com item ID
 * @param {string} boardId - Monday.com board ID
 * @param {string} boardName - Name of the board
 * @param {Object} columnValues - Column values from the create form
 * @returns {boolean} Success status
 */
function appendItemToSheet(sheetName, itemName, itemId, boardId, boardName, columnValues) {
  try {
    console.log(`Appending new item to ${sheetName}:`, itemName);
    console.log('Column values received:', JSON.stringify(columnValues));

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      console.error(`Sheet not found: ${sheetName}`);
      return false;
    }

    // Get existing headers
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    console.log('Sheet headers:', headers.join(', '));

    // Create new row array
    const newRow = new Array(headers.length).fill('');

    // Map standard columns
    const headerMap = {};
    headers.forEach((header, index) => {
      headerMap[header] = index;
    });

    // Use global sanitizeValueForSheet function for consistency
    const sanitizeValue = sanitizeValueForSheet;

    // Set standard fields
    if (headerMap['Item Name'] !== undefined) newRow[headerMap['Item Name']] = sanitizeValue(itemName);
    if (headerMap['Monday Item ID'] !== undefined) newRow[headerMap['Monday Item ID']] = sanitizeValue(itemId);
    if (headerMap['Board ID'] !== undefined) newRow[headerMap['Board ID']] = sanitizeValue(boardId);
    if (headerMap['Board Name'] !== undefined) newRow[headerMap['Board Name']] = sanitizeValue(boardName);
    if (headerMap['Partner Name'] !== undefined) newRow[headerMap['Partner Name']] = 'Marketing Team';

    // Map column values to headers
    // Handle various column name formats (with and without spaces)
    Object.entries(columnValues || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;

      // Sanitize the value before writing
      const sanitizedValue = sanitizeValue(value);
      console.log(`Processing column "${key}": ${typeof value} -> "${sanitizedValue}"`);

      // Try exact match first
      if (headerMap[key] !== undefined) {
        newRow[headerMap[key]] = sanitizedValue;
        return;
      }

      // Try with spaces removed
      const keyNoSpaces = key.replace(/\s+/g, '');
      for (const header of headers) {
        if (header.replace(/\s+/g, '') === keyNoSpaces) {
          newRow[headerMap[header]] = sanitizedValue;
          return;
        }
      }

      // Try case-insensitive match
      const keyLower = key.toLowerCase();
      for (const header of headers) {
        if (header.toLowerCase() === keyLower) {
          newRow[headerMap[header]] = sanitizedValue;
          return;
        }
      }
    });

    console.log('Row to append:', newRow.slice(0, 15).join(' | ') + '...');

    // Append the new row
    sheet.appendRow(newRow);

    // Ensure the write is committed
    SpreadsheetApp.flush();

    console.log(`Successfully appended item "${itemName}" to ${sheetName}`);
    return true;

  } catch (error) {
    console.error('Error appending item to sheet:', error);
    return false;
  }
}

/**
 * Update an existing Partner Activity item in the MondayData sheet
 * This provides immediate UI feedback while the sync runs in the background
 *
 * @param {string} itemId - Monday.com item ID
 * @param {Object} updates - Object with column titles as keys and new values
 * @param {string} boardId - Board ID for the item
 * @param {string} partnerName - Partner name for the item
 * @returns {Object} Success/error result
 */
function updatePartnerActivityInSheet(itemId, updates, boardId, partnerName) {
  try {
    console.log('Updating Partner Activity in MondayData sheet:', itemId);
    console.log('Updates:', JSON.stringify(updates));

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SHEET_TAB_NAME);

    if (!sheet) {
      console.error('MondayData sheet not found');
      return { success: false, error: 'MondayData sheet not found' };
    }

    // Get headers
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headerMap = {};
    headers.forEach((header, index) => {
      headerMap[header] = index;
    });

    // Find the Monday Item ID column
    const itemIdColIndex = headerMap['Monday Item ID'];
    if (itemIdColIndex === undefined) {
      console.error('Monday Item ID column not found');
      return { success: false, error: 'Monday Item ID column not found' };
    }

    // Find the row with this item ID
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      console.log('No data rows in sheet');
      return { success: false, error: 'No data rows in sheet' };
    }

    const itemIdCol = sheet.getRange(2, itemIdColIndex + 1, lastRow - 1, 1).getValues();
    let rowIndex = -1;

    for (let i = 0; i < itemIdCol.length; i++) {
      if (String(itemIdCol[i][0]) === String(itemId)) {
        rowIndex = i + 2; // +2 because data starts at row 2
        break;
      }
    }

    if (rowIndex === -1) {
      console.log('Item not found in sheet, will be added on next sync');
      return { success: false, error: 'Item not found in sheet' };
    }

    console.log('Found item at row:', rowIndex);

    // Get the current row data
    const rowData = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];

    // Update values
    const sanitizeValue = sanitizeValueForSheet;
    let changesCount = 0;

    Object.entries(updates).forEach(([key, value]) => {
      // Handle Item Name / Name updates
      if (key === 'Item Name' || key === 'Name') {
        if (headerMap['Item Name'] !== undefined) {
          rowData[headerMap['Item Name']] = sanitizeValue(value);
          changesCount++;
        }
        return;
      }

      // Try exact match first
      if (headerMap[key] !== undefined) {
        rowData[headerMap[key]] = sanitizeValue(value);
        changesCount++;
        return;
      }

      // Try case-insensitive match
      const keyLower = key.toLowerCase();
      for (const header of headers) {
        if (header.toLowerCase() === keyLower) {
          rowData[headerMap[header]] = sanitizeValue(value);
          changesCount++;
          break;
        }
      }
    });

    if (changesCount > 0) {
      // Write updated row back
      sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowData]);
      SpreadsheetApp.flush();
      console.log(`Updated ${changesCount} fields for item ${itemId}`);
    }

    return { success: true, rowIndex, changesCount };

  } catch (error) {
    console.error('Error updating Partner Activity in sheet:', error);
    return { success: false, error: String(error.message || error) };
  }
}

/**
 * Add a new Partner Activity item to the MondayData sheet
 * This provides immediate UI feedback while the sync runs in the background
 *
 * @param {string} itemName - Name of the new item
 * @param {string} itemId - Monday.com item ID
 * @param {string} boardId - Monday.com board ID
 * @param {string} boardName - Name of the board
 * @param {string} partnerName - Partner name
 * @param {Object} columnValues - Column values from the create form
 * @returns {Object} Success/error result
 */
function addPartnerActivityToSheet(itemName, itemId, boardId, boardName, partnerName, columnValues) {
  try {
    console.log('Adding Partner Activity to MondayData sheet:', itemName);
    console.log('Column values:', JSON.stringify(columnValues));

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(SHEET_TAB_NAME);

    if (!sheet) {
      console.error('MondayData sheet not found');
      return { success: false, error: 'MondayData sheet not found' };
    }

    // Get headers
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headerMap = {};
    headers.forEach((header, index) => {
      headerMap[header] = index;
    });

    // Create new row
    const newRow = new Array(headers.length).fill('');
    const sanitizeValue = sanitizeValueForSheet;

    // Set standard fields
    if (headerMap['Item Name'] !== undefined) newRow[headerMap['Item Name']] = sanitizeValue(itemName);
    if (headerMap['Monday Item ID'] !== undefined) newRow[headerMap['Monday Item ID']] = sanitizeValue(itemId);
    if (headerMap['Board ID'] !== undefined) newRow[headerMap['Board ID']] = sanitizeValue(boardId);
    if (headerMap['Board Name'] !== undefined) newRow[headerMap['Board Name']] = sanitizeValue(boardName);
    if (headerMap['Partner Name'] !== undefined) newRow[headerMap['Partner Name']] = sanitizeValue(partnerName);

    // Map column values to headers
    Object.entries(columnValues || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;

      const sanitizedValue = sanitizeValue(value);

      // Try exact match first
      if (headerMap[key] !== undefined) {
        newRow[headerMap[key]] = sanitizedValue;
        return;
      }

      // Try case-insensitive match
      const keyLower = key.toLowerCase();
      for (const header of headers) {
        if (header.toLowerCase() === keyLower) {
          newRow[headerMap[header]] = sanitizedValue;
          break;
        }
      }
    });

    // Append the new row
    sheet.appendRow(newRow);
    SpreadsheetApp.flush();

    console.log(`Successfully added Partner Activity "${itemName}" to MondayData`);
    return { success: true };

  } catch (error) {
    console.error('Error adding Partner Activity to sheet:', error);
    return { success: false, error: String(error.message || error) };
  }
}
