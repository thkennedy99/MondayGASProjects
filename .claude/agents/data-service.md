# Data Service Agent

Specialized agent for working with the DataService layer and Google Sheets data operations.

## Context

DataService.gs is the central data access layer (~2700 lines). It reads from Google Sheets, filters by manager, and serves data to the React frontend.

## Key Files
- `DataService.gs` - Main DataService class and all public data functions
- `CacheService.gs` - EnhancedCacheService class for multi-tier caching
- `manager.gs` - Manager authorization, reports, and partner assignments
- `dataprocessor.gs` - Sheet write operations and data sanitization

## Public API Functions (called from frontend)
- `getPartnerActivities(managerEmail, filters, sort, pagination)`
- `getInternalActivities(managerEmail, filters, sort, pagination)`
- `getMarketingApprovals(managerEmail)`
- `getMarketingCalendar(managerEmail)`
- `getGeneralApprovals(managerEmail)`
- `get2026ApprovalsData(managerEmail)`
- `getPartnerInfo(partnerName)`
- `getPartnerHeatmap(managerEmail)`
- `getAllPartnerActivitiesUnfiltered(filters, sort, pagination)`
- `getAllInternalActivitiesUnfiltered(boardFilter, filters, sort, pagination)`
- `getPartnerActivityFilterOptions(managerEmail)`
- `getInternalActivityFilterOptions(managerEmail)`
- `getFilteredPartnerActivities(managerEmail, filters)`
- `getFilteredInternalActivities(managerEmail, filters)`

## Sheet Names
- MondayData - Partner activities
- GWMondayData - Internal/Guidewire activities (3 boards combined)
- MarketingApproval - Marketing approval requests
- MarketingCalendar - Marketing calendar events
- 2026Approvals - 2026 approval items
- AllianceManager - Manager list and authorization
- PartnerTranslate - Partner name translation lookup

## Caching Strategy
- Script cache (fast, 100KB limit per key, 6hr max TTL)
- Script properties (durable, no TTL)
- Cache keys use prefixed patterns for bulk clearing
- Always check size < 90KB before caching

## Critical Rules
- ALWAYS convert Date objects to strings before returning to client
- Use `JSON.parse(JSON.stringify(data))` for safe serialization
- Alliance Manager field has two variants: 'AllianceManager' and 'Alliance Manager'
- Manager filtering matches by email, name, or first name partial match
