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

    // 4. Get board subscribers, teams, and groups for each source board
    var boardDetails = [];
    sourceBoards.forEach(function(sb) {
      var sourceAccess = { kind: 'private', subscribers: [], teams: [], teamMemberIds: {} };
      try { sourceAccess = _getBoardAccessDetails(sb.id, null); } catch (e) {}
      var groups = (sb.groups || []).map(function(g) { return { id: g.id, title: g.title }; });

      var mapped = boardMapping[String(sb.id)];
      var targetAccess = { kind: 'private', subscribers: [], teams: [], teamMemberIds: {} };
      var targetGroups = [];
      if (mapped) {
        try { targetAccess = _getBoardAccessDetails(mapped.targetBoardId, targetApiKey); } catch (e) {}
        targetGroups = (mapped.targetGroups || []).map(function(g) { return { id: g.id, title: g.title }; });
      }

      boardDetails.push({
        sourceBoardId: String(sb.id),
        sourceBoardName: sb.name,
        sourceKind: sourceAccess.kind,
        targetBoardId: mapped ? mapped.targetBoardId : null,
        targetBoardName: mapped ? mapped.targetBoardName : null,
        sourceSubscribers: sourceAccess.subscribers,
        targetSubscribers: targetAccess.subscribers,
        sourceTeams: sourceAccess.teams,
        targetTeams: targetAccess.teams,
        sourceTeamMemberIds: sourceAccess.teamMemberIds,
        targetTeamMemberIds: targetAccess.teamMemberIds,
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
            sourceKind: bd.sourceKind,
            targetBoardId: bd.targetBoardId,
            targetBoardName: bd.targetBoardName,
            matched: bd.matched,
            sourceSubscriberCount: bd.sourceSubscribers.length,
            targetSubscriberCount: bd.targetSubscribers.length,
            sourceTeams: (bd.sourceTeams || []).map(function(t) {
              return { id: t.id, name: t.name, isOwner: t.isOwner, memberCount: t.memberCount };
            }),
            targetTeams: (bd.targetTeams || []).map(function(t) {
              return { id: t.id, name: t.name, isOwner: t.isOwner, memberCount: t.memberCount };
            }),
            missingTeams: _getMissingTeams(bd.sourceTeams || [], bd.targetTeams || [], isCrossAccount),
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
    // Skip users who are only accessed via teams (they'll be added via team assignment)
    if (u.viaTeams && u.viaTeams.length > 0 && !u.wsRole) return;
    wsUserIds.push(u.sourceUserId);
  });

  if (wsUserIds.length > 0) {
    try {
      _targetAPI(targetApiKey,
        'mutation ($wsId: ID!, $userIds: [ID!]!, $kind: WorkspaceSubscriberKind) { add_users_to_workspace (workspace_id: $wsId, user_ids: $userIds, kind: $kind) { id } }',
        { wsId: Number(targetWorkspaceId), userIds: wsUserIds.map(Number), kind: 'subscriber' }
      );
      results.usersAssigned += wsUserIds.length;
    } catch (e) {
      results.errors.push({ action: 'add_to_workspace', error: e.toString() });
    }
  }

  // Step 2: For each matched board, add missing teams first, then missing individual subscribers
  boardMapping.forEach(function(bm) {
    if (!bm.matched || !bm.targetBoardId) return;
    results.boardsProcessed++;

    // 2a: Add missing teams to the target board
    var missingTeams = bm.missingTeams || [];
    if (missingTeams.length > 0) {
      var teamIdsToAdd = missingTeams.map(function(t) { return t.sourceTeamId; });
      try {
        _targetAPI(targetApiKey,
          'mutation ($boardId: ID!, $teamIds: [ID!]!) { add_teams_to_board (board_id: $boardId, team_ids: $teamIds) { id } }',
          { boardId: Number(bm.targetBoardId), teamIds: teamIdsToAdd.map(Number) }
        );
        results.details.push({
          board: bm.targetBoardName,
          action: 'teams_assigned',
          count: teamIdsToAdd.length
        });
      } catch (e) {
        results.errors.push({
          board: bm.targetBoardName,
          action: 'add_teams_to_board',
          error: e.toString()
        });
      }
      Utilities.sleep(200);
    }

    // 2b: Add missing individual subscribers (not team-covered)
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

  // Step 2: For each matched board, add missing teams then missing individual subscribers
  boardMapping.forEach(function(bm) {
    if (!bm.matched || !bm.targetBoardId) return;
    results.boardsProcessed++;

    // 2a: Add missing teams (matched by name cross-account)
    var missingTeams = (bm.missingTeams || []).filter(function(t) { return t.targetTeamId; });
    if (missingTeams.length > 0) {
      var teamIdsToAdd = missingTeams.map(function(t) { return t.targetTeamId; });
      try {
        _targetAPI(targetApiKey,
          'mutation ($boardId: ID!, $teamIds: [ID!]!) { add_teams_to_board (board_id: $boardId, team_ids: $teamIds) { id } }',
          { boardId: Number(bm.targetBoardId), teamIds: teamIdsToAdd.map(Number) }
        );
        results.details.push({
          board: bm.targetBoardName,
          action: 'teams_assigned',
          count: teamIdsToAdd.length
        });
      } catch (e) {
        results.errors.push({
          board: bm.targetBoardName,
          action: 'add_teams_to_board',
          error: e.toString()
        });
      }
      Utilities.sleep(200);
    }

    // 2b: Add missing individual subscribers with target user IDs
    var missing = bm.missingSubscribers || [];
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

/**
 * Get detailed board access info including teams and handling public boards.
 * For public boards, `subscribers` returns every user in the account, so we
 * only return owners as individual subscribers and rely on team_subscribers
 * for team-based access.
 *
 * @param {string} boardId
 * @param {string|null} targetApiKey
 * @returns {{ kind: string, subscribers: Array, teams: Array, teamMemberIds: Object }}
 */
function _getBoardAccessDetails(boardId, targetApiKey) {
  var data = _targetAPI(targetApiKey,
    'query ($boardId: [ID!]) { boards (ids: $boardId) { board_kind subscribers { id name email is_guest } owners { id name email } team_subscribers (limit: 100) { id name users { id name email } } team_owners (limit: 100) { id name users { id name email } } } }',
    { boardId: [Number(boardId)] }
  );
  var board = data.boards && data.boards[0];
  if (!board) return { kind: 'private', subscribers: [], teams: [], teamMemberIds: {} };

  var kind = board.board_kind || 'private';

  // Build owner lookup
  var ownerIds = {};
  (board.owners || []).forEach(function(o) { ownerIds[String(o.id)] = true; });

  // Build team info (merge team_subscribers + team_owners, dedupe)
  var teamOwnerIds = {};
  (board.team_owners || []).forEach(function(t) { teamOwnerIds[String(t.id)] = true; });

  var teams = [];
  var teamMemberIds = {}; // userId → teamName
  var seenTeams = {};
  var allTeamEntries = (board.team_subscribers || []).concat(board.team_owners || []);
  allTeamEntries.forEach(function(t) {
    var tid = String(t.id);
    if (seenTeams[tid]) return;
    seenTeams[tid] = true;
    var members = (t.users || []).map(function(u) {
      return { id: String(u.id), name: u.name, email: u.email || '' };
    });
    teams.push({
      id: tid,
      name: t.name,
      isOwner: !!teamOwnerIds[tid],
      members: members,
      memberIds: members.map(function(m) { return m.id; }),
      memberCount: members.length
    });
    members.forEach(function(m) {
      teamMemberIds[m.id] = t.name;
    });
  });

  // Build subscriber list
  var subscribers;
  if (kind === 'public') {
    // For public boards, only list owners as individual subscribers
    // (subscribers field returns everyone in the account)
    subscribers = (board.owners || []).map(function(o) {
      return {
        id: String(o.id),
        name: o.name,
        email: o.email || '',
        isGuest: false,
        role: 'owner'
      };
    });
  } else {
    // For private/shareable boards, list all subscribers with roles
    // but exclude users who are covered by a team (unless they are an owner)
    subscribers = [];
    (board.subscribers || []).forEach(function(s) {
      var sid = String(s.id);
      var isOwner = !!ownerIds[sid];
      var coveredByTeam = !!teamMemberIds[sid];
      if (coveredByTeam && !isOwner) return; // show via team instead
      subscribers.push({
        id: sid,
        name: s.name,
        email: s.email || '',
        isGuest: !!s.is_guest,
        role: isOwner ? 'owner' : 'subscriber'
      });
    });
  }

  return {
    kind: kind,
    subscribers: subscribers,
    teams: teams,
    teamMemberIds: teamMemberIds
  };
}

/** Backward-compat wrapper: returns flat subscriber array */
function _getBoardSubscribersWithRole(boardId, targetApiKey) {
  var details = _getBoardAccessDetails(boardId, targetApiKey);
  return details.subscribers;
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

  // Helper to ensure a user entry exists
  function ensureUser(s, wsRole) {
    if (!seen[s.id]) {
      seen[s.id] = true;
      users.push({
        id: s.id,
        name: s.name,
        email: s.email,
        isGuest: s.isGuest,
        enabled: s.enabled !== undefined ? s.enabled : true,
        wsRole: wsRole || null,
        boards: []
      });
    }
  }

  // Workspace subscribers
  wsData.subscribers.forEach(function(s) {
    ensureUser(s, s.role);
  });

  // Board-level individual subscribers (already filtered by _getBoardAccessDetails:
  // public boards only have owners, non-public exclude team-covered users)
  boardDetails.forEach(function(bd) {
    bd.sourceSubscribers.forEach(function(s) {
      ensureUser(s, null);
      var user = users.find(function(u) { return u.id === s.id; });
      if (user) {
        user.boards.push({
          boardId: bd.sourceBoardId,
          boardName: bd.sourceBoardName,
          boardKind: bd.sourceKind,
          role: s.role,
          viaTeam: null
        });
      }
    });

    // Team-based subscribers: add the team name to each member's board entry
    (bd.sourceTeams || []).forEach(function(team) {
      (team.members || []).forEach(function(m) {
        ensureUser({ id: m.id, name: m.name, email: m.email, isGuest: false }, null);
        var user = users.find(function(u) { return u.id === m.id; });
        if (user) {
          // Only add if not already listed as an individual subscriber for this board
          var already = user.boards.some(function(b) { return b.boardId === bd.sourceBoardId; });
          if (!already) {
            user.boards.push({
              boardId: bd.sourceBoardId,
              boardName: bd.sourceBoardName,
              boardKind: bd.sourceKind,
              role: team.isOwner ? 'team_owner' : 'team_subscriber',
              viaTeam: team.name
            });
          }
        }
      });
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

  // Build target board subscriber + team member lookups
  var targetBoardSubs = {};
  boardDetails.forEach(function(bd) {
    if (!bd.targetBoardId) return;
    targetBoardSubs[bd.targetBoardId] = {};
    bd.targetSubscribers.forEach(function(s) {
      targetBoardSubs[bd.targetBoardId][String(s.id)] = s;
    });
    // Also count team members as assigned in target
    (bd.targetTeams || []).forEach(function(t) {
      (t.memberIds || []).forEach(function(mid) {
        if (!targetBoardSubs[bd.targetBoardId][mid]) {
          targetBoardSubs[bd.targetBoardId][mid] = { id: mid, viaTeam: t.name };
        }
      });
    });
  });

  // Build target account user lookup (by ID) for "in target account" check
  var targetAccountById = {};
  if (isCrossAccount) {
    targetAccountUsers.forEach(function(u) {
      targetAccountById[String(u.id)] = u;
    });
  }

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
    var inTargetAccount = false;
    var boardAssignments = [];

    if (targetUser) {
      inTargetWorkspace = !!targetWsSubs[targetUser.id];
      inTargetAccount = isCrossAccount ? !!targetAccountById[targetUser.id] : true;

      su.boards.forEach(function(sb) {
        var matched = boardDetails.find(function(bd) { return bd.sourceBoardId === sb.boardId; });
        if (matched && matched.targetBoardId) {
          var subs = targetBoardSubs[matched.targetBoardId] || {};
          boardAssignments.push({
            sourceBoardName: sb.boardName,
            targetBoardId: matched.targetBoardId,
            targetBoardName: matched.targetBoardName,
            sourceRole: sb.role,
            viaTeam: sb.viaTeam || null,
            assignedInTarget: !!subs[targetUser.id]
          });
        }
      });
    } else {
      inTargetAccount = !isCrossAccount; // same account means they exist
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
      inTargetAccount: inTargetAccount,
      inTargetWorkspace: inTargetWorkspace,
      boardAssignments: boardAssignments,
      boardCount: su.boards.length,
      assignedBoardCount: boardAssignments.filter(function(ba) { return ba.assignedInTarget; }).length,
      // Collect unique team names this user is accessed through
      viaTeams: su.boards.reduce(function(acc, b) {
        if (b.viaTeam && acc.indexOf(b.viaTeam) === -1) acc.push(b.viaTeam);
        return acc;
      }, [])
    };
  });
}


// ── Helper: Get Missing Teams ────────────────────────────────────────────────

function _getMissingTeams(sourceTeams, targetTeams, isCrossAccount) {
  if (!sourceTeams || sourceTeams.length === 0) return [];

  // Build lookup of target teams by ID (same-account) or name (cross-account)
  var targetTeamById = {};
  var targetTeamByName = {};
  (targetTeams || []).forEach(function(t) {
    targetTeamById[t.id] = true;
    targetTeamByName[t.name.toLowerCase()] = t;
  });

  var missing = [];
  sourceTeams.forEach(function(st) {
    var found = false;
    var targetTeamId = null;
    if (!isCrossAccount) {
      found = !!targetTeamById[st.id];
      targetTeamId = st.id;
    } else {
      var match = targetTeamByName[st.name.toLowerCase()];
      if (match) {
        found = true;
        targetTeamId = match.id;
      }
    }
    if (!found) {
      missing.push({
        sourceTeamId: st.id,
        name: st.name,
        isOwner: st.isOwner,
        memberCount: st.memberCount,
        targetTeamId: targetTeamId
      });
    }
  });
  return missing;
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
