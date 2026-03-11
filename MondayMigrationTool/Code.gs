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

  // Pre-fetch and cache workspaces so the UI loads with data immediately
  var workspacesData = '[]';
  try {
    if (CONFIG.MONDAY_API_KEY) {
      var cache = CacheService.getScriptCache();
      var cached = cache.get('initial_workspaces');
      if (cached) {
        workspacesData = cached;
      } else {
        var ws = getWorkspaces();
        var summaries = ws.map(function(w) {
          return { id: String(w.id), name: w.name, kind: w.kind, description: w.description || '' };
        });
        summaries.sort(function(a, b) { return a.name.localeCompare(b.name); });
        workspacesData = JSON.stringify(summaries);
        // Cache for 5 minutes
        if (workspacesData.length < 90000) {
          cache.put('initial_workspaces', workspacesData, 300);
        }
      }
    }
  } catch (err) {
    console.error('Failed to pre-fetch workspaces:', err);
  }
  template.workspacesData = workspacesData;

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

// ── File Transfer Test ──────────────────────────────────────────────────────

/**
 * Test function: Copy a file from one item to another on the same board.
 * Uses the TARGET account (MONDAY_MIGRATION_API_KEY) to:
 *   1. Read the asset's public_url from a source item
 *   2. Download the file
 *   3. Upload it to a new item's file column
 *
 * Run this from the Apps Script editor to verify file migration works.
 *
 * To test cross-account: change sourceApiKey to CONFIG.MONDAY_API_KEY
 * and targetApiKey to CONFIG.MONDAY_MIGRATION_API_KEY.
 */
function testFileTransfer() {
  // ── Configuration — update these values as needed ──
  var SOURCE_BOARD_ID = 18402167020;    // MCP getting started (target account)
  var SOURCE_ITEM_ID  = '11402968038';  // Item "Doc Comments" — has a PNG file
  var TARGET_ITEM_ID  = '11483882312';  // Item "File Transfer Test - from Claude"
  var TARGET_FILE_COL = 'files';        // File column ID on target board

  // Both on the target account — use migration key
  var apiKey = CONFIG.MONDAY_MIGRATION_API_KEY;

  console.log('=== File Transfer Test ===');
  console.log('Source item: ' + SOURCE_ITEM_ID);
  console.log('Target item: ' + TARGET_ITEM_ID);
  console.log('Target column: ' + TARGET_FILE_COL);

  // Step 1: Get file assets from source item
  console.log('\nStep 1: Fetching assets from source item...');
  var assetMap = getItemAssets([SOURCE_ITEM_ID], apiKey);
  var assets = assetMap[SOURCE_ITEM_ID];

  if (!assets || assets.length === 0) {
    console.error('FAIL: No assets found on source item ' + SOURCE_ITEM_ID);
    return { success: false, error: 'No assets found on source item' };
  }

  console.log('Found ' + assets.length + ' asset(s):');
  assets.forEach(function(a, i) {
    console.log('  [' + i + '] ' + a.name + ' (' + a.file_extension + ', ' +
      Math.round((a.file_size || 0) / 1024) + ' KB)');
    console.log('      public_url: ' + (a.public_url ? 'YES (' + a.public_url.substring(0, 80) + '...)' : 'NO'));
  });

  // Step 2: Download the first asset
  var asset = assets[0];
  if (!asset.public_url) {
    console.error('FAIL: Asset "' + asset.name + '" has no public_url');
    return { success: false, error: 'No public_url on asset' };
  }

  console.log('\nStep 2: Downloading "' + asset.name + '"...');
  var fileName = asset.name || ('file_' + asset.id + (asset.file_extension || ''));
  var blob;
  try {
    blob = downloadMondayAsset(asset.public_url, fileName);
    console.log('Downloaded: ' + blob.getName() + ' (' + Math.round(blob.getBytes().length / 1024) + ' KB)');
  } catch (dlErr) {
    console.error('FAIL: Download error — ' + dlErr);
    return { success: false, error: 'Download failed: ' + dlErr.toString() };
  }

  // Step 3: Upload to target item
  console.log('\nStep 3: Uploading to target item ' + TARGET_ITEM_ID + ', column "' + TARGET_FILE_COL + '"...');
  try {
    var result = uploadFileToMondayItem(TARGET_ITEM_ID, TARGET_FILE_COL, blob, apiKey);
    console.log('Upload result: ' + JSON.stringify(result));
    console.log('\n=== SUCCESS: File transferred! ===');
    console.log('Check item ' + TARGET_ITEM_ID + ' on board ' + SOURCE_BOARD_ID + ' — the file should be there.');
    return { success: true, assetId: result ? result.id : null, fileName: fileName };
  } catch (upErr) {
    console.error('FAIL: Upload error — ' + upErr);
    return { success: false, error: 'Upload failed: ' + upErr.toString() };
  }
}

/**
 * Test function: Cross-account file transfer.
 * Reads a file from the SOURCE account and uploads it to the TARGET account.
 * Update the IDs below to match your source/target boards.
 */
function testCrossAccountFileTransfer() {
  // ── Source (old account) ──
  var SOURCE_ITEM_ID = '11402968038';  // Update with a source account item ID
  var sourceApiKey = CONFIG.MONDAY_API_KEY;

  // ── Target (new account) ──
  var TARGET_ITEM_ID = '11483882312';  // Update with a target account item ID
  var TARGET_FILE_COL = 'files';       // File column ID on target board
  var targetApiKey = CONFIG.MONDAY_MIGRATION_API_KEY;

  console.log('=== Cross-Account File Transfer Test ===');
  console.log('Source item: ' + SOURCE_ITEM_ID + ' (source account)');
  console.log('Target item: ' + TARGET_ITEM_ID + ' (target account)');

  // Step 1: Get assets from source account
  console.log('\nStep 1: Fetching assets from source account...');
  var assetMap = getItemAssets([SOURCE_ITEM_ID], sourceApiKey);
  var assets = assetMap[SOURCE_ITEM_ID];

  if (!assets || assets.length === 0) {
    console.error('FAIL: No assets found on source item');
    return { success: false, error: 'No assets on source item' };
  }

  console.log('Found ' + assets.length + ' asset(s)');

  // Step 2: Download from source
  var asset = assets[0];
  if (!asset.public_url) {
    console.error('FAIL: No public_url');
    return { success: false, error: 'No public_url' };
  }

  console.log('\nStep 2: Downloading "' + asset.name + '"...');
  var blob = downloadMondayAsset(asset.public_url, asset.name);
  console.log('Downloaded: ' + Math.round(blob.getBytes().length / 1024) + ' KB');

  // Step 3: Upload to target account
  console.log('\nStep 3: Uploading to target account...');
  try {
    var result = uploadFileToMondayItem(TARGET_ITEM_ID, TARGET_FILE_COL, blob, targetApiKey);
    console.log('Upload result: ' + JSON.stringify(result));
    console.log('\n=== SUCCESS: Cross-account file transfer complete! ===');
    return { success: true, assetId: result ? result.id : null };
  } catch (err) {
    console.error('FAIL: ' + err);
    return { success: false, error: err.toString() };
  }
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

// ── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Query the destination Monday.com account to get:
 * - API key owner (name, email, role)
 * - All boards they have access to (id, name, board_kind, their permission level)
 * @returns {Object} { success, user, boards }
 */
function diagnoseDestinationAccount() {
  try {
    var apiKey = CONFIG.MONDAY_MIGRATION_API_KEY;
    if (!apiKey) throw new Error('MONDAY_MIGRATION_API_KEY not configured');

    // 1. Get user info and role
    var userData = callMondayAPIWithKey(apiKey,
      '{ me { id name email is_admin is_guest created_at title phone account { id name plan { max_users period tier } } } }'
    );

    // 2. Get all boards the user can see (paginated, up to 500)
    var allBoards = [];
    var page = 1;
    var hasMore = true;
    while (hasMore) {
      var boardData = callMondayAPIWithKey(apiKey,
        'query ($page: Int!) { boards (limit: 100, page: $page) { id name board_kind state board_folder_id permissions } }',
        { page: page }
      );
      var boards = boardData.boards || [];
      allBoards = allBoards.concat(boards);
      hasMore = boards.length === 100 && page < 5; // safety cap at 500 boards
      page++;
    }

    var me = userData.me;
    var result = {
      success: true,
      user: {
        id: me.id,
        name: me.name,
        email: me.email,
        title: me.title || '',
        phone: me.phone || '',
        isAdmin: me.is_admin,
        isGuest: me.is_guest,
        createdAt: me.created_at,
        account: me.account
      },
      boards: allBoards.map(function(b) {
        return {
          id: b.id,
          name: b.name,
          kind: b.board_kind,
          state: b.state,
          folderId: b.board_folder_id,
          permissions: b.permissions
        };
      }),
      boardCount: allBoards.length
    };

    console.log('=== DESTINATION ACCOUNT DIAGNOSTICS ===');
    console.log('User: ' + me.name + ' (' + me.email + ')');
    console.log('Admin: ' + me.is_admin + ' | Guest: ' + me.is_guest);
    console.log('Account: ' + (me.account ? me.account.name + ' (ID: ' + me.account.id + ')' : 'N/A'));
    console.log('Boards accessible: ' + allBoards.length);
    allBoards.forEach(function(b) {
      console.log('  Board ' + b.id + ': ' + b.name + ' [' + b.board_kind + '] permissions=' + b.permissions);
    });
    console.log('=======================================');

    return safeReturn(result);
  } catch (error) {
    return handleError('diagnoseDestinationAccount', error);
  }
}

/**
 * Look up a user by email in the destination Monday.com account and return
 * their profile, role, and all boards they belong to with permissions.
 * @param {string} email - The email address to look up
 * @returns {Object} { success, user, boards, boardCount }
 */
function diagnoseDestinationUser(email) {
  try {
    var apiKey = CONFIG.MONDAY_MIGRATION_API_KEY;
    if (!apiKey) throw new Error('MONDAY_MIGRATION_API_KEY not configured');
    if (!email || typeof email !== 'string') throw new Error('Email address is required');
    email = email.trim().toLowerCase();

    // 1. Find user by email
    var usersData = callMondayAPIWithKey(apiKey,
      'query ($email: String!) { users (emails: [$email]) { id name email is_admin is_guest created_at title phone teams { id name } account { id name plan { max_users period tier } } } }',
      { email: email }
    );

    var users = usersData.users || [];
    if (users.length === 0) {
      console.log('No user found with email: ' + email);
      return safeReturn({ success: true, user: null, boards: [], boardCount: 0, message: 'No user found with email: ' + email });
    }

    var user = users[0];

    // 2. Get boards where this user is a subscriber
    var allBoards = [];
    var page = 1;
    var hasMore = true;
    while (hasMore) {
      var boardData = callMondayAPIWithKey(apiKey,
        'query ($page: Int!) { boards (limit: 100, page: $page) { id name board_kind state board_folder_id permissions subscribers { id } } }',
        { page: page }
      );
      var boards = boardData.boards || [];
      boards.forEach(function(b) {
        var isSubscriber = (b.subscribers || []).some(function(s) {
          return String(s.id) === String(user.id);
        });
        if (isSubscriber) {
          allBoards.push(b);
        }
      });
      hasMore = boards.length === 100 && page < 5;
      page++;
    }

    var result = {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        title: user.title || '',
        phone: user.phone || '',
        isAdmin: user.is_admin,
        isGuest: user.is_guest,
        createdAt: user.created_at,
        teams: (user.teams || []).map(function(t) { return { id: t.id, name: t.name }; }),
        account: user.account
      },
      boards: allBoards.map(function(b) {
        return {
          id: b.id,
          name: b.name,
          kind: b.board_kind,
          state: b.state,
          folderId: b.board_folder_id,
          permissions: b.permissions
        };
      }),
      boardCount: allBoards.length
    };

    console.log('=== DESTINATION USER DIAGNOSTICS ===');
    console.log('User: ' + user.name + ' (' + user.email + ')');
    console.log('Admin: ' + user.is_admin + ' | Guest: ' + user.is_guest);
    console.log('Teams: ' + (user.teams || []).map(function(t) { return t.name; }).join(', '));
    console.log('Account: ' + (user.account ? user.account.name + ' (ID: ' + user.account.id + ')' : 'N/A'));
    console.log('Boards subscribed to: ' + allBoards.length);
    allBoards.forEach(function(b) {
      console.log('  Board ' + b.id + ': ' + b.name + ' [' + b.board_kind + '] permissions=' + b.permissions);
    });
    console.log('====================================');

    return safeReturn(result);
  } catch (error) {
    return handleError('diagnoseDestinationUser', error);
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function generateMigrationId() {
  return 'mig_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function safeReturn(data) {
  return JSON.parse(JSON.stringify(data));
}
