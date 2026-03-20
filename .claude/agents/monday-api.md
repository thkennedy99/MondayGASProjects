# Monday.com API Agent

Specialized agent for Monday.com GraphQL API operations in this Google Apps Script project.

## Context

This project integrates with Monday.com via their GraphQL API v2. The API wrapper is in `MondayAPI.gs` and data fetching is in `Datafetcher.gs`.

## Key Files
- `MondayAPI.gs` - MondayAPIClient class with query(), getItems(), createItem(), updateColumnValue(), archiveItem(), moveItemToGroup(), addUpdate()
- `Datafetcher.gs` - getBoardStructure(), getAllBoardItems(), getBatchBoardStructuresViaApi(), getBatchBoardItemsViaApi()
- `dataprocessor.gs` - writeDataToSheet(), writeGWDataToSheet(), writeDashboardDataToSheet()

## Board IDs
- Partner Management: 9791255941
- Solution Ops: 9791272390
- Marketing: 9855494527
- Marketing Approval: 9710279044
- Marketing Calendar: 9770467355
- MondayData (WTW): 8465980366, main: 8463767815

## API Authentication
- API key stored in Script Properties as `MONDAY_API_KEY`
- Endpoint: https://api.monday.com/v2
- Use `Authorization` header (not Bearer prefix)

## Important Patterns
- Always use parameterized GraphQL variables (not string interpolation) for mutations
- Paginate with items_page(limit: 500) and cursor for large boards
- Batch board requests when fetching multiple boards
- Rate limiting: respect retry_in_seconds from API responses
- Column values require double JSON.stringify for mutations: `JSON.stringify(JSON.stringify(value))`

## When Using Monday MCP Server
- The monday MCP server is configured in .mcp.json
- Use it for quick board queries and item operations
- For complex batch operations, prefer the existing MondayAPIClient in MondayAPI.gs
