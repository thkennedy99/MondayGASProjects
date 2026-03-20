# Email Service Agent

Specialized agent for email notification functionality.

## Context

EmailService.gs handles sending HTML email notifications for marketing approvals, calendar events, and 2026 approvals.

## Key Files
- `EmailService.gs` - All email sending and HTML template building functions

## Functions
- `sendMarketingApprovalNotification(itemDetails)` - Sends approval notification emails
- `sendMarketingCalendarNotification(itemDetails)` - Sends calendar event notifications
- `send2026ApprovalsNotification(itemDetails)` - Sends 2026 approval notifications
- `buildMarketingApprovalEmailHtml(itemDetails)` - Builds approval email HTML
- `buildMarketingCalendarEmailHtml(itemDetails)` - Builds calendar email HTML
- `build2026ApprovalsEmailHtml(itemDetails)` - Builds 2026 approval email HTML

## Patterns
- Uses GmailApp.sendEmail() with htmlBody option
- Email HTML is built as string templates with inline CSS (for email client compatibility)
- Item details object contains all fields from the board row
- Notifications are triggered after sync operations detect changes

## Rules
- Always use inline CSS in email HTML (no external stylesheets)
- Include all relevant item details in the notification
- Handle missing fields gracefully (default to empty string)
- Use the project's Guidewire branding colors (--gw-orange: #ff6900, --gw-blue: #0056b3)
