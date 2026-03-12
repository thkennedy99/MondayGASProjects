/**
 * InventoryService.gs - Scan and catalog Monday.com account assets.
 * Single-account inventory of workspaces, boards, users, items, and columns.
 */

// ── Public API (called from client) ──────────────────────────────────────────

/**
 * Get a full inventory snapshot for the account.
 * @returns {Object} Inventory summary
 */
function getAccountInventory() {
  try {
    var workspaces = getWorkspaces();
    var users = getAccountUsers();

    var memberCount = 0;
    var guestCount = 0;
    var activeCount = 0;

    users.forEach(function(u) {
      if (u.enabled) activeCount++;
      if (u.is_guest) {
        guestCount++;
      } else {
        memberCount++;
      }
    });

    var workspaceSummaries = workspaces.map(function(ws) {
      return {
        id: String(ws.id),
        name: ws.name,
        kind: ws.kind,
        description: ws.description || ''
      };
    });

    return safeReturn({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        workspaces: workspaceSummaries,
        workspaceCount: workspaces.length,
        users: {
          total: users.length,
          members: memberCount,
          guests: guestCount,
          active: activeCount
        }
      }
    });
  } catch (error) {
    return handleError('getAccountInventory', error);
  }
}

/**
 * Get detailed inventory for a specific workspace including all boards.
 * @param {string} workspaceId
 * @returns {Object} Workspace details with board inventory
 */
function getWorkspaceInventory(workspaceId) {
  try {
    if (!workspaceId) throw new Error('workspaceId is required');

    var boards = getBoardsInWorkspace(workspaceId);

    var boardSummaries = boards.map(function(board) {
      var itemCount = 0;
      try {
        itemCount = getBoardItemCount(board.id);
      } catch (e) {
        console.warn('Failed to get item count for board ' + board.id + ':', e);
      }

      // Exclude non-creatable/system column types from count so source
      // totals reflect only what actually gets migrated to the target.
      var nonCreatableTypes = ['subtasks', 'board_relation', 'mirror', 'formula', 'auto_number',
                               'creation_log', 'last_updated', 'button', 'dependency', 'item_id'];
      var creatableColumns = (board.columns || []).filter(function(col) {
        return nonCreatableTypes.indexOf(col.type) < 0;
      });

      return {
        id: String(board.id),
        name: board.name,
        kind: board.board_kind || 'public',
        state: board.state || 'active',
        columnCount: creatableColumns.length,
        groupCount: board.groups ? board.groups.length : 0,
        itemCount: itemCount,
        folderId: board.board_folder_id ? String(board.board_folder_id) : null,
        createdFromBoardId: null,
        columns: (board.columns || []).map(function(col) {
          return {
            id: col.id,
            title: col.title,
            type: col.type
          };
        }),
        groups: (board.groups || []).map(function(grp) {
          return {
            id: grp.id,
            title: grp.title
          };
        })
      };
    });

    var totalItems = boardSummaries.reduce(function(sum, b) { return sum + b.itemCount; }, 0);
    var totalColumns = boardSummaries.reduce(function(sum, b) { return sum + b.columnCount; }, 0);
    var totalGroups = boardSummaries.reduce(function(sum, b) { return sum + b.groupCount; }, 0);

    // Template linkage summary
    var templateLinkedBoards = boardSummaries.filter(function(b) { return !!b.createdFromBoardId; });
    var uniqueTemplateIds = {};
    templateLinkedBoards.forEach(function(b) { uniqueTemplateIds[b.createdFromBoardId] = true; });

    // Folder summary
    var folderedBoards = boardSummaries.filter(function(b) { return !!b.folderId; });
    var uniqueFolderIds = {};
    folderedBoards.forEach(function(b) { uniqueFolderIds[b.folderId] = true; });

    return safeReturn({
      success: true,
      data: {
        workspaceId: String(workspaceId),
        timestamp: new Date().toISOString(),
        boards: boardSummaries,
        summary: {
          boardCount: boards.length,
          totalItems: totalItems,
          totalColumns: totalColumns,
          totalGroups: totalGroups,
          templateLinkedCount: templateLinkedBoards.length,
          uniqueTemplateCount: Object.keys(uniqueTemplateIds).length,
          folderedBoardCount: folderedBoards.length,
          uniqueFolderCount: Object.keys(uniqueFolderIds).length
        }
      }
    });
  } catch (error) {
    return handleError('getWorkspaceInventory', error);
  }
}

/**
 * Get detailed structure of a single board.
 * @param {string} boardId
 * @returns {Object} Board structure details
 */
function getBoardInventory(boardId) {
  try {
    if (!boardId) throw new Error('boardId is required');

    var board = getBoardStructure(boardId);
    if (!board) throw new Error('Board not found: ' + boardId);

    var itemCount = getBoardItemCount(boardId);
    var subscribers = [];
    try {
      subscribers = getBoardSubscribers(boardId);
    } catch (e) {
      console.warn('Failed to get subscribers for board ' + boardId);
    }

    var columnTypes = {};
    (board.columns || []).forEach(function(col) {
      columnTypes[col.type] = (columnTypes[col.type] || 0) + 1;
    });

    // Check template linkage
    // created_from_board_id no longer available in Monday.com API
    var createdFromBoardId = null;
    var templateInfo = null;
    if (false) {
      templateInfo = { templateBoardId: createdFromBoardId };
      try {
        var tplBoard = getBoardStructure(createdFromBoardId);
        if (tplBoard) {
          templateInfo.templateBoardName = tplBoard.name;
          templateInfo.templateBoardState = tplBoard.state || 'active';
        }
      } catch (e) {
        templateInfo.templateBoardName = '(unable to resolve)';
      }
    }

    return safeReturn({
      success: true,
      data: {
        id: String(board.id),
        name: board.name,
        kind: board.board_kind || 'public',
        description: board.description || '',
        folderId: board.board_folder_id ? String(board.board_folder_id) : null,
        createdFromBoardId: createdFromBoardId,
        templateInfo: templateInfo,
        columns: (board.columns || []).map(function(col) {
          return {
            id: col.id,
            title: col.title,
            type: col.type,
            settings: col.settings_str || '{}'
          };
        }),
        groups: (board.groups || []).map(function(grp) {
          return {
            id: grp.id,
            title: grp.title,
            color: grp.color || ''
          };
        }),
        itemCount: itemCount,
        subscriberCount: subscribers.length,
        subscribers: subscribers.map(function(s) {
          return { id: String(s.id), name: s.name, email: s.email };
        }),
        columnTypeSummary: columnTypes
      }
    });
  } catch (error) {
    return handleError('getBoardInventory', error);
  }
}

/**
 * Get all users with role breakdown.
 * @returns {Object} User list with details
 */
function getUserInventory() {
  try {
    var users = getAccountUsers();

    var userList = users.map(function(u) {
      return {
        id: String(u.id),
        name: u.name,
        email: u.email,
        isGuest: !!u.is_guest,
        enabled: !!u.enabled
      };
    });

    userList.sort(function(a, b) { return a.name.localeCompare(b.name); });

    return safeReturn({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        users: userList,
        summary: {
          total: userList.length,
          members: userList.filter(function(u) { return !u.isGuest; }).length,
          guests: userList.filter(function(u) { return u.isGuest; }).length,
          active: userList.filter(function(u) { return u.enabled; }).length,
          disabled: userList.filter(function(u) { return !u.enabled; }).length
        }
      }
    });
  } catch (error) {
    return handleError('getUserInventory', error);
  }
}
