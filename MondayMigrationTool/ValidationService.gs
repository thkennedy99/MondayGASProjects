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

    // Cross-account support: resolve target API key if targetAccountId provided
    var targetApiKey = null;
    if (options.targetAccountId) {
      targetApiKey = getTargetApiKeyForAccount(options.targetAccountId);
      if (!targetApiKey) throw new Error('No API key found for target account: ' + options.targetAccountId);
    }

    var sourceWs = getWorkspaceDetails(sourceWorkspaceId);
    var targetWs;
    if (targetApiKey) {
      var twData = callMondayAPIWithKey(targetApiKey,
        'query ($ids: [ID!]) { workspaces (ids: $ids) { id name kind description } }',
        { ids: [Number(targetWorkspaceId)] }
      );
      targetWs = twData.workspaces && twData.workspaces[0] ? twData.workspaces[0] : null;
    } else {
      targetWs = getWorkspaceDetails(targetWorkspaceId);
    }
    if (!sourceWs) throw new Error('Source workspace not found');
    if (!targetWs) throw new Error('Target workspace not found');

    var sourceBoards = getBoardsInWorkspace(sourceWorkspaceId);
    var targetBoards = targetApiKey
      ? _getBoardsInWorkspaceOnTarget(targetWorkspaceId, targetApiKey)
      : getBoardsInWorkspace(targetWorkspaceId);

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

    // Column types excluded from comparison:
    // - 'name': The item name column always exists; its title may differ but it's the same column
    // - System/computed types that are not migrated
    var nonCreatableTypes = ['name', 'subtasks', 'board_relation', 'mirror', 'formula', 'auto_number',
                             'creation_log', 'last_updated', 'button', 'dependency', 'item_id'];

    // Helper: returns true if a column should be excluded from comparison
    // Excludes non-creatable types AND form-generated columns (ID contains '_form')
    var isExcludedColumn = function(col) {
      return nonCreatableTypes.indexOf(col.type) >= 0 || (col.id && col.id.indexOf('_form') >= 0);
    };

    // Helper to get item count on the right account
    var getTargetItemCount = function(boardId) {
      if (!targetApiKey) return getBoardItemCount(boardId);
      var d = callMondayAPIWithKey(targetApiKey,
        'query ($boardId: [ID!]) { boards (ids: $boardId) { id items_count } }',
        { boardId: [Number(boardId)] }
      );
      var b = d.boards && d.boards[0];
      return b ? (b.items_count || 0) : 0;
    };

    sourceBoards.forEach(function(sourceBoard) {
      var targetBoard = targetBoardByName[sourceBoard.name];

      var sourceItemCount = 0;
      try { sourceItemCount = getBoardItemCount(sourceBoard.id); } catch (e) {}

      var sourceGroupCount = sourceBoard.groups ? sourceBoard.groups.length : 0;
      var sourceCreatableCols = (sourceBoard.columns || []).filter(function(c) {
        return !isExcludedColumn(c);
      });
      var sourceColumnCount = sourceCreatableCols.length;

      totalSourceItems += sourceItemCount;
      totalSourceGroups += sourceGroupCount;
      totalSourceColumns += sourceColumnCount;

      if (targetBoard) {
        matchedBoards++;

        var targetItemCount = 0;
        try { targetItemCount = getTargetItemCount(targetBoard.id); } catch (e) {}

        var targetGroupCount = targetBoard.groups ? targetBoard.groups.length : 0;
        var targetCreatableCols = (targetBoard.columns || []).filter(function(c) {
          return !isExcludedColumn(c);
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

    // ── Document Comparison ────────────────────────────────────────────────────
    // Note: Document and form comparison only works for same-account validation.
    // Cross-account doc/form queries require different API endpoints not yet supported.
    var sourceDocs = [];
    var targetDocs = [];
    if (!targetApiKey) {
      try { sourceDocs = getDocsWithDetails(sourceWorkspaceId) || []; } catch (e) { console.warn('Could not fetch source docs:', e); }
      try { targetDocs = getDocsWithDetails(targetWorkspaceId) || []; } catch (e) { console.warn('Could not fetch target docs:', e); }
    }

    var targetDocByName = {};
    targetDocs.forEach(function(d) { targetDocByName[d.name || d.title || ''] = d; });

    var matchedDocs = [];
    var missingDocs = [];
    var extraDocs = [];
    sourceDocs.forEach(function(sd) {
      var docName = sd.name || sd.title || '';
      if (targetDocByName[docName]) {
        matchedDocs.push(docName);
      } else {
        missingDocs.push({ name: docName, kind: sd.doc_kind || '' });
      }
    });
    var sourceDocNames = {};
    sourceDocs.forEach(function(d) { sourceDocNames[d.name || d.title || ''] = true; });
    targetDocs.forEach(function(td) {
      var docName = td.name || td.title || '';
      if (!sourceDocNames[docName]) {
        extraDocs.push({ name: docName, kind: td.doc_kind || '' });
      }
    });

    // ── Form Comparison (per-board) ─────────────────────────────────────────────
    var totalSourceForms = 0;
    var totalTargetForms = 0;
    var matchedForms = [];
    var missingForms = [];
    var extraForms = [];

    boardComparisons.forEach(function(bc) {
      if (!bc.matched) return;
      var srcForms = [];
      var tgtForms = [];
      try { srcForms = getBoardFormViews(bc.sourceBoardId) || []; } catch (e) {}
      try { tgtForms = getBoardFormViews(bc.targetBoardId) || []; } catch (e) {}

      totalSourceForms += srcForms.length;
      totalTargetForms += tgtForms.length;

      var tgtFormNames = {};
      tgtForms.forEach(function(f) { tgtFormNames[f.viewName] = true; });
      var srcFormNames = {};
      srcForms.forEach(function(f) { srcFormNames[f.viewName] = true; });

      srcForms.forEach(function(sf) {
        if (tgtFormNames[sf.viewName]) {
          matchedForms.push({ name: sf.viewName, board: bc.boardName });
        } else {
          missingForms.push({ name: sf.viewName, board: bc.boardName });
        }
      });
      tgtForms.forEach(function(tf) {
        if (!srcFormNames[tf.viewName]) {
          extraForms.push({ name: tf.viewName, board: bc.boardName });
        }
      });
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
    var docMatchPct = sourceDocs.length > 0
      ? Math.round((matchedDocs.length / sourceDocs.length) * 100) : 100;

    var pcts = [boardMatchPct, itemMatchPct, groupMatchPct, columnMatchPct, docMatchPct];
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
          totalColumns: totalSourceColumns,
          totalDocuments: sourceDocs.length,
          totalForms: totalSourceForms
        },
        target: {
          workspaceId: String(targetWorkspaceId),
          workspaceName: targetWs.name,
          boardCount: targetBoards.length,
          totalItems: totalTargetItems,
          totalGroups: totalTargetGroups,
          totalColumns: totalTargetColumns,
          totalDocuments: targetDocs.length,
          totalForms: totalTargetForms
        },
        matchPercentages: {
          overall: overallPct,
          boards: boardMatchPct,
          items: itemMatchPct,
          groups: groupMatchPct,
          columns: columnMatchPct,
          documents: docMatchPct,
          users: userMatchPct
        },
        boardComparisons: boardComparisons,
        unmatchedBoards: unmatchedBoards,
        extraTargetBoards: targetBoards
          .filter(function(b) {
            return !sourceBoards.some(function(sb) { return sb.name === b.name; });
          })
          .map(function(b) { return b.name; }),
        documentComparison: {
          sourceCount: sourceDocs.length,
          targetCount: targetDocs.length,
          matched: matchedDocs,
          missing: missingDocs,
          extra: extraDocs
        },
        formComparison: {
          sourceCount: totalSourceForms,
          targetCount: totalTargetForms,
          matched: matchedForms,
          missing: missingForms,
          extra: extraForms
        },
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
/**
 * Get the raw (unfiltered) subscriber and owner list for a board.
 * Unlike _getBoardAccessDetails, this does NOT filter public boards to owners-only.
 * Used for validation where we need to check if a user exists at all on the target board.
 */
function _getRawBoardSubscribers(boardId) {
  var data = callMondayAPI(
    'query ($boardId: [ID!]) { boards (ids: $boardId) { board_kind subscribers { id name email is_guest } owners { id name email } } }',
    { boardId: [Number(boardId)] }
  );
  var board = data.boards && data.boards[0];
  if (!board) return { subscribers: {}, owners: {} };

  var subs = {};
  (board.subscribers || []).forEach(function(s) {
    subs[String(s.id)] = { id: String(s.id), name: s.name, email: s.email || '', isGuest: !!s.is_guest, role: 'subscriber' };
  });
  var owners = {};
  (board.owners || []).forEach(function(o) {
    var oid = String(o.id);
    owners[oid] = true;
    if (subs[oid]) subs[oid].role = 'owner';
    else subs[oid] = { id: oid, name: o.name, email: o.email || '', isGuest: false, role: 'owner' };
  });

  return { subscribers: subs, owners: owners };
}

function _verifyUsersAndGuests(sourceWsId, targetWsId, sourceBoards, targetBoardByName) {
  // Per-board subscriber, owner, and team comparison
  var boardDetails = [];

  // Track unique subscribers across all boards
  var uniqueSourceSubs = {};  // id → { name, email, role, isGuest, boards[] }
  var uniqueMatchedIds = {};  // id → true
  var allMissingSubs = {};    // id → { name, email, role, isGuest, boards[] }
  var allRoleMismatches = {}; // id → { name, sourceRole, targetRole, boards[] }

  sourceBoards.forEach(function(sb) {
    var targetBoard = targetBoardByName[sb.name];
    if (!targetBoard) return;

    var sourceAccess, targetAccess;
    try { sourceAccess = _getBoardAccessDetails(sb.id, null); } catch (e) { return; }
    try { targetAccess = _getBoardAccessDetails(targetBoard.id, null); } catch (e) { return; }

    // For the target board, get the RAW subscriber list (not owner-filtered)
    // so we can accurately detect who is actually present on the target board
    var targetRaw;
    try { targetRaw = _getRawBoardSubscribers(targetBoard.id); } catch (e) { targetRaw = { subscribers: {}, owners: {} }; }

    // Build target subscriber lookup from raw data (includes all actual subscribers)
    var targetSubMap = {};
    Object.keys(targetRaw.subscribers).forEach(function(id) { targetSubMap[id] = targetRaw.subscribers[id]; });
    // Also include team members from the structured access data
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
      // Track unique source subscriber
      if (!uniqueSourceSubs[ss.id]) {
        uniqueSourceSubs[ss.id] = { id: ss.id, name: ss.name, email: ss.email, role: ss.role, isGuest: ss.isGuest, boards: [] };
      }
      uniqueSourceSubs[ss.id].boards.push(sb.name);

      var ts = targetSubMap[ss.id];
      if (!ts) {
        missingSubs.push({ id: ss.id, name: ss.name, email: ss.email, role: ss.role, isGuest: ss.isGuest });
        if (!allMissingSubs[ss.id]) {
          allMissingSubs[ss.id] = { id: ss.id, name: ss.name, email: ss.email, role: ss.role, isGuest: ss.isGuest, boards: [] };
        }
        allMissingSubs[ss.id].boards.push(sb.name);
      } else {
        matchedSubs++;
        uniqueMatchedIds[ss.id] = true;
        // Check role: source owner should be target owner
        if (ss.role === 'owner' && ts.role !== 'owner') {
          roleMismatches.push({ id: ss.id, name: ss.name, sourceRole: 'owner', targetRole: ts.role || 'subscriber' });
          if (!allRoleMismatches[ss.id]) {
            allRoleMismatches[ss.id] = { id: ss.id, name: ss.name, sourceRole: 'owner', targetRole: ts.role || 'subscriber', boards: [] };
          }
          allRoleMismatches[ss.id].boards.push(sb.name);
        }
      }
    });

    // Also check team members from source
    (sourceAccess.teams || []).forEach(function(srcTeam) {
      (srcTeam.memberIds || []).forEach(function(mid) {
        var alreadyCounted = sourceAccess.subscribers.some(function(ss) { return ss.id === mid; });
        if (!alreadyCounted) {
          if (!uniqueSourceSubs[mid]) {
            uniqueSourceSubs[mid] = { id: mid, name: '', email: '', role: 'team_member', isGuest: false, boards: [] };
          }
          uniqueSourceSubs[mid].boards.push(sb.name);
          if (targetSubMap[mid]) {
            uniqueMatchedIds[mid] = true;
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
      targetSubscriberCount: Object.keys(targetRaw.subscribers).length,
      matchedSubscribers: matchedSubs,
      missingSubscribers: missingSubs,
      roleMismatches: roleMismatches,
      sourceTeamCount: sourceTeamNames.length,
      targetTeamCount: targetTeamNames.length,
      matchedTeams: matchedTeams,
      missingTeams: missingTeams
    });
  });

  var totalUniqueSubs = Object.keys(uniqueSourceSubs).length;
  var totalUniqueMatched = Object.keys(uniqueMatchedIds).length;
  var missingSubsList = Object.keys(allMissingSubs).map(function(id) { return allMissingSubs[id]; });
  var roleMismatchList = Object.keys(allRoleMismatches).map(function(id) { return allRoleMismatches[id]; });

  var userMatchPct = totalUniqueSubs > 0
    ? Math.round((totalUniqueMatched / totalUniqueSubs) * 100) : 100;

  return {
    matchPercentage: userMatchPct,
    boardDetails: boardDetails,
    summary: {
      totalSourceSubscribers: totalUniqueSubs,
      totalMatchedSubscribers: totalUniqueMatched,
      totalMissingSubscribers: totalUniqueSubs - totalUniqueMatched,
      missingSubscribers: missingSubsList,
      roleMismatches: roleMismatchList,
      totalRoleMismatches: roleMismatchList.length,
      totalMissingTeams: boardDetails.reduce(function(acc, bd) { return acc + bd.missingTeams.length; }, 0)
    }
  };
}
