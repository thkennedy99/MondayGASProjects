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
 */
getActivityData(type, manager, filters = {}, sort = {}, pagination = {}) {
  const cacheKey = `activity_${type}_${manager}_${this.hashParams(filters, sort, pagination)}`;
  const cached = this.cache.get(cacheKey);
  
  if (cached && !CONFIG.DEBUG_MODE) {
    return JSON.parse(cached);
  }
  
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
      
      // Then add all other fields
      for (const key in row) {
        if (key === 'Item Name') {
          // Skip Item Name as we've already added it as Name
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
    
    // Cache result
    this.cache.put(cacheKey, JSON.stringify(result), CONFIG.CACHE_DURATION);
    
    return result;
    
  } catch (error) {
    console.error('Error getting activity data:', error);
    throw error;
  }
}
  
// Inside the DataService class definition, add this method:
getMarketingCalendarData(managerEmail) {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = `marketing_calendar_${managerEmail}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
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
    
    cache.put(cacheKey, JSON.stringify(calendarData), CONFIG.CACHE_DURATION);
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
        const allianceManager = row['Alliance Manager'];
        
        // Check both email and name formats
        return allianceManager === managerEmail || 
               allianceManager === managerName ||
               (allianceManager && allianceManager.includes(managerName.split(' ')[0])); // Check first name
      });
    } else {
      // For internal activities (GWMondayData), check Owner or Assigned By columns
      const managerName = this.getManagerName(managerEmail);
      
      return data.filter(row => {
        const owner = row['Owner'];
        const assignedBy = row['Assigned By'];
        
        // Check both email and name formats
        return owner === managerEmail || 
               owner === managerName ||
               assignedBy === managerEmail || 
               assignedBy === managerName ||
               (owner && owner.includes(managerName.split(' ')[0])) ||
               (assignedBy && assignedBy.includes(managerName.split(' ')[0]));
      });
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
    const cacheKey = `manager_partners_${managerEmail}`;
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
 * Get marketing approvals
 */
getMarketingApprovals(managerEmail) {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = `marketing_approvals_${managerEmail}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    const sheet = this.spreadsheet.getSheetByName('MarketingApproval');
    if (!sheet) {
      console.log('MarketingApproval sheet not found');
      return [];
    }
    
    const data = this.getSheetData(sheet);
    const managerName = this.getManagerName(managerEmail);
    
    console.log(`Getting marketing approvals for: ${managerEmail} / ${managerName}`);
    console.log(`Total marketing approval rows: ${data.length}`);
    
    // Filter by Alliance Manager column and approval status
    const filtered = data.filter(row => {
      // Check if this approval belongs to the manager
      const allianceManager = row['Alliance Manager'];
      const owner = row['Owner'];
      
      const matchesManager = 
        allianceManager === managerEmail || 
        allianceManager === managerName ||
        (allianceManager && allianceManager.includes(managerName.split(' ')[0])) ||
        owner === managerEmail ||
        owner === managerName ||
        (owner && owner.includes(managerName.split(' ')[0]));
      
      if (!matchesManager) return false;
      
      // Check for pending approval status - using the Overall Status column
      const overallStatus = String(row['Overall Status'] || '').toLowerCase();
      
      // Consider it pending if it's not fully approved or rejected
      const isPending = 
        !overallStatus.includes('final approval') &&
        !overallStatus.includes('rejected') &&
        !overallStatus.includes('completed') &&
        !overallStatus.includes('cancelled');
      
      // Also check individual decision columns
      const ericDecision = String(row['Eric Decision'] || '').toLowerCase();
      const marketingDecision = String(row['Marketing Decision'] || '').toLowerCase();
      const willDecision = String(row['Will Decision'] || '').toLowerCase();
      
      // If any decision is explicitly pending or not yet made, include it
      const hasOutstandingDecision = 
        !ericDecision || ericDecision.includes('pending') || ericDecision.includes('send back') ||
        !marketingDecision || marketingDecision.includes('pending') || marketingDecision.includes('send back') ||
        !willDecision || willDecision.includes('pending') || willDecision.includes('send back');
      
      return matchesManager && (isPending || hasOutstandingDecision);
    });
    
    console.log(`Filtered to ${filtered.length} pending approvals`);
    
    // Convert all values to strings and add calculated fields
    const approvals = filtered.map(row => {
      const sanitized = {};
      
      // Add all the columns from the sheet
      const columnsToInclude = [
        'Item Name',
        'Group',
        'Board Name',
        'Partner Name',
        'Monday Item ID',
        'Board ID',
        'Subitems',
        'Event URL',
        'Priority',
        'Overall Status',
        'Owner',
        'Alliance Manager',
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
    
    cache.put(cacheKey, JSON.stringify(approvals), CONFIG.CACHE_DURATION);
    return approvals;
    
  } catch (error) {
    console.error('Error in getMarketingApprovals:', error);
    return [];
  }
}
  

  /**
 * Get partner heatmap data
 */
getPartnerHeatmap(managerEmail) {
  try {
    // Initialize cache properly
    const cache = CacheService.getScriptCache();
    const cacheKey = `heatmap_${managerEmail}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    const sheet = this.spreadsheet.getSheetByName('MondayDashboard');
    if (!sheet) {
      console.log('MondayDashboard sheet not found');
      return [];
    }
    
    const data = this.getSheetData(sheet);
    const managerName = this.getManagerName(managerEmail);
    
    console.log(`Getting heatmap for manager: ${managerEmail} / ${managerName}`);
    console.log(`Total dashboard rows: ${data.length}`);
    
    // Filter by Alliance Manager column
    const filtered = data.filter(row => {
      const allianceManager = row['Alliance Manager'];
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
        'Alliance Manager': String(row['Alliance Manager'] || ''),
        'Summary of Partner Activities': String(row['Summary of Partner Activities'] || ''),
        'PartnerBoard': String(row['PartnerBoard'] || ''),
        
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
    
    cache.put(cacheKey, JSON.stringify(heatmapData), CONFIG.CACHE_DURATION);
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
    const service = new DataService();
    const result = service.getPartnerHeatmap(managerEmail);
    
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
    
    return serialized;
    
  } catch (error) {
    console.error('Error in getPartnerHeatmap wrapper:', error);
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
    const sheet = spreadsheet.getSheetByName('MondayData');
    
    if (!sheet) {
      console.error('MondayData sheet not found');
      return { partners: [], statuses: [], owners: [] };
    }
    
    // Get all data from the sheet
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    
    if (values.length < 2) {
      return { partners: [], statuses: [], owners: [] };
    }
    
    // Find column indices
    const headers = values[0];
    const partnerIndex = headers.indexOf('Partner Name');
    const statusIndex = headers.indexOf('Activity Status');
    const ownerIndex = headers.indexOf('Owner');
    const allianceManagerIndex = headers.indexOf('Alliance Manager');
    
    // Get manager name for filtering
    const managerName = getManagerName(managerEmail);
    
    // Collect unique values
    const partnersSet = new Set();
    const statusesSet = new Set();
    const ownersSet = new Set();
    
    // Process data rows
    for (let i = 1; i < values.length; i++) {
      const allianceManager = values[i][allianceManagerIndex];
      
      // Only process rows for this manager
      const isManagerRow = allianceManager === managerEmail || 
                          allianceManager === managerName ||
                          (allianceManager && allianceManager.toString().includes(managerName.split(' ')[0]));
      
      if (isManagerRow) {
        // Add partner
        const partner = values[i][partnerIndex];
        if (partner && partner.toString().trim()) {
          partnersSet.add(partner.toString().trim());
        }
        
        // Add status
        const status = values[i][statusIndex];
        if (status && status.toString().trim()) {
          statusesSet.add(status.toString().trim());
        }
        
        // Add owners (handle multiple owners)
        const owner = values[i][ownerIndex];
        if (owner) {
          const ownerStr = owner.toString().trim();
          // Handle multiple owners separated by commas or semicolons
          const ownerList = ownerStr.split(/[,;]/).map(o => o.trim()).filter(o => o);
          ownerList.forEach(o => ownersSet.add(o));
        }
      }
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
    if (!email) return email;
    
    // Check cache first
    const cache = CacheService.getScriptCache();
    const cacheKey = `manager_name_${email}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
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
    const manager = managerData.find(row => {
      const rowEmail = row['Email'];
      return rowEmail && rowEmail.toString().toLowerCase().trim() === email.toLowerCase().trim();
    });
    
    const name = manager && manager['Manager'] ? manager['Manager'].toString().trim() : email;
    
    // Cache for 1 hour
    cache.put(cacheKey, name, 3600);
    
    return name;
    
  } catch (error) {
    console.error('Error in getManagerName:', error);
    return email;
  }
}
/**
 * Get filtered partner activities
 * @param {string} managerEmail - Manager's email
 * @param {Object} filters - Filter criteria { partner, status, owner }
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
    let filtered = data.filter(row => {
      const allianceManager = row['Alliance Manager'];
      return allianceManager === managerEmail || 
             allianceManager === managerName ||
             (allianceManager && allianceManager.toString().includes(managerName.split(' ')[0]));
    });
    
    // Apply partner filter
    if (filters.partner && filters.partner !== 'all') {
      filtered = filtered.filter(row => row['Partner Name'] === filters.partner);
    }
    
    // Apply status filter
    if (filters.status && filters.status !== 'all') {
      filtered = filtered.filter(row => row['Activity Status'] === filters.status);
    }
    
    // Apply owner filter (handle multiple owners)
    if (filters.owner && filters.owner !== 'all') {
      filtered = filtered.filter(row => {
        const owner = row['Owner'];
        if (!owner) return false;
        
        const ownerStr = owner.toString();
        // Check if the selected owner is in the list of owners
        const ownerList = ownerStr.split(/[,;]/).map(o => o.trim());
        return ownerList.includes(filters.owner);
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
    
    console.log(`Returning ${sanitized.length} filtered partner activities`);
    return sanitized;
    
  } catch (error) {
    console.error('Error getting filtered partner activities:', error);
    return [];
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
