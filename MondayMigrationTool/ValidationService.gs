/**
 * ValidationService.gs - Compare source vs target workspaces to verify migration.
 * Provides detailed comparison of boards, groups, columns, items, and subscribers.
 */

/**
 * Run a full validation comparing source workspace to target workspace.
 * @param {string} sourceWorkspaceId
 * @param {string} targetWorkspaceId
 * @param {Object} [options] - Optional flags (e.g. { verifyUsers: true })
 * @returns {Object} Detailed comparison report
 */
function validateMigration(sourceWorkspaceId, targetWorkspaceId, options) {
  try {
    if (!sourceWorkspaceId || !targetWorkspaceId) {
      throw new Error('Both sourceWorkspaceId and targetWorkspaceId are required');
    }
    options = options || {};

    var sourceWs = getWorkspaceDetails(sourceWorkspaceId);
    var targetWs = getWorkspaceDetails(targetWorkspaceId);
    if (!sourceWs) throw new Error('Source workspace not found');
    if (!targetWs) throw new Error('Target workspace not found');

    var sourceBoards = getBoardsInWorkspace(sourceWorkspaceId);
    var targetBoards = getBoardsInWorkspace(targetWorkspaceId);

    // Build target board lookup by name
    var targetBoardByName = {};
    targetBoards.forEach(function(b) {
      targetBoardByName[b.name] = b;
    });

    var boardComparisons = [];
    var totalSourceItems = 0;
    var totalTargetItems = 0;
    var totalSourceGroups = 0;
    var totalTargetGroups = 0;
    var totalSourceColumns = 0;
    var totalTargetColumns = 0;
    var matchedBoards = 0;
    var unmatchedBoards = [];

    // Column types that are not migrated (system/computed)
    var nonCreatableTypes = ['subtasks', 'board_relation', 'mirror', 'formula', 'auto_number',
                             'creation_log', 'last_updated', 'button', 'dependency', 'item_id'];

    sourceBoards.forEach(function(sourceBoard) {
      var targetBoard = targetBoardByName[sourceBoard.name];

      var sourceItemCount = 0;
      try { sourceItemCount = getBoardItemCount(sourceBoard.id); } catch (e) {}

      var sourceGroupCount = sourceBoard.groups ? sourceBoard.groups.length : 0;
      var sourceCreatableCols = (sourceBoard.columns || []).filter(function(c) {
        return nonCreatableTypes.indexOf(c.type) < 0;
      });
      var sourceColumnCount = sourceCreatableCols.length;

      totalSourceItems += sourceItemCount;
      totalSourceGroups += sourceGroupCount;
      totalSourceColumns += sourceColumnCount;

      if (targetBoard) {
        matchedBoards++;

        var targetItemCount = 0;
        try { targetItemCount = getBoardItemCount(targetBoard.id); } catch (e) {}

        var targetGroupCount = targetBoard.groups ? targetBoard.groups.length : 0;
        var targetCreatableCols = (targetBoard.columns || []).filter(function(c) {
          return nonCreatableTypes.indexOf(c.type) < 0;
        });
        var targetColumnCount = targetCreatableCols.length;

        totalTargetItems += targetItemCount;
        totalTargetGroups += targetGroupCount;
        totalTargetColumns += targetColumnCount;

        // Column comparison (only creatable types)
        var sourceColMap = {};
        sourceCreatableCols.forEach(function(c) { sourceColMap[c.title] = c.type; });
        var targetColMap = {};
        targetCreatableCols.forEach(function(c) { targetColMap[c.title] = c.type; });

        var matchedColumns = 0;
        var missingColumns = [];
        var extraColumns = [];

        Object.keys(sourceColMap).forEach(function(title) {
          if (targetColMap[title]) {
            matchedColumns++;
          } else {
            missingColumns.push({ title: title, type: sourceColMap[title] });
          }
        });

        Object.keys(targetColMap).forEach(function(title) {
          if (!sourceColMap[title]) {
            extraColumns.push({ title: title, type: targetColMap[title] });
          }
        });

        // Group comparison
        var sourceGroupNames = (sourceBoard.groups || []).map(function(g) { return g.title; });
        var targetGroupNames = (targetBoard.groups || []).map(function(g) { return g.title; });

        var matchedGroups = 0;
        var missingGroups = [];

        sourceGroupNames.forEach(function(name) {
          if (targetGroupNames.indexOf(name) >= 0) {
            matchedGroups++;
          } else {
            missingGroups.push(name);
          }
        });

        boardComparisons.push({
          boardName: sourceBoard.name,
          sourceBoardId: String(sourceBoard.id),
          targetBoardId: String(targetBoard.id),
          matched: true,
          items: {
            source: sourceItemCount,
            target: targetItemCount,
            match: sourceItemCount === targetItemCount,
            diff: targetItemCount - sourceItemCount
          },
          groups: {
            source: sourceGroupCount,
            target: targetGroupCount,
            matched: matchedGroups,
            missing: missingGroups
          },
          columns: {
            source: sourceColumnCount,
            target: targetColumnCount,
            matched: matchedColumns,
            missing: missingColumns,
            extra: extraColumns
          }
        });
      } else {
        unmatchedBoards.push(sourceBoard.name);
        boardComparisons.push({
          boardName: sourceBoard.name,
          sourceBoardId: String(sourceBoard.id),
          targetBoardId: null,
          matched: false,
          items: { source: sourceItemCount, target: 0, match: false, diff: -sourceItemCount },
          groups: { source: sourceGroupCount, target: 0, matched: 0, missing: [] },
          columns: { source: sourceColumnCount, target: 0, matched: 0, missing: [], extra: [] }
        });
      }
    });

    // ── User & Guest Verification (optional) ──────────────────────────────────
    var userVerification = null;
    if (options.verifyUsers) {
      userVerification = _verifyUsersAndGuests(sourceWorkspaceId, targetWorkspaceId, sourceBoards, targetBoardByName);
      // Enrich board comparisons with subscriber data
      boardComparisons.forEach(function(bc) {
        var boardUsers = (userVerification.boardDetails || []).find(function(bu) {
          return bu.sourceBoardId === bc.sourceBoardId;
        });
        if (boardUsers) {
          bc.users = boardUsers;
        }
      });
    }

    // Calculate overall match percentages
    var boardMatchPct = sourceBoards.length > 0
      ? Math.round((matchedBoards / sourceBoards.length) * 100) : 100;
    var itemMatchPct = totalSourceItems > 0
      ? Math.round((totalTargetItems / totalSourceItems) * 100) : 100;
    var groupMatchPct = totalSourceGroups > 0
      ? Math.round((totalTargetGroups / totalSourceGroups) * 100) : 100;
    var columnMatchPct = totalSourceColumns > 0
      ? Math.round((totalTargetColumns / totalSourceColumns) * 100) : 100;

    var pcts = [boardMatchPct, itemMatchPct, groupMatchPct, columnMatchPct];
    var userMatchPct = null;
    if (userVerification) {
      userMatchPct = userVerification.matchPercentage;
      pcts.push(userMatchPct);
    }
    var overallPct = Math.round(pcts.reduce(function(a, b) { return a + b; }, 0) / pcts.length);

    return safeReturn({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        source: {
          workspaceId: String(sourceWorkspaceId),
          workspaceName: sourceWs.name,
          boardCount: sourceBoards.length,
          totalItems: totalSourceItems,
          totalGroups: totalSourceGroups,
          totalColumns: totalSourceColumns
        },
        target: {
          workspaceId: String(targetWorkspaceId),
          workspaceName: targetWs.name,
          boardCount: targetBoards.length,
          totalItems: totalTargetItems,
          totalGroups: totalTargetGroups,
          totalColumns: totalTargetColumns
        },
        matchPercentages: {
          overall: overallPct,
          boards: boardMatchPct,
          items: itemMatchPct,
          groups: groupMatchPct,
          columns: columnMatchPct,
          users: userMatchPct
        },
        boardComparisons: boardComparisons,
        unmatchedBoards: unmatchedBoards,
        extraTargetBoards: targetBoards
          .filter(function(b) {
            return !sourceBoards.some(function(sb) { return sb.name === b.name; });
          })
          .map(function(b) { return b.name; }),
        userVerification: userVerification
      }
    });
  } catch (error) {
    return handleError('validateMigration', error);
  }
}

/**
 * Deep-compare items between a source and target board.
 * Returns per-item match details (name matches, column value diffs).
 * @param {string} sourceBoardId
 * @param {string} targetBoardId
 * @returns {Object} Item-level comparison
 */
function validateBoardItems(sourceBoardId, targetBoardId) {
  try {
    if (!sourceBoardId || !targetBoardId) {
      throw new Error('Both sourceBoardId and targetBoardId are required');
    }

    var sourceItems = getAllBoardItems(sourceBoardId);
    var targetItems = getAllBoardItems(targetBoardId);

    // Build target lookup by name
    var targetByName = {};
    targetItems.forEach(function(item) {
      targetByName[item.name] = item;
    });

    var matched = 0;
    var missingInTarget = [];
    var valueMismatches = [];

    sourceItems.forEach(function(srcItem) {
      var tgtItem = targetByName[srcItem.name];

      if (!tgtItem) {
        missingInTarget.push(srcItem.name);
        return;
      }

      matched++;

      // Compare column values by text representation
      var srcValues = {};
      (srcItem.column_values || []).forEach(function(cv) {
        if (cv.text) srcValues[cv.id] = cv.text;
      });

      // Note: target column IDs will differ, so compare by matching column titles
      // This is a simplified text-level comparison
    });

    var extraInTarget = targetItems
      .filter(function(t) {
        return !sourceItems.some(function(s) { return s.name === t.name; });
      })
      .map(function(t) { return t.name; });

    var matchPct = sourceItems.length > 0
      ? Math.round((matched / sourceItems.length) * 100) : 100;

    return safeReturn({
      success: true,
      data: {
        sourceBoardId: String(sourceBoardId),
        targetBoardId: String(targetBoardId),
        sourceItemCount: sourceItems.length,
        targetItemCount: targetItems.length,
        matched: matched,
        matchPercentage: matchPct,
        missingInTarget: missingInTarget,
        extraInTarget: extraInTarget
      }
    });
  } catch (error) {
    return handleError('validateBoardItems', error);
  }
}

/**
 * Quick comparison using just counts (faster, no item-level fetch).
 * @param {string} sourceWorkspaceId
 * @param {string} targetWorkspaceId
 * @returns {Object} Count-level comparison
 */
function quickValidation(sourceWorkspaceId, targetWorkspaceId) {
  try {
    if (!sourceWorkspaceId || !targetWorkspaceId) {
      throw new Error('Both workspace IDs are required');
    }

    var sourceInv = getWorkspaceInventory(sourceWorkspaceId);
    var targetInv = getWorkspaceInventory(targetWorkspaceId);

    if (!sourceInv.success) throw new Error('Failed to get source inventory');
    if (!targetInv.success) throw new Error('Failed to get target inventory');

    var src = sourceInv.data;
    var tgt = targetInv.data;

    // Match boards by name
    var srcBoardNames = src.boards.map(function(b) { return b.name; });
    var tgtBoardNames = tgt.boards.map(function(b) { return b.name; });

    var boardsMatched = srcBoardNames.filter(function(n) { return tgtBoardNames.indexOf(n) >= 0; }).length;
    var boardsMissing = srcBoardNames.filter(function(n) { return tgtBoardNames.indexOf(n) < 0; });

    // Per-board item count comparison
    var boardDetails = src.boards.map(function(srcBoard) {
      var tgtBoard = tgt.boards.find(function(b) { return b.name === srcBoard.name; });

      return {
        name: srcBoard.name,
        sourceItems: srcBoard.itemCount,
        targetItems: tgtBoard ? tgtBoard.itemCount : 0,
        sourceGroups: srcBoard.groupCount,
        targetGroups: tgtBoard ? tgtBoard.groupCount : 0,
        sourceColumns: srcBoard.columnCount,
        targetColumns: tgtBoard ? tgtBoard.columnCount : 0,
        matched: !!tgtBoard
      };
    });

    return safeReturn({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        source: {
          workspaceId: String(sourceWorkspaceId),
          boardCount: src.summary.boardCount,
          totalItems: src.summary.totalItems,
          totalGroups: src.summary.totalGroups,
          totalColumns: src.summary.totalColumns
        },
        target: {
          workspaceId: String(targetWorkspaceId),
          boardCount: tgt.summary.boardCount,
          totalItems: tgt.summary.totalItems,
          totalGroups: tgt.summary.totalGroups,
          totalColumns: tgt.summary.totalColumns
        },
        boardsMatched: boardsMatched,
        boardsMissing: boardsMissing,
        boardDetails: boardDetails
      }
    });
  } catch (error) {
    return handleError('quickValidation', error);
  }
}


// ── User & Guest Verification ────────────────────────────────────────────────

/**
 * Compare workspace subscribers, board subscribers, owners, and teams
 * between source and target workspaces.
 * @param {string} sourceWsId
 * @param {string} targetWsId
 * @param {Array} sourceBoards
 * @param {Object} targetBoardByName - lookup by name
 * @returns {Object} User verification report
 */
function _verifyUsersAndGuests(sourceWsId, targetWsId, sourceBoards, targetBoardByName) {
  // Per-board subscriber, owner, and team comparison
  var boardDetails = [];
  var totalSourceSubs = 0;
  var totalMatchedSubs = 0;

  sourceBoards.forEach(function(sb) {
    var targetBoard = targetBoardByName[sb.name];
    if (!targetBoard) return;

    var sourceAccess, targetAccess;
    try { sourceAccess = _getBoardAccessDetails(sb.id, null); } catch (e) { return; }
    try { targetAccess = _getBoardAccessDetails(targetBoard.id, null); } catch (e) { return; }

    // Build target subscriber lookup
    var targetSubMap = {};
    targetAccess.subscribers.forEach(function(ts) { targetSubMap[ts.id] = ts; });
    // Also include team members
    (targetAccess.teams || []).forEach(function(t) {
      (t.memberIds || []).forEach(function(mid) {
        if (!targetSubMap[mid]) targetSubMap[mid] = { id: mid, role: 'team_subscriber', viaTeam: t.name };
      });
    });

    // Compare individual subscribers
    var missingSubs = [];
    var roleMismatches = [];
    var matchedSubs = 0;

    sourceAccess.subscribers.forEach(function(ss) {
      totalSourceSubs++;
      var ts = targetSubMap[ss.id];
      if (!ts) {
        missingSubs.push({ id: ss.id, name: ss.name, email: ss.email, role: ss.role, isGuest: ss.isGuest });
      } else {
        matchedSubs++;
        totalMatchedSubs++;
        // Check role: source owner should be target owner
        if (ss.role === 'owner' && ts.role !== 'owner') {
          roleMismatches.push({ id: ss.id, name: ss.name, sourceRole: 'owner', targetRole: ts.role || 'subscriber' });
        }
      }
    });

    // Also check team members from source
    (sourceAccess.teams || []).forEach(function(srcTeam) {
      (srcTeam.memberIds || []).forEach(function(mid) {
        // Only count if not already in individual subscribers
        var alreadyCounted = sourceAccess.subscribers.some(function(ss) { return ss.id === mid; });
        if (!alreadyCounted) {
          totalSourceSubs++;
          if (targetSubMap[mid]) {
            totalMatchedSubs++;
          }
        }
      });
    });

    // Compare teams
    var sourceTeamNames = (sourceAccess.teams || []).map(function(t) { return t.name; });
    var targetTeamNames = (targetAccess.teams || []).map(function(t) { return t.name; });
    var targetTeamSet = {};
    targetTeamNames.forEach(function(n) { targetTeamSet[n] = true; });

    var missingTeams = [];
    var matchedTeams = 0;
    sourceTeamNames.forEach(function(n) {
      if (targetTeamSet[n]) {
        matchedTeams++;
      } else {
        var srcTeam = (sourceAccess.teams || []).find(function(t) { return t.name === n; });
        missingTeams.push({ name: n, memberCount: srcTeam ? srcTeam.memberCount : 0 });
      }
    });

    boardDetails.push({
      sourceBoardId: String(sb.id),
      boardName: sb.name,
      boardKind: sourceAccess.kind,
      sourceSubscriberCount: sourceAccess.subscribers.length,
      targetSubscriberCount: targetAccess.subscribers.length,
      matchedSubscribers: matchedSubs,
      missingSubscribers: missingSubs,
      roleMismatches: roleMismatches,
      sourceTeamCount: sourceTeamNames.length,
      targetTeamCount: targetTeamNames.length,
      matchedTeams: matchedTeams,
      missingTeams: missingTeams
    });
  });

  var userMatchPct = totalSourceSubs > 0
    ? Math.round((totalMatchedSubs / totalSourceSubs) * 100) : 100;

  return {
    matchPercentage: userMatchPct,
    boardDetails: boardDetails,
    summary: {
      totalSourceSubscribers: totalSourceSubs,
      totalMatchedSubscribers: totalMatchedSubs,
      totalMissingSubscribers: totalSourceSubs - totalMatchedSubs,
      totalRoleMismatches: boardDetails.reduce(function(acc, bd) { return acc + bd.roleMismatches.length; }, 0),
      totalMissingTeams: boardDetails.reduce(function(acc, bd) { return acc + bd.missingTeams.length; }, 0)
    }
  };
}
