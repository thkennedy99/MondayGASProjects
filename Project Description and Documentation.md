# Alliance Manager Portal

## Overview

The Alliance Manager Portal is a comprehensive web application built on Google Apps Script that integrates with Monday.com to provide alliance managers with a unified dashboard for tracking partner activities, managing approvals, and monitoring partnership health metrics.

## Features

### 📊 Activity Tracking
- **Partner Activities**: Track all partner-related tasks and deliverables
- **Internal Activities**: Monitor internal Guidewire team activities
- **Real-time Sync**: Automatic synchronization with Monday.com boards
- **Advanced Filtering**: Filter by status, owner, date ranges, and more
- **Smart Sorting**: Multi-column sorting with customizable order

### 🔥 Partner Health Heatmap
- **Visual Health Scores**: Color-coded health indicators for each partner
- **Metric-based Scoring**: Automatic calculation based on:
  - Overdue items
  - Stuck/blocked tasks
  - Not started activities
  - Completion rates
- **Trend Analysis**: Track partner health over time

### ✅ Approval Management
- **Marketing Approvals**: Track pending marketing event approvals
- **General Approvals**: Monitor all approval requests across boards
- **Days Waiting**: Automatic calculation of approval wait times
- **Priority Indicators**: Visual badges for approval urgency

### 🌓 Dark Mode Support
- **Automatic Theme Detection**: Respects system preferences
- **Manual Toggle**: User-controlled dark/light mode switch
- **Persistent Preference**: Saves user preference across sessions

### 🔐 Security & Permissions
- **Domain Restriction**: Limited to @guidewire.com users
- **Role-based Access**: Different permission levels:
  - Viewers: Read-only access
  - Managers: Edit capabilities
  - Admins: Full system control
- **Session Management**: Secure session handling with timeout

### ⚡ Performance Optimization
- **Multi-tier Caching**: Script, user, and document level caching
- **Lazy Loading**: Data loaded on-demand
- **Batch Operations**: Optimized API calls
- **Progress Indicators**: Visual feedback during operations

## Technology Stack

- **Backend**: Google Apps Script (V8 Runtime)
- **Frontend**: React 18 with Bootstrap 5
- **API Integration**: Monday.com GraphQL API v2
- **Database**: Google Sheets
- **Styling**: Bootstrap 5 with custom Guidewire theme
- **Icons**: Bootstrap Icons

## Architecture

```
┌─────────────────────────────────────────┐
│          React UI (Client)              │
│  - Components                           │
│  - State Management                     │
│  - Bootstrap Styling                    │
└──────────────┬──────────────────────────┘
               │ google.script.run
┌──────────────▼──────────────────────────┐
│      Google Apps Script (Server)        │
│  - Session Management                   │
│  - Business Logic                       │
│  - Data Processing                      │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│           Data Layer                    │
│  ┌─────────────┐  ┌─────────────┐      │
│  │Google Sheets│  │Monday.com   │      │
│  │  Database   │  │    API      │      │
│  └─────────────┘  └─────────────┘      │
└──────────────────────────────────────────┘
```

## Quick Start

1. **Clone the repository** or copy the files to your Google Apps Script project

2. **Configure Monday.com API**:
   ```javascript
   PropertiesService.getScriptProperties()
     .setProperty('MONDAY_API_KEY', 'your-api-key-here');
   ```

3. **Setup required sheets** in your Google Spreadsheet:
   - MondayData
   - GWMondayData
   - MarketingApproval
   - MarketingCalendar
   - MondayDashboard
   - Partner
   - PartnerTranslate (optional)

4. **Deploy as Web App**:
   - Go to Deploy > New Deployment
   - Select "Web app" as type
   - Set execute as "Me"
   - Set access to "Anyone in your organization"
   - Click Deploy

5. **Access the portal** using the generated Web App URL

## File Structure

```
alliance-manager-portal/
├── Server Files (Google Apps Script)
│   ├── Code.gs              # Main entry point
│   ├── DataService.gs       # Data operations
│   ├── MondayAPI.gs         # Monday.com integration
│   ├── CacheService.gs      # Caching layer
│   ├── SessionManager.gs    # Session management
│   └── Utilities.gs         # Helper functions
│
├── Client Files (HTML/React)
│   ├── index.html           # React application
│   └── error.html           # Error page
│
├── Configuration
│   ├── appsscript.json      # GAS manifest
│   └── DEPLOYMENT_GUIDE.md  # Setup instructions
│
└── Documentation
    └── README.md            # This file
```

## Key Components

### Activity Tracker
Displays partner and internal activities in a tabbed interface with:
- Sortable columns
- Status badges
- Date formatting
- Click-to-edit functionality

### Partner Heatmap
Visual representation of partner health with:
- Color-coded rows (green/yellow/red)
- Health score calculation
- Metric breakdowns
- Trend indicators

### Approval Widgets
Compact cards showing pending approvals with:
- Event names
- Days waiting
- Status indicators
- Quick actions

## API Endpoints

### Server Functions (via google.script.run)

| Function | Description | Parameters |
|----------|-------------|------------|
| `getPartnerActivities` | Get partner activity data | manager, filters, sort, pagination |
| `getInternalActivities` | Get internal activity data | manager, filters, sort, pagination |
| `getPartnerHeatmap` | Get partner health metrics | manager |
| `getMarketingApprovals` | Get pending marketing approvals | manager |
| `getGeneralApprovals` | Get general approval items | manager |
| `updateMondayItem` | Update Monday.com item | itemId, boardId, updates |
| `deleteMondayItem` | Delete Monday.com item | itemId |
| `getCurrentUser` | Get current user info | - |
| `refreshSession` | Refresh user session | - |

## Performance Considerations

- **Caching Strategy**: 5-minute cache for frequently accessed data
- **Batch Processing**: Groups API calls to reduce latency
- **Lazy Loading**: Components load data only when visible
- **Optimized Queries**: Filtered at the data layer to reduce payload

## Security Best Practices

- API keys stored in Script Properties (not in code)
- Domain-restricted access (@guidewire.com only)
- Session timeout after 30 minutes of inactivity
- No sensitive data in client-side code
- HTTPS-only communication

## Browser Support

- Chrome 90+ (recommended)
- Firefox 88+
- Safari 14+
- Edge 90+

## Known Limitations

- Maximum 500 items per Monday.com board query
- Google Apps Script 6-minute execution time limit
- Cache size limit of 100KB per key
- Concurrent user limit based on Google Workspace plan

## Troubleshooting

### No Data Showing
- Verify sheet names match exactly
- Check manager email in Partner sheet
- Confirm Monday.com API key is valid

### Slow Performance
- Enable caching (should be automatic)
- Reduce page size in pagination
- Check for large datasets

### Authentication Issues
- Ensure user is logged into Google Workspace
- Verify @guidewire.com email domain
- Check session hasn't expired

## Support

For issues or feature requests, please contact the Alliance Manager Portal admin team.

## License

© 2025 Guidewire Software. All rights reserved.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | Dec 2024 | Complete React rewrite with Bootstrap 5 |
| 1.5.0 | Oct 2024 | Added marketing approval tracking |
| 1.2.0 | Sep 2024 | Implemented partner heatmap |
| 1.0.0 | Aug 2024 | Initial release |

## Contributing

To contribute to this project:
1. Test changes in a development environment
2. Follow the existing code style
3. Update documentation as needed
4. Submit changes for review

## Acknowledgments

Built with:
- Google Apps Script
- React 18
- Bootstrap 5
- Monday.com API
- And the dedication of the Guidewire Alliance team
