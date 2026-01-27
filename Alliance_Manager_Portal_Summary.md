# Alliance Manager Portal
## Application Summary & User Guide

**Version:** 2.0.0
**Platform:** Google Apps Script Web Application
**Last Updated:** January 2025

---

## Overview

The **Alliance Manager Portal** is a centralized activity management and tracking system designed for alliance managers at Guidewire. It provides a unified view of all partner and internal activities across multiple Monday.com boards, enabling efficient tracking, management, and collaboration.

### Key Benefits

- **Single Dashboard**: View all partner and internal activities in one place
- **Real-Time Sync**: Data synchronized from Monday.com to ensure accuracy
- **Direct Editing**: Create, edit, and delete activities without leaving the portal
- **Visual Insights**: Heatmap view for at-a-glance partner health status
- **Role-Based Access**: See only the partners and activities relevant to your role

---

## Main Features

### 1. Partner Activities

The primary workspace for managing partner-related activities.

| Capability | Description |
|------------|-------------|
| **View Activities** | Browse all activities for your assigned partners |
| **Filter & Search** | Filter by partner, status, owner, or search by keyword |
| **Sort Data** | Click any column header to sort ascending/descending |
| **Edit Activities** | Update status, due dates, owners, and other fields |
| **Create Activities** | Add new activities to any partner board |
| **Delete Activities** | Remove activities with confirmation prompt |
| **Sync Data** | Manually refresh data from Monday.com |

**Key Fields Displayed:**
- Item Name
- Partner
- Status
- Owner
- Date Due
- Date Created
- Days Waiting
- Importance/Priority

---

### 2. Partner Heatmap

A visual dashboard showing the health status of partner activities at a glance.

**Color Coding:**
| Color | Days Waiting | Meaning |
|-------|--------------|---------|
| Green | 0-5 days | On track |
| Yellow | 5-15 days | Needs attention |
| Red | 15+ days | Overdue/Critical |

**How to Use:**
1. Click the "Heatmap" toggle button in Partner Activities
2. Review color-coded status for each partner
3. Click on a partner to drill down into their activities
4. Take action on items requiring attention

---

### 3. Internal Activities (GW Boards)

Manage Guidewire-specific internal activities across four specialized boards:

| Board | Purpose |
|-------|---------|
| **Partner Management Activities** | Track partner engagement initiatives |
| **Tech Ops Activities** | Internal technical operations |
| **Marketing Activities** | Marketing campaigns and initiatives |
| **Marketplace Activities** | Integration compliance tracking |

**Available Actions:**
- View and filter activities by board
- Edit activity details
- Create new internal activities
- Delete completed or erroneous entries
- Sync individual boards on demand

---

### 4. Marketing Calendar

Track and manage marketing events scheduled across partners.

**Features:**
- View events by month, week, or partner
- Filter by partner and owner
- Add new marketing events
- Edit event details (date, partner, description)
- Delete cancelled events

**Key Fields:**
- Event Name
- Partner
- Month/Week
- Event Date
- Activity Type
- Owner

---

### 5. Marketing Approvals

Workflow management for marketing event approval requests.

**Approval Workflow Statuses:**
- Submit Request Form
- Sent to Will/Eric for Approval
- PM Approved / PM Rejected
- Marketing Approved / Marketing Rejected
- Ready to Start
- Started
- Final Approval

**Actions Available:**
- View approval status
- Track cost information
- Edit approval requests
- Create new approval submissions

---

### 6. General Approvals

A consolidated view of approvals across multiple boards with urgency indicators.

**Features:**
- Combined approvals from all board types
- Days Waiting indicator (red warning at 5+ days)
- Board identification for each item
- Standard edit/delete operations

---

## How to Use the Portal

### Getting Started

1. **Access the Portal**: Open the web app URL provided by your administrator
2. **Authentication**: Log in with your Guidewire Google account
3. **Navigate**: Use the tabs at the top to switch between different views

### Filtering Data

1. **Partner Filter**: Select one or more partners from the dropdown
2. **Status Filter**: Choose specific statuses to view
3. **Owner Filter**: Filter by activity owner
4. **Search Box**: Type keywords to search across all visible data
5. **Clear Filters**: Click "Clear All" to reset all filters

### Editing an Activity

1. Find the activity in the data table
2. Click the **Edit** button (pencil icon) on the row
3. Modify fields in the modal form
4. Click **Save** to apply changes to Monday.com
5. The table will refresh automatically

### Creating a New Activity

1. Click the **+ Add** button in the toolbar
2. Select the target board/partner (if applicable)
3. Fill in required fields:
   - Item Name (required)
   - Status
   - Owner
   - Due Date
   - Priority/Importance
4. Click **Create** to add the activity

### Deleting an Activity

1. Find the activity in the data table
2. Click the **Delete** button (trash icon) on the row
3. Confirm the deletion in the popup dialog
4. The activity will be removed from Monday.com

### Syncing Data

Data syncs automatically, but you can force a refresh:
1. Click the **Sync** button (refresh icon) in the toolbar
2. Wait for the sync to complete
3. The table will update with the latest Monday.com data

---

## User Roles & Permissions

| Role | View Own | Edit Own | View Team | Edit Team | View All | Admin |
|------|----------|----------|-----------|-----------|----------|-------|
| **User** | Yes | Yes | No | No | No | No |
| **Manager** | Yes | Yes | Yes | Yes | No | No |
| **Sr. Director** | Yes | Yes | Yes | Yes | Yes | No |
| **Admin** | Yes | Yes | Yes | Yes | Yes | Yes |

---

## Data Architecture

```
┌────────────────────────────────────────────────────────┐
│                    USER INTERFACE                       │
│           Alliance Manager Portal (React)              │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                  GOOGLE APPS SCRIPT                     │
│            Authentication, Caching, Validation          │
└──────────────────────────┬─────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│  Monday.com   │  │ Google Sheets │  │ Google Drive  │
│ (Data Source) │  │ (Cache/Sync)  │  │   (Files)     │
└───────────────┘  └───────────────┘  └───────────────┘
```

---

## Monday.com Boards Connected

| Board Name | Purpose | Data Sheet |
|------------|---------|------------|
| Partner Management Activities | Partner engagement tracking | GW_PartnerManagementActivities |
| Tech Ops Activities | Internal tech operations | GW_TechOpsActivities |
| Marketing Activities | Marketing campaigns | GW_MarketingActivities |
| Marketplace Activities | Integration compliance | GW_IntegrationComplianceActivities |
| Marketing Approval Requests | Event approval workflow | MarketingApproval |
| Marketing Calendar | Event scheduling | MarketingCalendar |
| Partner-Specific Boards | Individual partner activities | MondayData |

---

## Tips for Alliance Managers

### Daily Workflow

1. **Morning Check**: Open the Partner Heatmap to identify urgent items
2. **Review Red Items**: Address activities with 15+ days waiting
3. **Update Statuses**: Keep activity statuses current as work progresses
4. **Add New Work**: Create activities as new initiatives begin

### Best Practices

- **Use Consistent Naming**: Follow naming conventions for easy searching
- **Set Realistic Due Dates**: Update due dates when timelines change
- **Assign Owners**: Ensure every activity has a clear owner
- **Update Status Promptly**: Mark items as complete when finished
- **Review Weekly**: Check heatmap weekly to prevent items going red

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Data not updating | Click Sync button to force refresh |
| Can't see a partner | Check with admin about your access permissions |
| Edit not saving | Ensure all required fields are filled |
| Slow loading | Clear browser cache and reload |
| Missing activities | Verify the correct board/filter is selected |

---

## Quick Reference

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Search | Click search box or Tab to it |
| Clear search | Press Escape in search box |
| Next page | Click pagination arrows |

### Status Indicators

| Icon/Color | Meaning |
|------------|---------|
| Green status | Completed / On track |
| Yellow status | In progress / Needs attention |
| Red status | Blocked / Overdue |
| Gray status | Not started |

### Button Icons

| Icon | Action |
|------|--------|
| Pencil | Edit item |
| Trash | Delete item |
| Plus (+) | Create new item |
| Refresh | Sync data |
| Sun/Moon | Toggle dark mode |

---

## Support

For technical issues or feature requests:
- Contact your system administrator
- Report issues via the designated support channel

---

*This document provides an overview of the Alliance Manager Portal. For detailed technical documentation, refer to the CLAUDE.md file in the project repository.*
