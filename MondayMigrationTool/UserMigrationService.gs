/**
 * User & Guest Migration Service
 *
 * Provides post-workspace-migration user/guest assignment:
 *   1. Scan & compare source vs target workspace users, board subscribers
 *   2. Same-account: directly assign users/guests to boards (no invites needed)
 *   3. Cross-account: validate-only, assign-existing, invite-users, invite-guests modes
 *
 * Avoids flooding users with monday.com invitation emails by supporting
 * validate-only and assign-existing-only modes.
 */

// ── Scan & Compare ──────────────────────────────────────────────────────────

/**
 * Scan source and target workspaces, build a full comparison of users,
 * board subscribers, groups, and user roles.
 *
 * @param {string} sourceWorkspaceId
 * @param {string} targetWorkspaceId
 * @param {string|null} targetAccountId - If cross-account, the target account ID
 * @returns {Object} Full scan result
 */
function scanUserMigration(sourceWorkspaceId, targetWorkspaceId, targetAccountId) {
  try {
    var targetApiKey = null;
    var isCrossAccount = false;
    if (targetAccountId) {
      targetApiKey = getTargetApiKeyForAccount(targetAccountId);
      var sourceAcct = _validateApiKey(CONFIG.MONDAY_API_KEY);
      isCrossAccount = sourceAcct && sourceAcct.accountId !== targetAccountId;
    }

    // 1. Get workspace subscriber lists
    var sourceWsData = _getWorkspaceSubscribers(sourceWorkspaceId, null);
    var targetWsData = _getWorkspaceSubscribers(targetWorkspaceId, targetApiKey);

    // 2. Get boards in both workspaces
    var sourceBoards = getBoardsInWorkspace(sourceWorkspaceId);
    var targetBoards = _getBoardsInWorkspaceOnTarget(targetWorkspaceId, targetApiKey);

    // 3. Build board name mapping (source → target)
    var boardMapping = _buildBoardNameMapping(sourceBoards, targetBoards);

    // 4. Get board subscribers and groups for each source board
    var boardDetails = [];
    sourceBoards.forEach(function(sb) {
      var subscribers = [];
      try { subscribers = _getBoardSubscribersWithRole(sb.id, null); } catch (e) {}
      var groups = (sb.groups || []).map(function(g) { return { id: g.id, title: g.title }; });

      var mapped = boardMapping[String(sb.id)];
      var targetSubs = [];
      var targetGroups = [];
      if (mapped) {
        try { targetSubs = _getBoardSubscribersWithRole(mapped.targetBoardId, targetApiKey); } catch (e) {}
        targetGroups = (mapped.targetGroups || []).map(function(g) { return { id: g.id, title: g.title }; });
      }

      boardDetails.push({
        sourceBoardId: String(sb.id),
        sourceBoardName: sb.name,
        sourceKind: sb.board_kind,
        targetBoardId: mapped ? mapped.targetBoardId : null,
        targetBoardName: mapped ? mapped.targetBoardName : null,
        sourceSubscribers: subscribers,
        targetSubscribers: targetSubs,
        sourceGroups: groups,
        targetGroups: targetGroups,
        matched: !!mapped
      });
    });

    // 5. Get all users in the target account (for cross-account matching)
    var targetAccountUsers = [];
    if (isCrossAccount) {
      targetAccountUsers = _getAllUsersOnTarget(targetApiKey);
    }

    // 6. Build unified user list with match status
    var allSourceUsers = _collectAllSourceUsers(sourceWsData, boardDetails);
    var userComparison = _buildUserComparison(allSourceUsers, targetAccountUsers, targetWsData, boardDetails, isCrossAccount);

    return safeReturn({
      success: true,
      data: {
        isCrossAccount: isCrossAccount,
        sourceWorkspace: { id: sourceWorkspaceId, name: sourceWsData.name, subscribers: sourceWsData.subscribers.length },
        targetWorkspace: { id: targetWorkspaceId, name: targetWsData.name, subscribers: targetWsData.subscribers.length },
        boardMapping: boardDetails.map(function(bd) {
          return {
            sourceBoardId: bd.sourceBoardId,
            sourceBoardName: bd.sourceBoardName,
            targetBoardId: bd.targetBoardId,
            targetBoardName: bd.targetBoardName,
            matched: bd.matched,
            sourceSubscriberCount: bd.sourceSubscribers.length,
            targetSubscriberCount: bd.targetSubscribers.length,
            sourceGroupCount: bd.sourceGroups.length,
            targetGroupCount: bd.targetGroups.length,
            missingSubscribers: _getMissingSubscribers(bd.sourceSubscribers, bd.targetSubscribers, isCrossAccount, targetAccountUsers)
          };
        }),
        users: userComparison,
        summary: {
          totalSourceUsers: allSourceUsers.length,
          members: allSourceUsers.filter(function(u) { return !u.isGuest; }).length,
          guests: allSourceUsers.filter(function(u) { return u.isGuest; }).length,
          matchedInTarget: userComparison.filter(function(u) { return u.targetUserId; }).length,
          unmatchedInTarget: userComparison.filter(function(u) { return !u.targetUserId; }).length,
          boardsMatched: boardDetails.filter(function(b) { return b.matched; }).length,
          boardsTotal: boardDetails.length
        }
      }
    });
  } catch (error) {
    return handleError('scanUserMigration', error);
  }
}


// ── Execute User Migration ──────────────────────────────────────────────────

/**
 * Execute user/guest migration based on selected mode.
 *
 * Modes:
 *   - 'validate'         : Read-only scan (already done by scanUserMigration)
 *   - 'assign_existing'  : Assign users already in the target account to matching boards
 *   - 'invite_users'     : Invite member users (sends emails via monday.com)
 *   - 'invite_guests'    : Invite guest users (sends emails via monday.com)
 *
 * @param {Object} params
 * @param {string} params.sourceWorkspaceId
 * @param {string} params.targetWorkspaceId
 * @param {string} params.targetAccountId
 * @param {string} params.mode - One of the above modes
 * @param {Array} params.userIds - Optional list of specific source user IDs to process
 * @param {Object} params.scanData - Previously computed scan data (to avoid re-scanning)
 * @returns {Object} Result with details of actions taken
 */
function executeUserMigration(params) {
  try {
    var sourceWorkspaceId = params.sourceWorkspaceId;
    var targetWorkspaceId = params.targetWorkspaceId;
    var targetAccountId = params.targetAccountId;
    var mode = params.mode;
    var selectedUserIds = params.userIds || null;
    var scanData = params.scanData;

    if (!sourceWorkspaceId || !targetWorkspaceId || !mode) {
      throw new Error('Missing required parameters: sourceWorkspaceId, targetWorkspaceId, mode');
    }

    var targetApiKey = null;
    var isCrossAccount = false;
    if (targetAccountId) {
      targetApiKey = getTargetApiKeyForAccount(targetAccountId);
      var sourceAcct = _validateApiKey(CONFIG.MONDAY_API_KEY);
      isCrossAccount = sourceAcct && sourceAcct.accountId !== targetAccountId;
    }

    var results = {
      mode: mode,
      isCrossAccount: isCrossAccount,
      usersProcessed: 0,
      usersAssigned: 0,
      usersInvited: 0,
      usersSkipped: 0,
      boardsProcessed: 0,
      errors: [],
      details: []
    };

    if (mode === 'validate') {
      // Validate-only: just return the scan data
      return safeReturn({ success: true, data: results, message: 'Validation complete. No changes made.' });
    }

    // For same-account, use direct assignment regardless of mode
    if (!isCrossAccount) {
      _executeSameAccountUserMigration(
        sourceWorkspaceId, targetWorkspaceId, targetApiKey, scanData, selectedUserIds, results
      );
    } else {
      // Cross-account: mode-specific behavior
      switch (mode) {
        case 'assign_existing':
          _executeCrossAccountAssignExisting(
            targetWorkspaceId, targetApiKey, scanData, selectedUserIds, results
          );
          break;
        case 'invite_users':
          _executeCrossAccountInviteUsers(
            targetWorkspaceId, targetApiKey, scanData, selectedUserIds, false, results
          );
          break;
        case 'invite_guests':
          _executeCrossAccountInviteUsers(
            targetWorkspaceId, targetApiKey, scanData, selectedUserIds, true, results
          );
          break;
        default:
          throw new Error('Unknown migration mode: ' + mode);
      }
    }

    logMigrationAction(
      'user_mig_' + Utilities.getUuid().substring(0, 8),
      'user_migration_' + mode,
      sourceWorkspaceId,
      targetWorkspaceId,
      results.errors.length > 0 ? 'completed_with_errors' : 'completed',
      results
    );

    return safeReturn({ success: true, data: results });
  } catch (error) {
    return handleError('executeUserMigration', error);
  }
}


// ── Same-Account Migration ──────────────────────────────────────────────────

function _executeSameAccountUserMigration(sourceWorkspaceId, targetWorkspaceId, targetApiKey, scanData, selectedUserIds, results) {
  var boardMapping = scanData.boardMapping || [];

  // Step 1: Add all source workspace subscribers to target workspace
  var wsUsers = scanData.users || [];
  var wsUserIds = [];
  wsUsers.forEach(function(u) {
    if (selectedUserIds && selectedUserIds.indexOf(u.sourceUserId) === -1) return;
    wsUserIds.push(u.sourceUserId);
  });

  if (wsUserIds.length > 0) {
    try {
      // Add as workspace members (same account, IDs are valid)
      _targetAPI(targetApiKey,
        'mutation ($wsId: ID!, $userIds: [ID!]!, $kind: WorkspaceSubscriberKind) { add_users_to_workspace (workspace_id: $wsId, user_ids: $userIds, kind: $kind) { id } }',
        { wsId: Number(targetWorkspaceId), userIds: wsUserIds.map(Number), kind: 'subscriber' }
      );
      results.usersAssigned += wsUserIds.length;
    } catch (e) {
      results.errors.push({ action: 'add_to_workspace', error: e.toString() });
    }
  }

  // Step 2: For each matched board, ensure groups exist then add subscribers
  boardMapping.forEach(function(bm) {
    if (!bm.matched || !bm.targetBoardId) return;
    results.boardsProcessed++;

    // Get missing subscribers for this board
    var missing = bm.missingSubscribers || [];
    if (selectedUserIds) {
      missing = missing.filter(function(m) { return selectedUserIds.indexOf(m.sourceUserId) !== -1; });
    }

    if (missing.length === 0) return;

    var userIdsToAdd = missing.map(function(m) { return m.sourceUserId; });

    try {
      _targetAPI(targetApiKey,
        'mutation ($boardId: ID!, $userIds: [ID!]!) { add_users_to_board (board_id: $boardId, user_ids: $userIds) { id } }',
        { boardId: Number(bm.targetBoardId), userIds: userIdsToAdd.map(Number) }
      );
      results.usersAssigned += userIdsToAdd.length;
      results.details.push({
        board: bm.targetBoardName,
        action: 'assigned',
        count: userIdsToAdd.length
      });
    } catch (e) {
      results.errors.push({
        board: bm.targetBoardName,
        action: 'add_users_to_board',
        error: e.toString()
      });
    }

    Utilities.sleep(200);
  });

  results.usersProcessed = wsUserIds.length;
}


// ── Cross-Account: Assign Existing ──────────────────────────────────────────

function _executeCrossAccountAssignExisting(targetWorkspaceId, targetApiKey, scanData, selectedUserIds, results) {
  var boardMapping = scanData.boardMapping || [];
  var users = scanData.users || [];

  // Only process users that have a match in the target account
  var matchedUsers = users.filter(function(u) {
    if (!u.targetUserId) return false;
    if (selectedUserIds && selectedUserIds.indexOf(u.sourceUserId) === -1) return false;
    return true;
  });

  // Step 1: Add matched users to target workspace
  var targetUserIds = matchedUsers.map(function(u) { return u.targetUserId; });
  if (targetUserIds.length > 0) {
    try {
      _targetAPI(targetApiKey,
        'mutation ($wsId: ID!, $userIds: [ID!]!, $kind: WorkspaceSubscriberKind) { add_users_to_workspace (workspace_id: $wsId, user_ids: $userIds, kind: $kind) { id } }',
        { wsId: Number(targetWorkspaceId), userIds: targetUserIds.map(Number), kind: 'subscriber' }
      );
      results.usersAssigned += targetUserIds.length;
    } catch (e) {
      results.errors.push({ action: 'add_to_workspace', error: e.toString() });
    }
  }

  // Step 2: For each matched board, add matched users as board subscribers
  boardMapping.forEach(function(bm) {
    if (!bm.matched || !bm.targetBoardId) return;
    results.boardsProcessed++;

    var missing = bm.missingSubscribers || [];
    // Filter to only those with target user IDs
    var toAssign = missing.filter(function(m) {
      if (!m.targetUserId) return false;
      if (selectedUserIds && selectedUserIds.indexOf(m.sourceUserId) === -1) return false;
      return true;
    });

    if (toAssign.length === 0) return;

    var idsToAdd = toAssign.map(function(m) { return m.targetUserId; });
    try {
      _targetAPI(targetApiKey,
        'mutation ($boardId: ID!, $userIds: [ID!]!) { add_users_to_board (board_id: $boardId, user_ids: $userIds) { id } }',
        { boardId: Number(bm.targetBoardId), userIds: idsToAdd.map(Number) }
      );
      results.usersAssigned += idsToAdd.length;
      results.details.push({
        board: bm.targetBoardName,
        action: 'assigned_existing',
        count: idsToAdd.length
      });
    } catch (e) {
      results.errors.push({
        board: bm.targetBoardName,
        action: 'assign_existing',
        error: e.toString()
      });
    }

    Utilities.sleep(200);
  });

  results.usersProcessed = matchedUsers.length;
}


// ── Cross-Account: Invite Users/Guests ──────────────────────────────────────

function _executeCrossAccountInviteUsers(targetWorkspaceId, targetApiKey, scanData, selectedUserIds, guestsOnly, results) {
  var users = scanData.users || [];

  // Filter to users/guests without a target match
  var toInvite = users.filter(function(u) {
    if (u.targetUserId) return false; // Already in target, skip
    if (guestsOnly && !u.isGuest) return false;
    if (!guestsOnly && u.isGuest) return false;
    if (selectedUserIds && selectedUserIds.indexOf(u.sourceUserId) === -1) return false;
    return true;
  });

  if (toInvite.length === 0) {
    results.usersSkipped = users.length;
    return;
  }

  // Invite in batches of 10 to avoid rate limits
  var BATCH_SIZE = 10;
  for (var i = 0; i < toInvite.length; i += BATCH_SIZE) {
    var batch = toInvite.slice(i, i + BATCH_SIZE);
    var emails = batch.map(function(u) { return u.email; });

    try {
      var userRole = guestsOnly ? 'GUEST' : 'MEMBER';
      var data = _targetAPI(targetApiKey,
        'mutation ($emails: [String!]!, $role: UserRole) { invite_users (emails: $emails, user_role: $role) { invited_users { id name email } errors { message email } } }',
        { emails: emails, role: userRole }
      );

      var inviteResult = data.invite_users;
      if (inviteResult.invited_users) {
        results.usersInvited += inviteResult.invited_users.length;
      }
      if (inviteResult.errors) {
        inviteResult.errors.forEach(function(err) {
          results.errors.push({
            action: 'invite_' + userRole,
            email: err.email,
            error: err.message
          });
        });
      }
    } catch (e) {
      results.errors.push({
        action: 'invite_batch',
        emails: emails.join(', '),
        error: e.toString()
      });
    }

    Utilities.sleep(500);
  }

  results.usersProcessed = toInvite.length;
}


// ── Helper: Get Workspace Subscribers ───────────────────────────────────────

function _getWorkspaceSubscribers(workspaceId, targetApiKey) {
  var data = _targetAPI(targetApiKey,
    'query ($ids: [ID!]) { workspaces (ids: $ids) { id name users_subscribers (limit: 200) { id name email is_guest enabled } owners_subscribers (limit: 50) { id name email } } }',
    { ids: [Number(workspaceId)] }
  );
  var ws = data.workspaces && data.workspaces[0];
  if (!ws) throw new Error('Workspace ' + workspaceId + ' not found');

  // Merge owners and subscribers, mark role
  var ownerIds = {};
  (ws.owners_subscribers || []).forEach(function(o) { ownerIds[String(o.id)] = true; });

  var subscribers = (ws.users_subscribers || []).map(function(u) {
    return {
      id: String(u.id),
      name: u.name,
      email: u.email,
      isGuest: !!u.is_guest,
      enabled: u.enabled !== false,
      role: ownerIds[String(u.id)] ? 'owner' : 'subscriber'
    };
  });

  return { id: String(ws.id), name: ws.name, subscribers: subscribers };
}

function _getBoardsInWorkspaceOnTarget(workspaceId, targetApiKey) {
  if (!targetApiKey) return getBoardsInWorkspace(workspaceId);

  var data = callMondayAPIWithKey(targetApiKey,
    'query ($wsId: [ID!]) { boards (workspace_ids: $wsId, limit: 200) { id name board_kind board_folder_id state columns { id title type } groups { id title color } } }',
    { wsId: [Number(workspaceId)] }
  );
  var allBoards = data.boards || [];
  // Filter out subitem boards
  return allBoards.filter(function(b) { return b.board_kind !== 'sub_items_board'; });
}

function _getBoardSubscribersWithRole(boardId, targetApiKey) {
  var data = _targetAPI(targetApiKey,
    'query ($boardId: [ID!]) { boards (ids: $boardId) { subscribers { id name email is_guest } owners { id name email } } }',
    { boardId: [Number(boardId)] }
  );
  var board = data.boards && data.boards[0];
  if (!board) return [];

  var ownerIds = {};
  (board.owners || []).forEach(function(o) { ownerIds[String(o.id)] = true; });

  return (board.subscribers || []).map(function(s) {
    return {
      id: String(s.id),
      name: s.name,
      email: s.email || '',
      isGuest: !!s.is_guest,
      role: ownerIds[String(s.id)] ? 'owner' : 'subscriber'
    };
  });
}

function _getAllUsersOnTarget(targetApiKey) {
  var allUsers = [];
  var page = 1;
  while (true) {
    var data = callMondayAPIWithKey(targetApiKey,
      'query ($page: Int!) { users (limit: 100, page: $page) { id name email is_guest enabled } }',
      { page: page }
    );
    var users = data.users || [];
    if (users.length === 0) break;
    allUsers = allUsers.concat(users);
    page++;
    if (users.length < 100) break;
    Utilities.sleep(200);
  }
  return allUsers.map(function(u) {
    return {
      id: String(u.id),
      name: u.name,
      email: u.email,
      isGuest: !!u.is_guest,
      enabled: !!u.enabled
    };
  });
}


// ── Helper: Build Board Name Mapping ────────────────────────────────────────

function _buildBoardNameMapping(sourceBoards, targetBoards) {
  var mapping = {};
  var targetByName = {};
  targetBoards.forEach(function(tb) {
    targetByName[tb.name] = tb;
  });

  sourceBoards.forEach(function(sb) {
    // Try exact name match first
    var target = targetByName[sb.name];
    // Also try with " (Migrated)" suffix removed or added
    if (!target) target = targetByName[sb.name + ' (Migrated)'];
    if (!target) {
      // Try matching without any suffix
      var baseName = sb.name.replace(/ \(Migrated\)$/, '');
      target = targetByName[baseName];
    }

    if (target) {
      mapping[String(sb.id)] = {
        targetBoardId: String(target.id),
        targetBoardName: target.name,
        targetGroups: target.groups || []
      };
    }
  });
  return mapping;
}


// ── Helper: Collect All Source Users ─────────────────────────────────────────

function _collectAllSourceUsers(wsData, boardDetails) {
  var seen = {};
  var users = [];

  // Workspace subscribers
  wsData.subscribers.forEach(function(s) {
    if (!seen[s.id]) {
      seen[s.id] = true;
      users.push({
        id: s.id,
        name: s.name,
        email: s.email,
        isGuest: s.isGuest,
        enabled: s.enabled,
        wsRole: s.role,
        boards: []
      });
    }
  });

  // Board subscribers
  boardDetails.forEach(function(bd) {
    bd.sourceSubscribers.forEach(function(s) {
      if (!seen[s.id]) {
        seen[s.id] = true;
        users.push({
          id: s.id,
          name: s.name,
          email: s.email,
          isGuest: s.isGuest,
          enabled: true,
          wsRole: null,
          boards: []
        });
      }
      // Track which boards this user is on
      var user = users.find(function(u) { return u.id === s.id; });
      if (user) {
        user.boards.push({
          boardId: bd.sourceBoardId,
          boardName: bd.sourceBoardName,
          role: s.role
        });
      }
    });
  });

  return users;
}


// ── Helper: Build User Comparison ───────────────────────────────────────────

function _buildUserComparison(sourceUsers, targetAccountUsers, targetWsData, boardDetails, isCrossAccount) {
  // Build email → target user lookup
  var targetByEmail = {};
  if (isCrossAccount) {
    targetAccountUsers.forEach(function(u) {
      targetByEmail[u.email.toLowerCase()] = u;
    });
  }

  // Build target workspace subscriber lookup
  var targetWsSubs = {};
  targetWsData.subscribers.forEach(function(s) {
    targetWsSubs[String(s.id)] = s;
  });

  // Build target board subscriber lookups
  var targetBoardSubs = {};
  boardDetails.forEach(function(bd) {
    if (!bd.targetBoardId) return;
    targetBoardSubs[bd.targetBoardId] = {};
    bd.targetSubscribers.forEach(function(s) {
      targetBoardSubs[bd.targetBoardId][String(s.id)] = s;
    });
  });

  return sourceUsers.map(function(su) {
    var targetUser = null;

    if (isCrossAccount) {
      // Match by email
      targetUser = targetByEmail[su.email.toLowerCase()] || null;
    } else {
      // Same account — same user ID
      targetUser = { id: su.id, name: su.name, email: su.email };
    }

    var inTargetWorkspace = false;
    var boardAssignments = [];

    if (targetUser) {
      inTargetWorkspace = !!targetWsSubs[targetUser.id];

      su.boards.forEach(function(sb) {
        var matched = boardDetails.find(function(bd) { return bd.sourceBoardId === sb.boardId; });
        if (matched && matched.targetBoardId) {
          var subs = targetBoardSubs[matched.targetBoardId] || {};
          boardAssignments.push({
            sourceBoardName: sb.boardName,
            targetBoardId: matched.targetBoardId,
            targetBoardName: matched.targetBoardName,
            sourceRole: sb.role,
            assignedInTarget: !!subs[targetUser.id]
          });
        }
      });
    }

    return {
      sourceUserId: su.id,
      name: su.name,
      email: su.email,
      isGuest: su.isGuest,
      wsRole: su.wsRole,
      targetUserId: targetUser ? targetUser.id : null,
      targetUserName: targetUser ? targetUser.name : null,
      matchedByEmail: isCrossAccount && !!targetUser,
      inTargetWorkspace: inTargetWorkspace,
      boardAssignments: boardAssignments,
      boardCount: su.boards.length,
      assignedBoardCount: boardAssignments.filter(function(ba) { return ba.assignedInTarget; }).length
    };
  });
}


// ── Helper: Get Missing Subscribers ─────────────────────────────────────────

function _getMissingSubscribers(sourceSubs, targetSubs, isCrossAccount, targetAccountUsers) {
  var targetIds = {};
  var targetEmails = {};
  targetSubs.forEach(function(ts) {
    targetIds[String(ts.id)] = true;
    if (ts.email) targetEmails[ts.email.toLowerCase()] = ts;
  });

  // Build email → target user ID lookup for cross-account
  var emailToTargetId = {};
  if (isCrossAccount && targetAccountUsers) {
    targetAccountUsers.forEach(function(u) {
      emailToTargetId[u.email.toLowerCase()] = u.id;
    });
  }

  var missing = [];
  sourceSubs.forEach(function(ss) {
    var found = false;
    var targetUserId = null;

    if (!isCrossAccount) {
      // Same account: match by ID
      found = !!targetIds[ss.id];
      targetUserId = ss.id;
    } else {
      // Cross-account: match by email
      var email = (ss.email || '').toLowerCase();
      if (email) {
        var matchedTarget = targetEmails[email];
        if (matchedTarget) {
          found = true;
          targetUserId = matchedTarget.id;
        } else if (emailToTargetId[email]) {
          // User exists in target account but not subscribed to this board
          targetUserId = emailToTargetId[email];
        }
      }
    }

    if (!found) {
      missing.push({
        sourceUserId: ss.id,
        name: ss.name,
        email: ss.email || '',
        isGuest: ss.isGuest,
        role: ss.role,
        targetUserId: targetUserId
      });
    }
  });

  return missing;
}
