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

  // Target Monday.com API key (migration destination account)
  MONDAY_MIGRATION_API_KEY: PropertiesService.getScriptProperties().getProperty('MONDAY_MIGRATION_API_KEY'),

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
    'MONDAY_MIGRATION_API_KEY': 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU4MzM5MzU5MCwiYWFpIjoxMSwidWlkIjo3ODcyNDQ3MSwiaWFkIjoiMjAyNS0xMS0wNlQxNzowMzo0Ny4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjkxMTQ4OTIsInJnbiI6InVzZTEifQ.yRNbcnAmL7YT5FbcoLKpwdMMPu3QzBbHDbYOKYRG25s',
    'MIGRATION_SPREADSHEET_ID': '1H6IySq686XFkyBFiPwX1twJvy-CkntO5hajzVf6jMyU'
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
// Uses MONDAY_MIGRATION_API_KEY from Script Properties as the target account.
// Both the source and target accounts are validated via /me and returned to the UI
// so the user can pick which one to migrate to from a dropdown.

/**
 * Validate a Monday.com API key by querying the /me endpoint.
 * @param {string} apiKey - The API key to validate
 * @returns {Object|null} Account info or null if invalid
 */
function _validateApiKey(apiKey) {
  if (!apiKey || apiKey.trim().length < 10) return null;

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

  if (code !== 200 || body.errors) return null;

  var me = body.data.me;
  return {
    userId: String(me.id),
    userName: me.name,
    userEmail: me.email,
    accountId: me.account ? String(me.account.id) : '',
    accountName: me.account ? me.account.name : ''
  };
}

/**
 * Get available Monday.com accounts for the dropdown.
 * Returns the source account (from MONDAY_API_KEY) and the target account
 * (from MONDAY_MIGRATION_API_KEY) if configured.
 * @returns {Object} { success, accounts: [{ accountId, accountName, userEmail, role }] }
 */
function getTargetAccounts() {
  try {
    // Check cache first to avoid repeated /me calls
    var cache = CacheService.getScriptCache();
    var cached = cache.get('target_accounts_list');
    if (cached) return safeReturn({ success: true, accounts: JSON.parse(cached) });

    var accounts = [];

    // Source account
    if (CONFIG.MONDAY_API_KEY) {
      var source = _validateApiKey(CONFIG.MONDAY_API_KEY);
      if (source) {
        accounts.push({
          accountId: source.accountId,
          accountName: source.accountName,
          userEmail: source.userEmail,
          userName: source.userName,
          role: 'source'
        });
      }
    }

    // Target account (migration destination)
    if (CONFIG.MONDAY_MIGRATION_API_KEY) {
      var target = _validateApiKey(CONFIG.MONDAY_MIGRATION_API_KEY);
      if (target) {
        accounts.push({
          accountId: target.accountId,
          accountName: target.accountName,
          userEmail: target.userEmail,
          userName: target.userName,
          role: 'target'
        });
      }
    }

    // Cache for 10 minutes
    cache.put('target_accounts_list', JSON.stringify(accounts), 600);

    return safeReturn({ success: true, accounts: accounts });
  } catch (error) {
    return handleError('getTargetAccounts', error);
  }
}

/**
 * Get the API key for a specific account by its ID.
 * Uses cached account info to avoid redundant API calls.
 * @param {string} accountId - The account ID
 * @returns {string|null}
 */
function getTargetApiKeyForAccount(accountId) {
  if (!accountId) return null;

  // Try cache first
  var cacheKey = 'acct_key_' + accountId;
  var cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) return cached;

  // Check source key
  if (CONFIG.MONDAY_API_KEY) {
    var source = _validateApiKey(CONFIG.MONDAY_API_KEY);
    if (source && source.accountId === accountId) {
      CacheService.getScriptCache().put(cacheKey, CONFIG.MONDAY_API_KEY, 3600);
      return CONFIG.MONDAY_API_KEY;
    }
  }

  // Check migration target key
  if (CONFIG.MONDAY_MIGRATION_API_KEY) {
    var target = _validateApiKey(CONFIG.MONDAY_MIGRATION_API_KEY);
    if (target && target.accountId === accountId) {
      CacheService.getScriptCache().put(cacheKey, CONFIG.MONDAY_MIGRATION_API_KEY, 3600);
      return CONFIG.MONDAY_MIGRATION_API_KEY;
    }
  }

  return null;
}

/**
 * Get the migration target API key directly.
 * @returns {string|null}
 */
function getTargetApiKey() {
  return CONFIG.MONDAY_MIGRATION_API_KEY || null;
}

/**
 * Get workspaces from a target Monday.com account.
 * @param {string} accountId - Target account ID (resolves to the matching API key)
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

// ── Utility ──────────────────────────────────────────────────────────────────

function generateMigrationId() {
  return 'mig_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function safeReturn(data) {
  return JSON.parse(JSON.stringify(data));
}
