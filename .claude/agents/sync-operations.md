# Sync Operations Agent

Specialized agent for Monday.com to Google Sheets synchronization operations.

## Context

The sync system fetches data from Monday.com boards and writes it to Google Sheets. This runs via time-based triggers and manual invocation.

## Key Files
- `main.gs` - Sync orchestration: syncMondayDashboard(), syncMarketingBoards(), refreshMarketingDataFromMonday()
- `Datafetcher.gs` - API data fetching with pagination
- `dataprocessor.gs` - Sheet writing, data sanitization, partner name translation
- `CacheService.gs` - Cache clearing after sync

## Sync Functions
- `syncMondayDashboard()` - Syncs partner activity boards to MondayData sheet
- `syncMarketingBoards()` - Syncs marketing approval, calendar, and 2026 boards
- `syncAndClearMarketingCalendar()` - Sync + cache clear for calendar
- `syncAndClearMarketingApprovals()` - Sync + cache clear for approvals
- `syncAndClear2026Approvals()` - Sync + cache clear for 2026
- `syncAndClearInternalActivities()` - Sync + cache clear for internal
- `syncAndClearPartnerActivities(force)` - Sync + cache clear for partner
- `refreshMarketingDataFromMonday(force)` - Full marketing refresh

## Board Configurations
Retrieved from `getBoardConfigurations()` and `getMarketingBoardConfigurations()` in main.gs. Maps sheet names to board IDs, column mappings, and group filters.

## Data Processing Pipeline
1. Fetch board structure (columns, groups) via API
2. Fetch all items with column values (paginated)
3. Parse column values by type (status, date, people, files, etc.)
4. Sanitize values for sheets (sanitizeValueForSheet, sanitizeRowForSheet)
5. Write to sheet with headers matching column titles
6. Translate partner names (translatePartnerNames)
7. Delete completed rows if configured (deleteCompletedRows)
8. Sort by item name (sortDataByItemName)
9. Clear related caches

## Important Rules
- Use LockService for concurrent sheet modifications
- Batch operations to avoid GAS 6-minute timeout
- Handle rate limiting from Monday.com API
- Always clear caches after sync completes
- Partner name translation maps Monday names to external names
