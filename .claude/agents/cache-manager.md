# Cache Manager Agent

Specialized agent for the multi-tier caching system.

## Context

CacheService.gs provides an EnhancedCacheService class wrapping GAS CacheService and PropertiesService.

## Key Files
- `CacheService.gs` - EnhancedCacheService class and global cache functions

## EnhancedCacheService Methods
- `get(key, tier)` - Get from cache (tries script cache, falls back to properties)
- `put(key, value, ttl, tier)` - Write to cache with TTL
- `remove(key, tier)` - Remove from cache
- `clearPattern(pattern, tier)` - Clear keys matching pattern
- `batchGet(keys, tier)` - Batch get multiple keys
- `batchPut(items, ttl, tier)` - Batch put multiple items
- `getStats()` - Get cache hit/miss statistics

## Global Functions
- `clearAllCaches()` - Clears all tracked cache keys
- `getCacheStats()` - Returns cache statistics
- `warmUpCache()` - Pre-loads frequently accessed data

## Cache TTL Guidelines
- Partners/Contacts: 1 hour (3600s)
- Session Progress: 10 minutes (600s)
- Templates: 24 hours (86400s)
- Manager list: 1 hour (3600s)
- Board configurations: varies

## Limits
- Script cache: 100KB per key, 6 hour max TTL
- Properties: 9KB per key, no TTL (persistent)
- Always check `json.length < 90000` before caching
- Track cache keys for bulk clearing operations

## Cache Key Patterns
- `manager_list` - Manager email list
- `manager_auth_*` - Manager authorization data
- `partner_activities_*` - Partner activity data
- `internal_activities_*` - Internal activity data
- `marketing_*` - Marketing data
