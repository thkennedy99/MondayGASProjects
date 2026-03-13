/**
 * DataFetcher.gs - Functions for fetching data from Monday.com
 *
 * Uses batched API requests where possible to reduce the number of
 * individual API calls. Board structures are fetched in bulk, and
 * item pagination uses a larger page size (500) for efficiency.
 */

/**
 * Get board structure including columns and their types
 */
function getBoardStructure(boardId = BOARD_ID) {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        id
        name
        columns {
          id
          title
          type
          settings_str
        }
        groups {
          id
          title
        }
      }
    }
  `;

  console.log(`Board structure query for board ${boardId}`);
  const response = makeApiRequest(query);

  if (!response.data || !response.data.boards || response.data.boards.length === 0) {
    throw new Error(`Board ${boardId} not found or no access to board`);
  }

  return response.data.boards[0];
}

/**
 * Get board structures for multiple boards using batched API calls.
 * Chunks board IDs into groups of 10 to stay within complexity limits,
 * then fetches each chunk in a single API call. Reduces N calls to N/10.
 * @param {string[]} boardIds - Array of Monday.com board IDs
 * @returns {Object} Map of boardId -> board structure
 */
function getBatchBoardStructuresViaApi(boardIds) {
  if (!boardIds || boardIds.length === 0) return {};

  const CHUNK_SIZE = 10; // Monday.com complexity limits: ~10 boards per call is safe
  const structureMap = {};

  console.log(`Batch fetching board structures for ${boardIds.length} boards in chunks of ${CHUNK_SIZE}...`);

  for (let i = 0; i < boardIds.length; i += CHUNK_SIZE) {
    const chunk = boardIds.slice(i, i + CHUNK_SIZE);
    const idList = chunk.join(', ');
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(boardIds.length / CHUNK_SIZE);

    console.log(`Fetching board structure chunk ${chunkNum}/${totalChunks} (${chunk.length} boards)...`);

    const query = `
      query {
        boards(ids: [${idList}]) {
          id
          name
          columns {
            id
            title
            type
            settings_str
          }
          groups {
            id
            title
          }
        }
      }
    `;

    try {
      const response = makeApiRequest(query);
      if (response.data && response.data.boards) {
        response.data.boards.forEach(board => {
          structureMap[board.id] = board;
        });
      }
    } catch (error) {
      console.error(`Error fetching board structure chunk ${chunkNum}:`, error);
      // Continue with remaining chunks even if one fails
    }

    // Small delay between chunks to avoid complexity budget exhaustion
    if (i + CHUNK_SIZE < boardIds.length) {
      Utilities.sleep(500);
    }
  }

  console.log(`Batch board structures retrieved: ${Object.keys(structureMap).length}/${boardIds.length} boards`);
  return structureMap;
}

/**
 * Get all items from the board with cursor-based pagination.
 * Uses page size of 500 (matching MondayMigrationTool) for fewer API calls.
 * No artificial limits - fetches all items using cursor-based pagination.
 */
function getAllBoardItems(boardId = BOARD_ID) {
  let allItems = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;
  const MAX_ITEMS = 10000; // Safety limit to prevent infinite loops
  const PAGE_SIZE = 200; // Balanced page size: lower API complexity vs fewer calls

  console.log(`Starting to fetch all board items for board ${boardId} (pageSize=${PAGE_SIZE})...`);

  while (hasMore && allItems.length < MAX_ITEMS) {
    pageCount++;
    console.log(`\nFetching page ${pageCount} for board ${boardId}...`);

    // Query without subitems - using 500-item page size for efficiency
    const query = cursor ?
      `query { next_items_page(cursor: "${cursor}", limit: ${PAGE_SIZE}) { cursor items { id name group { id title } column_values { id type text value } assets { id name url public_url } } } }` :
      `query { boards(ids: [${boardId}]) { items_page(limit: ${PAGE_SIZE}) { cursor items { id name group { id title } column_values { id type text value } assets { id name url public_url } } } } }`;

    try {
      const response = makeApiRequest(query);

      let pageData;
      if (cursor) {
        if (!response.data || !response.data.next_items_page) {
          console.log('No next_items_page in response - end of pagination');
          hasMore = false;
          continue;
        }
        pageData = response.data.next_items_page;
      } else {
        if (!response.data || !response.data.boards || response.data.boards.length === 0) {
          console.log('No boards data in response');
          hasMore = false;
          continue;
        }
        pageData = response.data.boards[0].items_page;
      }

      if (pageData && pageData.items && pageData.items.length > 0) {
        const itemsInThisPage = pageData.items.length;

        // Log group distribution for this page
        const groupCounts = {};
        pageData.items.forEach(item => {
          const groupName = item.group ? item.group.title : 'No Group';
          groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
        });

        allItems = allItems.concat(pageData.items);
        console.log(`Page ${pageCount}: Retrieved ${itemsInThisPage} items. Total items so far: ${allItems.length}`);
        console.log(`Groups in this page:`, JSON.stringify(groupCounts));

        // Check if we have a cursor for next page
        if (pageData.cursor) {
          cursor = pageData.cursor;
          console.log('Cursor received for next page');
        } else {
          console.log('No cursor - this is the last page');
          hasMore = false;
        }
      } else {
        hasMore = false;
        console.log('No items in page - end of data');
      }
    } catch (error) {
      console.error(`Error fetching page ${pageCount} for board ${boardId}:`, error);
      throw error;
    }

    // Shorter delay between pages since we're fetching more per page
    Utilities.sleep(200);
  }

  console.log(`\n=== FINAL SUMMARY for Board ${boardId} ===`);
  console.log(`Total items retrieved: ${allItems.length} in ${pageCount} pages`);

  return allItems;
}

/**
 * Fetch items for multiple boards in sequence with cursor-based pagination.
 * Board structures should be pre-fetched via getBatchBoardStructuresViaApi().
 * @param {string[]} boardIds - Array of Monday.com board IDs
 * @returns {Object} Map of boardId -> items array
 */
function getBatchBoardItemsViaApi(boardIds) {
  if (!boardIds || boardIds.length === 0) return {};

  const itemsMap = {};
  console.log(`Batch fetching items for ${boardIds.length} boards...`);

  for (let i = 0; i < boardIds.length; i++) {
    const boardId = boardIds[i];
    try {
      itemsMap[boardId] = getAllBoardItems(boardId);
    } catch (error) {
      console.error(`Error fetching items for board ${boardId}:`, error);
      itemsMap[boardId] = [];
    }

    // Delay between boards to allow complexity budget to replenish
    if (i < boardIds.length - 1) {
      Utilities.sleep(1000);
    }
  }

  const totalItems = Object.values(itemsMap).reduce((sum, items) => sum + items.length, 0);
  console.log(`Batch items fetch complete: ${totalItems} total items across ${boardIds.length} boards`);
  return itemsMap;
}

/**
 * Alternative: Get all items without pagination (for boards with < 500 items)
 */
function getAllBoardItemsNoPagination(boardId = BOARD_ID) {
  console.log(`Fetching all items without pagination for board ${boardId}...`);

  const query = `
    query {
      boards(ids: [${boardId}]) {
        items_page(limit: 500) {
          items {
            id
            name
            group {
              id
              title
            }
            column_values {
              id
              type
              text
              value
            }
            assets {
              id
              name
              url
              public_url
            }
          }
        }
      }
    }
  `;

  try {
    const response = makeApiRequest(query);

    if (response.data && response.data.boards && response.data.boards[0]) {
      const items = response.data.boards[0].items_page.items || [];

      // Log group distribution
      const groupCounts = {};
      items.forEach(item => {
        const groupName = item.group ? item.group.title : 'No Group';
        groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
      });

      console.log(`Total items retrieved for board ${boardId}: ${items.length}`);
      console.log('Group distribution:', JSON.stringify(groupCounts, null, 2));

      return items;
    }

    return [];
  } catch (error) {
    console.error(`Error fetching items for board ${boardId}:`, error);
    throw error;
  }
}
