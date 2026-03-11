/**
 * DocumentMigrationService.gs - Document migration with Google Drive backup.
 *
 * Flow:
 *   1. Export each doc from source workspace as markdown
 *   2. Save markdown files to Google Drive (backup)
 *   3. Create new docs in target workspace
 *   4. Import markdown content into the new docs
 *
 * Drive folder structure:
 *   <ROOT_FOLDER>/
 *     <Migration_ID>_<Workspace_Name>/
 *       doc_<id>_<sanitized_name>.md
 *       doc_<id>_<sanitized_name>.md
 *       ...
 */

// Google Drive folder ID for document backups
var DRIVE_BACKUP_FOLDER_ID = '1FI25ARWCXE7UWwr8qIhmMsgKeTIxtPNm';

/**
 * Migrate documents from source workspace to target workspace with Drive backup.
 * Called from MigrationService.gs during the migration flow.
 *
 * @param {string} sourceWorkspaceId - Source workspace ID
 * @param {string} targetWorkspaceId - Target workspace ID
 * @param {string} migrationId - Migration tracking ID
 * @param {Function} progressCallback - Optional callback for progress updates
 * @param {string} targetApiKey - Optional API key for target account (cross-account migration)
 * @returns {Object} { success, docsTotal, docsMigrated, docsSkipped, driveFolder, docMapping, errors }
 */
function migrateDocuments(sourceWorkspaceId, targetWorkspaceId, migrationId, progressCallback, targetApiKey) {
  var errors = [];
  var docMapping = [];
  var docsMigrated = 0;
  var docsSkipped = 0;

  try {
    // 1. Get source docs
    if (progressCallback) progressCallback('Scanning documents in source workspace...');
    var sourceDocs = getDocsWithDetails(sourceWorkspaceId);

    if (!sourceDocs || sourceDocs.length === 0) {
      return {
        success: true,
        docsTotal: 0,
        docsMigrated: 0,
        docsSkipped: 0,
        driveFolder: null,
        docMapping: [],
        errors: []
      };
    }

    // 2. Create Drive backup folder
    if (progressCallback) progressCallback('Creating Google Drive backup folder...');
    var driveFolder = createMigrationBackupFolder(migrationId, sourceWorkspaceId);
    var driveFolderUrl = driveFolder.getUrl();

    // 3. Process each document
    for (var i = 0; i < sourceDocs.length; i++) {
      var doc = sourceDocs[i];
      var docName = doc.name || 'Untitled Document';

      if (progressCallback) {
        progressCallback('Document ' + (i + 1) + '/' + sourceDocs.length + ': ' + docName);
      }

      try {
        // 3a. Export as markdown
        var exportResult = exportDocAsMarkdown(doc.id);

        if (!exportResult || !exportResult.success) {
          var exportError = (exportResult && exportResult.error) || 'Export returned no data';
          errors.push({ docId: String(doc.id), docName: docName, stage: 'export', msg: exportError });
          docsSkipped++;
          continue;
        }

        var markdown = exportResult.markdown || '';

        if (!markdown.trim()) {
          // Empty doc — still create it but skip Drive backup of content
          docMapping.push({
            sourceDocId: String(doc.id),
            sourceDocName: docName,
            targetDocId: null,
            targetDocName: docName,
            driveFileId: null,
            status: 'empty',
            note: 'Document was empty — created as empty doc in target'
          });

          // Create empty doc in target
          try {
            var emptyDoc = createDocOnTarget(targetApiKey, targetWorkspaceId, docName, doc.doc_kind || 'public');
            docMapping[docMapping.length - 1].targetDocId = String(emptyDoc.id);
            docMapping[docMapping.length - 1].status = 'migrated_empty';
            docsMigrated++;
          } catch (createErr) {
            errors.push({ docId: String(doc.id), docName: docName, stage: 'create_empty', msg: createErr.toString() });
            docMapping[docMapping.length - 1].status = 'error';
            docsSkipped++;
          }

          Utilities.sleep(200);
          continue;
        }

        // 3b. Save to Google Drive
        var driveFile = saveMarkdownToDrive(driveFolder, doc.id, docName, markdown);

        // 3c. Create new doc in target workspace
        var newDoc = createDocOnTarget(targetApiKey, targetWorkspaceId, docName, doc.doc_kind || 'public');
        Utilities.sleep(300);

        // 3d. Import markdown content into new doc
        var importResult = addMarkdownToDocOnTarget(targetApiKey, newDoc.id, markdown);

        docMapping.push({
          sourceDocId: String(doc.id),
          sourceDocName: docName,
          targetDocId: String(newDoc.id),
          targetDocName: docName,
          driveFileId: driveFile.getId(),
          driveFileUrl: driveFile.getUrl(),
          status: 'migrated',
          blocksCreated: (importResult && importResult.block_ids) ? importResult.block_ids.length : 0
        });

        docsMigrated++;
        Utilities.sleep(300);

      } catch (docError) {
        console.error('Failed to migrate document "' + docName + '":', docError);
        errors.push({ docId: String(doc.id), docName: docName, stage: 'migration', msg: docError.toString() });
        docsSkipped++;
      }
    }

    return {
      success: true,
      docsTotal: sourceDocs.length,
      docsMigrated: docsMigrated,
      docsSkipped: docsSkipped,
      driveFolder: {
        id: driveFolder.getId(),
        url: driveFolderUrl,
        name: driveFolder.getName()
      },
      docMapping: docMapping,
      errors: errors
    };

  } catch (error) {
    console.error('Document migration failed:', error);
    return {
      success: false,
      docsTotal: 0,
      docsMigrated: docsMigrated,
      docsSkipped: docsSkipped,
      driveFolder: null,
      docMapping: docMapping,
      errors: errors.concat([{ docId: '', docName: '', stage: 'init', msg: error.toString() }])
    };
  }
}

/**
 * Create a subfolder in the Drive backup folder for this migration.
 * @param {string} migrationId - Migration ID
 * @param {string} workspaceId - Source workspace ID (for naming)
 * @returns {Folder} Google Drive Folder object
 */
function createMigrationBackupFolder(migrationId, workspaceId) {
  var rootFolder = DriveApp.getFolderById(DRIVE_BACKUP_FOLDER_ID);

  // Get workspace name for the folder
  var wsName = '';
  try {
    var ws = getWorkspaceDetails(workspaceId);
    wsName = ws ? ws.name : workspaceId;
  } catch (e) {
    wsName = workspaceId;
  }

  var folderName = sanitizeFileName(migrationId + '_' + wsName);
  var folder = rootFolder.createFolder(folderName);

  // Add a README file with migration metadata
  var readme = 'Migration Document Backup\n' +
    '========================\n\n' +
    'Migration ID: ' + migrationId + '\n' +
    'Source Workspace: ' + wsName + ' (ID: ' + workspaceId + ')\n' +
    'Backup Date: ' + new Date().toISOString() + '\n' +
    'User: ' + Session.getActiveUser().getEmail() + '\n\n' +
    'This folder contains markdown exports of all documents from the source workspace.\n' +
    'These files serve as a backup and can be used to manually recreate documents if needed.\n';

  folder.createFile('_README.txt', readme, MimeType.PLAIN_TEXT);

  return folder;
}

/**
 * Save markdown content as a .md file in the Drive backup folder.
 * @param {Folder} folder - Google Drive folder
 * @param {string} docId - Source document ID
 * @param {string} docName - Document name
 * @param {string} markdown - Markdown content
 * @returns {File} Google Drive File object
 */
function saveMarkdownToDrive(folder, docId, docName, markdown) {
  var fileName = sanitizeFileName('doc_' + docId + '_' + docName) + '.md';

  // Add metadata header to the markdown
  var header = '<!-- Monday.com Document Backup -->\n' +
    '<!-- Source Doc ID: ' + docId + ' -->\n' +
    '<!-- Original Name: ' + docName + ' -->\n' +
    '<!-- Exported: ' + new Date().toISOString() + ' -->\n\n';

  var file = folder.createFile(fileName, header + markdown, MimeType.PLAIN_TEXT);
  return file;
}

/**
 * Sanitize a string for use as a file/folder name.
 * @param {string} name - Raw name
 * @returns {string} Sanitized name safe for Drive
 */
function sanitizeFileName(name) {
  return name
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}

/**
 * Test document migration with a dry run — export docs and check sizes without creating anything.
 * Called during testMigration to provide doc details in the plan.
 *
 * @param {string} workspaceId - Source workspace ID
 * @returns {Object} { docs: [...], totalSize, exportable }
 */
function analyzeDocumentsForMigration(workspaceId) {
  var docs = getDocsWithDetails(workspaceId);
  var analysis = {
    docs: [],
    totalCount: docs.length,
    exportableCount: 0,
    emptyCount: 0,
    errorCount: 0,
    totalMarkdownSize: 0
  };

  docs.forEach(function(doc) {
    var info = {
      id: String(doc.id),
      name: doc.name || 'Untitled',
      kind: doc.doc_kind || 'public',
      createdAt: doc.created_at,
      exportable: false,
      markdownSize: 0,
      error: null
    };

    try {
      var exported = exportDocAsMarkdown(doc.id);
      if (exported && exported.success && exported.markdown) {
        info.exportable = true;
        info.markdownSize = exported.markdown.length;
        analysis.exportableCount++;
        analysis.totalMarkdownSize += exported.markdown.length;

        if (!exported.markdown.trim()) {
          info.exportable = true;
          analysis.emptyCount++;
        }
      } else {
        info.error = (exported && exported.error) || 'Export failed';
        analysis.errorCount++;
      }
    } catch (e) {
      info.error = e.toString();
      analysis.errorCount++;
    }

    analysis.docs.push(info);
    Utilities.sleep(200); // Rate limiting
  });

  return analysis;
}

/**
 * Standalone function to backup all workspace documents to Drive without migration.
 * Can be called independently from the UI.
 *
 * @param {string} workspaceId - Workspace ID to backup
 * @returns {Object} { success, backupFolder, docsBackedUp, errors }
 */
function backupWorkspaceDocsToDrive(workspaceId) {
  try {
    if (!workspaceId) throw new Error('workspaceId is required');

    var backupId = 'backup_' + Utilities.getUuid().replace(/-/g, '').substring(0, 8);
    var folder = createMigrationBackupFolder(backupId, workspaceId);
    var docs = getDocsWithDetails(workspaceId);
    var backedUp = 0;
    var errors = [];

    docs.forEach(function(doc) {
      try {
        var exported = exportDocAsMarkdown(doc.id);
        if (exported && exported.success && exported.markdown) {
          saveMarkdownToDrive(folder, doc.id, doc.name || 'Untitled', exported.markdown);
          backedUp++;
        }
      } catch (e) {
        errors.push({ docId: String(doc.id), docName: doc.name, msg: e.toString() });
      }
      Utilities.sleep(200);
    });

    return safeReturn({
      success: true,
      backupFolder: {
        id: folder.getId(),
        url: folder.getUrl(),
        name: folder.getName()
      },
      docsTotal: docs.length,
      docsBackedUp: backedUp,
      errors: errors
    });

  } catch (error) {
    return handleError('backupWorkspaceDocsToDrive', error);
  }
}
