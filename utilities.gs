/**
 * Utilities.gs - Helper Functions and Common Utilities
 * Shared utility functions used across the application
 */

/**
 * Format date for display
 */
function formatDate(date, format = 'MM/DD/YYYY') {
  if (!date) return '';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  switch (format) {
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'MM/DD/YYYY HH:mm':
      return `${month}/${day}/${year} ${hours}:${minutes}`;
    case 'ISO':
      return d.toISOString();
    default:
      return d.toLocaleDateString();
  }
}

/**
 * Parse date from various formats
 */
function parseDate(dateString) {
  if (!dateString) return null;
  
  // Try to parse as is
  let date = new Date(dateString);
  
  // If invalid, try common formats
  if (isNaN(date.getTime())) {
    // Try MM/DD/YYYY format
    const parts = dateString.split('/');
    if (parts.length === 3) {
      date = new Date(parts[2], parts[0] - 1, parts[1]);
    }
  }
  
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Calculate business days between two dates
 */
function getBusinessDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  let count = 0;
  const current = new Date(start);
  
  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

/**
 * Sanitize string for use in cache keys
 */
function sanitizeKey(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

/**
 * Deep clone object
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  
  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}

/**
 * Merge objects deeply
 */
function deepMerge(target, source) {
  const output = deepClone(target);
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  
  return output;
}

/**
 * Check if value is plain object
 */
function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Group array by key
 */
function groupBy(array, key) {
  return array.reduce((result, item) => {
    const group = item[key];
    if (!result[group]) result[group] = [];
    result[group].push(item);
    return result;
  }, {});
}

/**
 * Sort array of objects by multiple keys
 */
function sortByMultiple(array, keys) {
  return array.sort((a, b) => {
    for (const key of keys) {
      const field = key.field || key;
      const order = key.order || 'asc';
      const multiplier = order === 'desc' ? -1 : 1;
      
      if (a[field] < b[field]) return -1 * multiplier;
      if (a[field] > b[field]) return 1 * multiplier;
    }
    return 0;
  });
}

/**
 * Chunk array into smaller arrays
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Retry function with exponential backoff
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        Utilities.sleep(delay);
      }
    }
  }
  
  throw lastError;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Generate CSV from array of objects
 */
function generateCSV(data, columns) {
  if (!data || data.length === 0) return '';
  
  // Use provided columns or extract from first object
  const headers = columns || Object.keys(data[0]);
  
  // Create header row
  const csv = [headers.join(',')];
  
  // Add data rows
  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header];
      
      // Escape special characters
      if (value === null || value === undefined) return '';
      
      const stringValue = String(value);
      
      // Quote if contains comma, quote, or newline
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      
      return stringValue;
    });
    
    csv.push(values.join(','));
  });
  
  return csv.join('\n');
}

/**
 * Parse CSV string to array of objects
 */
function parseCSV(csvString, hasHeaders = true) {
  const lines = csvString.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  const headers = hasHeaders ? lines[0].split(',').map(h => h.trim()) : [];
  const startIndex = hasHeaders ? 1 : 0;
  
  const data = [];
  
  for (let i = startIndex; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    
    if (hasHeaders) {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] || '';
      });
      data.push(obj);
    } else {
      data.push(values);
    }
  }
  
  return data;
}

/**
 * Get color for status
 */
function getStatusColor(status) {
  const statusLower = (status || '').toLowerCase();
  
  const colorMap = {
    'done': '#00c875',
    'complete': '#00c875',
    'completed': '#00c875',
    'working': '#fdab3d',
    'in progress': '#fdab3d',
    'stuck': '#e2445c',
    'blocked': '#e2445c',
    'not started': '#c4c4c4',
    'pending': '#579bfc',
    'high': '#ff6b6b',
    'medium': '#ffcc33',
    'low': '#00cc66'
  };
  
  for (const [key, color] of Object.entries(colorMap)) {
    if (statusLower.includes(key)) {
      return color;
    }
  }
  
  return '#666666'; // Default gray
}

/**
 * Calculate health score
 */
function calculateHealthScore(metrics) {
  const {
    totalItems = 0,
    completedItems = 0,
    overdueItems = 0,
    stuckItems = 0,
    notStartedItems = 0
  } = metrics;
  
  if (totalItems === 0) return 100;
  
  let score = 100;
  
  // Deduct points for issues
  score -= (overdueItems / totalItems) * 30;
  score -= (stuckItems / totalItems) * 20;
  score -= (notStartedItems / totalItems) * 10;
  
  // Add points for completion
  score += (completedItems / totalItems) * 20;
  
  // Ensure score is between 0 and 100
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Log performance metrics
 */
function logPerformance(operation, startTime) {
  const duration = Date.now() - startTime;
  console.log(`Performance: ${operation} took ${duration}ms`);
  
  // Store metrics for analysis
  const metricsKey = 'performance_metrics';
  let metrics = cache.get(metricsKey) || [];
  
  metrics.push({
    operation: operation,
    duration: duration,
    timestamp: new Date().toISOString()
  });
  
  // Keep last 100 metrics
  metrics = metrics.slice(-100);
  cache.put(metricsKey, metrics, 3600);
  
  return duration;
}

/**
 * Get performance report
 */
function getPerformanceReport() {
  const metricsKey = 'performance_metrics';
  const metrics = cache.get(metricsKey) || [];
  
  if (metrics.length === 0) {
    return { message: 'No performance metrics available' };
  }
  
  // Group by operation
  const grouped = groupBy(metrics, 'operation');
  
  const report = {};
  
  for (const [operation, ops] of Object.entries(grouped)) {
    const durations = ops.map(op => op.duration);
    
    report[operation] = {
      count: ops.length,
      average: Math.round(durations.reduce((a, b) => a + b, 0) / ops.length),
      min: Math.min(...durations),
      max: Math.max(...durations),
      last: ops[ops.length - 1].duration
    };
  }
  
  return report;
}
