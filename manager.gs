/**
 * Get list of authorized managers from AllianceManager sheet
 * @returns {string[]} Array of manager email addresses
 */
function getManagerList() {
  try {
    // Check cache first for performance
    const cache = CacheService.getScriptCache();
    const cacheKey = 'manager_list';
    const cached = cache.get(cacheKey);
    
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        console.log('Cache parse error, fetching fresh data');
      }
    }
    
    // Get the AllianceManager sheet
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const managerSheet = spreadsheet.getSheetByName('AllianceManager');
    
    if (!managerSheet) {
      console.error('AllianceManager sheet not found');
      // Check if there's a fallback from Properties Service
      const fallbackManagers = PropertiesService.getScriptProperties().getProperty('MANAGER_LIST');
      if (fallbackManagers) {
        return fallbackManagers.split(',').map(email => email.trim());
      }
      return [];
    }
    
    // Get all data from the sheet
    const dataRange = managerSheet.getDataRange();
    const values = dataRange.getValues();
    
    if (values.length < 2) {
      console.log('No manager data found in AllianceManager sheet');
      return [];
    }
    
    // Find the Email column index (assuming first row is headers)
    const headers = values[0];
    let emailColumnIndex = -1;
    
    // Look for 'Email' column (case-insensitive)
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] && headers[i].toString().toLowerCase().trim() === 'email') {
        emailColumnIndex = i;
        break;
      }
    }
    
    // If no Email column found, try first column as fallback
    if (emailColumnIndex === -1) {
      console.log('Email column not found in headers, using first column');
      emailColumnIndex = 0;
    }
    
    // Extract manager emails from the data rows
    const managers = [];
    
    for (let i = 1; i < values.length; i++) { // Start from row 2 (index 1)
      const email = values[i][emailColumnIndex];
      
      // Validate and add email if it's valid
      if (email && typeof email === 'string') {
        const trimmedEmail = email.trim().toLowerCase();
        
        // Basic email validation
        if (trimmedEmail && trimmedEmail.includes('@') && trimmedEmail.includes('.')) {
          // Check if it's a Guidewire email (based on domain requirements from project)
          if (trimmedEmail.endsWith('@guidewire.com')) {
            managers.push(trimmedEmail);
          }
        }
      }
    }
    
    // Remove duplicates
    const uniqueManagers = [...new Set(managers)];
    
    // Sort alphabetically for consistency
    uniqueManagers.sort();
    
    // Cache the result for 1 hour (3600 seconds)
    cache.put(cacheKey, JSON.stringify(uniqueManagers), 3600);
    
    console.log(`Loaded ${uniqueManagers.length} managers from AllianceManager sheet`);
    
    return uniqueManagers;
    
  } catch (error) {
    console.error('Error in getManagerList:', error);
    
    // Try to get from Properties Service as last resort
    try {
      const fallbackManagers = PropertiesService.getScriptProperties().getProperty('MANAGER_LIST');
      if (fallbackManagers) {
        return fallbackManagers.split(',').map(email => email.trim().toLowerCase());
      }
    } catch (e) {
      console.error('Failed to get fallback manager list:', e);
    }
    
    return [];
  }
}

/**
 * Clear the manager list cache - useful when the AllianceManager sheet is updated
 */
function clearManagerListCache() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove('manager_list');
    console.log('Manager list cache cleared');
    return true;
  } catch (error) {
    console.error('Error clearing manager list cache:', error);
    return false;
  }
}

/**
 * Look up manager email by name
 * Used when webhook passes manager name instead of email
 * @param {string} managerName - Manager's full name (e.g., "Tim Kennedy")
 * @returns {string} Manager's email (lowercase) or empty string if not found
 */
function getManagerEmailByName(managerName) {
  try {
    if (!managerName || typeof managerName !== 'string') {
      console.log('getManagerEmailByName: Invalid manager name provided');
      return '';
    }

    const searchName = managerName.trim().toLowerCase();
    console.log(`Looking up email for manager: "${managerName}"`);

    // Check cache first
    const cache = CacheService.getScriptCache();
    const cacheKey = `manager_email_${searchName.replace(/\s+/g, '_')}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log(`Found cached email for ${managerName}: ${cached}`);
      return cached;
    }

    // Get the AllianceManager sheet
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const managerSheet = spreadsheet.getSheetByName('AllianceManager');

    if (!managerSheet) {
      console.error('AllianceManager sheet not found');
      return '';
    }

    // Get all data from the sheet
    const dataRange = managerSheet.getDataRange();
    const values = dataRange.getValues();

    if (values.length < 2) {
      console.log('No manager data found in AllianceManager sheet');
      return '';
    }

    // Find column indices
    const headers = values[0];
    let nameColumnIndex = -1;
    let emailColumnIndex = -1;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] ? headers[i].toString().toLowerCase().trim() : '';
      if (header === 'manager' || header === 'name' || header === 'full name') {
        nameColumnIndex = i;
      }
      if (header === 'email') {
        emailColumnIndex = i;
      }
    }

    if (emailColumnIndex === -1) {
      console.error('Email column not found in AllianceManager sheet');
      return '';
    }

    // If no name column, try to match against email username
    if (nameColumnIndex === -1) {
      console.log('Name column not found, will try matching against email');
    }

    // Search for the manager
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const email = row[emailColumnIndex] ? row[emailColumnIndex].toString().trim().toLowerCase() : '';

      // Try matching by name column if available
      if (nameColumnIndex !== -1) {
        const name = row[nameColumnIndex] ? row[nameColumnIndex].toString().trim().toLowerCase() : '';
        if (name === searchName) {
          console.log(`Found exact name match: ${managerName} -> ${email}`);
          cache.put(cacheKey, email, 3600); // Cache for 1 hour
          return email;
        }
      }

      // Try matching by email username (first.last@domain.com)
      if (email) {
        const emailUsername = email.split('@')[0];
        const nameFromEmail = emailUsername.replace(/\./g, ' ').toLowerCase();
        if (nameFromEmail === searchName) {
          console.log(`Found email username match: ${managerName} -> ${email}`);
          cache.put(cacheKey, email, 3600);
          return email;
        }
      }
    }

    // Try partial/fuzzy matching as fallback
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const email = row[emailColumnIndex] ? row[emailColumnIndex].toString().trim().toLowerCase() : '';

      if (nameColumnIndex !== -1) {
        const name = row[nameColumnIndex] ? row[nameColumnIndex].toString().trim().toLowerCase() : '';
        // Check if search name contains or is contained in the name
        if (name && (name.includes(searchName) || searchName.includes(name))) {
          console.log(`Found partial name match: ${managerName} -> ${email}`);
          cache.put(cacheKey, email, 3600);
          return email;
        }
      }
    }

    console.log(`No email found for manager: ${managerName}`);
    return '';

  } catch (error) {
    console.error('Error in getManagerEmailByName:', error);
    return '';
  }
}

/**
 * Refresh manager list - clears cache and reloads from sheet
 * @returns {string[]} Array of manager email addresses
 */
function refreshManagerList() {
  clearManagerListCache();
  return getManagerList();
}

/**
 * Check if a user is a manager
 * @param {string} email - Email address to check
 * @returns {boolean} True if the email is in the manager list
 */
function isManager(email) {
  if (!email) return false;
  
  const managers = getManagerList();
  const normalizedEmail = email.trim().toLowerCase();
  
  return managers.includes(normalizedEmail);
}

/**
 * Add a manager to the Properties Service fallback list
 * This is useful for emergency access if the sheet is unavailable
 * @param {string} email - Manager email to add
 */
function addManagerToFallback(email) {
  try {
    const properties = PropertiesService.getScriptProperties();
    let fallbackList = properties.getProperty('MANAGER_LIST') || '';
    
    const managers = fallbackList ? fallbackList.split(',').map(e => e.trim()) : [];
    
    if (!managers.includes(email)) {
      managers.push(email);
      properties.setProperty('MANAGER_LIST', managers.join(','));
      console.log(`Added ${email} to fallback manager list`);
    }
    
    return true;
  } catch (error) {
    console.error('Error adding manager to fallback:', error);
    return false;
  }
}

/**
 * Test function to verify getManagerList is working
 */
function testGetManagerList() {
  try {
    const managers = getManagerList();
    console.log('Manager List Test Results:');
    console.log('Total managers found:', managers.length);

    if (managers.length > 0) {
      console.log('First 5 managers:', managers.slice(0, 5));
    } else {
      console.log('No managers found - check AllianceManager sheet');
    }

    // Test cache
    const cachedManagers = getManagerList(); // Should come from cache
    console.log('Cache working:', cachedManagers.length === managers.length);

    // Test isManager function
    if (managers.length > 0) {
      console.log('isManager test:', isManager(managers[0]));
    }

    return managers;
  } catch (error) {
    console.error('Test failed:', error);
    return null;
  }
}

/**
 * Get manager authorization data from TechAllianceManager sheet
 * Returns which Monday board tabs to show, the user's role, and their reports (for Manager role)
 * @param {string} managerEmail - Manager's email address
 * @returns {Object} Authorization data containing:
 *   - mondayBoards: Array of board tab names the user can access
 *   - role: User's role (User, Manager, Admin, SrDirector)
 *   - reports: Comma-separated list of names (for Manager role)
 *   - managerName: The manager's name
 */
function getManagerAuthorization(managerEmail) {
  try {
    if (!managerEmail || typeof managerEmail !== 'string') {
      console.log('getManagerAuthorization: Invalid manager email provided');
      return {
        mondayBoards: [],
        role: 'User',
        reports: '',
        managerName: ''
      };
    }

    const searchEmail = managerEmail.trim().toLowerCase();
    console.log(`Getting authorization for manager: "${managerEmail}"`);

    // Check cache first
    const cache = CacheService.getScriptCache();
    const cacheKey = `manager_auth_${searchEmail.replace(/[@.]/g, '_')}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      try {
        console.log(`Found cached authorization for ${managerEmail}`);
        return JSON.parse(cached);
      } catch (e) {
        console.log('Cache parse error, fetching fresh data');
      }
    }

    // Get the TechAllianceManager sheet
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('TechAllianceManager');

    if (!sheet) {
      console.error('TechAllianceManager sheet not found');
      return {
        mondayBoards: [],
        role: 'User',
        reports: '',
        managerName: ''
      };
    }

    // Get all data from the sheet
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();

    if (values.length < 2) {
      console.log('No data found in TechAllianceManager sheet');
      return {
        mondayBoards: [],
        role: 'User',
        reports: '',
        managerName: ''
      };
    }

    // Find column indices
    const headers = values[0];
    console.log('=== TechAllianceManager Headers ===');
    console.log('Raw headers:', JSON.stringify(headers));

    let nameColumnIndex = -1;
    let emailColumnIndex = -1;
    let mondayBoardsColumnIndex = -1;
    let mondayRoleColumnIndex = -1;
    let reportsColumnIndex = -1;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] ? headers[i].toString().toLowerCase().trim() : '';
      // Remove spaces for more flexible matching
      const headerNoSpaces = header.replace(/\s+/g, '');

      if (header === 'manager' || header === 'name' || header === 'full name') {
        nameColumnIndex = i;
      }
      if (header === 'email') {
        emailColumnIndex = i;
      }
      // Match 'mondayboards', 'monday boards', 'MondayBoards', etc.
      if (headerNoSpaces === 'mondayboards') {
        mondayBoardsColumnIndex = i;
      }
      // Match 'mondayrole', 'monday role', 'MondayRole', etc.
      if (headerNoSpaces === 'mondayrole') {
        mondayRoleColumnIndex = i;
      }
      if (header === 'reports') {
        reportsColumnIndex = i;
      }
    }

    console.log('Column indices found - name:', nameColumnIndex, 'email:', emailColumnIndex,
                'mondayBoards:', mondayBoardsColumnIndex, 'mondayRole:', mondayRoleColumnIndex,
                'reports:', reportsColumnIndex);

    if (emailColumnIndex === -1) {
      console.error('Email column not found in TechAllianceManager sheet');
      return {
        mondayBoards: [],
        role: 'User',
        reports: '',
        managerName: ''
      };
    }

    // Default authorization
    let authorization = {
      mondayBoards: [],
      role: 'User',
      reports: '',
      managerName: ''
    };

    // Search for the manager by email
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const email = row[emailColumnIndex] ? row[emailColumnIndex].toString().trim().toLowerCase() : '';

      if (email === searchEmail) {
        console.log(`Found manager in TechAllianceManager: ${managerEmail}`);
        console.log('Row index:', i);
        console.log('Row data:', JSON.stringify(row));

        // Get manager name
        if (nameColumnIndex !== -1) {
          authorization.managerName = row[nameColumnIndex] ? row[nameColumnIndex].toString().trim() : '';
        }

        // Get MondayBoards - comma-separated list of tab names
        if (mondayBoardsColumnIndex !== -1) {
          const boardsValue = row[mondayBoardsColumnIndex] ? row[mondayBoardsColumnIndex].toString().trim() : '';
          authorization.mondayBoards = boardsValue
            .split(',')
            .map(board => board.trim())
            .filter(board => board !== '');
        }

        // Get MondayRole
        if (mondayRoleColumnIndex !== -1) {
          const rawRoleValue = row[mondayRoleColumnIndex];
          const roleValue = rawRoleValue ? rawRoleValue.toString().trim() : 'User';
          console.log('=== Role Processing ===');
          console.log('Raw role value from sheet:', rawRoleValue);
          console.log('Trimmed role value:', roleValue);
          console.log('Role value type:', typeof rawRoleValue);

          // Validate role - must be one of the allowed values
          const validRoles = ['User', 'Manager', 'Admin', 'SrDirector'];
          const isValidRole = validRoles.includes(roleValue);
          console.log('Valid roles:', validRoles);
          console.log('Is role valid?:', isValidRole);

          authorization.role = isValidRole ? roleValue : 'User';
          console.log('Final assigned role:', authorization.role);
        } else {
          console.log('MondayRole column not found (index: -1), defaulting to User');
        }

        // Get Reports - comma-separated list of names (for Manager role)
        if (reportsColumnIndex !== -1) {
          authorization.reports = row[reportsColumnIndex] ? row[reportsColumnIndex].toString().trim() : '';
        }

        break;
      }
    }

    console.log(`Authorization for ${managerEmail}:`, JSON.stringify(authorization));

    // Cache the result for 1 hour (3600 seconds)
    cache.put(cacheKey, JSON.stringify(authorization), 3600);

    return authorization;

  } catch (error) {
    console.error('Error in getManagerAuthorization:', error);
    return {
      mondayBoards: [],
      role: 'User',
      reports: '',
      managerName: ''
    };
  }
}

/**
 * Clear the manager authorization cache for a specific email
 * @param {string} managerEmail - Manager's email address
 */
function clearManagerAuthorizationCache(managerEmail) {
  try {
    const cache = CacheService.getScriptCache();
    const searchEmail = managerEmail ? managerEmail.trim().toLowerCase() : '';
    const cacheKey = `manager_auth_${searchEmail.replace(/[@.]/g, '_')}`;
    cache.remove(cacheKey);
    console.log(`Manager authorization cache cleared for ${managerEmail}`);
    return true;
  } catch (error) {
    console.error('Error clearing manager authorization cache:', error);
    return false;
  }
}

/**
 * Nuclear option - clear ALL caches (manager list, all authorizations, email lookups)
 * Use this when you've made changes to TechAllianceManager or AllianceManager sheets
 * and want to ensure fresh data is loaded for everyone
 */
function clearAllManagerCaches() {
  try {
    const cache = CacheService.getScriptCache();

    // Clear the manager list cache
    cache.remove('manager_list');
    console.log('Cleared manager_list cache');

    // Get all managers from AllianceManager sheet to clear their individual caches
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // Clear authorization caches for all managers in TechAllianceManager
    const techSheet = spreadsheet.getSheetByName('TechAllianceManager');
    if (techSheet) {
      const techData = techSheet.getDataRange().getValues();
      const techHeaders = techData[0];
      let emailColIndex = -1;

      for (let i = 0; i < techHeaders.length; i++) {
        if (techHeaders[i] && techHeaders[i].toString().toLowerCase().trim() === 'email') {
          emailColIndex = i;
          break;
        }
      }

      if (emailColIndex !== -1) {
        for (let i = 1; i < techData.length; i++) {
          const email = techData[i][emailColIndex];
          if (email) {
            const normalizedEmail = email.toString().trim().toLowerCase();
            const authCacheKey = `manager_auth_${normalizedEmail.replace(/[@.]/g, '_')}`;
            cache.remove(authCacheKey);
            console.log(`Cleared auth cache for: ${normalizedEmail}`);
          }
        }
      }
    }

    // Clear email lookup caches for all managers in AllianceManager
    const allianceSheet = spreadsheet.getSheetByName('AllianceManager');
    if (allianceSheet) {
      const allianceData = allianceSheet.getDataRange().getValues();
      const allianceHeaders = allianceData[0];
      let nameColIndex = -1;

      for (let i = 0; i < allianceHeaders.length; i++) {
        const header = allianceHeaders[i] ? allianceHeaders[i].toString().toLowerCase().trim() : '';
        if (header === 'manager' || header === 'name' || header === 'full name') {
          nameColIndex = i;
          break;
        }
      }

      if (nameColIndex !== -1) {
        for (let i = 1; i < allianceData.length; i++) {
          const name = allianceData[i][nameColIndex];
          if (name) {
            const searchName = name.toString().trim().toLowerCase();
            const emailCacheKey = `manager_email_${searchName.replace(/\s+/g, '_')}`;
            cache.remove(emailCacheKey);
            console.log(`Cleared email lookup cache for: ${name}`);
          }
        }
      }
    }

    console.log('=== ALL MANAGER CACHES CLEARED ===');
    return { success: true, message: 'All manager caches cleared successfully' };

  } catch (error) {
    console.error('Error in clearAllManagerCaches:', error);
    return { success: false, message: error.toString() };
  }
}

/**
 * Get list of report names for a manager (parsed from Reports column)
 * @param {string} managerEmail - Manager's email address
 * @returns {string[]} Array of report names
 */
function getManagerReportsList(managerEmail) {
  const authorization = getManagerAuthorization(managerEmail);
  if (!authorization.reports) {
    return [];
  }
  return authorization.reports
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '');
}

/**
 * Get list of emails for all report names under a manager
 * Looks up each name in AllianceManager sheet to get their email
 * @param {string} managerEmail - Manager's email address
 * @returns {string[]} Array of email addresses for the manager's reports
 */
function getManagerReportsEmails(managerEmail) {
  try {
    const reportNames = getManagerReportsList(managerEmail);
    if (reportNames.length === 0) {
      return [];
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const managerSheet = spreadsheet.getSheetByName('AllianceManager');

    if (!managerSheet) {
      console.error('AllianceManager sheet not found');
      return [];
    }

    const dataRange = managerSheet.getDataRange();
    const values = dataRange.getValues();

    if (values.length < 2) {
      return [];
    }

    // Find column indices
    const headers = values[0];
    let nameColumnIndex = -1;
    let emailColumnIndex = -1;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] ? headers[i].toString().toLowerCase().trim() : '';
      if (header === 'manager' || header === 'name' || header === 'full name') {
        nameColumnIndex = i;
      }
      if (header === 'email') {
        emailColumnIndex = i;
      }
    }

    if (emailColumnIndex === -1) {
      return [];
    }

    const reportEmails = [];

    // Look up each report name
    for (const reportName of reportNames) {
      const searchName = reportName.toLowerCase();

      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const email = row[emailColumnIndex] ? row[emailColumnIndex].toString().trim().toLowerCase() : '';

        // Match by name column if available
        if (nameColumnIndex !== -1) {
          const name = row[nameColumnIndex] ? row[nameColumnIndex].toString().trim().toLowerCase() : '';
          if (name === searchName || name.includes(searchName) || searchName.includes(name)) {
            if (email && !reportEmails.includes(email)) {
              reportEmails.push(email);
            }
            break;
          }
        }

        // Try matching by email username
        if (email) {
          const emailUsername = email.split('@')[0];
          const nameFromEmail = emailUsername.replace(/\./g, ' ').toLowerCase();
          if (nameFromEmail === searchName || nameFromEmail.includes(searchName)) {
            if (!reportEmails.includes(email)) {
              reportEmails.push(email);
            }
            break;
          }
        }
      }
    }

    console.log(`Report emails for ${managerEmail}:`, reportEmails);
    return reportEmails;

  } catch (error) {
    console.error('Error in getManagerReportsEmails:', error);
    return [];
  }
}

/**
 * Get list of partners managed by a specific manager (exposed to client)
 * Reads from Partner sheet and matches by Account Owner
 * @param {string} managerEmail - Manager's email address
 * @returns {string[]} Array of partner names (Account Name values)
 */
function getManagedPartners(managerEmail) {
  try {
    if (!managerEmail) return [];

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const partnerSheet = spreadsheet.getSheetByName('Partner');

    if (!partnerSheet) {
      console.log('Partner sheet not found');
      return [];
    }

    // Get manager's name for matching
    const authorization = getManagerAuthorization(managerEmail);
    const managerName = authorization.managerName || '';

    if (!managerName) {
      console.log('Manager name not found for:', managerEmail);
      return [];
    }

    // Get all partner data
    const lastRow = partnerSheet.getLastRow();
    const lastCol = partnerSheet.getLastColumn();
    if (lastRow < 2) return [];

    const headers = partnerSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const data = partnerSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const accountNameIndex = headers.indexOf('Account Name');
    const accountOwnerIndex = headers.indexOf('Account Owner');

    if (accountNameIndex === -1 || accountOwnerIndex === -1) {
      console.log('Required columns not found in Partner sheet');
      return [];
    }

    const managerNameLower = managerName.toLowerCase();
    const managerFirstName = managerNameLower.split(' ')[0];

    // Filter partners by Account Owner matching manager name
    const managedPartners = data
      .filter(row => {
        const accountOwner = row[accountOwnerIndex] ? row[accountOwnerIndex].toString().trim().toLowerCase() : '';
        // Check if Account Owner matches manager name (full or first name)
        return accountOwner === managerNameLower ||
               accountOwner.includes(managerNameLower) ||
               managerNameLower.includes(accountOwner) ||
               accountOwner.includes(managerFirstName);
      })
      .map(row => row[accountNameIndex] ? row[accountNameIndex].toString().trim() : '')
      .filter(name => name !== '');

    console.log(`Found ${managedPartners.length} managed partners for ${managerName}:`, managedPartners);
    return managedPartners;

  } catch (error) {
    console.error('Error in getManagedPartners:', error);
    return [];
  }
}
