/**
 * BoardAudit.gs - Diagnostic functions to capture Monday.com board structures
 * Run each function from the Apps Script editor and check Execution Log for output.
 *
 * Functions to run (in this order):
 *   1. auditAllGWBoards()
 *   2. auditMarketingBoards()
 *   3. auditPartnerBoards()
 *   4. auditDashboardSheet()
 */


// ============================================================
// 1. AUDIT ALL GW INTERNAL BOARDS
//    Captures structure + groups for all 4 GW boards
// ============================================================
function auditAllGWBoards() {
  const boards = [
    { id: GW_BOARD_1_ID, label: 'GW Board 1 - Partner Management Activities' },
    { id: GW_BOARD_2_ID, label: 'GW Board 2 - Tech Ops Activities' },
    { id: GW_BOARD_3_ID, label: 'GW Board 3 - Marketing Activities' },
    { id: GW_BOARD_4_ID, label: 'GW Board 4 - Marketplace Activities' }
  ];

  boards.forEach(function(board) {
    console.log('\n' + '='.repeat(70));
    console.log(board.label + '  (ID: ' + board.id + ')');
    console.log('='.repeat(70));

    try {
      var structure = getBoardStructure(board.id);

      console.log('Board Name (from Monday): ' + structure.name);

      // Groups
      console.log('\nGROUPS:');
      if (structure.groups && structure.groups.length > 0) {
        structure.groups.forEach(function(g) {
          console.log('  - ' + g.title + '  (id: ' + g.id + ')');
        });
      } else {
        console.log('  (none)');
      }

      // Columns
      console.log('\nCOLUMNS (' + structure.columns.length + ' total):');
      structure.columns.forEach(function(col) {
        var settings = '';
        if (col.type === 'color' || col.type === 'status') {
          try {
            var parsed = JSON.parse(col.settings_str);
            if (parsed.labels) {
              var labelList = Object.entries(parsed.labels)
                .map(function(entry) { return entry[0] + '=' + entry[1]; })
                .join(', ');
              settings = '  Labels: [' + labelList + ']';
            }
          } catch (e) { /* ignore parse errors */ }
        }
        if (col.type === 'dropdown') {
          try {
            var parsed = JSON.parse(col.settings_str);
            if (parsed.labels) {
              var labelList = parsed.labels
                .map(function(l) { return l.name; })
                .join(', ');
              settings = '  Options: [' + labelList + ']';
            }
          } catch (e) { /* ignore */ }
        }
        console.log('  ' + col.id + ' | ' + col.title + ' | ' + col.type + settings);
      });

    } catch (err) {
      console.error('ERROR fetching board ' + board.id + ': ' + err.toString());
    }
  });

  console.log('\n\nDONE - GW Board audit complete');
}


// ============================================================
// 2. AUDIT MARKETING BOARDS
//    Captures structure + groups for all 3 marketing boards
// ============================================================
function auditMarketingBoards() {
  const boards = [
    { id: MARKETING_APPROVAL_BOARD_ID, label: 'Marketing Event Approval Requests' },
    { id: MARKETING_CALENDAR_BOARD_ID, label: 'Marketing Event Calendar' },
    { id: APPROVALS_2026_BOARD_ID, label: '2026 Approvals' }
  ];

  boards.forEach(function(board) {
    console.log('\n' + '='.repeat(70));
    console.log(board.label + '  (ID: ' + board.id + ')');
    console.log('='.repeat(70));

    try {
      var structure = getBoardStructure(board.id);

      console.log('Board Name (from Monday): ' + structure.name);

      // Groups
      console.log('\nGROUPS:');
      if (structure.groups && structure.groups.length > 0) {
        structure.groups.forEach(function(g) {
          console.log('  - ' + g.title + '  (id: ' + g.id + ')');
        });
      } else {
        console.log('  (none)');
      }

      // Columns with status labels
      console.log('\nCOLUMNS (' + structure.columns.length + ' total):');
      structure.columns.forEach(function(col) {
        var settings = '';
        if (col.type === 'color' || col.type === 'status') {
          try {
            var parsed = JSON.parse(col.settings_str);
            if (parsed.labels) {
              var labelList = Object.entries(parsed.labels)
                .map(function(entry) { return entry[0] + '=' + entry[1]; })
                .join(', ');
              settings = '  Labels: [' + labelList + ']';
            }
          } catch (e) { /* ignore */ }
        }
        if (col.type === 'dropdown') {
          try {
            var parsed = JSON.parse(col.settings_str);
            if (parsed.labels) {
              var labelList = parsed.labels
                .map(function(l) { return l.name; })
                .join(', ');
              settings = '  Options: [' + labelList + ']';
            }
          } catch (e) { /* ignore */ }
        }
        console.log('  ' + col.id + ' | ' + col.title + ' | ' + col.type + settings);
      });

    } catch (err) {
      console.error('ERROR fetching board ' + board.id + ': ' + err.toString());
    }
  });

  console.log('\n\nDONE - Marketing board audit complete');
}


// ============================================================
// 3. AUDIT PARTNER BOARDS
//    Reads MondayDashboard sheet to discover all partner boards,
//    then fetches structure + groups for each one
// ============================================================
function auditPartnerBoards() {
  // First, read the dashboard sheet to find all partner board IDs
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var dashSheet = ss.getSheetByName('MondayDashboard');

  if (!dashSheet) {
    console.log('MondayDashboard sheet not found. Falling back to known board IDs.');
    var partnerBoardIds = [
      { id: BOARD_ID, label: 'Main Partner Board (fallback)' }
    ];
  } else {
    var data = dashSheet.getDataRange().getValues();
    var headers = data[0];

    console.log('MondayDashboard Headers: ' + JSON.stringify(headers));
    console.log('MondayDashboard Rows: ' + (data.length - 1));
    console.log('\nFull Dashboard Contents:');

    for (var r = 0; r < data.length; r++) {
      console.log('  Row ' + r + ': ' + JSON.stringify(data[r]));
    }

    // Find boardId column
    var boardIdCol = headers.indexOf('Board ID');
    if (boardIdCol === -1) boardIdCol = headers.indexOf('boardId');
    if (boardIdCol === -1) boardIdCol = headers.indexOf('BoardID');

    var boardNameCol = headers.indexOf('Board Name');
    if (boardNameCol === -1) boardNameCol = headers.indexOf('boardName');
    if (boardNameCol === -1) boardNameCol = headers.indexOf('BoardName');

    var partnerNameCol = headers.indexOf('Partner Name');
    if (partnerNameCol === -1) partnerNameCol = headers.indexOf('partnerName');
    if (partnerNameCol === -1) partnerNameCol = headers.indexOf('PartnerName');

    console.log('\nColumn indices - BoardID: ' + boardIdCol + ', BoardName: ' + boardNameCol + ', PartnerName: ' + partnerNameCol);

    var partnerBoardIds = [];
    var seenIds = {};

    for (var i = 1; i < data.length; i++) {
      var bid = boardIdCol >= 0 ? String(data[i][boardIdCol]).trim() : '';
      var bname = boardNameCol >= 0 ? String(data[i][boardNameCol]).trim() : '';
      var pname = partnerNameCol >= 0 ? String(data[i][partnerNameCol]).trim() : '';

      if (bid && bid !== '' && bid !== 'undefined' && !seenIds[bid]) {
        seenIds[bid] = true;
        partnerBoardIds.push({
          id: bid,
          label: bname + (pname ? ' (' + pname + ')' : '')
        });
      }
    }
  }

  console.log('\n\nDiscovered ' + partnerBoardIds.length + ' partner board(s):');
  partnerBoardIds.forEach(function(b) {
    console.log('  ' + b.id + ' - ' + b.label);
  });

  // Now fetch structure for each partner board
  partnerBoardIds.forEach(function(board) {
    console.log('\n' + '='.repeat(70));
    console.log(board.label + '  (ID: ' + board.id + ')');
    console.log('='.repeat(70));

    try {
      var structure = getBoardStructure(board.id);

      console.log('Board Name (from Monday): ' + structure.name);

      // Groups (these often represent partner categories or activity areas)
      console.log('\nGROUPS:');
      if (structure.groups && structure.groups.length > 0) {
        structure.groups.forEach(function(g) {
          console.log('  - ' + g.title + '  (id: ' + g.id + ')');
        });
      } else {
        console.log('  (none)');
      }

      // Columns
      console.log('\nCOLUMNS (' + structure.columns.length + ' total):');
      structure.columns.forEach(function(col) {
        var settings = '';
        if (col.type === 'color' || col.type === 'status') {
          try {
            var parsed = JSON.parse(col.settings_str);
            if (parsed.labels) {
              var labelList = Object.entries(parsed.labels)
                .map(function(entry) { return entry[0] + '=' + entry[1]; })
                .join(', ');
              settings = '  Labels: [' + labelList + ']';
            }
          } catch (e) { /* ignore */ }
        }
        if (col.type === 'dropdown') {
          try {
            var parsed = JSON.parse(col.settings_str);
            if (parsed.labels) {
              var labelList = parsed.labels
                .map(function(l) { return l.name; })
                .join(', ');
              settings = '  Options: [' + labelList + ']';
            }
          } catch (e) { /* ignore */ }
        }
        console.log('  ' + col.id + ' | ' + col.title + ' | ' + col.type + settings);
      });

    } catch (err) {
      console.error('ERROR fetching board ' + board.id + ': ' + err.toString());
    }
  });

  // Also audit the Dashboard board itself
  console.log('\n' + '='.repeat(70));
  console.log('DASHBOARD BOARD  (ID: ' + DASHBOARD_BOARD_ID + ')');
  console.log('='.repeat(70));

  try {
    var dashStructure = getBoardStructure(DASHBOARD_BOARD_ID);
    console.log('Board Name (from Monday): ' + dashStructure.name);

    console.log('\nGROUPS:');
    if (dashStructure.groups && dashStructure.groups.length > 0) {
      dashStructure.groups.forEach(function(g) {
        console.log('  - ' + g.title + '  (id: ' + g.id + ')');
      });
    }

    console.log('\nCOLUMNS (' + dashStructure.columns.length + ' total):');
    dashStructure.columns.forEach(function(col) {
      console.log('  ' + col.id + ' | ' + col.title + ' | ' + col.type);
    });

  } catch (err) {
    console.error('ERROR fetching dashboard board: ' + err.toString());
  }

  console.log('\n\nDONE - Partner board audit complete');
}


// ============================================================
// 4. AUDIT DASHBOARD SHEET (Supplementary)
//    Reads PartnerTranslate and any config sheets
// ============================================================
function auditDashboardSheet() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // List all sheet names
  var sheets = ss.getSheets();
  console.log('ALL SHEETS IN SPREADSHEET:');
  sheets.forEach(function(s) {
    console.log('  - ' + s.getName() + '  (' + s.getLastRow() + ' rows, ' + s.getLastColumn() + ' cols)');
  });

  // Read PartnerTranslate sheet
  console.log('\n' + '='.repeat(70));
  console.log('PARTNER TRANSLATE SHEET');
  console.log('='.repeat(70));

  var ptSheet = ss.getSheetByName('PartnerTranslate');
  if (ptSheet) {
    var ptData = ptSheet.getDataRange().getValues();
    console.log('Headers: ' + JSON.stringify(ptData[0]));
    console.log('Rows: ' + (ptData.length - 1));
    for (var i = 0; i < ptData.length; i++) {
      console.log('  Row ' + i + ': ' + JSON.stringify(ptData[i]));
    }
  } else {
    console.log('  (sheet not found)');
  }

  // Read Managers/Authorization sheet if it exists
  console.log('\n' + '='.repeat(70));
  console.log('MANAGER AUTHORIZATION');
  console.log('='.repeat(70));

  var mgSheet = ss.getSheetByName('Managers');
  if (!mgSheet) mgSheet = ss.getSheetByName('Authorization');
  if (!mgSheet) mgSheet = ss.getSheetByName('Auth');

  if (mgSheet) {
    var mgData = mgSheet.getDataRange().getValues();
    console.log('Sheet Name: ' + mgSheet.getName());
    console.log('Headers: ' + JSON.stringify(mgData[0]));
    console.log('Rows: ' + (mgData.length - 1));
    // Just show headers and row count for privacy
    console.log('(Row data omitted for privacy - contains email addresses)');
  } else {
    console.log('  (sheet not found - tried Managers, Authorization, Auth)');
  }

  console.log('\n\nDONE - Dashboard sheet audit complete');
}
