/**
 * DocumentFetcher.gs - Functions for fetching documents from Monday.com
 */

/**
 * Parse Monday.com link to extract board and item IDs
 */
function parseMondayLink(link) {
  // Monday.com links typically have formats like:
  // https://[account].monday.com/boards/[board_id]/pulses/[item_id]
  // https://[account].monday.com/boards/[board_id]?pulseIds=[item_id]
  // https://[account].monday.com/boards/[board_id]?itemIds=[item_id]
  
  const patterns = [
    /boards\/(\d+)\/pulses\/(\d+)/,
    /boards\/(\d+).*pulseIds=(\d+)/,
    /boards\/(\d+).*itemIds=(\d+)/
  ];
  
  for (const pattern of patterns) {
    const match = link.match(pattern);
    if (match) {
      return {
        boardId: match[1],
        itemId: match[2]
      };
    }
  }
  
  // Try to extract just board ID if no item ID found
  const boardMatch = link.match(/boards\/(\d+)/);
  if (boardMatch) {
    return {
      boardId: boardMatch[1],
      itemId: null
    };
  }
  
  return null;
}

/**
 * Fetch item data including file columns with proper authentication
 */
function fetchItemWithFiles(boardId, itemId) {
  const query = `
    query {
      items(ids: [${itemId}]) {
        id
        name
        board {
          id
          name
        }
        column_values {
          id
          type
          title
          value
          text
        }
        assets {
          id
          name
          url
          public_url
        }
      }
    }
  `;
  
  console.log('Fetching item with files...');
  const response = makeApiRequest(query);
  
  if (!response.data || !response.data.items || response.data.items.length === 0) {
    throw new Error('Item not found');
  }
  
  const item = response.data.items[0];
  const files = [];
  
  // Extract all files from file columns
  item.column_values.forEach(column => {
    if (column.type === 'file' && column.value) {
      try {
        const parsed = JSON.parse(column.value);
        if (parsed.files) {
          parsed.files.forEach(file => {
            // For ASSET type files, find the matching asset
            if (file.fileType === 'ASSET' && file.assetId) {
              const asset = item.assets.find(a => a.id == file.assetId);
              if (asset) {
                files.push({
                  columnTitle: column.title,
                  columnId: column.id,
                  name: file.name || asset.name,
                  id: asset.id, // This is the asset ID we'll use for downloading
                  url: asset.url,
                  publicUrl: asset.public_url,
                  fileType: 'ASSET'
                });
              }
            }
            // For LINK type files, use the link directly
            else if (file.fileType === 'LINK' && file.linkToFile) {
              files.push({
                columnTitle: column.title,
                columnId: column.id,
                name: file.name,
                url: file.linkToFile,
                publicUrl: file.linkToFile,
                fileType: 'LINK'
              });
            }
          });
        }
      } catch (e) {
        console.log('Error parsing file column:', e);
      }
    }
  });
  
  return {
    itemId: item.id,
    itemName: item.name,
    boardId: item.board.id,
    boardName: item.board.name,
    files: files
  };
}

/**
 * Process the Monday.com document link
 */
function processMondayDocumentLink(link) {
  try {
    console.log('Processing Monday.com link:', link);
    
    // Check if it's a direct file URL
    if (link.includes('/protected_static/') || link.includes('files-monday-com.s3.amazonaws.com')) {
      // Handle direct file URL
      console.log('Direct file URL detected');
      
      // Extract filename from URL
      let fileName = 'document';
      const urlParts = link.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      if (lastPart) {
        fileName = decodeURIComponent(lastPart.split('?')[0]);
      }
      
      // Try to extract asset ID from URL
      let assetId = null;
      const assetMatch = link.match(/resources\/(\d+)\//);
      if (assetMatch) {
        assetId = assetMatch[1];
        console.log('Extracted asset ID from URL:', assetId);
      }
      
      // Create a file object
      const itemData = {
        itemName: 'Direct File Download',
        boardName: 'N/A',
        files: [{
          name: fileName,
          id: assetId, // Asset ID if we found it
          url: link,
          publicUrl: link,
          fileType: assetId ? 'ASSET' : 'PUBLIC',
          columnTitle: 'Direct Link'
        }]
      };
      
      showDocumentListModal(itemData);
      return;
    }
    
    // Otherwise, try to parse as Monday.com item link
    const linkInfo = parseMondayLink(link);
    if (!linkInfo) {
      throw new Error('Invalid Monday.com link format. Please use either an item link or direct file URL.');
    }
    
    console.log('Extracted info:', linkInfo);
    
    // Fetch the item data including file column
    const itemData = fetchItemWithFiles(linkInfo.boardId, linkInfo.itemId);
    
    // Process and display the files
    if (itemData && itemData.files && itemData.files.length > 0) {
      showDocumentListModal(itemData);
    } else {
      throw new Error('No documents found for this item');
    }
    
  } catch (error) {
    console.error('Error processing document link:', error);
    throw error;
  }
}

/**
 * Fetch documents from column T for all items
 */
function fetchAllDocumentsFromColumnT() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TAB_NAME);
    if (!sheet) {
      throw new Error('MondayData sheet not found. Please sync data first.');
    }
    
    // Find column T (should be column 20)
    const columnTIndex = 20; // Column T
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) {
      throw new Error('No data found in sheet');
    }
    
    // Get all values from column T and column A in batch operations
    const columnTValues = sheet.getRange(2, columnTIndex, lastRow - 1, 1).getValues();
    const columnAValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues(); // Batch read of item names
    const documents = [];

    columnTValues.forEach((row, index) => {
      const link = row[0];
      if (link && link.toString().includes('monday.com')) {
        const itemName = columnAValues[index][0]; // Use pre-fetched value
        documents.push({
          row: index + 2,
          itemName: itemName,
          link: link
        });
      }
    });
    
    console.log(`Found ${documents.length} Monday.com links in column T`);
    return documents;
    
  } catch (error) {
    console.error('Error fetching documents from column T:', error);
    throw error;
  }
}

/**
 * Helper function to get file icon
 */
function getFileIcon(extension) {
  const icons = {
    pdf: '📄',
    doc: '📝',
    docx: '📝',
    xls: '📊',
    xlsx: '📊',
    ppt: '📽️',
    pptx: '📽️',
    jpg: '🖼️',
    jpeg: '🖼️',
    png: '🖼️',
    gif: '🖼️',
    zip: '🗜️',
    rar: '🗜️',
    txt: '📃',
    csv: '📊'
  };
  return icons[extension.toLowerCase()] || '📎';
}
