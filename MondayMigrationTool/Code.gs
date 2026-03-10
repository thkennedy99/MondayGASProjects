/**
 * Monday.com Workspace Migration Tool
 * GAS project for migrating workspaces within the same or across Monday.com accounts.
 *
 * Features:
 *   - Inventory: Scan and catalog workspaces, boards, users, items
 *   - Test Run: Dry-run analysis of what will be migrated
 *   - Migration: Clone a workspace to a new workspace (same or different account)
 *   - Validation: Compare source vs target to verify migration success
 *
 * Supports dual API keys for cross-account migration.
 * For same-account migrations, people columns are preserved by user ID.
 */

// ── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  APP_NAME: 'Monday.com Workspace Migration Tool',
  VERSION: '1.1.0',
  CACHE_DURATION: 300,
  MAX_RETRIES: 3,
  DEBUG_MODE: false,

  // Source Monday.com API key (primary account)
  MONDAY_API_KEY: PropertiesService.getScriptProperties().getProperty('MONDAY_API_KEY'),

  MONDAY_API_URL: 'https://api.monday.com/v2',

  // Google Sheet for logging migration state
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('MIGRATION_SPREADSHEET_ID')
};

// ── Web App Entry Point ──────────────────────────────────────────────────────

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');

  const configData = {
    appName: CONFIG.APP_NAME,
    version: CONFIG.VERSION,
    user: Session.getActiveUser().getEmail(),
    hasApiKey: !!CONFIG.MONDAY_API_KEY,
    hasSpreadsheet: !!CONFIG.SPREADSHEET_ID
  };

  template.configData = JSON.stringify(configData);

  return template.evaluate()
    .setTitle(CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── Setup Helpers ────────────────────────────────────────────────────────────

/**
 * Store API keys and spreadsheet ID in Script Properties.
 * Run this once from the Apps Script editor.
 */
function setupScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    'MONDAY_API_KEY': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ3MjI3MDMwNywiYWFpIjoxMSwidWlkIjo2MzU1MTg0NCwiaWFkIjoiMjAyNS0wMi0xM1QxNjowOTozNC4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjQ0MzgzMjcsInJnbiI6InVzZTEifQ.8QsKLrmBSa7DyaRlefC9KBx38ZI0y7EUdlsVTPw7fS8',
    'MIGRATION_SPREADSHEET_ID': '1H6IySq686XFkyBFiPwX1twJvy-CkntO5hajzVf6jMyU'
    'MONDAY_MIGRATION_API_KEY': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU4MzM5MzU5MCwiYWFpIjoxMSwidWlkIjo3ODcyNDQ3MSwiaWFkIjoiMjAyNS0xMS0wNlQxNzowMzo0Ny4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjkxMTQ4OTIsInJnbiI6InVzZTEifQ.yRNbcnAmL7YT5FbcoLKpwdMMPu3QzBbHDbYOKYRG25s"
  });
  console.log('Script properties set. Update with real values.');
}

/**
 * Create the migration tracking spreadsheet with required sheets.
 */
function initializeMigrationSpreadsheet() {
  const ssId = CONFIG.SPREADSHEET_ID;
  if (!ssId) {
    throw new Error('MIGRATION_SPREADSHEET_ID not set in Script Properties');
  }

  const ss = SpreadsheetApp.openById(ssId);
  const requiredSheets = [
    { name: 'MigrationLog', headers: ['Timestamp', 'Migration ID', 'Action', 'Source Workspace', 'Target Workspace', 'Status', 'Details', 'User'] },
    { name: 'BoardMapping', headers: ['Migration ID', 'Source Board ID', 'Source Board Name', 'Target Board ID', 'Target Board Name', 'Status', 'Items Migrated', 'Items Total'] },
    { name: 'UserMapping', headers: ['Migration ID', 'Source User ID', 'Source Email', 'Target User ID', 'Target Email', 'Role', 'Status'] },
    { name: 'Errors', headers: ['Timestamp', 'Migration ID', 'Function', 'Error', 'Stack', 'User'] }
  ];

  requiredSheets.forEach(({ name, headers }) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });

  return { success: true, message: 'Spreadsheet initialized with all required sheets.' };
}

// ── Error Handling ───────────────────────────────────────────────────────────

function handleError(functionName, error, migrationId) {
  console.error(`Error in ${functionName}:`, error);

  try {
    if (CONFIG.SPREADSHEET_ID) {
      const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      let errorSheet = ss.getSheetByName('Errors');
      if (!errorSheet) {
        errorSheet = ss.insertSheet('Errors');
        errorSheet.appendRow(['Timestamp', 'Migration ID', 'Function', 'Error', 'Stack', 'User']);
      }
      errorSheet.appendRow([
        new Date(),
        migrationId || '',
        functionName,
        error.toString(),
        error.stack || '',
        Session.getActiveUser().getEmail()
      ]);
    }
  } catch (logError) {
    console.error('Failed to log error:', logError);
  }

  return {
    success: false,
    error: error.toString(),
    functionName: functionName,
    timestamp: new Date().toISOString()
  };
}

// ── Migration Logging ────────────────────────────────────────────────────────

function logMigrationAction(migrationId, action, sourceWs, targetWs, status, details) {
  try {
    if (!CONFIG.SPREADSHEET_ID) return;
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName('MigrationLog');
    if (sheet) {
      sheet.appendRow([
        new Date(),
        migrationId,
        action,
        sourceWs,
        targetWs || '',
        status,
        typeof details === 'object' ? JSON.stringify(details) : String(details),
        Session.getActiveUser().getEmail()
      ]);
    }
  } catch (e) {
    console.error('Failed to log migration action:', e);
  }
}

// ── Target Account Management ────────────────────────────────────────────────
// Supports multiple saved target Monday.com accounts stored per-user.
// Each account is stored as { accountId, accountName, userEmail, apiKey }.

var TARGET_ACCOUNTS_KEY = 'TARGET_MONDAY_ACCOUNTS';

/**
 * Validate a Monday.com API key by querying the /me endpoint.
 * Returns account info if valid, error if not.
 * @param {string} apiKey - The API key to validate
 * @returns {Object} { success, accountInfo: { userId, userName, userEmail, accountId, accountName } }
 */
function validateTargetApiKey(apiKey) {
  try {
    if (!apiKey || apiKey.trim().length < 10) {
      return { success: false, error: 'API key is too short or empty.' };
    }

    var options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey.trim(),
        'API-Version': '2025-07'
      },
      payload: JSON.stringify({
        query: '{ me { id name email account { id name } } }'
      }),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(CONFIG.MONDAY_API_URL, options);
    var code = response.getResponseCode();
    var body = JSON.parse(response.getContentText());

    if (code !== 200 || body.errors) {
      var errMsg = body.errors ? body.errors[0].message : 'HTTP ' + code;
      return { success: false, error: 'API key validation failed: ' + errMsg };
    }

    var me = body.data.me;
    return safeReturn({
      success: true,
      accountInfo: {
        userId: String(me.id),
        userName: me.name,
        userEmail: me.email,
        accountId: me.account ? String(me.account.id) : '',
        accountName: me.account ? me.account.name : ''
      }
    });
  } catch (error) {
    return handleError('validateTargetApiKey', error);
  }
}

/**
 * Add a validated target account to the saved accounts list.
 * Validates the key first, then stores it.
 * @param {string} apiKey - The target Monday.com API key
 * @returns {Object} { success, account, accounts }
 */
function addTargetAccount(apiKey) {
  try {
    if (!apiKey || apiKey.trim().length < 10) {
      return { success: false, error: 'API key is too short or empty.' };
    }

    // Validate first
    var validation = validateTargetApiKey(apiKey);
    if (!validation.success) return validation;

    var accounts = _getTargetAccounts();
    var info = validation.accountInfo;

    // Check if this account is already saved (by accountId)
    var existing = accounts.findIndex(function(a) { return a.accountId === info.accountId; });
    var account = {
      accountId: info.accountId,
      accountName: info.accountName,
      userEmail: info.userEmail,
      userName: info.userName,
      apiKey: apiKey.trim(),
      addedAt: new Date().toISOString()
    };

    if (existing >= 0) {
      // Update existing
      accounts[existing] = account;
    } else {
      accounts.push(account);
    }

    _saveTargetAccounts(accounts);

    return safeReturn({
      success: true,
      account: {
        accountId: account.accountId,
        accountName: account.accountName,
        userEmail: account.userEmail,
        userName: account.userName
      },
      accounts: _getTargetAccountsList()
    });
  } catch (error) {
    return handleError('addTargetAccount', error);
  }
}

/**
 * Remove a saved target account.
 * @param {string} accountId - The account ID to remove
 * @returns {Object} { success, accounts }
 */
function removeTargetAccount(accountId) {
  try {
    var accounts = _getTargetAccounts();
    accounts = accounts.filter(function(a) { return a.accountId !== accountId; });
    _saveTargetAccounts(accounts);
    return safeReturn({ success: true, accounts: _getTargetAccountsList() });
  } catch (error) {
    return handleError('removeTargetAccount', error);
  }
}

/**
 * Get list of saved target accounts (without exposing API keys).
 * @returns {Object} { success, accounts: [{ accountId, accountName, userEmail }] }
 */
function getTargetAccounts() {
  try {
    return safeReturn({ success: true, accounts: _getTargetAccountsList() });
  } catch (error) {
    return handleError('getTargetAccounts', error);
  }
}

/**
 * Get the API key for a specific target account.
 * @param {string} accountId - The account ID
 * @returns {string|null}
 */
function getTargetApiKeyForAccount(accountId) {
  if (!accountId) return null;
  var accounts = _getTargetAccounts();
  var match = accounts.find(function(a) { return a.accountId === accountId; });
  return match ? match.apiKey : null;
}

// Legacy compatibility — returns the first saved target key or null
function getTargetApiKey() {
  var accounts = _getTargetAccounts();
  return accounts.length > 0 ? accounts[0].apiKey : null;
}

// Legacy compatibility
function saveTargetApiKey(apiKey) {
  return addTargetAccount(apiKey);
}

// Legacy compatibility
function clearTargetApiKey() {
  try {
    PropertiesService.getUserProperties().deleteProperty(TARGET_ACCOUNTS_KEY);
    return { success: true };
  } catch (error) {
    return handleError('clearTargetApiKey', error);
  }
}

/**
 * Get workspaces from a target Monday.com account.
 * @param {string} accountId - Target account ID (looks up stored API key)
 * @returns {Object} { success, workspaces }
 */
function getTargetWorkspaces(accountId) {
  try {
    var apiKey = getTargetApiKeyForAccount(accountId);
    if (!apiKey) throw new Error('No API key found for account: ' + accountId);
    var data = callMondayAPIWithKey(apiKey, 'query { workspaces (limit: 100) { id name kind description } }');
    return safeReturn({ success: true, workspaces: data.workspaces || [] });
  } catch (error) {
    return handleError('getTargetWorkspaces', error);
  }
}

// ── Internal helpers ──

function _getTargetAccounts() {
  var json = PropertiesService.getUserProperties().getProperty(TARGET_ACCOUNTS_KEY);
  if (!json) return [];
  try { return JSON.parse(json); } catch (e) { return []; }
}

function _saveTargetAccounts(accounts) {
  PropertiesService.getUserProperties().setProperty(TARGET_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function _getTargetAccountsList() {
  return _getTargetAccounts().map(function(a) {
    return {
      accountId: a.accountId,
      accountName: a.accountName,
      userEmail: a.userEmail,
      userName: a.userName,
      addedAt: a.addedAt
    };
  });
}

// ── Utility ──────────────────────────────────────────────────────────────────

function generateMigrationId() {
  return 'mig_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function safeReturn(data) {
  return JSON.parse(JSON.stringify(data));
}
