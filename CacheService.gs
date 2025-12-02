/**
 * CacheService.gs - Advanced Caching Layer
 * Provides multi-tier caching with automatic invalidation
 */

class CacheManager {
  constructor() {
    this.scriptCache = CacheService.getScriptCache();
    this.userCache = CacheService.getUserCache();
    this.documentCache = CacheService.getDocumentCache();
    this.properties = PropertiesService.getScriptProperties();
  }
  
  /**
   * Get from cache with fallback
   */
  get(key, tier = 'script') {
    try {
      let cache;
      switch (tier) {
        case 'user':
          cache = this.userCache;
          break;
        case 'document':
          cache = this.documentCache;
          break;
        default:
          cache = this.scriptCache;
      }
      
      const value = cache.get(key);
      if (value) {
        const parsed = JSON.parse(value);
        
        // Check if expired
        if (parsed.expires && new Date(parsed.expires) < new Date()) {
          cache.remove(key);
          return null;
        }
        
        return parsed.data;
      }
      
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }
  
  /**
   * Set cache with expiration
   */
  put(key, value, expirationInSeconds = 600, tier = 'script') {
    try {
      let cache;
      switch (tier) {
        case 'user':
          cache = this.userCache;
          break;
        case 'document':
          cache = this.documentCache;
          break;
        default:
          cache = this.scriptCache;
      }
      
      const data = {
        data: value,
        created: new Date().toISOString(),
        expires: new Date(Date.now() + expirationInSeconds * 1000).toISOString()
      };
      
      // GAS cache has a 100KB limit per key
      const serialized = JSON.stringify(data);
      if (serialized.length > 100000) {
        console.warn(`Cache value too large for key ${key}: ${serialized.length} bytes`);
        return false;
      }
      
      cache.put(key, serialized, expirationInSeconds);
      return true;
    } catch (error) {
      console.error('Cache put error:', error);
      return false;
    }
  }
  
  /**
   * Remove from cache
   */
  remove(key, tier = 'script') {
    try {
      let cache;
      switch (tier) {
        case 'user':
          cache = this.userCache;
          break;
        case 'document':
          cache = this.documentCache;
          break;
        default:
          cache = this.scriptCache;
      }
      
      cache.remove(key);
      return true;
    } catch (error) {
      console.error('Cache remove error:', error);
      return false;
    }
  }
  
  /**
   * Clear all cache entries matching pattern
   */
  clearPattern(pattern, tier = 'script') {
    try {
      // Get all keys from properties (we maintain a key index)
      const keysJson = this.properties.getProperty(`cache_keys_${tier}`);
      if (!keysJson) return;
      
      const keys = JSON.parse(keysJson);
      const regex = new RegExp(pattern);
      
      keys.forEach(key => {
        if (regex.test(key)) {
          this.remove(key, tier);
        }
      });
      
      // Update key index
      const remainingKeys = keys.filter(key => !regex.test(key));
      this.properties.setProperty(`cache_keys_${tier}`, JSON.stringify(remainingKeys));
      
    } catch (error) {
      console.error('Clear pattern error:', error);
    }
  }
  
  /**
   * Get or compute - fetch from cache or compute if missing
   */
  async getOrCompute(key, computeFn, expirationInSeconds = 600, tier = 'script') {
    // Try to get from cache
    const cached = this.get(key, tier);
    if (cached !== null) {
      return cached;
    }
    
    // Compute value
    const value = await computeFn();
    
    // Store in cache
    this.put(key, value, expirationInSeconds, tier);
    
    return value;
  }
  
  /**
   * Batch get
   */
  batchGet(keys, tier = 'script') {
    const results = {};
    keys.forEach(key => {
      results[key] = this.get(key, tier);
    });
    return results;
  }
  
  /**
   * Batch put
   */
  batchPut(items, expirationInSeconds = 600, tier = 'script') {
    const results = {};
    Object.entries(items).forEach(([key, value]) => {
      results[key] = this.put(key, value, expirationInSeconds, tier);
    });
    return results;
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    const stats = {
      script: { keys: 0, size: 0 },
      user: { keys: 0, size: 0 },
      document: { keys: 0, size: 0 }
    };
    
    ['script', 'user', 'document'].forEach(tier => {
      const keysJson = this.properties.getProperty(`cache_keys_${tier}`);
      if (keysJson) {
        const keys = JSON.parse(keysJson);
        stats[tier].keys = keys.length;
      }
    });
    
    return stats;
  }
}

// Global cache instance
const cache = new CacheManager();

/**
 * Clear all caches
 */
function clearAllCaches() {
  try {
    const properties = PropertiesService.getScriptProperties();
    const scriptCache = CacheService.getScriptCache();

    // Get tracked cache keys
    const scriptKeys = properties.getProperty('cache_keys_script');
    const userKeys = properties.getProperty('cache_keys_user');
    const documentKeys = properties.getProperty('cache_keys_document');

    // Remove script cache keys
    if (scriptKeys) {
      const keysArray = JSON.parse(scriptKeys);
      if (keysArray.length > 0) {
        scriptCache.removeAll(keysArray);
      }
    }

    // Remove user cache keys
    if (userKeys) {
      const keysArray = JSON.parse(userKeys);
      if (keysArray.length > 0) {
        CacheService.getUserCache().removeAll(keysArray);
      }
    }

    // Remove document cache keys
    if (documentKeys) {
      const keysArray = JSON.parse(documentKeys);
      if (keysArray.length > 0) {
        CacheService.getDocumentCache().removeAll(keysArray);
      }
    }

    // Clear key indexes
    properties.deleteProperty('cache_keys_script');
    properties.deleteProperty('cache_keys_user');
    properties.deleteProperty('cache_keys_document');

    // Clear untracked marketing and data cache keys (used directly by DataService)
    // These are not tracked by CacheManager but need to be cleared
    const untrackedKeys = [
      'all_marketing_approvals',
      'all_marketing_calendar',
      'board_columns_9710279044',  // Marketing Approval board
      'board_columns_9770467355'   // Marketing Calendar board
    ];

    // Also clear manager-specific marketing caches
    // Get list of managers using the centralized getManagerList() function
    // This ensures consistent lowercase normalization of emails
    try {
      const managers = getManagerList();
      managers.forEach(email => {
        // email is already lowercase from getManagerList()
        untrackedKeys.push(`marketing_approvals_${email}`);
        untrackedKeys.push(`marketing_calendar_${email}`);
        untrackedKeys.push(`heatmap_${email}`);
        untrackedKeys.push(`heatmap_data_${email}`);
        untrackedKeys.push(`manager_partners_${email}`);
        untrackedKeys.push(`manager_name_${email}`);
      });
      console.log(`Added ${managers.length * 6} manager-specific cache keys to clear`);
    } catch (managerError) {
      console.log('Could not load manager list for cache clearing:', managerError);
    }

    // Remove all untracked keys
    if (untrackedKeys.length > 0) {
      scriptCache.removeAll(untrackedKeys);
      console.log(`Cleared ${untrackedKeys.length} untracked cache keys`);
    }

    return { success: true, message: 'All caches cleared' };
  } catch (error) {
    console.error('Clear cache error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return cache.getStats();
}

/**
 * Warm up cache with frequently accessed data
 */
function warmUpCache() {
  try {
    const managers = getManagerList();
    
    managers.forEach(manager => {
      // Pre-cache partner manager mappings
      const service = new DataService();
      service.getPartnerManagerMap();
      
      // Pre-cache recent activities
      cache.getOrCompute(
        `activity_partner_${manager}_recent`,
        () => service.getActivityData('partner', manager, {}, { field: 'Date Due', order: 'desc' }, { page: 1, pageSize: 10 }),
        300
      );
    });
    
    return { success: true, message: 'Cache warmed up' };
  } catch (error) {
    console.error('Warm up cache error:', error);
    return { success: false, error: error.message };
  }
}
