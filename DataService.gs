/**
 * DataService.gs - Data Operations Layer
 * Handles all data operations between Monday.com and Google Sheets
 * FIXED: Corrected column mappings based on actual DataProcessor output
 */

class DataService {
  constructor() {
    this.spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    this.cache = CacheService.getScriptCache();
    this.monday = new MondayAPI();
  }
  

// Add this as a static method in DataService class
static ensureSerializable(data) {
  if (data === null || data === undefined) return data;
  
  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => DataService.ensureSerializable(item));
  }
  
  // Handle objects
  if (typeof data === 'object') {
    const result = {};
    for (const key in data) {
      const value = data[key];
      // Convert dates to strings
      if (value instanceof Date) {
        result[key] = value.toISOString();
      } else if (typeof value === 'function') {
        // Skip functions
        continue;
      } else {
        result[key] = DataService.ensureSerializable(value);
      }
    }
    return result;
  }
  
  // Return primitives as-is
  return data;
}

/**
 * Get activity data (partner or internal)
 * Caching disabled - always reads fresh data from spreadsheet
 */
getActivityData(type, manager, filters = {}, sort = {}, pagination = {}) {
  console.log(`=== getActivityData (NO CACHE) ===`);
  console.log(`Type: ${type}, Manager: ${manager}`);
  console.log(`Reading directly from spreadsheet (caching disabled)`);

  try {
    const sheet = this.spreadsheet.getSheetByName(type === 'partner' ? 'MondayData' : 'GWMondayData');
    if (!sheet) throw new Error(`Sheet not found: ${type === 'partner' ? 'MondayData' : 'GWMondayData'}`);
    
    let data = this.getSheetData(sheet);
    
    // Debug: Log sample row before processing
    if (data.length > 0) {
      console.log('Sample row before processing:', JSON.stringify(data[0]));
    }
    
    // Apply manager filter
    data = this.filterByManager(data, manager, type);
    
    // Apply additional filters
    if (Object.keys(filters).length > 0) {
      data = this.applyFilters(data, filters);
    }
    
    // Apply sorting - handle both "Name" and "Item Name" field names
    if (sort.field) {
      // If UI is sorting by "Name", map it to "Item Name" for the actual data
      const sortField = sort.field === 'Name' ? 'Item Name' : sort.field;
      data = this.sortData(data, sortField, sort.order);
    }
    
    // Apply pagination
    const totalItems = data.length;
    const page = pagination.page || 1;
    const pageSize = pagination.pageSize || 50;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    
    data = data.slice(startIndex, endIndex);
    
    // Map "Item Name" to "Name" for UI compatibility and ensure all values are strings
    const sanitizedData = data.map(row => {
      const sanitized = {};

      // First, add the Name field from Item Name
      if (row['Item Name'] !== undefined) {
        sanitized['Name'] = this.convertToString(row['Item Name']);
      }

      // For internal activities, map "Assigned To" to "Assigned By"
      if (type === 'internal' && row['Assigned To'] !== undefined) {
        sanitized['Assigned By'] = this.convertToString(row['Assigned To']);
      }

      // Then add all other fields
      for (const key in row) {
        if (key === 'Item Name') {
          // Skip Item Name as we've already added it as Name
          continue;
        } else if (type === 'internal' && key === 'Assigned To') {
          // Skip Assigned To as we've already added it as Assigned By
          continue;
        } else {
          sanitized[key] = this.convertToString(row[key]);
        }
      }

      // Debug: Log first sanitized row
      if (data.indexOf(row) === 0) {
        console.log('First sanitized row:', JSON.stringify(sanitized));
        console.log('Has Name field:', sanitized.hasOwnProperty('Name'));
        console.log('Name value:', sanitized['Name']);
      }

      return sanitized;
    });
    
    const result = {
      data: sanitizedData,
      total: String(totalItems),
      page: String(page),
      pageSize: String(pageSize),
      pages: String(Math.ceil(totalItems / pageSize))
    };
    
    // Debug: Log what we're returning
    console.log(`Returning ${result.data.length} rows for ${type} activities`);
    if (result.data.length > 0) {
      console.log('First row keys:', Object.keys(result.data[0]));
    }

    // Caching disabled - always return fresh data from spreadsheet
    return result;
    
  } catch (error) {
    console.error('Error getting activity data:', error);
    throw error;
  }
}
  
// Inside the DataService class definition, add this method:
getMarketingCalendarData(managerEmail) {
  try {
    // Normalize email to lowercase
    const normalizedEmail = managerEmail ? managerEmail.toLowerCase() : '';

    console.log(`=== getMarketingCalendarData (NO CACHE) ===`);
    console.log(`Manager email: ${managerEmail}`);
    console.log(`Reading directly from spreadsheet (caching disabled)`);

    const sheet = this.spreadsheet.getSheetByName('MarketingCalendar');
    if (!sheet) {
      console.log('MarketingCalendar sheet not found');
      return [];
    }
    
    const data = this.getSheetData(sheet);
    const managerName = this.getManagerName(managerEmail);
    
    console.log(`Getting marketing calendar for: ${managerEmail} / ${managerName}`);
    console.log(`Total marketing calendar rows: ${data.length}`);
    
    // Get partner translation data for partner name mapping
    const translateSheet = this.spreadsheet.getSheetByName('PartnerTranslate');
    const translateData = translateSheet ? this.getSheetData(translateSheet) : [];
    
    // Get managed partners for filtering
    const managedPartners = this.getManagerPartners(managerEmail);
    console.log(`Manager ${managerName} manages partners: ${managedPartners.join(', ')}`);
    
    // Filter and transform calendar data
    const calendarData = data.filter(row => {
      // Check if this activity belongs to a partner managed by this manager
      const partner = row['Partner'];
      const owner = row['Owner'];
      
      // Check if partner is in managed partners list
      let matchesPartner = false;
      if (partner) {
        matchesPartner = managedPartners.some(p => 
          p.toLowerCase() === partner.toString().toLowerCase()
        );
        
        // Also check translated partner names
        if (!matchesPartner) {
          const translation = translateData.find(t => 
            t['External Partner Name'] === partner
          );
          if (translation && translation['Monday Partner Name']) {
            matchesPartner = managedPartners.some(p => 
              p.toLowerCase() === translation['Monday Partner Name'].toLowerCase()
            );
          }
        }
      }
      
      // Check if owner matches manager or their team
      const matchesOwner = owner === managerEmail || 
                          owner === managerName ||
                          (owner && owner.includes(managerName.split(' ')[0]));
      
      return matchesPartner || matchesOwner;
    }).map(row => {
      // Transform and sanitize the data
      const itemName = String(row['Item Name'] || '');
      const month = String(row['Month'] || '');
      const partner = String(row['Partner'] || '');
      const owner = String(row['Owner'] || '');
      const activityType = String(row['Activity Type'] || '');
      const dateStr = row['Date'];
      const eventDateStr = row['EventDate'];
      const week = String(row['Week'] || '');
      const mondayItemId = String(row['Monday Item ID'] || '');
      const boardId = String(row['Board ID'] || '');
      
      // Format dates as strings
      let formattedDate = '';
      let formattedEventDate = '';
      
      if (dateStr) {
        if (dateStr instanceof Date) {
          const year = dateStr.getFullYear();
          const month = String(dateStr.getMonth() + 1).padStart(2, '0');
          const day = String(dateStr.getDate()).padStart(2, '0');
          formattedDate = `${year}-${month}-${day}`;
        } else {
          formattedDate = String(dateStr);
        }
      }
      
      if (eventDateStr) {
        if (eventDateStr instanceof Date) {
          const year = eventDateStr.getFullYear();
          const month = String(eventDateStr.getMonth() + 1).padStart(2, '0');
          const day = String(eventDateStr.getDate()).padStart(2, '0');
          formattedEventDate = `${year}-${month}-${day}`;
        } else {
          formattedEventDate = String(eventDateStr);
        }
      }
      
      // Determine status/urgency
      let status = 'scheduled';
      if (dateStr) {
        const activityDate = dateStr instanceof Date ? dateStr : new Date(dateStr);
        const today = new Date();
        const daysUntil = Math.ceil((activityDate - today) / (1000 * 60 * 60 * 24));
        
        if (daysUntil < 0) {
          status = 'past';
        } else if (daysUntil <= 7) {
          status = 'upcoming';
        } else if (daysUntil <= 30) {
          status = 'thisMonth';
        }
      }
      
      return {
        'Item Name': itemName,
        'Month': month,
        'Week': week,
        'Partner': partner,
        'Owner': owner,
        'Activity Type': activityType,
        'Date': formattedDate,
        'Event Date': formattedEventDate,
        'Monday Item ID': mondayItemId,
        'Board ID': boardId,
        'status': status
      };
    });
    
    console.log(`Returning ${calendarData.length} marketing calendar entries`);

    // Caching disabled - always return fresh data from spreadsheet
    return calendarData;

  } catch (error) {
    console.error('Error getting marketing calendar data:', error);
    throw error;
  }
}


  
  /**
   * Get sheet data as JSON
   */
  getSheetData(sheet) {
    const sheetName = sheet.getName();
    console.log(`Getting data from sheet: ${sheetName}`);
    
    const data = sheet.getDataRange().getValues();
    console.log(`  Raw data rows: ${data.length}`);
    
    if (data.length < 2) {
      console.log(`  No data rows found (only header or empty)`);
      return [];
    }
    
    const headers = data[0];
    console.log(`  Headers: ${headers.join(', ')}`);
    
    const rows = data.slice(1);
    console.log(`  Data rows to process: ${rows.length}`);
    
    // Map rows to objects
    const mappedRows = rows.map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });
    
    // Smart empty row filtering based on sheet type
    const filtered = mappedRows.filter(row => {
      // Check if row has any non-empty values
      const hasData = Object.values(row).some(value => {
        if (value === null || value === undefined || value === '') return false;
        if (typeof value === 'string' && value.trim() === '') return false;
        return true;
      });
      
      if (!hasData) return false;
      
      // Sheet-specific filtering for primary key field - FIXED COLUMN NAMES
      switch (sheetName) {
        case 'Partner':
          return row['Account Name'] && row['Account Name'].toString().trim() !== '';
        case 'AllianceManager':
          return row['Email'] && row['Email'].toString().trim() !== '';
        case 'MondayData':
          // MondayData uses 'Item Name' as the first column (from DataProcessor)
          return row['Item Name'] && row['Item Name'].toString().trim() !== '';
        case 'GWMondayData':
          // GWMondayData uses 'Item Name' as the first column (from DataProcessor)
          return row['Item Name'] && row['Item Name'].toString().trim() !== '';
        case 'MarketingApproval':
          // MarketingApproval uses 'Item Name' as the first column (from DataProcessor)
          return row['Item Name'] && row['Item Name'].toString().trim() !== '';
        case 'MondayDashboard':
          // MondayDashboard uses 'Item' as the first column
          return row['Item'] && row['Item'].toString().trim() !== '';
        default:
          // For other sheets, just check if row has any data
          return hasData;
      }
    });
    
    console.log(`  Filtered rows (non-empty): ${filtered.length}`);
    
    if (filtered.length === 0 && mappedRows.length > 0) {
      console.log(`  ⚠️ All rows filtered out! Sample row:`, JSON.stringify(mappedRows[0]));
    }
    
    return filtered;
  }
  
  /**
   * Filter by manager
   */
  filterByManager(data, managerEmail, type) {
    if (type === 'partner') {
      // For partner activities, filter by Alliance Manager column (added by DataProcessor)
      const managerName = this.getManagerName(managerEmail);

      return data.filter(row => {
        // Use helper method to handle both 'AllianceManager' and 'Alliance Manager' column names
        const allianceManager = this.getAllianceManager(row);

        // Check both email and name formats
        return allianceManager === managerEmail ||
               allianceManager === managerName ||
               (allianceManager && allianceManager.includes(managerName.split(' ')[0])); // Check first name
      });
    } else {
      // For internal activities (GWMondayData), filter by Owner OR Assigned To
      const managerName = this.getManagerName(managerEmail);

      console.log(`Filtering internal activities for manager: ${managerEmail}, name: ${managerName}`);
      console.log(`Total rows before filtering: ${data.length}`);

      const filtered = data.filter(row => {
        const allianceManager = this.getAllianceManagerInternal(row);
        const owner = row['Owner'] || '';
        const assignedTo = row['Assigned To'] || '';

        // If Alliance Manager is empty, show the activity to all managers
        if (!allianceManager) {
          console.log(`Row with empty Alliance Manager - showing to all managers. Item: ${row['Item Name']}`);
          return true;
        }

        // Helper function to check if manager is in a comma-separated list
        const isManagerInList = (field) => {
          if (!field) return false;
          const fieldStr = field.toString();

          // Split by comma and check each value
          const values = fieldStr.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);

          const nameParts = managerName ? managerName.toLowerCase().split(' ') : [];
          const emailLower = managerEmail.toLowerCase();

          return values.some(value =>
            value === emailLower ||
            value === managerName?.toLowerCase() ||
            nameParts.some(part => value.includes(part))
          );
        };

        // Check if manager is in Owner OR Assigned To fields (handle multi-select dropdowns)
        const isOwner = isManagerInList(owner);
        const isAssignedTo = isManagerInList(assignedTo);

        if (isOwner || isAssignedTo) {
          console.log(`Match found - Owner: "${owner}", Assigned To: "${assignedTo}". Item: ${row['Item Name']}`);
          return true;
        }

        return false;
      });

      console.log(`Rows after filtering: ${filtered.length}`);
      return filtered;
    }
  }
  
  /**
   * Get manager's name from AllianceManager sheet
   */
  getManagerName(email) {
    const cacheKey = `manager_name_${email}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    const managerSheet = this.spreadsheet.getSheetByName('AllianceManager');
    if (!managerSheet) return email; // Return email if sheet not found
    
    const managerData = this.getSheetData(managerSheet);
    const manager = managerData.find(row => row['Email'] === email);
    
    const name = manager ? manager['Manager'] : email;
    this.cache.put(cacheKey, name, CONFIG.CACHE_DURATION);
    
    return name;
  }
  
  /**
   * Get list of partners managed by a specific manager
   */
  getManagerPartners(managerEmail) {
    // Normalize email to lowercase for consistent cache key
    const normalizedEmail = managerEmail ? managerEmail.toLowerCase() : '';
    const cacheKey = `manager_partners_${normalizedEmail}`;
    const cached = this.cache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    // Get manager's name from AllianceManager sheet
    const managerName = this.getManagerName(managerEmail);
    
    // Get partners from Partner sheet
    const partnerSheet = this.spreadsheet.getSheetByName('Partner');
    if (!partnerSheet) return [];
    
    const partnerData = this.getSheetData(partnerSheet);
    
    // Filter partners by Account Owner (which contains the manager name)
    const managedPartners = partnerData
      .filter(row => {
        const accountOwner = row['Account Owner'];
        // Check if Account Owner matches either email or name
        return accountOwner === managerEmail || 
               accountOwner === managerName ||
               (accountOwner && accountOwner.includes(managerName.split(' ')[0])); // Check first name
      })
      .map(row => row['Account Name']); // Account Name is the partner name
    
    // Also check PartnerTranslate for Monday.com name mappings
    const translateSheet = this.spreadsheet.getSheetByName('PartnerTranslate');
    if (translateSheet) {
      const translateData = this.getSheetData(translateSheet);
      const additionalNames = [];
      
      managedPartners.forEach(partnerName => {
        // Find Monday.com name for this partner
        const translation = translateData.find(row => 
          row['External Partner Name'] === partnerName
        );
        if (translation && translation['Monday Partner Name']) {
          additionalNames.push(translation['Monday Partner Name']);
        }
      });
      
      managedPartners.push(...additionalNames);
    }
    
    this.cache.put(cacheKey, JSON.stringify(managedPartners), CONFIG.CACHE_DURATION);
    return managedPartners;
  }
  

  /**
   * Clear all cached data
   * Note: Delegates to global clearAllCaches() function which properly tracks cache keys
   */
  clearCache() {
    try {
      // Use the global clearAllCaches function which properly handles cache key tracking
      return clearAllCaches();
    } catch (error) {
      console.error('Error clearing cache:', error);
      return { success: false, message: String(error.message) };
    }
  }





    /**
   * Helper method to get Alliance Manager value from a row
   * Handles both 'AllianceManager' (no space) and 'Alliance Manager' (with space)
   */
  getAllianceManager(row) {
    return row['AllianceManager'] || row['Alliance Manager'] || '';
  }

  getAllianceManagerInternal(row) {
    return row['Owner'] || '';
  }
  
  /**
 * Get marketing approvals
 */
getMarketingApprovals(managerEmail) {
  try {
    // Normalize email to lowercase
    const normalizedEmail = managerEmail ? managerEmail.toLowerCase() : '';

    console.log(`=== getMarketingApprovals (NO CACHE) ===`);
    console.log(`Manager email: ${managerEmail}`);
    console.log(`Normalized email: ${normalizedEmail}`);
    console.log(`Reading directly from spreadsheet (caching disabled)`);

    const sheet = this.spreadsheet.getSheetByName('MarketingApproval');
    if (!sheet) {
      console.log('MarketingApproval sheet not found');
      return [];
    }

    const data = this.getSheetData(sheet);
    const managerName = this.getManagerName(managerEmail);

    console.log(`Getting marketing approvals for: ${managerEmail} / ${managerName}`);
    console.log(`Total marketing approval rows from sheet: ${data.length}`);

    // Filter by Alliance Manager column (handles both 'AllianceManager' and 'Alliance Manager')
    const filtered = data.filter(row => {
      const allianceManager = this.getAllianceManager(row);
      const owner = row['Owner'];

      const matchesManager =
        allianceManager === managerEmail ||
        allianceManager === managerName ||
        (allianceManager && allianceManager.includes(managerName.split(' ')[0])) ||
        owner === managerEmail ||
        owner === managerName ||
        (owner && owner.includes(managerName.split(' ')[0]));

      return matchesManager;
    });

    console.log(`Filtered to ${filtered.length} approvals for manager ${managerName}`);
    
    // Convert all values to strings and add calculated fields
    const approvals = filtered.map(row => {
      const sanitized = {};

      // Add all the columns from the sheet
      const columnsToInclude = [
        'Item Name',
        'Group',
        'Board Name',
        'Partner Name',  // Included but not used - Partner column is the source of truth
        'Partner',  // Primary partner field - this is the single source of truth
        'Monday Item ID',
        'Board ID',
        'Subitems',
        'Event URL',
        'Priority',
        'Overall Status',
        'Funding Type',
        'Owner',
        'AllianceManager',
        'Requesting Department',
        'Cost',
        'Date and Location',
        'Start Date',
        'Request Type',
        'Urgency',
        'Number of Meetings or Receptions',
        'Total Audience',
        'Expected Attendance',
        'Speaking Opportunity',
        'Brand Details',
        'Create Date',
        'Eric Approval Date',
        'Marketing Approval Date',
        'Final Approval Date',
        'Eric Decision',
        'Marketing Decision',
        'Will Decision',
        'Long text',
        'Scope Document Public URL'
      ];
      
      // Copy all columns and ensure they're strings
      columnsToInclude.forEach(column => {
        const value = row[column];
        if (value === null || value === undefined) {
          sanitized[column] = '';
        } else if (value instanceof Date) {
          // Format dates as YYYY-MM-DD
          const year = value.getFullYear();
          const month = String(value.getMonth() + 1).padStart(2, '0');
          const day = String(value.getDate()).padStart(2, '0');
          sanitized[column] = `${year}-${month}-${day}`;
        } else if (typeof value === 'boolean') {
          sanitized[column] = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
          sanitized[column] = String(value);
        } else if (typeof value === 'object') {
          sanitized[column] = JSON.stringify(value);
        } else {
          sanitized[column] = String(value);
        }
      });

      // Note: For MarketingApproval, only use Partner column (ignore Partner Name column)
      // Partner Name column in MarketingApproval sheet should be ignored per user requirement
      // The Partner field is the single source of truth for partner data

      // Calculate days waiting from Create Date
      const createDate = row['Create Date'];
      let daysWaiting = 0;
      
      if (createDate) {
        try {
          const created = new Date(createDate);
          const now = new Date();
          const diff = now - created;
          daysWaiting = Math.floor(diff / (1000 * 60 * 60 * 24));
        } catch (e) {
          console.log('Error calculating days waiting:', e);
        }
      }
      
      sanitized.daysWaiting = String(daysWaiting);
      
      // Add a computed urgency level
      if (daysWaiting > 14) {
        sanitized.urgencyLevel = 'critical';
      } else if (daysWaiting > 7) {
        sanitized.urgencyLevel = 'high';
      } else if (daysWaiting > 3) {
        sanitized.urgencyLevel = 'medium';
      } else {
        sanitized.urgencyLevel = 'normal';
      }
      
      return sanitized;
    });
    
    // Sort by days waiting (descending) to show oldest first
    approvals.sort((a, b) => {
      const daysA = parseInt(a.daysWaiting) || 0;
      const daysB = parseInt(b.daysWaiting) || 0;
      return daysB - daysA;
    });
    
    console.log('Sample approval:', approvals[0] ? JSON.stringify(Object.keys(approvals[0])) : 'No approvals');

    // Caching disabled - always return fresh data from spreadsheet
    return approvals;

  } catch (error) {
    console.error('Error in getMarketingApprovals:', error);
    return [];
  }
}

/**
 * Get 2026 Approvals data
 * Caching disabled - always reads fresh data from spreadsheet
 */
get2026ApprovalsData(managerEmail) {
  try {
    // Normalize email to lowercase
    const normalizedEmail = managerEmail ? managerEmail.toLowerCase() : '';

    console.log(`=== get2026ApprovalsData (NO CACHE) ===`);
    console.log(`Manager email: ${managerEmail}`);
    console.log(`Normalized email: ${normalizedEmail}`);
    console.log(`Reading directly from spreadsheet (caching disabled)`);

    const sheet = this.spreadsheet.getSheetByName('Approvals2026');
    if (!sheet) {
      console.log('Approvals2026 sheet not found');
      return [];
    }

    const data = this.getSheetData(sheet);
    const managerName = this.getManagerName(managerEmail) || '';
    const managerFirstName = managerName ? managerName.split(' ')[0] : '';

    console.log(`Getting 2026 approvals for: ${managerEmail} / ${managerName}`);
    console.log(`Manager first name: ${managerFirstName}`);
    console.log(`Total 2026 approval rows from sheet: ${data.length}`);

    // Get managed partners for this manager
    const managedPartners = this.getManagerPartners(managerEmail) || [];
    console.log(`Manager ${managerName} manages partners: ${managedPartners.join(', ')}`);

    // Filter by Partner field (matching managed partners) or by Alliance Manager
    const filtered = data.filter(row => {
      const partner = row['Partner'] || '';
      const allianceManager = this.getAllianceManager(row) || '';
      const owner = row['Owner'] || '';

      // Check if partner is in managed partners list
      let matchesPartner = false;
      if (partner) {
        matchesPartner = managedPartners.some(p =>
          p && p.toLowerCase() === partner.toString().toLowerCase()
        );
      }

      // Check if Alliance Manager or Owner matches
      const matchesManager =
        (managerEmail && allianceManager === managerEmail) ||
        (managerName && allianceManager === managerName) ||
        (managerFirstName && allianceManager && allianceManager.includes(managerFirstName)) ||
        (managerEmail && owner === managerEmail) ||
        (managerName && owner === managerName) ||
        (managerFirstName && owner && owner.includes(managerFirstName));

      return matchesPartner || matchesManager;
    });

    console.log(`Filtered to ${filtered.length} 2026 approvals for manager ${managerName}`);

    // Convert all values to strings and add calculated fields
    const approvals = filtered.map(row => {
      const sanitized = {};

      // Add all the columns from the sheet based on the Monday column IDs specified
      // Activity - Item Name (the item name from Monday)
      // Requestor - text_mky7xyqh
      // Total Cost - formula_mky7wjsx
      // Funding Type - color_mkxxef94
      // Overall Status - status
      // Partner - text_mkv092nh
      // Event Date - date_mktkb5sf
      // Create Date - date_mktmw20b
      const columnsToInclude = [
        'Item Name',
        'Group',
        'Board Name',
        'Monday Item ID',
        'Board ID',
        'Requestor',
        'Total Cost',
        'Funding Type',
        'Overall Status',
        'Partner',
        'Event Date',
        'Create Date',
        'Owner',
        'AllianceManager',
        'Alliance Manager'
      ];

      // Copy all columns and ensure they're strings
      columnsToInclude.forEach(column => {
        const value = row[column];
        if (value === null || value === undefined) {
          sanitized[column] = '';
        } else if (value instanceof Date) {
          // Format dates as YYYY-MM-DD
          const year = value.getFullYear();
          const month = String(value.getMonth() + 1).padStart(2, '0');
          const day = String(value.getDate()).padStart(2, '0');
          sanitized[column] = `${year}-${month}-${day}`;
        } else if (typeof value === 'boolean') {
          sanitized[column] = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
          sanitized[column] = String(value);
        } else if (typeof value === 'object') {
          sanitized[column] = JSON.stringify(value);
        } else {
          sanitized[column] = String(value);
        }
      });

      // Calculate days waiting from Create Date
      const createDate = row['Create Date'];
      let daysWaiting = 0;

      if (createDate) {
        try {
          const created = new Date(createDate);
          const now = new Date();
          const diff = now - created;
          daysWaiting = Math.floor(diff / (1000 * 60 * 60 * 24));
        } catch (e) {
          console.log('Error calculating days waiting:', e);
        }
      }

      sanitized.daysWaiting = String(daysWaiting);

      // Add a computed urgency level
      if (daysWaiting > 14) {
        sanitized.urgencyLevel = 'critical';
      } else if (daysWaiting > 7) {
        sanitized.urgencyLevel = 'high';
      } else if (daysWaiting > 3) {
        sanitized.urgencyLevel = 'medium';
      } else {
        sanitized.urgencyLevel = 'normal';
      }

      return sanitized;
    });

    // Sort by days waiting (descending) to show oldest first
    approvals.sort((a, b) => {
      const daysA = parseInt(a.daysWaiting) || 0;
      const daysB = parseInt(b.daysWaiting) || 0;
      return daysB - daysA;
    });

    console.log('Sample 2026 approval:', approvals[0] ? JSON.stringify(Object.keys(approvals[0])) : 'No approvals');

    // Caching disabled - always return fresh data from spreadsheet
    return approvals;

  } catch (error) {
    console.error('Error in get2026ApprovalsData:', error);
    return [];
  }
}


  /**
 * Get partner heatmap data
 * Caching disabled - always reads fresh data from spreadsheet
 */
getPartnerHeatmap(managerEmail) {
  try {
    // Normalize email to lowercase
    const normalizedEmail = managerEmail ? managerEmail.toLowerCase() : '';

    console.log(`=== getPartnerHeatmap (NO CACHE) ===`);
    console.log(`Manager email: ${managerEmail}`);
    console.log(`Reading directly from spreadsheet (caching disabled)`);

    const sheet = this.spreadsheet.getSheetByName('MondayDashboard');
    if (!sheet) {
      console.log('MondayDashboard sheet not found');
      return [];
    }
    
    const data = this.getSheetData(sheet);
    const managerName = this.getManagerName(managerEmail);
    
    console.log(`Getting heatmap for manager: ${managerEmail} / ${managerName}`);
    console.log(`Total dashboard rows: ${data.length}`);

    // Filter by Alliance Manager column - use helper method to handle both column name variants
    const filtered = data.filter(row => {
      const allianceManager = this.getAllianceManager(row);
      const matches = allianceManager === managerEmail ||
             allianceManager === managerName ||
             (allianceManager && allianceManager.includes(managerName.split(' ')[0]));

      if (matches) {
        console.log(`Match found for partner: ${row['Partner Name'] || row['Item']}`);
      }

      return matches;
    });
    
    console.log(`Filtered to ${filtered.length} partners for this manager`);
    
    // Map the data with the actual columns and calculate health scores
    const heatmapData = filtered.map(row => {
      // Use Temperature as a health indicator if available
      const temperature = String(row['Temperature'] || '');
      const status = String(row['Status'] || '');
      const engagement = String(row['Engagement'] || '');
      
      // Calculate a basic health score based on available data
      let healthScore = 50; // Start with neutral score
      
      // Adjust based on temperature
      if (temperature.toLowerCase().includes('hot')) {
        healthScore = 90;
      } else if (temperature.toLowerCase().includes('warm')) {
        healthScore = 70;
      } else if (temperature.toLowerCase().includes('cool')) {
        healthScore = 40;
      } else if (temperature.toLowerCase().includes('cold')) {
        healthScore = 20;
      }
      
      // Adjust based on status
      if (status.toLowerCase().includes('active')) {
        healthScore += 10;
      } else if (status.toLowerCase().includes('inactive')) {
        healthScore -= 20;
      } else if (status.toLowerCase().includes('blocked')) {
        healthScore -= 30;
      }
      
      // Ensure score is between 0 and 100
      healthScore = Math.max(0, Math.min(100, healthScore));
      
      // Determine health status color
      const healthStatus = healthScore >= 70 ? 'green' : healthScore >= 40 ? 'yellow' : 'red';
      
      // Convert all values to strings - no dates or booleans
      const sanitized = {
        // Primary display fields
        'Partner Name': String(row['Partner Name'] || row['Item'] || ''),
        'Item': String(row['Item'] || ''),
        'Monday Item ID': String(row['Monday Item ID'] || ''),
        'Board ID': String(row['Board ID'] || ''),
        'Partner Description': String(row['Partner Description'] || ''),
        'Status': String(status || ''),
        'Temperature': String(temperature || ''),
        'Engagement': String(engagement || ''),
        'Files': String(row['Files'] || ''),
        'Alliance Manager': String(row['AllianceManager'] || ''),
        'Summary of Partner Activities': String(row['Summary of Partner Activities'] || ''),
        'PartnerBoard': String(row['PartnerBoard'] || ''),
        'MarketingLevel': String(row['MarketingLevel'] || ''),

        // Calculated fields for the heatmap
        'healthScore': String(healthScore),
        'healthStatus': String(healthStatus),

        // Add placeholder fields that the UI might expect
        'Overdue items': '0',
        'Stuck or Blocked items': status.toLowerCase().includes('blocked') ? '1' : '0',
        'Not Started items': status.toLowerCase().includes('not started') ? '1' : '0',
        'Completed Last 30 Days': '0'
      };
      
      return sanitized;
    });
    
    console.log(`Returning ${heatmapData.length} heatmap entries`);
    if (heatmapData.length > 0) {
      console.log('Sample heatmap entry:', JSON.stringify(heatmapData[0]));
    }

    // Caching disabled - always return fresh data from spreadsheet
    return heatmapData;

  } catch (error) {
    console.error('Error in getPartnerHeatmap:', error);
    return [];
  }
}
  /**
   * Get general approvals
   */
  getGeneralApprovals(managerEmail) {
    // Combine approvals from multiple sources
    const approvals = [];
    const managerName = this.getManagerName(managerEmail);
    
    // Get from internal activities (GWMondayData)
    const internalSheet = this.spreadsheet.getSheetByName('GWMondayData');
    if (internalSheet) {
      const data = this.getSheetData(internalSheet);
      const pending = data.filter(row => {
        const owner = row['Owner'];
        const assignedBy = row['Assigned By'];
        const matchesManager = owner === managerEmail || 
                              owner === managerName ||
                              assignedBy === managerEmail ||
                              assignedBy === managerName ||
                              (owner && owner.includes(managerName.split(' ')[0])) ||
                              (assignedBy && assignedBy.includes(managerName.split(' ')[0]));
        
        // Check for approval required status
        const activityStatus = row['Activity Status'];
        return matchesManager && activityStatus === 'Approval Required';
      });
      
      pending.forEach(item => {
        const sanitized = {};
        for (const key in item) {
          sanitized[key] = this.convertToString(item[key]);
        }
        sanitized.type = 'Internal Activity';
        sanitized.source = 'GWMondayData';
        sanitized.daysWaiting = String(this.calculateDaysWaiting(item['Date Created']));
        approvals.push(sanitized);
      });
    }
    
    // Also check MondayData for partner activities requiring approval
    const partnerSheet = this.spreadsheet.getSheetByName('MondayData');
    if (partnerSheet) {
      const data = this.getSheetData(partnerSheet);
      const pending = data.filter(row => {
        const allianceManager = row['Alliance Manager'];
        const matchesManager = allianceManager === managerEmail || 
                              allianceManager === managerName ||
                              (allianceManager && allianceManager.includes(managerName.split(' ')[0]));
        
        // Check for approval required status
        const activityStatus = row['Activity Status'];
        return matchesManager && activityStatus === 'Approval Required';
      });
      
      pending.forEach(item => {
        const sanitized = {};
        for (const key in item) {
          sanitized[key] = this.convertToString(item[key]);
        }
        sanitized.type = 'Partner Activity';
        sanitized.source = 'MondayData';
        sanitized.daysWaiting = String(this.calculateDaysWaiting(item['Date Created']));
        approvals.push(sanitized);
      });
    }
    
    return approvals;
  }
  
  /**
   * Calculate days waiting
   */
  calculateDaysWaiting(dateRequested) {
    if (!dateRequested) return 0;
    const requested = new Date(dateRequested);
    const now = new Date();
    const diff = now - requested;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }
  
  /**
   * Ensure all data is serializable for UI
   * Recursively converts all values to strings/primitives
   */
  static ensureSerializable(obj) {
    if (obj === null || obj === undefined) {
      return null;
    }
    
    if (obj instanceof Date) {
      return obj.toISOString().split('T')[0]; // Return YYYY-MM-DD format
    }
    
    if (typeof obj === 'boolean' || typeof obj === 'number') {
      return String(obj);
    }
    
    if (typeof obj === 'string') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => DataService.ensureSerializable(item));
    }
    
    if (typeof obj === 'object') {
      const result = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          result[key] = DataService.ensureSerializable(obj[key]);
        }
      }
      return result;
    }
    
    return String(obj);
  }
  
  /**
   * Apply filters
   */
  applyFilters(data, filters) {
    if (!filters || Object.keys(filters).length === 0) {
      return data;
    }
    
    return data.filter(row => {
      return Object.keys(filters).every(column => {
        const filterValues = filters[column];
        if (!filterValues || filterValues.length === 0) {
          return true;
        }
        
        const rowValue = row[column];
        
        // Handle different filter types
        if (Array.isArray(filterValues)) {
          // Multi-select filter
          return filterValues.includes(rowValue);
        } else if (filterValues.min !== undefined || filterValues.max !== undefined) {
          // Range filter
          const value = parseFloat(rowValue);
          if (isNaN(value)) return false;
          
          if (filterValues.min !== undefined && value < filterValues.min) {
            return false;
          }
          if (filterValues.max !== undefined && value > filterValues.max) {
            return false;
          }
          return true;
        } else if (filterValues.startDate || filterValues.endDate) {
          // Date range filter
          const date = new Date(rowValue);
          if (filterValues.startDate && date < new Date(filterValues.startDate)) {
            return false;
          }
          if (filterValues.endDate && date > new Date(filterValues.endDate)) {
            return false;
          }
          return true;
        } else if (typeof filterValues === 'string') {
          // Text filter (case-insensitive partial match)
          return rowValue && 
                 rowValue.toString().toLowerCase()
                   .includes(filterValues.toLowerCase());
        }
        
        return true;
      });
    });
  }
  
/**
 * Sort data
 */
sortData(data, field, order = 'asc') {
  // Map "Name" to "Item Name" if needed
  const actualField = field === 'Name' ? 'Item Name' : field;
  
  return data.sort((a, b) => {
    const aVal = a[actualField];
    const bVal = b[actualField];
    
    // Handle nulls
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return order === 'asc' ? 1 : -1;
    if (bVal == null) return order === 'asc' ? -1 : 1;
    
    // Handle dates
    if (aVal instanceof Date || bVal instanceof Date) {
      const aDate = new Date(aVal);
      const bDate = new Date(bVal);
      return order === 'asc' ? aDate - bDate : bDate - aDate;
    }
    
    // Handle numbers
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return order === 'asc' ? aVal - bVal : bVal - aVal;
    }
    
    // Handle strings
    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    
    if (order === 'asc') {
      return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
    } else {
      return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
    }
  });
}
  
  /**
   * Convert any value to string for UI compatibility
   */
  convertToString(value) {
    // Handle dates
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    // Handle null/undefined
    if (value === null || value === undefined) {
      return '';
    }
    
    // Handle booleans
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    
    // Handle objects
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (e) {
        return '';
      }
    }
    
    // Everything else: convert to string
    return String(value);
  }
  
  /**
   * Hash parameters for cache key
   */
  hashParams(...params) {
    return params.map(part => 
      typeof part === 'object' ? JSON.stringify(part) : part
    ).join('_');
  }
}

// Exposed functions - All wrapped to ensure UI compatibility
function getPartnerActivities(managerEmail, filters, sort, pagination) {
  try {
    const service = new DataService();
    const result = service.getActivityData('partner', managerEmail, filters, sort, pagination);
    return DataService.ensureSerializable(result);
  } catch (error) {
    console.error('Error in getPartnerActivities:', error);
    return DataService.ensureSerializable({
      data: [],
      total: '0',
      page: '1',
      pageSize: '50',
      pages: '0',
      error: String(error.message)
    });
  }
}

function getInternalActivities(managerEmail, filters, sort, pagination) {
  try {
    const service = new DataService();
    const result = service.getActivityData('internal', managerEmail, filters, sort, pagination);
    return DataService.ensureSerializable(result);
  } catch (error) {
    console.error('Error in getInternalActivities:', error);
    return DataService.ensureSerializable({
      data: [],
      total: '0',
      page: '1',
      pageSize: '50',
      pages: '0',
      error: String(error.message)
    });
  }
}


function getMarketingApprovals(managerEmail) {
  try {
    const service = new DataService();
    const result = service.getMarketingApprovals(managerEmail);
    
    // Ensure everything is properly serialized
    const serialized = result.map(approval => {
      const clean = {};
      for (const key in approval) {
        const value = approval[key];
        // Convert any non-string to string
        if (value === null || value === undefined) {
          clean[key] = '';
        } else if (value instanceof Date) {
          // Format as YYYY-MM-DD
          const year = value.getFullYear();
          const month = String(value.getMonth() + 1).padStart(2, '0');
          const day = String(value.getDate()).padStart(2, '0');
          clean[key] = `${year}-${month}-${day}`;
        } else if (typeof value === 'boolean') {
          clean[key] = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
          clean[key] = String(value);
        } else if (typeof value === 'object') {
          try {
            clean[key] = JSON.stringify(value);
          } catch (e) {
            clean[key] = '';
          }
        } else {
          clean[key] = String(value);
        }
      }
      return clean;
    });
    
    console.log(`Returning ${serialized.length} marketing approvals to UI`);
    return serialized;
    
  } catch (error) {
    console.error('Error in getMarketingApprovals wrapper:', error);
    return [];
  }
}

function getGeneralApprovals(managerEmail) {
  try {
    const service = new DataService();
    const result = service.getGeneralApprovals(managerEmail);
    return DataService.ensureSerializable(result);
  } catch (error) {
    console.error('Error in getGeneralApprovals:', error);
    return DataService.ensureSerializable([]);
  }
}

/**
 * Get 2026 Approvals data for a manager
 * @param {string} managerEmail - The manager's email address
 * @returns {Array} Array of 2026 approval records
 */
function get2026ApprovalsData(managerEmail) {
  try {
    const service = new DataService();
    const result = service.get2026ApprovalsData(managerEmail);

    // Ensure everything is properly serialized
    const serialized = result.map(approval => {
      const clean = {};
      for (const key in approval) {
        const value = approval[key];
        // Convert any non-string to string
        if (value === null || value === undefined) {
          clean[key] = '';
        } else if (value instanceof Date) {
          // Format as YYYY-MM-DD
          const year = value.getFullYear();
          const month = String(value.getMonth() + 1).padStart(2, '0');
          const day = String(value.getDate()).padStart(2, '0');
          clean[key] = `${year}-${month}-${day}`;
        } else if (typeof value === 'boolean') {
          clean[key] = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
          clean[key] = String(value);
        } else if (typeof value === 'object') {
          try {
            clean[key] = JSON.stringify(value);
          } catch (e) {
            clean[key] = '';
          }
        } else {
          clean[key] = String(value);
        }
      }
      return clean;
    });

    console.log(`Returning ${serialized.length} 2026 approvals to UI`);
    return serialized;

  } catch (error) {
    console.error('Error in get2026ApprovalsData wrapper:', error);
    return [];
  }
}

/**
 * Debug function to get marketing approvals BYPASSING CACHE
 * Run this to see what data is actually in the spreadsheet
 */
function getMarketingApprovalsNoCache(managerEmail) {
  try {
    console.log('=== getMarketingApprovalsNoCache (BYPASSING CACHE) ===');
    console.log(`Manager email: ${managerEmail}`);

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MarketingApproval');

    if (!sheet) {
      console.log('MarketingApproval sheet not found');
      return { error: 'Sheet not found', data: [] };
    }

    // Get raw sheet data
    const range = sheet.getDataRange();
    const values = range.getValues();

    console.log(`Total rows in sheet (including header): ${values.length}`);

    if (values.length < 2) {
      return { error: 'No data rows', data: [], rowCount: values.length };
    }

    const headers = values[0];
    console.log('Headers:', headers.join(', '));

    // Find Item Name column
    const itemNameIndex = headers.indexOf('Item Name');
    console.log(`Item Name column index: ${itemNameIndex}`);

    // Get all item names from the sheet
    const itemNames = [];
    for (let i = 1; i < values.length; i++) {
      const itemName = itemNameIndex >= 0 ? values[i][itemNameIndex] : values[i][0];
      if (itemName && String(itemName).trim() !== '') {
        itemNames.push(String(itemName).trim());
      }
    }

    console.log(`Total items in sheet: ${itemNames.length}`);
    console.log('Item names (first 10):', itemNames.slice(0, 10).join(', '));
    console.log('Item names (last 5):', itemNames.slice(-5).join(', '));

    // Now compare with what getMarketingApprovals returns
    const service = new DataService();

    // Temporarily clear the cache to force a fresh read
    const cache = CacheService.getScriptCache();
    const normalizedEmail = managerEmail ? managerEmail.toLowerCase() : '';
    const cacheKey = `marketing_approvals_${normalizedEmail}`;

    console.log('');
    console.log('Checking current cache state...');
    const currentCache = cache.get(cacheKey);
    if (currentCache) {
      const cachedData = JSON.parse(currentCache);
      console.log(`Cache contains ${cachedData.length} items`);
      console.log('Cached items (first 5):', cachedData.slice(0, 5).map(i => i['Item Name']).join(', '));
    } else {
      console.log('Cache is EMPTY');
    }

    return {
      sheetRowCount: values.length - 1,
      itemsInSheet: itemNames.length,
      itemNames: itemNames,
      cacheExists: !!currentCache,
      cachedItemCount: currentCache ? JSON.parse(currentCache).length : 0
    };

  } catch (error) {
    console.error('Error in getMarketingApprovalsNoCache:', error);
    return { error: error.message };
  }
}

/**
 * Get partner info including tier, region, and alliance type
 */
function getPartnerInfo(partnerName) {
  try {
    const service = new DataService();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const partnerSheet = spreadsheet.getSheetByName('Partner');
    
    if (!partnerSheet) return null;
    
    const data = service.getSheetData(partnerSheet);
    
    // Check PartnerTranslate for name mapping
    const translateSheet = spreadsheet.getSheetByName('PartnerTranslate');
    let searchName = partnerName;
    
    if (translateSheet) {
      const translateData = service.getSheetData(translateSheet);
      const translation = translateData.find(row => 
        row['Monday Partner Name'] === partnerName
      );
      if (translation) {
        searchName = translation['External Partner Name'];
      }
    }
    
    // Find partner by Account Name
    const partner = data.find(row => row['Account Name'] === searchName);
    
    if (!partner) return null;
    
    const result = {
      name: service.convertToString(partner['Account Name']),
      tier: service.convertToString(partner['Tier']),
      region: service.convertToString(partner['Region']),
      accountOwner: service.convertToString(partner['Account Owner']),
      allianceType: service.convertToString(partner['Alliance Type'])
    };
    
    return DataService.ensureSerializable(result);
  } catch (error) {
    console.error('Error in getPartnerInfo:', error);
    return null;
  }
}

/**
 * Get all managers with their details
 */
function getAllManagers() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const managerSheet = spreadsheet.getSheetByName('AllianceManager');
    
    if (!managerSheet) return [];
    
    const service = new DataService();
    const managers = service.getSheetData(managerSheet);
    
    // Add partner count for each manager and convert to strings
    const result = managers.map(manager => {
      const partners = service.getManagerPartners(manager['Email']);
      const sanitized = {};
      for (const key in manager) {
        sanitized[key] = service.convertToString(manager[key]);
      }
      sanitized.partnerCount = String(partners.length);
      sanitized.partners = partners.map(p => String(p));
      return sanitized;
    });
    
    return DataService.ensureSerializable(result);
  } catch (error) {
    console.error('Error in getAllManagers:', error);
    return [];
  }
}

/**
 * Get all partners with details
 */
function getAllPartners() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const partnerSheet = spreadsheet.getSheetByName('Partner');
    
    if (!partnerSheet) return [];
    
    const service = new DataService();
    const partners = service.getSheetData(partnerSheet);
    
    // Convert all partner data to strings
    const sanitizedPartners = partners.map(partner => {
      const sanitized = {};
      for (const key in partner) {
        sanitized[key] = service.convertToString(partner[key]);
      }
      return sanitized;
    });
    
    // Debugging: Log sample partner data
    if (sanitizedPartners.length === 0) {
      console.log('WARNING: No partners found in Partner sheet!');
      console.log('Check that:');
      console.log('    1. Partner sheet has data rows');
      console.log('    2. Account Name column has values');
      console.log('    3. Headers match exactly: Account Name, Tier, Region, Account Owner, Alliance Type');
      
      // Try to get raw data for debugging
      const rawData = partnerSheet.getDataRange().getValues();
      console.log(`    Raw sheet has ${rawData.length} rows total`);
      if (rawData.length > 0) {
        console.log(`    First row (headers): ${rawData[0].slice(0, 5).join(', ')}...`);
        if (rawData.length > 1) {
          console.log(`    Second row (first data): ${rawData[1].slice(0, 5).join(', ')}...`);
        }
      }
    } else {
      console.log(`  Sample partner: ${sanitizedPartners[0]['Account Name']} owned by ${sanitizedPartners[0]['Account Owner']}`);
    }
    
    return DataService.ensureSerializable(sanitizedPartners);
  } catch (error) {
    console.error('Error in getAllPartners:', error);
    return [];
  }
}

function getPartnerHeatmap(managerEmail) {
  try {
    console.log('getPartnerHeatmap called with:', managerEmail);
    const service = new DataService();
    const result = service.getPartnerHeatmap(managerEmail);
    console.log('getPartnerHeatmap result count:', result.length);

    // Ensure everything is serializable
    const serialized = result.map(row => {
      const clean = {};
      for (const key in row) {
        const value = row[key];
        // Convert any non-string to string
        if (value === null || value === undefined) {
          clean[key] = '';
        } else if (value instanceof Date) {
          clean[key] = value.toISOString().split('T')[0];
        } else if (typeof value === 'boolean') {
          clean[key] = value ? 'true' : 'false';
        } else if (typeof value === 'object') {
          clean[key] = JSON.stringify(value);
        } else {
          clean[key] = String(value);
        }
      }
      return clean;
    });

    console.log('Returning', serialized.length, 'heatmap entries');
    return serialized;

  } catch (error) {
    console.error('Error in getPartnerHeatmap wrapper:', error);
    console.error('Error stack:', error.stack);
    return [];
  }
}

/**
 * Debug function to test manager filtering
 */
function testManagerFiltering(managerEmail) {
  try {
    const service = new DataService();
    
    console.log('Testing manager:', managerEmail);
    
    // Get manager name
    const managerName = service.getManagerName(managerEmail);
    console.log('Manager name:', managerName);
    
    // Get managed partners
    const partners = service.getManagerPartners(managerEmail);
    console.log('Managed partners:', partners);
    
    // Test partner activities
    const partnerActivities = getPartnerActivities(managerEmail, {}, {}, { page: 1, pageSize: 5 });
    console.log('Partner activities count:', partnerActivities.total);
    console.log('Sample activities:', partnerActivities.data.slice(0, 2));
    
    // Test internal activities
    const internalActivities = getInternalActivities(managerEmail, {}, {}, { page: 1, pageSize: 5 });
    console.log('Internal activities count:', internalActivities.total);
    
    // Test heatmap
    const heatmap = getPartnerHeatmap(managerEmail);
    console.log('Heatmap entries:', heatmap.length);
    
    // Test marketing approvals
    const marketingApprovals = getMarketingApprovals(managerEmail);
    console.log('Marketing approvals:', marketingApprovals.length);
    
    // Test general approvals  
    const generalApprovals = getGeneralApprovals(managerEmail);
    console.log('General approvals:', generalApprovals.length);
    
    const result = {
      success: 'true',
      managerName: String(managerName),
      partnerCount: String(partners.length),
      partnerActivityCount: String(partnerActivities.total),
      internalActivityCount: String(internalActivities.total),
      heatmapCount: String(heatmap.length),
      marketingApprovalCount: String(marketingApprovals.length),
      generalApprovalCount: String(generalApprovals.length)
    };
    
    return DataService.ensureSerializable(result);
    
  } catch (error) {
    console.error('Test failed:', error);
    return DataService.ensureSerializable({
      success: 'false',
      error: String(error.message)
    });
  }
}

/**
 * Get marketing calendar data - EXPOSED FUNCTION
 */
function getMarketingCalendar(managerEmail) {
  try {
    console.log('getMarketingCalendar called with:', managerEmail);
    const service = new DataService();
    const result = service.getMarketingCalendarData(managerEmail);
    return DataService.ensureSerializable(result);
  } catch (error) {
    console.error('Error in getMarketingCalendar:', error);
    return DataService.ensureSerializable([]);
  }
}


/**
 * Get filter options for partner activities
 * @param {string} managerEmail - Manager's email address
 * @returns {Object} Filter options for partners, statuses, and owners
 */
function getPartnerActivityFilterOptions(managerEmail) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // Get manager name for filtering
    const managerName = getManagerName(managerEmail);

    // Collect unique values
    const partnersSet = new Set();
    const statusesSet = new Set();
    const ownersSet = new Set();

    // ===== STEP 1: Get partners from MondayDashboard sheet filtered by AllianceManager =====
    const dashboardSheet = spreadsheet.getSheetByName('MondayDashboard');

    if (dashboardSheet) {
      const dashboardData = dashboardSheet.getDataRange().getValues();

      if (dashboardData.length >= 2) {
        // Find column indices in MondayDashboard
        const dashboardHeaders = dashboardData[0];
        const partnerNameIndex = dashboardHeaders.indexOf('Partner Name');
        const allianceManagerIndex = dashboardHeaders.indexOf('AllianceManager');

        if (partnerNameIndex !== -1 && allianceManagerIndex !== -1) {
          // Process dashboard rows to get partners for this manager
          for (let i = 1; i < dashboardData.length; i++) {
            const allianceManager = dashboardData[i][allianceManagerIndex];

            // Only process rows for this manager
            const isManagerRow = allianceManager === managerEmail ||
                                allianceManager === managerName ||
                                (allianceManager && allianceManager.toString().includes(managerName.split(' ')[0]));

            if (isManagerRow) {
              const partnerName = dashboardData[i][partnerNameIndex];
              if (partnerName && partnerName.toString().trim()) {
                partnersSet.add(partnerName.toString().trim());
              }
            }
          }
          console.log(`Found ${partnersSet.size} partners from MondayDashboard for manager: ${managerName}`);
        } else {
          console.warn('Partner Name or AllianceManager column not found in MondayDashboard sheet');
        }
      }
    } else {
      console.warn('MondayDashboard sheet not found');
    }

    // ===== STEP 2: Get statuses and owners from MondayData sheet =====
    const mondayDataSheet = spreadsheet.getSheetByName('MondayData');

    if (mondayDataSheet) {
      const mondayData = mondayDataSheet.getDataRange().getValues();

      if (mondayData.length >= 2) {
        // Find column indices in MondayData
        const headers = mondayData[0];
        const statusIndex = headers.indexOf('Activity Status');
        const ownerIndex = headers.indexOf('Owner');
        const allianceManagerIndex = headers.indexOf('Alliance Manager');

        if (allianceManagerIndex !== -1) {
          // Process data rows
          for (let i = 1; i < mondayData.length; i++) {
            const allianceManager = mondayData[i][allianceManagerIndex];

            // Only process rows for this manager
            const isManagerRow = allianceManager === managerEmail ||
                                allianceManager === managerName ||
                                (allianceManager && allianceManager.toString().includes(managerName.split(' ')[0]));

            if (isManagerRow) {
              // Add status
              if (statusIndex !== -1) {
                const status = mondayData[i][statusIndex];
                if (status && status.toString().trim()) {
                  statusesSet.add(status.toString().trim());
                }
              }

              // Add owners (handle multiple owners)
              if (ownerIndex !== -1) {
                const owner = mondayData[i][ownerIndex];
                if (owner) {
                  const ownerStr = owner.toString().trim();
                  // Handle multiple owners separated by commas or semicolons
                  const ownerList = ownerStr.split(/[,;]/).map(o => o.trim()).filter(o => o);
                  ownerList.forEach(o => ownersSet.add(o));
                }
              }
            }
          }
        }
      }
    } else {
      console.warn('MondayData sheet not found');
    }

    // Convert sets to sorted arrays
    const result = {
      partners: Array.from(partnersSet).sort(),
      statuses: Array.from(statusesSet).sort(),
      owners: Array.from(ownersSet).sort()
    };

    console.log(`Filter options - Partners: ${result.partners.length}, Statuses: ${result.statuses.length}, Owners: ${result.owners.length}`);

    return result;

  } catch (error) {
    console.error('Error getting partner activity filter options:', error);
    return { partners: [], statuses: [], owners: [] };
  }
}

/**
 * Get manager's name from AllianceManager sheet (STANDALONE VERSION)
 * @param {string} email - Manager's email address
 * @returns {string} Manager's name or email if not found
 */
function getManagerName(email) {
  try {
    console.log('getManagerName called with email:', email);
    if (!email) return email;

    // Check cache first
    const cache = CacheService.getScriptCache();
    const cacheKey = `manager_name_${email}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log('Manager name found in cache:', cached);
      return cached;
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const managerSheet = spreadsheet.getSheetByName('AllianceManager');

    if (!managerSheet) {
      console.log('AllianceManager sheet not found');
      return email; // Return email if sheet not found
    }

    // Get data using the standalone helper function
    const managerData = getSheetDataAsObjects(managerSheet);
    console.log('AllianceManager sheet has', managerData.length, 'rows');

    // Log all managers for debugging
    if (managerData.length > 0) {
      console.log('All managers in AllianceManager sheet:', JSON.stringify(
        managerData.map(row => ({ Manager: row['Manager'], Email: row['Email'] }))
      ));
    }

    const manager = managerData.find(row => {
      const rowEmail = row['Email'];
      const match = rowEmail && rowEmail.toString().toLowerCase().trim() === email.toLowerCase().trim();
      if (match) {
        console.log('Found matching row:', JSON.stringify({ Manager: row['Manager'], Email: row['Email'] }));
      }
      return match;
    });

    if (!manager) {
      console.log('No manager found for email:', email);
    }

    const name = manager && manager['Manager'] ? manager['Manager'].toString().trim() : email;
    console.log('Manager name resolved to:', name);

    // Cache for 1 hour
    cache.put(cacheKey, name, 3600);

    return name;

  } catch (error) {
    console.error('Error in getManagerName:', error);
    console.error('Error stack:', error.stack);
    return email;
  }
}

/**
 * Get internal activity filter options
 * @param {string} managerEmail - Manager's email
 * @returns {Object} Filter options for boards, statuses, and priorities
 */
function getInternalActivityFilterOptions(managerEmail) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('GWMondayData');

    if (!sheet) {
      console.error('GWMondayData sheet not found');
      return { boards: [], statuses: [], priorities: [] };
    }

    // Get all data from the sheet
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    if (values.length < 2) {
      return { boards: [], statuses: [], priorities: [] };
    }

    // Find column indices
    const headers = values[0];
    const boardIndex = headers.indexOf('Board Name');
    const statusIndex = headers.indexOf('Activity Status');
    const priorityIndex = headers.indexOf('Importance');
    const ownerIndex = headers.indexOf('Owner');
    const assignedByIndex = headers.indexOf('Assigned By');

    if (boardIndex === -1 || statusIndex === -1) {
      console.error('Required columns not found');
      return { boards: [], statuses: [], priorities: [] };
    }

    const managerName = getManagerName(managerEmail);

    // Use Sets to collect unique values
    const boardsSet = new Set();
    const statusesSet = new Set();
    const prioritiesSet = new Set();

    // Process data rows (skip header)
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const owner = row[ownerIndex];
      const assignedBy = row[assignedByIndex];

      // Filter by manager - check if manager is owner or assignedBy
      const isManagerActivity =
        owner === managerEmail ||
        owner === managerName ||
        (owner && owner.toString().includes(managerName.split(' ')[0])) ||
        assignedBy === managerEmail ||
        assignedBy === managerName ||
        (assignedBy && assignedBy.toString().includes(managerName.split(' ')[0]));

      if (isManagerActivity) {
        // Collect unique values
        if (row[boardIndex]) boardsSet.add(row[boardIndex].toString().trim());
        if (row[statusIndex]) statusesSet.add(row[statusIndex].toString().trim());
        if (priorityIndex !== -1 && row[priorityIndex]) {
          prioritiesSet.add(row[priorityIndex].toString().trim());
        }
      }
    }

    // Convert sets to sorted arrays
    const boards = Array.from(boardsSet).sort();
    const statuses = Array.from(statusesSet).sort();
    const priorities = Array.from(prioritiesSet).sort();

    console.log(`Internal activity filter options - Boards: ${boards.length}, Statuses: ${statuses.length}, Priorities: ${priorities.length}`);

    return {
      boards: boards,
      statuses: statuses,
      priorities: priorities
    };

  } catch (error) {
    console.error('Error getting internal activity filter options:', error);
    return { boards: [], statuses: [], priorities: [] };
  }
}

/**
 * Get filtered internal activities
 * @param {string} managerEmail - Manager's email
 * @param {Object} filters - Filter criteria { boards, statuses, priorities }
 * @returns {Array} Filtered activity data
 */
function getFilteredInternalActivities(managerEmail, filters = {}) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('GWMondayData');

    if (!sheet) {
      console.error('GWMondayData sheet not found');
      return [];
    }

    const data = getSheetDataAsObjects(sheet);
    const managerName = getManagerName(managerEmail);

    // Filter by manager - check if manager is in Owner OR Assigned To (handle multi-select)
    let filtered = data.filter(row => {
      const owner = row['Owner'] || '';
      const assignedTo = row['Assigned To'] || '';
      const allianceManager = row['Alliance Manager'] || '';

      // Helper function to check if manager is in a comma-separated list
      const isManagerInList = (field) => {
        if (!field) return false;
        const fieldStr = field.toString();

        // Split by comma and check each value
        const values = fieldStr.split(',').map(v => v.trim());

        return values.some(value => {
          return value === managerEmail ||
                 value === managerName ||
                 value.includes(managerName.split(' ')[0]);
        });
      };

      // If Alliance Manager is empty, show to all managers
      if (!allianceManager || allianceManager.toString().trim() === '') {
        return true;
      }

      // Check if current manager is in Owner OR Assigned To fields
      return isManagerInList(owner) || isManagerInList(assignedTo);
    });

    // Apply multiselect filters with OR logic within each filter type
    if (filters.boards && filters.boards.length > 0) {
      filtered = filtered.filter(row =>
        filters.boards.includes(row['Board Name'])
      );
    }

    if (filters.statuses && filters.statuses.length > 0) {
      filtered = filtered.filter(row =>
        filters.statuses.includes(row['Activity Status'])
      );
    }

    if (filters.priorities && filters.priorities.length > 0) {
      filtered = filtered.filter(row =>
        filters.priorities.includes(row['Importance'])
      );
    }

    // Convert dates to strings for client
    const sanitized = filtered.map(row => {
      const clean = {};
      for (const key in row) {
        const value = row[key];
        if (value instanceof Date) {
          clean[key] = value.toISOString().split('T')[0];
        } else if (value === null || value === undefined) {
          clean[key] = '';
        } else {
          clean[key] = String(value);
        }
      }
      return clean;
    });

    return sanitized;

  } catch (error) {
    console.error('Error getting filtered internal activities:', error);
    return [];
  }
}

/**
 * Get filtered partner activities
 * @param {string} managerEmail - Manager's email
 * @param {Object} filters - Filter criteria { partners: [], statuses: [], owners: [] }
 * @returns {Array} Filtered activity data
 */
function getFilteredPartnerActivities(managerEmail, filters = {}) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MondayData');

    if (!sheet) {
      console.error('MondayData sheet not found');
      return [];
    }

    const data = getSheetDataAsObjects(sheet);
    const managerName = getManagerName(managerEmail);

    // Filter by manager first
    let filtered = data.filter((row) => {
      const allianceManager = row['Alliance Manager'];
      const emailMatch = allianceManager === managerEmail;
      const nameMatch = allianceManager === managerName;
      const firstNameMatch = allianceManager && allianceManager.toString().includes(managerName.split(' ')[0]);
      return emailMatch || nameMatch || firstNameMatch;
    });

    // Apply multiselect filters with OR logic
    // If any filters are active, apply them with OR logic within each filter type
    if (filters.partners && filters.partners.length > 0) {
      filtered = filtered.filter(row =>
        filters.partners.includes(row['Partner Name'])
      );
    }

    if (filters.statuses && filters.statuses.length > 0) {
      filtered = filtered.filter(row =>
        filters.statuses.includes(row['Activity Status'])
      );
    }

    if (filters.owners && filters.owners.length > 0) {
      filtered = filtered.filter(row => {
        const owner = row['Owner'];
        if (!owner) return false;

        const ownerStr = owner.toString();
        // Check if any selected owner is in the list of owners for this row
        const ownerList = ownerStr.split(/[,;]/).map(o => o.trim());
        return filters.owners.some(selectedOwner =>
          ownerList.includes(selectedOwner)
        );
      });
    }
    
    // Convert dates to strings for client
    const sanitized = filtered.map(row => {
      const clean = {};
      for (const key in row) {
        const value = row[key];
        if (value instanceof Date) {
          clean[key] = value.toISOString().split('T')[0];
        } else if (value === null || value === undefined) {
          clean[key] = '';
        } else {
          clean[key] = String(value);
        }
      }
      return clean;
    });

    return sanitized;

  } catch (error) {
    console.error('Error getting filtered partner activities:', error);
    console.error('Error stack:', error.stack);
    return [];
  }
}

/**
 * Debug function to check what Alliance Manager values exist in MondayData
 */
function debugAllianceManagerValues() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MondayData');

    if (!sheet) {
      return { error: 'MondayData sheet not found' };
    }

    const data = getSheetDataAsObjects(sheet);

    // Get unique Alliance Manager values
    const managers = new Set();
    data.forEach(row => {
      if (row['Alliance Manager']) {
        managers.add(row['Alliance Manager']);
      }
    });

    // Get data from AllianceManager sheet
    const managerSheet = spreadsheet.getSheetByName('AllianceManager');
    const managerData = managerSheet ? getSheetDataAsObjects(managerSheet) : [];

    return {
      totalRows: data.length,
      uniqueAllianceManagers: Array.from(managers),
      allianceManagerSheetData: managerData.map(m => ({
        Manager: m.Manager,
        Email: m.Email
      })),
      sampleRows: data.slice(0, 3).map(row => ({
        'Item Name': row['Item Name'],
        'Alliance Manager': row['Alliance Manager'],
        'Partner Name': row['Partner Name']
      }))
    };
  } catch (error) {
    return { error: error.toString(), stack: error.stack };
  }
}

/**
 * Debug function to check what's in MondayDashboard for heatmap
 */
function debugMondayDashboard() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MondayDashboard');

    if (!sheet) {
      return { error: 'MondayDashboard sheet not found' };
    }

    const data = getSheetDataAsObjects(sheet);

    // Get unique Alliance Manager values
    const managers = new Set();
    data.forEach(row => {
      if (row['Alliance Manager']) {
        managers.add(row['Alliance Manager']);
      }
    });

    return {
      totalRows: data.length,
      uniqueAllianceManagers: Array.from(managers),
      sampleRows: data.slice(0, 3).map(row => ({
        'Partner Name': row['Partner Name'],
        'Item': row['Item'],
        'Alliance Manager': row['Alliance Manager'],
        'PartnerBoard': row['PartnerBoard']
      }))
    };
  } catch (error) {
    return { error: error.toString(), stack: error.stack };
  }
}

/**
 * Get sheet data as array of objects with headers as keys
 * @param {Sheet} sheet - Google Sheet object
 * @returns {Object[]} Array of row objects
 */
function getSheetDataAsObjects(sheet) {
  try {
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    if (values.length < 2) return [];
    
    const headers = values[0];
    const rows = values.slice(1);
    
    return rows.map((row, index) => {
      const obj = { _rowIndex: index + 2 }; // Keep track of row number
      headers.forEach((header, colIndex) => {
        obj[header] = parseValue(row[colIndex]);
      });
      return obj;
    });
  } catch (error) {
    console.error('Error in getSheetDataAsObjects:', error);
    return [];
  }
}

/**
 * Parse cell value to appropriate type
 * @param {*} value - Cell value
 * @returns {*} Parsed value
 */
function parseValue(value) {
  // Handle dates
  if (value instanceof Date) {
    return value.toISOString();
  }
  
  // Handle numbers
  if (typeof value === 'number') {
    return value;
  }
  
  // Handle strings
  if (typeof value === 'string') {
    // Try to parse JSON
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch (e) {
        // Not JSON, return as string
      }
    }
    return value.trim();
  }
  
  return value;
}

// ========================================================================
// New Activity Creation Functions
// ========================================================================

/**
 * Get board ID for a specific partner
 * @param {string} partnerName - Partner name
 * @returns {string} Board ID
 */
function getBoardIdForPartner(partnerName) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const dashboardSheet = spreadsheet.getSheetByName('MondayDashboard');

    if (!dashboardSheet) {
      throw new Error('MondayDashboard sheet not found');
    }

    const data = getSheetDataAsObjects(dashboardSheet);
    const partner = data.find(row =>
      row['Partner Name'] &&
      row['Partner Name'].toString().toLowerCase() === partnerName.toLowerCase()
    );

    if (partner && partner['PartnerBoard']) {
      return partner['PartnerBoard'].toString().trim();
    }

    throw new Error(`Board ID not found for partner: ${partnerName}`);

  } catch (error) {
    console.error('Error getting board ID for partner:', error);
    throw error;
  }
}

/**
 * Get board columns structure
 * @param {string} boardId - Monday.com board ID
 * @returns {Array} Array of column objects with id, title, and type
 */
function getBoardColumnsStructure(boardId) {
  try {
    console.log('Getting board columns for board:', boardId);

    const monday = new MondayAPI();
    const columns = monday.getBoardColumns(boardId);

    // Log each column name and ID on its own line (avoids log truncation)
    console.log('');
    console.log('=== COLUMN LIST (Copy-Paste Ready) ===');
    console.log('Board ID: ' + boardId);
    console.log('Column Name, Column ID');
    console.log('------------------------');

    // Log each column individually to avoid truncation
    columns.forEach(col => {
      console.log(col.title + ', ' + col.id);
    });

    console.log('------------------------');
    console.log('Total columns: ' + columns.length);
    console.log('');

    // Return simplified column structure
    return columns.map(col => ({
      id: col.id,
      title: col.title,
      type: col.type,
      settings: col.settings_str ? JSON.parse(col.settings_str) : {}
    }));

  } catch (error) {
    console.error('Error getting board columns:', error);
    throw error;
  }
}

/**
 * Print full board schema to console (run from Apps Script editor)
 * Outputs column names, IDs, types, and all label options for status/dropdown columns
 * @param {string} boardId - Monday.com board ID (defaults to Marketing Approval board)
 */
function printBoardSchema(boardId) {
  boardId = boardId || '9710279044'; // Default to Marketing Approval board

  console.log('=== BOARD SCHEMA FOR BOARD ID: ' + boardId + ' ===');
  console.log('Generated: ' + new Date().toISOString());
  console.log('');

  try {
    const monday = new MondayAPI();
    const columns = monday.getBoardColumnsWithSettings(boardId);

    columns.forEach((col, index) => {
      console.log('---');
      console.log('Column ' + (index + 1) + ':');
      console.log('  Name: "' + col.title + '"');
      console.log('  ID: "' + col.id + '"');
      console.log('  Type: "' + col.type + '"');

      if (col.settings) {
        // For status/color columns, show labels (key-value pairs)
        if (col.settings.labels && Object.keys(col.settings.labels).length > 0) {
          console.log('  Labels:');
          Object.keys(col.settings.labels).sort((a, b) => parseInt(a) - parseInt(b)).forEach(key => {
            const labelValue = col.settings.labels[key];
            // Handle dropdown labels which are objects with id/name properties
            if (labelValue && typeof labelValue === 'object' && labelValue.name) {
              console.log('    "' + key + '": "' + labelValue.name + '" (id: ' + labelValue.id + ')');
            } else {
              console.log('    "' + key + '": "' + labelValue + '"');
            }
          });
        }

        // Show deactivated labels if any
        if (col.settings.deactivated_labels && col.settings.deactivated_labels.length > 0) {
          console.log('  Deactivated Labels: [' + col.settings.deactivated_labels.join(', ') + ']');
        }
      }
    });

    console.log('---');
    console.log('=== END SCHEMA (' + columns.length + ' columns) ===');

    return columns;
  } catch (error) {
    console.error('Error printing board schema:', error);
    throw error;
  }
}

/**
 * Get board groups
 * @param {string} boardId - Monday.com board ID
 * @returns {Array} Array of group objects
 */
function getBoardGroups(boardId) {
  try {
    console.log('Getting board groups for board:', boardId);

    const query = `
      query {
        boards(ids: [${boardId}]) {
          groups {
            id
            title
            color
          }
        }
      }
    `;

    const monday = new MondayAPI();
    const result = monday.query(query);

    return result.boards[0].groups;

  } catch (error) {
    console.error('Error getting board groups:', error);
    throw error;
  }
}

/**
 * Create new Monday.com item
 * @param {string} boardId - Board ID
 * @param {string} groupId - Group ID
 * @param {string} itemName - Item name
 * @param {Object} columnValues - Column values object
 * @returns {Object} Created item info
 */
function createMondayActivity(boardId, groupId, itemName, columnValues) {
  try {
    console.log('Creating activity on board:', boardId);
    console.log('Item name:', itemName);
    console.log('Column values:', JSON.stringify(columnValues));

    const monday = new MondayAPI();
    const result = monday.createItem(boardId, groupId, itemName, columnValues);

    console.log('Activity created successfully:', result);
    return result;

  } catch (error) {
    console.error('Error creating Monday activity:', error);
    throw error;
  }
}

/**
 * Get available partners for creating new activities
 * @param {string} managerEmail - Manager email
 * @returns {Array} Array of partner objects with name and boardId
 */
function getAvailablePartnersForNewActivity(managerEmail) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const dashboardSheet = spreadsheet.getSheetByName('MondayDashboard');

    if (!dashboardSheet) {
      return [];
    }

    const managerName = getManagerName(managerEmail);
    const data = getSheetDataAsObjects(dashboardSheet);

    // Filter partners managed by this manager
    const managedPartners = data.filter(row => {
      const allianceManager = row['Alliance Manager'];
      return allianceManager === managerEmail ||
             allianceManager === managerName ||
             (allianceManager && allianceManager.toString().includes(managerName.split(' ')[0]));
    });

    // Return partner names and board IDs
    return managedPartners
      .filter(row => row['Partner Name'] && row['PartnerBoard'])
      .map(row => ({
        partnerName: row['Partner Name'].toString().trim(),
        boardId: row['PartnerBoard'].toString().trim()
      }));

  } catch (error) {
    console.error('Error getting available partners:', error);
    return [];
  }
}

/**
 * Get GW board options for internal activities
 * @returns {Array} Array of board objects
 */
function getGWBoardOptions() {
  return [
    { boardId: '9791255941', boardName: 'Partner Management Tracker' },
    { boardId: '9791272390', boardName: 'Solution Ops Tracker' },
    { boardId: '9855494527', boardName: 'Marketing Project Tracker' }
  ];
}

/**
 * Get board structure including columns and groups
 * @param {string} boardId - Board ID
 * @returns {Object} Board structure with columns and groups
 */
function getBoardStructureForNewActivity(boardId) {
  try {
    const columns = getBoardColumnsStructure(boardId);
    const groups = getBoardGroups(boardId);

    return {
      columns: columns,
      groups: groups
    };

  } catch (error) {
    console.error('Error getting board structure:', error);
    throw error;
  }
}

/**
 * Get internal board configurations from InternalBoards sheet
 * Returns array of {boardName, boardId} objects
 */
function getInternalBoardConfigurations() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const internalBoardsSheet = spreadsheet.getSheetByName('InternalBoards');

    if (!internalBoardsSheet) {
      console.error('InternalBoards sheet not found');
      return [];
    }

    const data = internalBoardsSheet.getDataRange().getValues();

    if (data.length < 2) {
      console.error('InternalBoards sheet has no data');
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
          boardId: String(boardId).trim()
        });
      }
    }

    console.log(`Loaded ${boards.length} internal boards from InternalBoards sheet`);
    return boards;

  } catch (error) {
    console.error('Error getting internal board configurations:', error);
    return [];
  }
}

/**
 * Validate that all Partner Names in Monday.com match valid partners from Partner sheet A2:A
 * Returns object with invalid partner names and their locations
 */
function validateMondayPartnerNames() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // Get valid partner names from Partner sheet (column A, starting from A2)
    const partnerSheet = spreadsheet.getSheetByName('Partner');
    if (!partnerSheet) {
      return { error: 'Partner sheet not found' };
    }

    const partnerData = partnerSheet.getRange('A2:A' + partnerSheet.getLastRow()).getValues();
    const validPartnerNames = new Set();
    partnerData.forEach(row => {
      if (row[0] && String(row[0]).trim()) {
        validPartnerNames.add(String(row[0]).trim());
      }
    });

    console.log(`Loaded ${validPartnerNames.size} valid partner names from Partner sheet`);

    // Get all partner names from MondayData sheet
    const mondayDataSheet = spreadsheet.getSheetByName('MondayData');
    if (!mondayDataSheet) {
      return { error: 'MondayData sheet not found' };
    }

    const mondayData = mondayDataSheet.getDataRange().getValues();
    if (mondayData.length < 2) {
      return { error: 'MondayData sheet has no data' };
    }

    const headers = mondayData[0];
    const partnerNameIndex = headers.indexOf('Partner Name');
    const itemNameIndex = headers.indexOf('Item Name');
    const boardNameIndex = headers.indexOf('Board Name');
    const mondayItemIdIndex = headers.indexOf('Monday Item ID');

    if (partnerNameIndex === -1) {
      return { error: 'Partner Name column not found in MondayData' };
    }

    // Track invalid partner names with details
    const invalidPartners = [];
    const invalidPartnerCounts = {};

    for (let i = 1; i < mondayData.length; i++) {
      const partnerName = mondayData[i][partnerNameIndex];

      if (!partnerName || !String(partnerName).trim()) {
        // Empty partner name
        invalidPartners.push({
          row: i + 1,
          partnerName: '(blank)',
          itemName: mondayData[i][itemNameIndex] || '',
          boardName: mondayData[i][boardNameIndex] || '',
          mondayItemId: mondayData[i][mondayItemIdIndex] || ''
        });
        invalidPartnerCounts['(blank)'] = (invalidPartnerCounts['(blank)'] || 0) + 1;
      } else {
        const trimmedName = String(partnerName).trim();
        if (!validPartnerNames.has(trimmedName)) {
          // Invalid partner name - not in Partner sheet
          invalidPartners.push({
            row: i + 1,
            partnerName: trimmedName,
            itemName: mondayData[i][itemNameIndex] || '',
            boardName: mondayData[i][boardNameIndex] || '',
            mondayItemId: mondayData[i][mondayItemIdIndex] || ''
          });
          invalidPartnerCounts[trimmedName] = (invalidPartnerCounts[trimmedName] || 0) + 1;
        }
      }
    }

    const result = {
      validPartnerCount: validPartnerNames.size,
      totalActivitiesChecked: mondayData.length - 1,
      invalidCount: invalidPartners.length,
      invalidPartners: invalidPartners,
      invalidPartnerSummary: Object.entries(invalidPartnerCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      validPartnerNames: Array.from(validPartnerNames).sort()
    };

    console.log('=== Monday Partner Name Validation Results ===');
    console.log(`Valid partners in Partner sheet: ${result.validPartnerCount}`);
    console.log(`Total activities checked: ${result.totalActivitiesChecked}`);
    console.log(`Invalid partner names found: ${result.invalidCount}`);

    if (result.invalidCount > 0) {
      console.log('\nInvalid Partner Names Summary:');
      result.invalidPartnerSummary.forEach(item => {
        console.log(`  "${item.name}": ${item.count} occurrence(s)`);
      });

      console.log('\nFirst 10 invalid entries:');
      result.invalidPartners.slice(0, 10).forEach(item => {
        console.log(`  Row ${item.row}: "${item.partnerName}" in "${item.itemName}" (Board: ${item.boardName})`);
      });
    } else {
      console.log('✓ All partner names are valid!');
    }

    return result;

  } catch (error) {
    console.error('Error validating Monday partner names:', error);
    return { error: error.message, stack: error.stack };
  }
}

/**
 * Compare Partner Names from MondayData sheet with Partner sheet column A
 * Returns object with mismatches and validation results
 */
function validatePartnerNames() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // Get Partner sheet data (column A, starting from A2)
    const partnerSheet = spreadsheet.getSheetByName('Partner');
    if (!partnerSheet) {
      return { error: 'Partner sheet not found' };
    }

    const partnerData = partnerSheet.getRange('A2:A' + partnerSheet.getLastRow()).getValues();
    const partnerSheetNames = new Set();
    partnerData.forEach(row => {
      if (row[0] && String(row[0]).trim()) {
        partnerSheetNames.add(String(row[0]).trim());
      }
    });

    console.log(`Found ${partnerSheetNames.size} partner names in Partner sheet`);

    // Get Partner Names from MondayData sheet
    const mondayDataSheet = spreadsheet.getSheetByName('MondayData');
    if (!mondayDataSheet) {
      return { error: 'MondayData sheet not found' };
    }

    const mondayData = mondayDataSheet.getDataRange().getValues();
    if (mondayData.length < 2) {
      return { error: 'MondayData sheet has no data' };
    }

    const headers = mondayData[0];
    const partnerNameIndex = headers.indexOf('Partner Name');

    if (partnerNameIndex === -1) {
      return { error: 'Partner Name column not found in MondayData' };
    }

    const mondayPartnerNames = new Set();
    for (let i = 1; i < mondayData.length; i++) {
      const partnerName = mondayData[i][partnerNameIndex];
      if (partnerName && String(partnerName).trim()) {
        mondayPartnerNames.add(String(partnerName).trim());
      }
    }

    console.log(`Found ${mondayPartnerNames.size} unique partner names in MondayData`);

    // Find partners in Monday but not in Partner sheet
    const inMondayNotInPartnerSheet = [];
    mondayPartnerNames.forEach(name => {
      if (!partnerSheetNames.has(name)) {
        inMondayNotInPartnerSheet.push(name);
      }
    });

    // Find partners in Partner sheet but not in Monday
    const inPartnerSheetNotInMonday = [];
    partnerSheetNames.forEach(name => {
      if (!mondayPartnerNames.has(name)) {
        inPartnerSheetNotInMonday.push(name);
      }
    });

    const result = {
      partnerSheetCount: partnerSheetNames.size,
      mondayDataCount: mondayPartnerNames.size,
      inMondayNotInPartnerSheet: inMondayNotInPartnerSheet.sort(),
      inPartnerSheetNotInMonday: inPartnerSheetNotInMonday.sort(),
      allPartnerSheetNames: Array.from(partnerSheetNames).sort(),
      allMondayDataNames: Array.from(mondayPartnerNames).sort()
    };

    console.log('=== Partner Name Validation Results ===');
    console.log(`Partner sheet has ${result.partnerSheetCount} partners`);
    console.log(`MondayData has ${result.mondayDataCount} unique partner names`);
    console.log(`Partners in Monday but NOT in Partner sheet (${result.inMondayNotInPartnerSheet.length}):`, result.inMondayNotInPartnerSheet);
    console.log(`Partners in Partner sheet but NOT in Monday (${result.inPartnerSheetNotInMonday.length}):`, result.inPartnerSheetNotInMonday);

    return result;

  } catch (error) {
    console.error('Error validating partner names:', error);
    return { error: error.message, stack: error.stack };
  }
}

/**
 * Get ALL Marketing Approvals without manager filtering
 * Used by Marketing Manager view
 * @returns {Array} All marketing approval items
 */
function getAllMarketingApprovals() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'all_marketing_approvals';
    const cached = cache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MarketingApproval');
    if (!sheet) {
      console.log('MarketingApproval sheet not found');
      return [];
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return [];
    }

    const headers = data[0];
    const rows = data.slice(1);

    console.log(`Getting ALL marketing approvals: ${rows.length} total rows`);

    // Convert to objects and sanitize
    const approvals = rows.map((row, index) => {
      const item = {};
      headers.forEach((header, colIndex) => {
        let value = row[colIndex];
        if (value === null || value === undefined) {
          value = '';
        } else if (value instanceof Date) {
          const year = value.getFullYear();
          const month = String(value.getMonth() + 1).padStart(2, '0');
          const day = String(value.getDate()).padStart(2, '0');
          value = `${year}-${month}-${day}`;
        } else {
          value = String(value);
        }
        item[header] = value;
      });
      item._rowIndex = index + 2;
      return item;
    }).filter(item => item['Item Name'] || item['Monday Item ID']); // Filter out empty rows

    console.log(`Returning ${approvals.length} marketing approvals`);

    // Cache for 2 minutes
    try {
      cache.put(cacheKey, JSON.stringify(approvals), 120);
    } catch (e) {
      console.log('Could not cache results:', e);
    }

    return approvals;

  } catch (error) {
    console.error('Error in getAllMarketingApprovals:', error);
    return [];
  }
}

/**
 * Get ALL Marketing Calendar entries without manager filtering
 * Used by Marketing Manager view
 * @returns {Array} All marketing calendar items
 */
function getAllMarketingCalendar() {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'all_marketing_calendar';
    const cached = cache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MarketingCalendar');
    if (!sheet) {
      console.log('MarketingCalendar sheet not found');
      return [];
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return [];
    }

    const headers = data[0];
    const rows = data.slice(1);

    console.log(`Getting ALL marketing calendar entries: ${rows.length} total rows`);

    // Convert to objects and sanitize
    const calendar = rows.map((row, index) => {
      const item = {};
      headers.forEach((header, colIndex) => {
        let value = row[colIndex];
        if (value === null || value === undefined) {
          value = '';
        } else if (value instanceof Date) {
          const year = value.getFullYear();
          const month = String(value.getMonth() + 1).padStart(2, '0');
          const day = String(value.getDate()).padStart(2, '0');
          value = `${year}-${month}-${day}`;
        } else {
          value = String(value);
        }
        item[header] = value;
      });
      item._rowIndex = index + 2;
      return item;
    }).filter(item => item['Item Name'] || item['Monday Item ID']); // Filter out empty rows

    console.log(`Returning ${calendar.length} marketing calendar entries`);

    // Cache for 2 minutes
    try {
      cache.put(cacheKey, JSON.stringify(calendar), 120);
    } catch (e) {
      console.log('Could not cache results:', e);
    }

    return calendar;

  } catch (error) {
    console.error('Error in getAllMarketingCalendar:', error);
    return [];
  }
}

/**
 * Get ALL 2026 Approvals data (for Marketing Manager portal)
 * Returns all rows from Approvals2026 sheet
 * @returns {Array} Array of 2026 approval records
 */
function getAll2026Approvals() {
  try {
    console.log('=== getAll2026Approvals START ===');

    const cache = CacheService.getScriptCache();
    const cacheKey = 'all_2026_approvals';
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log('*** CACHE HIT *** - Returning cached 2026 approvals data');
      const cachedData = JSON.parse(cached);
      console.log(`Cached data contains ${cachedData.length} items`);
      return cachedData;
    }

    console.log('*** CACHE MISS *** - Fetching 2026 approvals from spreadsheet');

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    console.log('Spreadsheet ID:', spreadsheet.getId());
    console.log('Spreadsheet Name:', spreadsheet.getName());

    const sheet = spreadsheet.getSheetByName('Approvals2026');
    if (!sheet) {
      console.log('ERROR: Approvals2026 sheet NOT FOUND');
      console.log('Available sheets:', spreadsheet.getSheets().map(s => s.getName()).join(', '));
      return [];
    }

    console.log('Approvals2026 sheet found');

    const data = sheet.getDataRange().getValues();
    console.log(`Sheet data range: ${data.length} rows x ${data[0] ? data[0].length : 0} columns`);

    if (data.length < 2) {
      console.log('No data rows found (only header or empty)');
      return [];
    }

    const headers = data[0];
    console.log('Headers:', headers.join(', '));

    const rows = data.slice(1);
    console.log(`Data rows (excluding header): ${rows.length}`);

    // Convert to objects and sanitize
    const approvals = rows.map((row, index) => {
      const item = {};
      headers.forEach((header, colIndex) => {
        let value = row[colIndex];
        if (value === null || value === undefined) {
          value = '';
        } else if (value instanceof Date) {
          const year = value.getFullYear();
          const month = String(value.getMonth() + 1).padStart(2, '0');
          const day = String(value.getDate()).padStart(2, '0');
          value = `${year}-${month}-${day}`;
        } else {
          value = String(value);
        }
        item[header] = value;
      });
      item._rowIndex = index + 2;
      return item;
    }).filter(item => item['Item Name'] || item['Monday Item ID']); // Filter out empty rows

    console.log(`After filtering empty rows: ${approvals.length} 2026 approval entries`);

    if (approvals.length > 0) {
      console.log('Sample item keys:', Object.keys(approvals[0]).join(', '));
      console.log('Sample item values:', JSON.stringify(approvals[0]));
    }

    // Cache for 2 minutes
    try {
      cache.put(cacheKey, JSON.stringify(approvals), 120);
      console.log('Data cached successfully for 2 minutes');
    } catch (e) {
      console.log('Could not cache results:', e);
    }

    console.log('=== getAll2026Approvals END - returning', approvals.length, 'items ===');
    return approvals;

  } catch (error) {
    console.error('ERROR in getAll2026Approvals:', error);
    console.error('Stack:', error.stack);
    return [];
  }
}

/**
 * Debug function to test 2026 Approvals data retrieval
 * Run this manually to check if data is being fetched correctly
 *
 * IMPORTANT: Run sync2026ApprovalsBoard() or syncAllMarketingBoards() first
 * to populate the Approvals2026 sheet from Monday.com
 */
function debug2026ApprovalsData() {
  console.log('=== DEBUG 2026 APPROVALS DATA ===');

  // First, try syncing from Monday
  console.log('Step 1: Syncing from Monday.com...');
  try {
    const syncResult = sync2026ApprovalsBoard();
    console.log('Sync result:', JSON.stringify(syncResult));
  } catch (e) {
    console.error('Sync failed:', e);
    console.error('Error details:', e.stack);
  }

  // Then, clear cache and fetch fresh data
  console.log('Step 2: Clearing cache...');
  const cache = CacheService.getScriptCache();
  cache.remove('all_2026_approvals');
  console.log('Cache cleared');

  // Fetch fresh data
  console.log('Step 3: Fetching data from spreadsheet...');
  const data = getAll2026Approvals();
  console.log('Data returned:', data.length, 'items');

  if (data.length > 0) {
    console.log('First item:', JSON.stringify(data[0]));
  } else {
    console.log('NO DATA FOUND - Check if:');
    console.log('  1. The Monday board 18389979949 has items');
    console.log('  2. The sync completed without errors');
    console.log('  3. The Approvals2026 sheet exists and has data');
  }

  return { success: true, itemCount: data.length, sampleItem: data[0] || null };
}

/**
 * One-time setup function to populate all Marketing Manager sheets
 * Run this from the script editor to initially populate:
 * - MarketingApproval sheet
 * - MarketingCalendar sheet
 * - Approvals2026 sheet
 */
function setupMarketingManagerSheets() {
  console.log('=== MARKETING MANAGER SHEETS SETUP ===');
  console.log('This will sync all marketing boards from Monday.com to the spreadsheet');

  const results = syncAllMarketingBoards();

  console.log('');
  console.log('=== SETUP COMPLETE ===');
  console.log('Marketing Approval items:', results.marketingApproval?.itemCount || 0);
  console.log('Marketing Calendar items:', results.marketingCalendar?.itemCount || 0);
  console.log('2026 Approvals items:', results.approvals2026?.itemCount || 0);

  return results;
}

/**
 * Get filter options for Marketing Manager view
 * Returns unique values for each filterable field
 * @returns {Object} Filter options for Marketing Approvals, Calendar, and 2026 Approvals
 */
function getMarketingManagerFilterOptions() {
  try {
    console.log('=== getMarketingManagerFilterOptions START ===');

    const approvals = getAllMarketingApprovals();
    console.log('Marketing Approvals:', approvals.length, 'items');

    const calendar = getAllMarketingCalendar();
    console.log('Marketing Calendar:', calendar.length, 'items');

    const approvals2026 = getAll2026Approvals();
    console.log('2026 Approvals:', approvals2026.length, 'items');

    // Collect unique values for Marketing Approvals filters
    const approvalFilters = {
      fundingTypes: [...new Set(approvals.map(a => a['Funding Type']).filter(v => v))].sort(),
      overallStatuses: [...new Set(approvals.map(a => a['Overall Status']).filter(v => v))].sort(),
      allianceManagers: [...new Set(approvals.map(a => a['AllianceManager'] || a['Alliance Manager']).filter(v => v))].sort(),
      partners: [...new Set(approvals.map(a => a['Partner']).filter(v => v))].sort(),
      requestTypes: [...new Set(approvals.map(a => a['Request Type']).filter(v => v))].sort()
    };

    // Collect unique values for Marketing Calendar filters
    const calendarFilters = {
      partners: [...new Set(calendar.map(c => c['Partner']).filter(v => v))].sort(),
      owners: [...new Set(calendar.map(c => c['Owner']).filter(v => v))].sort(),
      activityTypes: [...new Set(calendar.map(c => c['Activity Type']).filter(v => v))].sort()
    };

    // Collect unique values for 2026 Approvals filters
    const approvals2026Filters = {
      fundingTypes: [...new Set(approvals2026.map(a => a['Funding Type']).filter(v => v))].sort(),
      overallStatuses: [...new Set(approvals2026.map(a => a['Overall Status']).filter(v => v))].sort(),
      partners: [...new Set(approvals2026.map(a => a['Partner']).filter(v => v))].sort()
    };

    console.log('2026 Approvals filter options:');
    console.log('  - Funding Types:', approvals2026Filters.fundingTypes.length);
    console.log('  - Overall Statuses:', approvals2026Filters.overallStatuses.length);
    console.log('  - Partners:', approvals2026Filters.partners.length);
    console.log('=== getMarketingManagerFilterOptions END ===');

    return {
      approvalFilters,
      calendarFilters,
      approvals2026Filters
    };

  } catch (error) {
    console.error('ERROR in getMarketingManagerFilterOptions:', error);
    console.error('Stack:', error.stack);
    return {
      approvalFilters: { fundingTypes: [], overallStatuses: [], allianceManagers: [], partners: [], requestTypes: [] },
      calendarFilters: { partners: [], owners: [], activityTypes: [] },
      approvals2026Filters: { fundingTypes: [], overallStatuses: [], partners: [] }
    };
  }
}

/**
 * Get Marketing Calendar Stats data for stacked column chart
 * Reads from MarketingCalendarStats sheet where:
 * - Column A (A2:A) contains activity/task names
 * - Row 1 (B1:M1) contains month names (January through December)
 * - Cells contain counts of activities per task per month
 * @returns {Object} Chart data with labels (months), datasets (tasks with monthly counts)
 */
function getMarketingCalendarStats() {
  try {
    console.log('=== getMarketingCalendarStats START ===');

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('MarketingCalendarStats');

    if (!sheet) {
      console.log('MarketingCalendarStats sheet not found');
      return { labels: [], datasets: [], error: 'MarketingCalendarStats sheet not found' };
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    console.log(`Sheet dimensions: ${lastRow} rows x ${lastCol} columns`);

    if (lastRow < 2 || lastCol < 2) {
      console.log('Sheet has insufficient data');
      return { labels: [], datasets: [], error: 'Insufficient data in sheet' };
    }

    // Get all data from the sheet
    const allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();

    // Extract month labels from row 1 (B1:M1 or however many columns there are)
    const headerRow = allData[0];
    const months = [];
    for (let i = 1; i < headerRow.length; i++) {
      if (headerRow[i] && headerRow[i].toString().trim() !== '') {
        months.push(headerRow[i].toString().trim());
      }
    }

    console.log('Months found:', months.join(', '));

    // Extract activity data from rows 2 onwards
    const datasets = [];

    // Color palette for different activities
    const colors = [
      { bg: 'rgba(54, 162, 235, 0.8)', border: 'rgba(54, 162, 235, 1)' },    // Blue
      { bg: 'rgba(255, 99, 132, 0.8)', border: 'rgba(255, 99, 132, 1)' },    // Red
      { bg: 'rgba(75, 192, 192, 0.8)', border: 'rgba(75, 192, 192, 1)' },    // Teal
      { bg: 'rgba(255, 206, 86, 0.8)', border: 'rgba(255, 206, 86, 1)' },    // Yellow
      { bg: 'rgba(153, 102, 255, 0.8)', border: 'rgba(153, 102, 255, 1)' },  // Purple
      { bg: 'rgba(255, 159, 64, 0.8)', border: 'rgba(255, 159, 64, 1)' },    // Orange
      { bg: 'rgba(46, 204, 113, 0.8)', border: 'rgba(46, 204, 113, 1)' },    // Green
      { bg: 'rgba(231, 76, 60, 0.8)', border: 'rgba(231, 76, 60, 1)' },      // Dark Red
      { bg: 'rgba(52, 152, 219, 0.8)', border: 'rgba(52, 152, 219, 1)' },    // Light Blue
      { bg: 'rgba(155, 89, 182, 0.8)', border: 'rgba(155, 89, 182, 1)' },    // Violet
      { bg: 'rgba(241, 196, 15, 0.8)', border: 'rgba(241, 196, 15, 1)' },    // Gold
      { bg: 'rgba(26, 188, 156, 0.8)', border: 'rgba(26, 188, 156, 1)' },    // Turquoise
      { bg: 'rgba(230, 126, 34, 0.8)', border: 'rgba(230, 126, 34, 1)' },    // Carrot
      { bg: 'rgba(149, 165, 166, 0.8)', border: 'rgba(149, 165, 166, 1)' },  // Gray
      { bg: 'rgba(192, 57, 43, 0.8)', border: 'rgba(192, 57, 43, 1)' }       // Pomegranate
    ];

    for (let i = 1; i < allData.length; i++) {
      const row = allData[i];
      const activityName = row[0] ? row[0].toString().trim() : '';

      if (!activityName) continue;

      // Get monthly values for this activity
      const data = [];
      for (let j = 1; j <= months.length; j++) {
        const value = row[j];
        // Handle empty cells, strings, and numbers
        const numValue = (value === '' || value === null || value === undefined) ? 0 : Number(value) || 0;
        data.push(numValue);
      }

      const colorIndex = datasets.length % colors.length;

      datasets.push({
        label: activityName,
        data: data,
        backgroundColor: colors[colorIndex].bg,
        borderColor: colors[colorIndex].border,
        borderWidth: 1
      });
    }

    console.log(`Found ${datasets.length} activities`);
    console.log('Activities:', datasets.map(d => d.label).join(', '));
    console.log('=== getMarketingCalendarStats END ===');

    return {
      labels: months,
      datasets: datasets
    };

  } catch (error) {
    console.error('ERROR in getMarketingCalendarStats:', error);
    console.error('Stack:', error.stack);
    return { labels: [], datasets: [], error: error.message };
  }
}

/**
 * Get the 2026 Flow configuration for grouping columns in Add/Edit modals
 * Reads from the 2026Flow sheet which defines how columns are grouped
 *
 * Sheet columns:
 * - Column ID: The Monday column ID
 * - Section Grouping: Group 1, Group 2, etc.
 * - Group Name: Display name for the group
 * - Monday Column: Optional condition - column ID to check
 * - Value: Optional condition - value to match
 *
 * @returns {Object} Configuration with groups array and column mappings
 */
function get2026FlowConfig() {
  try {
    console.log('=== get2026FlowConfig START ===');

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('2026Flow');

    if (!sheet) {
      console.log('2026Flow sheet not found');
      return { groups: [], columns: [], error: '2026Flow sheet not found' };
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    console.log(`Sheet dimensions: ${lastRow} rows x ${lastCol} columns`);

    if (lastRow < 2) {
      console.log('Sheet has no data rows');
      return { groups: [], columns: [], error: 'No data in 2026Flow sheet' };
    }

    // Get header row to find column indices
    const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    // Find column indices (case-insensitive)
    const colIndices = {
      columnId: -1,
      sectionGrouping: -1,
      groupName: -1,
      mondayColumn: -1,
      value: -1
    };

    headerRow.forEach((header, idx) => {
      const h = header.toString().toLowerCase().trim();
      if (h === 'column id' || h === 'columnid') colIndices.columnId = idx;
      else if (h === 'section grouping' || h === 'sectiongrouping') colIndices.sectionGrouping = idx;
      else if (h === 'group name' || h === 'groupname') colIndices.groupName = idx;
      else if (h === 'monday column' || h === 'mondaycolumn') colIndices.mondayColumn = idx;
      else if (h === 'value') colIndices.value = idx;
    });

    console.log('Column indices:', JSON.stringify(colIndices));

    if (colIndices.columnId === -1 || colIndices.sectionGrouping === -1) {
      console.log('Required columns not found');
      return { groups: [], columns: [], error: 'Required columns (Column ID, Section Grouping) not found' };
    }

    // Get all data rows
    const dataRows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    // Build column configuration and group list
    const columns = [];
    const groupsMap = new Map(); // To track unique groups in order

    dataRows.forEach((row, idx) => {
      const columnId = row[colIndices.columnId]?.toString().trim();
      const sectionGrouping = row[colIndices.sectionGrouping]?.toString().trim();
      const groupName = colIndices.groupName >= 0 ? row[colIndices.groupName]?.toString().trim() : '';
      const mondayColumn = colIndices.mondayColumn >= 0 ? row[colIndices.mondayColumn]?.toString().trim() : '';
      const value = colIndices.value >= 0 ? row[colIndices.value]?.toString().trim() : '';

      if (columnId && sectionGrouping) {
        columns.push({
          columnId: columnId,
          group: sectionGrouping,
          groupName: groupName || sectionGrouping,
          condition: mondayColumn ? { columnId: mondayColumn, value: value } : null
        });

        // Track groups in order they appear
        if (!groupsMap.has(sectionGrouping)) {
          groupsMap.set(sectionGrouping, groupName || sectionGrouping);
        }
      }
    });

    // Convert groups map to array
    const groups = [];
    groupsMap.forEach((groupName, groupKey) => {
      groups.push({
        key: groupKey,
        name: groupName
      });
    });

    console.log(`Found ${columns.length} column configurations across ${groups.length} groups`);
    console.log('Groups:', groups.map(g => g.key).join(', '));
    console.log('=== get2026FlowConfig END ===');

    return {
      groups: groups,
      columns: columns
    };

  } catch (error) {
    console.error('ERROR in get2026FlowConfig:', error);
    console.error('Stack:', error.stack);
    return { groups: [], columns: [], error: error.message };
  }
}
