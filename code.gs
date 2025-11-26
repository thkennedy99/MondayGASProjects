/**
 * Code.gs - Alliance Manager Portal Main Entry Point
 * Version: 2.0.0
 * 
 * This is the main server file for the Alliance Manager Portal
 * Handles web app initialization and request routing
 */

// Configuration
const CONFIG = {
  APP_NAME: 'Alliance Manager Portal',
  VERSION: '2.0.0',
  CACHE_DURATION: 300, // 5 minutes
  SESSION_TIMEOUT: 1800, // 30 minutes
  MAX_RETRIES: 3,
  DEBUG_MODE: false,
  MONDAY_API_KEY: PropertiesService.getScriptProperties().getProperty('MONDAY_API_KEY'),
  MONDAY_API_URL: 'https://api.monday.com/v2'
};

/**
 * Web app entry point for GET requests
 */
function doGet(e) {
  try {
    const params = {
      page: e.parameter.page || 'main',
      manager: e.parameter.manager || Session.getActiveUser().getEmail(),
      token: e.parameter.token || null,
      editItemId: e.parameter.editItemId || null,
      editBoardId: e.parameter.editBoardId || null
    };

    console.log('doGet called with page:', params.page);
    if (params.editItemId) {
      console.log('Deep link edit request - itemId:', params.editItemId, 'boardId:', params.editBoardId);
    }

    // Initialize session
    const session = initializeSession(params.manager, params.token);

    // Determine which template to use based on page parameter
    let templateName = 'index';
    let pageTitle = CONFIG.APP_NAME;

    if (params.page === 'marketingmanager') {
      templateName = 'marketingmanager';
      pageTitle = 'Marketing Manager - ' + CONFIG.APP_NAME;
    }

    // Create HTML template
    const template = HtmlService.createTemplateFromFile(templateName);

     const configData = {
      user: session.user,
      token: session.token,
      environment: CONFIG.DEBUG_MODE ? 'development' : 'production',
      version: CONFIG.VERSION,
      apiEndpoint: CONFIG.MONDAY_API_URL,
      page: params.page,
      editItemId: params.editItemId,
      editBoardId: params.editBoardId
    };

    // Assign as string (legacy support)
    template.appConfig = JSON.stringify(configData);
    // Assign as raw object (for safer template injection)
    template.configData = configData;

    // Return HTML output
    return template.evaluate()
      .setTitle(pageTitle)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setFaviconUrl('https://www.guidewire.com/favicon.ico');

  } catch (error) {
    console.error('Error in doGet:', error);
    return createErrorResponse('Application initialization failed', 500);
  }
}


function setMondayApiKey() {
  PropertiesService.getScriptProperties()
    .setProperty('MONDAY_API_KEY', 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjQ3MjI3MDMwNywiYWFpIjoxMSwidWlkIjo2MzU1MTg0NCwiaWFkIjoiMjAyNS0wMi0xM1QxNjowOTozNC4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjQ0MzgzMjcsInJnbiI6InVzZTEifQ.8QsKLrmBSa7DyaRlefC9KBx38ZI0y7EUdlsVTPw7fS8');
}


/**
 * Web app entry point for POST requests
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    // Route to appropriate handler
    switch (action) {
      case 'webhook':
        return handleWebhook(data);
      case 'sync':
        return handleSync(data);
      default:
        return createJsonResponse({ error: 'Unknown action' }, 400);
    }
  } catch (error) {
    console.error('Error in doPost:', error);
    return createJsonResponse({ error: error.message }, 500);
  }
}

/**
 * Include external HTML files
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Initialize user session
 */
function initializeSession(userEmail, token) {
  const cache = CacheService.getUserCache();
  const sessionKey = `session_${userEmail}`;
  
  // Check existing session
  let session = cache.get(sessionKey);
  if (session) {
    session = JSON.parse(session);
    session.lastActivity = new Date().toISOString();
  } else {
    // Create new session
    session = {
      user: userEmail,
      token: token || Utilities.getUuid(),
      created: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      permissions: getUserPermissions(userEmail)
    };
  }
  
  // Save session
  cache.put(sessionKey, JSON.stringify(session), CONFIG.SESSION_TIMEOUT);
  return session;
}

/**
 * Validate user access
 */
function validateUserAccess(email) {
  // Check if user is in allowed domain
  return true;
}

/**
 * Get user permissions
 */
function getUserPermissions(email) {
  const permissions = {
    canView: true,
    canEdit: false,
    canDelete: false,
    canAdmin: false
  };
  
  // Check if user is admin
  const admins = ['admin@guidewire.com'];
  if (admins.includes(email)) {
    permissions.canEdit = true;
    permissions.canDelete = true;
    permissions.canAdmin = true;
  }
  
  // Check if user is manager
  const managers = getManagerList();
  if (managers.includes(email)) {
    permissions.canEdit = true;
  }
  
  return permissions;
}

/**
 * Create error response
 */
function createErrorResponse(message, code) {
  const template = HtmlService.createTemplateFromFile('error');
  template.message = message;
  template.code = code;
  
  return template.evaluate()
    .setTitle('Error - Alliance Manager Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Create JSON response
 */
function createJsonResponse(data, code = 200) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle webhook from Monday.com
 */
function handleWebhook(data) {
  try {
    // Validate webhook signature
    if (!validateWebhookSignature(data)) {
      return createJsonResponse({ error: 'Invalid signature' }, 401);
    }
    
    // Process webhook
    const result = processWebhookData(data);
    return createJsonResponse({ success: true, result });
    
  } catch (error) {
    console.error('Webhook error:', error);
    return createJsonResponse({ error: error.message }, 500);
  }
}

/**
 * Handle manual sync request
 */
function handleSync(data) {
  try {
    const { boardId, sheetName } = data;
    const result = syncBoardToSheet(boardId, sheetName);
    return createJsonResponse({ success: true, result });
    
  } catch (error) {
    console.error('Sync error:', error);
    return createJsonResponse({ error: error.message }, 500);
  }
}

/**
 * Validate webhook signature
 */
function validateWebhookSignature(data) {
  // Implement Monday.com webhook signature validation
  // This is a placeholder - implement actual signature validation
  return true;
}

/**
 * Process webhook data
 */
function processWebhookData(data) {
  // Process incoming webhook data from Monday.com
  const { event, boardId, itemId, columnId, value } = data;
  
  console.log(`Processing webhook: ${event} for board ${boardId}`);
  
  // Update corresponding sheet
  if (event === 'change_column_value') {
    updateSheetFromWebhook(boardId, itemId, columnId, value);
  }
  
  return { processed: true, event };
}
