# Manager Authorization Agent

Specialized agent for the manager authorization and access control system.

## Context

manager.gs handles manager authentication, authorization levels, report hierarchies, and partner assignments.

## Key Files
- `manager.gs` - All manager-related functions
- `code.gs` - doGet(), initializeSession(), validateUserAccess()

## Functions
- `getManagerList()` - Gets authorized managers from AllianceManager sheet (cached 1hr)
- `clearManagerListCache()` - Clears manager list cache
- `getManagerEmailByName(managerName)` - Reverse lookup name to email
- `refreshManagerList()` - Force refresh manager list
- `isManager(email)` - Check if email is an authorized manager
- `addManagerToFallback(email)` - Add to Script Properties fallback list
- `getManagerAuthorization(managerEmail)` - Full authorization with role, reports, partners
- `clearManagerAuthorizationCache(managerEmail)` - Clear specific manager's auth cache
- `refreshMyAuthorization()` - Refresh current user's authorization
- `clearAllManagerCaches()` - Clear all manager-related caches
- `getManagerReportsList(managerEmail)` - Get direct reports
- `getManagerReportsEmails(managerEmail)` - Get report emails
- `getManagedPartners(managerEmail)` - Get partner assignments

## Authorization Flow
1. User loads app with `?manager=Name` parameter or auto-detected email
2. `doGet()` passes manager name to template
3. Frontend calls `initializeSession(userEmail, token)`
4. `validateUserAccess(email)` checks against manager list
5. `getManagerAuthorization()` returns full permissions object

## AllianceManager Sheet Structure
- Email column: manager email addresses (must be @guidewire.com)
- Additional columns for role, reports, partner assignments
- Fallback to Script Properties `MANAGER_LIST` if sheet unavailable

## Rules
- All emails normalized to lowercase
- Manager list cached for 1 hour
- Authorization data cached per-manager
- Dual-store pattern (cache + properties) for reliability
