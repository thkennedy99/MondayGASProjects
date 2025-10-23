/**
 * DataFetcher.gs - Functions for fetching data from Monday.com
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
  
  console.log(`Board structure query for board ${boardId}:`, query);
  const response = makeApiRequest(query);
  
  if (!response.data || !response.data.boards || response.data.boards.length === 0) {
    throw new Error(`Board ${boardId} not found or no access to board`);
  }
  
  return response.data.boards[0];
}

/**
 * Get all items from the board with pagination
 */
function getAllBoardItems(boardId = BOARD_ID) {
  let allItems = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;
  
  console.log(`Starting to fetch all board items for board ${boardId}...`);
  
  while (hasMore && allItems.length < 200) { // Stop at 200 as a safety measure
    pageCount++;
    console.log(`\nFetching page ${pageCount} for board ${boardId}...`);
    
    // Query without subitems - using a smaller page size for better control
    const query = cursor ? 
      `query { next_items_page(cursor: "${cursor}", limit: 25) { cursor items { id name group { id title } column_values { id type text value } assets { id name url public_url } } } }` :
      `query { boards(ids: [${boardId}]) { items_page(limit: 25) { cursor items { id name group { id title } column_values { id type text value } assets { id name url public_url } } } } }`;
    
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
    
    // Add a small delay to avoid rate limiting
    Utilities.sleep(300);
  }
  
  console.log(`\n=== FINAL SUMMARY for Board ${boardId} ===`);
  console.log(`Total items retrieved: ${allItems.length}`);
  
  return allItems;
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
