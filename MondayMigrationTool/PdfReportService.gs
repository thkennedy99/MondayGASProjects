/**
 * PdfReportService.gs
 * Server-side PDF generation for validation reports using Google Docs.
 * No external libraries required — uses GAS DocumentApp to create a
 * formatted Google Doc, exports as PDF, and returns a download URL.
 */

/**
 * Generate a PDF validation report from report data.
 * Called from client via google.script.run.
 * @param {Object} reportData - The validation report object from compareWorkspaces()
 * @returns {Object} { success: true, url: string, fileName: string } or { success: false, error: string }
 */
function generateValidationPdf(reportData) {
  try {
    if (!reportData) throw new Error('No report data provided');

    var r = reportData;
    var dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var fileDate = new Date().toISOString().slice(0, 10);
    var fileName = 'Migration Validation Report - ' + fileDate;

    // Build styled HTML for the report
    var html = buildReportHtml(r, dateStr);

    // Create a temporary Google Doc from the HTML
    var blob = Utilities.newBlob(html, 'text/html', fileName + '.html');
    var tempFile = Drive.Files.insert(
      { title: fileName, mimeType: 'application/vnd.google-apps.document' },
      blob
    );
    var docId = tempFile.id;

    // Export the Google Doc as PDF
    var pdfBlob = DriveApp.getFileById(docId).getAs('application/pdf');
    pdfBlob.setName(fileName + '.pdf');

    // Save PDF to Drive (in the user's root)
    var pdfFile = DriveApp.createFile(pdfBlob);

    // Get download URL
    var downloadUrl = pdfFile.getDownloadUrl();

    // Clean up the temporary Google Doc
    DriveApp.getFileById(docId).setTrashed(true);

    return {
      success: true,
      url: downloadUrl,
      fileId: pdfFile.getId(),
      fileName: fileName + '.pdf'
    };

  } catch (error) {
    console.error('generateValidationPdf error:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Build a styled HTML string for the validation report.
 */
function buildReportHtml(r, dateStr) {
  var overall = r.matchPercentages.overall;
  var scoreColor = overall >= 90 ? '#198754' : overall >= 70 ? '#ff6900' : '#dc3545';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<style>';
  html += 'body { font-family: Arial, sans-serif; color: #212529; margin: 0; padding: 0; font-size: 11px; }';
  html += '.header { background: #034e6a; color: white; padding: 20px 30px; }';
  html += '.header h1 { margin: 0 0 4px 0; font-size: 22px; }';
  html += '.header .subtitle { font-size: 11px; opacity: 0.85; }';
  html += '.header .date { float: right; font-size: 11px; margin-top: -30px; }';
  html += '.accent { height: 3px; background: #1eb7df; }';
  html += '.content { padding: 20px 30px; }';
  html += '.ws-info { color: #6c757d; font-size: 10px; margin-bottom: 12px; }';
  html += '.score-box { background: #e7f1f5; border-radius: 6px; padding: 14px 20px; margin-bottom: 18px; display: flex; align-items: center; }';
  html += '.score-big { font-size: 32px; font-weight: bold; margin-right: 20px; }';
  html += '.score-label { font-size: 12px; color: #034e6a; font-weight: bold; }';
  html += '.cat-scores { display: flex; gap: 16px; margin-left: 30px; }';
  html += '.cat-score { text-align: center; }';
  html += '.cat-score .pct { font-size: 16px; font-weight: bold; }';
  html += '.cat-score .lbl { font-size: 9px; color: #6c757d; }';
  html += 'h2 { font-size: 14px; color: #034e6a; margin: 16px 0 6px 0; border-bottom: 1px solid #dee2e6; padding-bottom: 3px; }';
  html += 'h3 { font-size: 12px; color: #034e6a; margin: 12px 0 4px 0; }';
  html += 'table { border-collapse: collapse; width: 100%; margin-bottom: 12px; font-size: 10px; }';
  html += 'th { background: #034e6a; color: white; padding: 5px 8px; text-align: left; font-size: 9px; }';
  html += 'td { padding: 4px 8px; border-bottom: 1px solid #dee2e6; }';
  html += 'tr:nth-child(even) { background: #f5f8fa; }';
  html += '.match { color: #198754; font-weight: bold; }';
  html += '.miss { color: #dc3545; font-weight: bold; }';
  html += '.extra { color: #00739d; }';
  html += '.warn { color: #ff6900; font-weight: bold; }';
  html += '.badge-ok { background: #d1e7dd; color: #198754; padding: 2px 6px; border-radius: 3px; font-size: 9px; }';
  html += '.badge-err { background: #f8d7da; color: #dc3545; padding: 2px 6px; border-radius: 3px; font-size: 9px; }';
  html += '.badge-warn { background: #fff3cd; color: #ff6900; padding: 2px 6px; border-radius: 3px; font-size: 9px; }';
  html += '.badge-info { background: #cfe2ff; color: #00739d; padding: 2px 6px; border-radius: 3px; font-size: 9px; }';
  html += '.section-warn { background: #ff6900; color: white; padding: 6px 12px; font-weight: bold; font-size: 12px; margin: 14px 0 6px 0; }';
  html += '.section-blue { background: #00739d; color: white; padding: 6px 12px; font-weight: bold; font-size: 12px; margin: 14px 0 6px 0; }';
  html += '.stat-row { display: flex; gap: 10px; margin-bottom: 12px; }';
  html += '.stat-box { flex: 1; text-align: center; padding: 8px; border-radius: 4px; }';
  html += '.stat-box .val { font-size: 18px; font-weight: bold; }';
  html += '.stat-box .lbl { font-size: 8px; color: #6c757d; }';
  html += '.footer { border-top: 2px solid #1eb7df; margin-top: 20px; padding: 8px 30px; font-size: 8px; color: #6c757d; }';
  html += '</style></head><body>';

  // Header banner
  html += '<div class="header">';
  html += '<h1>Migration Validation Report</h1>';
  html += '<div class="subtitle">Guidewire Technology Alliances</div>';
  html += '<div class="date">' + dateStr + '</div>';
  html += '</div>';
  html += '<div class="accent"></div>';

  html += '<div class="content">';

  // Workspace info
  html += '<div class="ws-info">';
  html += 'SOURCE: ' + esc(r.source.workspaceName) + ' (ID: ' + esc(r.source.workspaceId) + ')<br>';
  html += 'TARGET: ' + esc(r.target.workspaceName) + ' (ID: ' + esc(r.target.workspaceId) + ')';
  html += '</div>';

  // Overall score
  html += '<div class="score-box">';
  html += '<div><div class="score-big" style="color:' + scoreColor + '">' + overall + '%</div>';
  html += '<div class="score-label">Overall Match</div></div>';
  html += '<div class="cat-scores">';
  var cats = [
    { label: 'Boards', pct: r.matchPercentages.boards },
    { label: 'Items', pct: r.matchPercentages.items },
    { label: 'Groups', pct: r.matchPercentages.groups },
    { label: 'Columns', pct: r.matchPercentages.columns }
  ];
  if (r.matchPercentages.documents != null) cats.push({ label: 'Docs', pct: r.matchPercentages.documents });
  if (r.matchPercentages.users != null) cats.push({ label: 'Users', pct: r.matchPercentages.users });
  for (var i = 0; i < cats.length; i++) {
    var c = cats[i];
    var col = c.pct >= 90 ? '#198754' : c.pct >= 70 ? '#ff6900' : '#dc3545';
    html += '<div class="cat-score"><div class="pct" style="color:' + col + '">' + c.pct + '%</div>';
    html += '<div class="lbl">' + c.label + '</div></div>';
  }
  html += '</div></div>';

  // Count comparison table
  html += '<h2>Count Comparison</h2>';
  html += '<table><tr><th>Metric</th><th>Source</th><th>Target</th><th>Status</th></tr>';
  var metrics = [
    { name: 'Boards', src: r.source.boardCount, tgt: r.target.boardCount },
    { name: 'Items', src: r.source.totalItems, tgt: r.target.totalItems },
    { name: 'Groups', src: r.source.totalGroups, tgt: r.target.totalGroups },
    { name: 'Columns', src: r.source.totalColumns, tgt: r.target.totalColumns },
    { name: 'Documents', src: r.source.totalDocuments || 0, tgt: r.target.totalDocuments || 0 },
    { name: 'Forms', src: r.source.totalForms || 0, tgt: r.target.totalForms || 0 }
  ];
  for (var i = 0; i < metrics.length; i++) {
    var m = metrics[i];
    var diff = m.tgt - m.src;
    var status = diff === 0 ? '<span class="match">Match</span>' :
                 '<span class="miss">' + (diff > 0 ? '+' : '') + diff + '</span>';
    html += '<tr><td><strong>' + m.name + '</strong></td><td>' + m.src + '</td><td>' + m.tgt + '</td><td>' + status + '</td></tr>';
  }
  html += '</table>';

  // Board-by-board comparison
  html += '<h2>Board-by-Board Comparison</h2>';
  html += '<table><tr><th>Board</th><th>Matched</th><th>Items (S/T)</th><th>Diff</th><th>Groups</th><th>Columns</th></tr>';
  for (var i = 0; i < r.boardComparisons.length; i++) {
    var bc = r.boardComparisons[i];
    var matchedStr = bc.matched ? '<span class="match">Yes</span>' : '<span class="miss">No</span>';
    var itemDiff = bc.items.match ? '<span class="match">OK</span>' :
                   '<span class="miss">' + (bc.items.diff > 0 ? '+' : '') + bc.items.diff + '</span>';
    var grpStr = bc.groups.matched + '/' + bc.groups.source;
    if (bc.groups.missing && bc.groups.missing.length > 0) grpStr += ' <span class="miss">(-' + bc.groups.missing.length + ')</span>';
    var colStr = bc.columns.matched + '/' + bc.columns.source;
    if (bc.columns.missing && bc.columns.missing.length > 0) colStr += ' <span class="miss">(-' + bc.columns.missing.length + ')</span>';
    if (bc.columns.extra && bc.columns.extra.length > 0) colStr += ' <span class="extra">(+' + bc.columns.extra.length + ')</span>';

    html += '<tr><td><strong>' + esc(bc.boardName) + '</strong></td><td>' + matchedStr + '</td>';
    html += '<td>' + bc.items.source + ' / ' + bc.items.target + '</td><td>' + itemDiff + '</td>';
    html += '<td>' + grpStr + '</td><td>' + colStr + '</td></tr>';
  }
  html += '</table>';

  // Discrepancy details
  var discrepancies = (r.boardComparisons || []).filter(function(bc) {
    return bc.matched && (
      (bc.groups.missing && bc.groups.missing.length > 0) ||
      (bc.columns.missing && bc.columns.missing.length > 0) ||
      (bc.columns.extra && bc.columns.extra.length > 0)
    );
  });
  if (discrepancies.length > 0) {
    html += '<div class="section-warn">Discrepancy Details</div>';
    for (var i = 0; i < discrepancies.length; i++) {
      var bc = discrepancies[i];
      html += '<h3>' + esc(bc.boardName) + '</h3>';
      if (bc.groups.missing && bc.groups.missing.length > 0) {
        html += '<div class="miss" style="font-size:10px;margin:2px 0">Missing groups: ' +
                bc.groups.missing.map(function(g) { return esc(g); }).join(', ') + '</div>';
      }
      if (bc.columns.missing && bc.columns.missing.length > 0) {
        html += '<div class="miss" style="font-size:10px;margin:2px 0">Missing columns: ' +
                bc.columns.missing.map(function(c) { return esc(c.title) + ' (' + esc(c.type) + ')'; }).join(', ') + '</div>';
      }
      if (bc.columns.extra && bc.columns.extra.length > 0) {
        html += '<div class="extra" style="font-size:10px;margin:2px 0">Extra in target: ' +
                bc.columns.extra.map(function(c) { return esc(c.title) + ' (' + esc(c.type) + ')'; }).join(', ') + '</div>';
      }
    }
  }

  // Unmatched/extra boards
  if (r.unmatchedBoards && r.unmatchedBoards.length > 0) {
    html += '<div class="badge-err" style="display:inline-block;margin:8px 0">Boards not found in target: ' +
            r.unmatchedBoards.map(function(b) { return esc(b); }).join(', ') + '</div><br>';
  }
  if (r.extraTargetBoards && r.extraTargetBoards.length > 0) {
    html += '<div class="badge-info" style="display:inline-block;margin:4px 0">Extra boards in target: ' +
            r.extraTargetBoards.map(function(b) { return esc(b); }).join(', ') + '</div><br>';
  }

  // Document & Form Comparison
  if (r.documentComparison || r.formComparison) {
    html += '<div class="section-blue">Documents & Forms</div>';

    // Documents
    if (r.documentComparison) {
      var dc = r.documentComparison;
      html += '<h3>Documents (' + dc.sourceCount + ' source / ' + dc.targetCount + ' target &mdash; ' + (dc.matched ? dc.matched.length : 0) + ' matched)</h3>';
      if (dc.missing && dc.missing.length > 0) {
        html += '<table><tr><th style="background:#dc3545">Missing Documents (' + dc.missing.length + ')</th><th style="background:#dc3545">Kind</th></tr>';
        for (var i = 0; i < dc.missing.length; i++) {
          html += '<tr><td class="miss">' + esc(dc.missing[i].name) + '</td><td>' + esc(dc.missing[i].kind) + '</td></tr>';
        }
        html += '</table>';
      }
      if (dc.extra && dc.extra.length > 0) {
        html += '<table><tr><th style="background:#00739d">Extra Documents in Target (' + dc.extra.length + ')</th><th style="background:#00739d">Kind</th></tr>';
        for (var i = 0; i < dc.extra.length; i++) {
          html += '<tr><td class="extra">' + esc(dc.extra[i].name) + '</td><td>' + esc(dc.extra[i].kind) + '</td></tr>';
        }
        html += '</table>';
      }
      if ((!dc.missing || dc.missing.length === 0) && (!dc.extra || dc.extra.length === 0)) {
        html += '<div class="badge-ok" style="display:inline-block;margin:4px 0">All documents matched.</div><br>';
      }
    }

    // Forms
    if (r.formComparison && (r.formComparison.sourceCount > 0 || r.formComparison.targetCount > 0)) {
      var fc = r.formComparison;
      html += '<h3>Forms (' + fc.sourceCount + ' source / ' + fc.targetCount + ' target &mdash; ' + (fc.matched ? fc.matched.length : 0) + ' matched)</h3>';
      if (fc.missing && fc.missing.length > 0) {
        html += '<table><tr><th style="background:#dc3545">Missing Forms (' + fc.missing.length + ')</th><th style="background:#dc3545">Board</th></tr>';
        for (var i = 0; i < fc.missing.length; i++) {
          html += '<tr><td class="miss">' + esc(fc.missing[i].name) + '</td><td>' + esc(fc.missing[i].board) + '</td></tr>';
        }
        html += '</table>';
      }
      if (fc.extra && fc.extra.length > 0) {
        html += '<table><tr><th style="background:#00739d">Extra Forms in Target (' + fc.extra.length + ')</th><th style="background:#00739d">Board</th></tr>';
        for (var i = 0; i < fc.extra.length; i++) {
          html += '<tr><td class="extra">' + esc(fc.extra[i].name) + '</td><td>' + esc(fc.extra[i].board) + '</td></tr>';
        }
        html += '</table>';
      }
      if ((!fc.missing || fc.missing.length === 0) && (!fc.extra || fc.extra.length === 0)) {
        html += '<div class="badge-ok" style="display:inline-block;margin:4px 0">All forms matched.</div><br>';
      }
    }
  }

  // User & Guest Verification
  if (r.userVerification) {
    var uv = r.userVerification;
    html += '<div class="section-blue">User & Guest Verification</div>';

    // Summary stats
    html += '<div class="stat-row">';
    var stats = [
      { lbl: 'Subscribers', val: uv.summary.totalSourceSubscribers, bg: '#e7f1f5', fg: '#034e6a' },
      { lbl: 'Matched', val: uv.summary.totalMatchedSubscribers, bg: '#d1e7dd', fg: '#198754' },
      { lbl: 'Missing', val: uv.summary.totalMissingSubscribers, bg: uv.summary.totalMissingSubscribers > 0 ? '#f8d7da' : '#d1e7dd', fg: uv.summary.totalMissingSubscribers > 0 ? '#dc3545' : '#198754' },
      { lbl: 'Role Issues', val: uv.summary.totalRoleMismatches, bg: uv.summary.totalRoleMismatches > 0 ? '#fff3cd' : '#d1e7dd', fg: uv.summary.totalRoleMismatches > 0 ? '#ff6900' : '#198754' },
      { lbl: 'Missing Teams', val: uv.summary.totalMissingTeams, bg: uv.summary.totalMissingTeams > 0 ? '#fff3cd' : '#d1e7dd', fg: uv.summary.totalMissingTeams > 0 ? '#ff6900' : '#198754' }
    ];
    for (var i = 0; i < stats.length; i++) {
      var s = stats[i];
      html += '<div class="stat-box" style="background:' + s.bg + '">';
      html += '<div class="val" style="color:' + s.fg + '">' + s.val + '</div>';
      html += '<div class="lbl">' + s.lbl + '</div></div>';
    }
    html += '</div>';

    // Missing subscribers table
    if (uv.summary.missingSubscribers && uv.summary.missingSubscribers.length > 0) {
      html += '<h3 class="miss">Missing Subscribers (' + uv.summary.missingSubscribers.length + ')</h3>';
      html += '<table><tr><th>Name</th><th>Email</th><th>Role</th><th>Boards</th></tr>';
      for (var i = 0; i < uv.summary.missingSubscribers.length; i++) {
        var u = uv.summary.missingSubscribers[i];
        var role = u.role === 'owner' ? 'Owner' : u.isGuest ? 'Guest' : 'Subscriber';
        html += '<tr><td><strong>' + esc(u.name) + '</strong></td><td>' + esc(u.email) + '</td>';
        html += '<td>' + role + '</td><td>' + (u.boards || []).map(function(b) { return esc(b); }).join(', ') + '</td></tr>';
      }
      html += '</table>';
    }

    // Role mismatches table
    if (uv.summary.roleMismatches && uv.summary.roleMismatches.length > 0) {
      html += '<h3 class="warn">Role Mismatches (' + uv.summary.roleMismatches.length + ')</h3>';
      html += '<table><tr><th>Name</th><th>Source Role</th><th>Target Role</th><th>Boards</th></tr>';
      for (var i = 0; i < uv.summary.roleMismatches.length; i++) {
        var u = uv.summary.roleMismatches[i];
        html += '<tr><td><strong>' + esc(u.name) + '</strong></td><td>' + esc(u.sourceRole) + '</td>';
        html += '<td>' + esc(u.targetRole) + '</td><td>' + (u.boards || []).map(function(b) { return esc(b); }).join(', ') + '</td></tr>';
      }
      html += '</table>';
    }

    // Per-board subscriber comparison
    if (uv.boardDetails && uv.boardDetails.length > 0) {
      html += '<h3>Per-Board Subscriber Comparison</h3>';
      html += '<table><tr><th>Board</th><th>Kind</th><th>Src</th><th>Tgt</th><th>Matched</th><th>Missing</th><th>Role Issues</th></tr>';
      for (var i = 0; i < uv.boardDetails.length; i++) {
        var bd = uv.boardDetails[i];
        var kind = bd.boardKind === 'public' ? 'Public' : bd.boardKind === 'share' ? 'Share' : 'Private';
        var missingNames = bd.missingSubscribers.length > 0 ?
          '<span class="miss">' + bd.missingSubscribers.map(function(u) { return esc(u.name); }).join(', ') + '</span>' : '-';
        var roleNames = bd.roleMismatches.length > 0 ?
          '<span class="warn">' + bd.roleMismatches.map(function(u) { return esc(u.name); }).join(', ') + '</span>' : '-';
        html += '<tr><td><strong>' + esc(bd.boardName) + '</strong></td><td>' + kind + '</td>';
        html += '<td>' + bd.sourceSubscriberCount + '</td><td>' + bd.targetSubscriberCount + '</td>';
        html += '<td>' + bd.matchedSubscribers + '/' + bd.sourceSubscriberCount + '</td>';
        html += '<td>' + missingNames + '</td><td>' + roleNames + '</td></tr>';
      }
      html += '</table>';
    }
  }

  // Footer
  html += '</div>'; // end content
  html += '<div class="footer">Guidewire Technology Alliances &nbsp;|&nbsp; Migration Validation Report &nbsp;|&nbsp; Generated: ' + dateStr + '</div>';
  html += '</body></html>';

  return html;
}

/** HTML-escape helper */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
