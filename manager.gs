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
