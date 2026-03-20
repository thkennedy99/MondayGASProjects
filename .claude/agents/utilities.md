# Utilities Agent

Specialized agent for shared utility functions and common patterns.

## Context

utilities.gs provides shared helper functions used across the codebase.

## Key Files
- `utilities.gs` - All utility functions
- `documentfetcher.gs` - Monday.com document/file link processing

## Utility Functions
- `formatDate(date, format)` - Format date to string (default MM/DD/YYYY)
- `parseDate(dateString)` - Parse date string to Date object
- `getBusinessDaysBetween(startDate, endDate)` - Calculate business days
- `sanitizeKey(str)` - Sanitize string for use as cache/property key
- `deepClone(obj)` - Deep clone an object
- `deepMerge(target, source)` - Deep merge two objects
- `isObject(item)` - Check if value is a plain object
- `groupBy(array, key)` - Group array of objects by key
- `sortByMultiple(array, keys)` - Multi-key sorting
- `chunkArray(array, size)` - Split array into chunks
- `isValidEmail(email)` - Email validation
- `generateCSV(data, columns)` - Generate CSV string from data
- `parseCSV(csvString, hasHeaders)` - Parse CSV string to array
- `getStatusColor(status)` - Map status to Bootstrap color class
- `calculateHealthScore(metrics)` - Calculate partner health score
- `logPerformance(operation, startTime)` - Log execution time
- `getPerformanceReport()` - Get performance metrics

## Document Fetcher Functions
- `parseMondayLink(link)` - Extract boardId and itemId from Monday.com URL
- `fetchItemWithFiles(boardId, itemId)` - Fetch item with file assets
- `processMondayDocumentLink(link)` - Process a Monday doc link end-to-end
- `fetchAllDocumentsFromColumnT()` - Batch fetch documents from file column
- `getFileIcon(extension)` - Map file extension to Bootstrap icon class

## Common Patterns
- Use `chunkArray()` for batch processing within GAS timeout limits
- Use `logPerformance()` to track function execution times
- Use `sanitizeKey()` when building cache keys from user input
- Use `deepClone()` before mutating shared data structures
