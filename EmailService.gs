/**
 * EmailService.gs - Email Notification Service
 * Handles email notifications for Marketing Approval and Marketing Calendar events
 */

/**
 * Send notification email for new Marketing Approval Request
 * @param {Object} itemDetails - Details of the newly created item
 * @param {string} itemDetails.itemName - Name of the item
 * @param {Object} itemDetails.columnValues - Column values from the form
 * @param {string} itemDetails.boardId - Board ID
 * @param {string} itemDetails.itemId - Monday Item ID
 * @returns {Object} Result of email send operation
 */
function sendMarketingApprovalNotification(itemDetails) {
  try {
    console.log('Sending Marketing Approval notification email...');

    const recipients = ['mearlywine@guidewire.com', 'jhiguchi@guidewire.com'];
    const subject = `New Marketing Approval Request: ${itemDetails.itemName}`;

    // Build email body with Guidewire branding
    const htmlBody = buildMarketingApprovalEmailHtml(itemDetails);

    // Send email via Gmail
    GmailApp.sendEmail(
      recipients.join(','),
      subject,
      '', // Plain text body (empty, we'll use HTML)
      {
        htmlBody: htmlBody,
        from: 'techalliancemanagement@guidewire.com',
        replyTo: 'tkennedy@guidewire.com',
        name: 'Timbot2000',
        cc: 'tkennedy@guidewire.com'
      }
    );

    console.log(`Marketing Approval notification sent to: ${recipients.join(', ')}`);
    return { success: true, recipients: recipients };

  } catch (error) {
    console.error('Error sending Marketing Approval notification:', error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Send notification email for new Marketing Calendar Entry
 * @param {Object} itemDetails - Details of the newly created item
 * @param {string} itemDetails.itemName - Name of the item
 * @param {Object} itemDetails.columnValues - Column values from the form
 * @param {string} itemDetails.boardId - Board ID
 * @returns {Object} Result of email send operation
 */
function sendMarketingCalendarNotification(itemDetails) {
  try {
    console.log('Sending Marketing Calendar notification email...');

    const recipients = ['mearlywine@guidewire.com', 'jhiguchi@guidewire.com'];
    const subject = `New Marketing Calendar Entry: ${itemDetails.itemName}`;

    // Build email body with Guidewire branding
    const htmlBody = buildMarketingCalendarEmailHtml(itemDetails);

    // Send email via Gmail
    GmailApp.sendEmail(
      recipients.join(','),
      subject,
      '', // Plain text body (empty, we'll use HTML)
      {
        htmlBody: htmlBody,
        from: 'techalliancemanagement@guidewire.com',
        replyTo: 'tkennedy@guidewire.com',
        name: 'Timbot2000',
        cc: 'tkennedy@guidewire.com'
      }
    );

    console.log(`Marketing Calendar notification sent to: ${recipients.join(', ')}`);
    return { success: true, recipients: recipients };

  } catch (error) {
    console.error('Error sending Marketing Calendar notification:', error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Build HTML email body for Marketing Approval Request
 * Uses Guidewire brand colors: Blue (#00739d), Navy (#034e6a)
 */
function buildMarketingApprovalEmailHtml(itemDetails) {
  const { itemName, columnValues, boardId, itemId } = itemDetails;

  // Build Monday.com link to open item in the board view
  // Use ?selectedPulseId= query parameter to open the specific item
  const mondayBoardUrl = itemId
    ? `https://guidewire-technology-alliances.monday.com/boards/${boardId || '9710279044'}/views/207296946?selectedPulseId=${itemId}`
    : `https://guidewire-technology-alliances.monday.com/boards/${boardId || '9710279044'}/views/207296946`;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy');

  // Build item details table
  let detailsHtml = '';

  // Define field order and labels for better presentation
  const fieldMapping = {
    'Partner': 'Partner Name',
    'Partner Name': 'Partner Name',
    'Event URL': 'Event URL',
    'Event Summary': 'Event Summary',
    'Priority': 'Priority',
    'Request Type': 'Request Type',
    'Urgency': 'Urgency',
    'Cost': 'Cost',
    'Start Date': 'Start Date',
    'Date and Location': 'Date and Location',
    'Owner': 'Owner',
    'Alliance Manager': 'Alliance Manager',
    'Requesting Department': 'Requesting Department'
  };

  // Build table rows for each field that has a value
  for (const [fieldKey, fieldLabel] of Object.entries(fieldMapping)) {
    if (columnValues && columnValues[fieldKey]) {
      let value = columnValues[fieldKey];

      // Format URLs as clickable links
      if (fieldKey === 'Event URL' && value) {
        value = `<a href="${value}" style="color: #00739d;">${value}</a>`;
      }

      detailsHtml += `
        <tr>
          <td style="padding: 10px; border: 1px solid #e0e0e0; background-color: #f5f5f5; font-weight: bold; width: 200px;">
            ${fieldLabel}
          </td>
          <td style="padding: 10px; border: 1px solid #e0e0e0;">
            ${value || 'N/A'}
          </td>
        </tr>
      `;
    }
  }

  // Build complete HTML email
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #00739d 0%, #034e6a 100%); padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">
                New Marketing Approval Request
              </h1>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 30px 20px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #333;">
                Hi Melinda and Julie,
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #333;">
                The following new item was created today (${today}):
              </p>
            </td>
          </tr>

          <!-- Item Name Highlight -->
          <tr>
            <td style="padding: 0 30px 20px 30px;">
              <div style="background-color: #f0f8ff; border-left: 4px solid #00739d; padding: 15px; border-radius: 4px;">
                <h2 style="margin: 0; color: #00739d; font-size: 20px; font-weight: 600;">
                  ${itemName}
                </h2>
              </div>
            </td>
          </tr>

          <!-- View in Monday Button -->
          <tr>
            <td style="padding: 0 30px 20px 30px; text-align: center;">
              <a href="${mondayBoardUrl}" style="display: inline-block; background: linear-gradient(135deg, #00739d 0%, #034e6a 100%); color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                📋 View Request in Monday.com
              </a>
            </td>
          </tr>

          <!-- Item Details Table -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <h3 style="color: #034e6a; font-size: 18px; margin: 0 0 15px 0; font-weight: 600;">
                Request Details
              </h3>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
                ${detailsHtml}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px 30px 30px; border-top: 2px solid #e0e0e0;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">
                Best regards,<br>
                <strong style="color: #00739d;">Timbot2000</strong>
              </p>
              <p style="margin: 15px 0 0 0; font-size: 12px; color: #999;">
                This is an automated notification from the Alliance Manager Portal.<br>
                Sent from: techalliancemanagement@guidewire.com<br>
                Please do not reply to this email. For questions, contact
                <a href="mailto:tkennedy@guidewire.com" style="color: #00739d;">tkennedy@guidewire.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  return html;
}

/**
 * Build HTML email body for Marketing Calendar Entry
 * Uses Guidewire brand colors: Blue (#00739d), Navy (#034e6a)
 */
function buildMarketingCalendarEmailHtml(itemDetails) {
  const { itemName, columnValues } = itemDetails;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy');

  // Build item details table
  let detailsHtml = '';

  // Define field order and labels for better presentation
  const fieldMapping = {
    'Partner': 'Partner',
    'Event Type': 'Event Type',
    'EventDate': 'Event Date',
    'Event Date': 'Event Date',
    'Month': 'Month',
    'Week': 'Week',
    'Link': 'Event Link',
    'Event Link': 'Event Link'
  };

  // Build table rows for each field that has a value
  for (const [fieldKey, fieldLabel] of Object.entries(fieldMapping)) {
    if (columnValues && columnValues[fieldKey]) {
      let value = columnValues[fieldKey];

      // Format URLs as clickable links
      if ((fieldKey === 'Link' || fieldKey === 'Event Link') && value) {
        value = `<a href="${value}" style="color: #00739d;">${value}</a>`;
      }

      // Format dates
      if (fieldKey === 'EventDate' || fieldKey === 'Event Date') {
        try {
          const dateObj = new Date(value);
          if (!isNaN(dateObj.getTime())) {
            value = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'MMMM d, yyyy');
          }
        } catch (e) {
          // Keep original value if date parsing fails
        }
      }

      detailsHtml += `
        <tr>
          <td style="padding: 10px; border: 1px solid #e0e0e0; background-color: #f5f5f5; font-weight: bold; width: 200px;">
            ${fieldLabel}
          </td>
          <td style="padding: 10px; border: 1px solid #e0e0e0;">
            ${value || 'N/A'}
          </td>
        </tr>
      `;
    }
  }

  // Build complete HTML email
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #00739d 0%, #034e6a 100%); padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">
                New Marketing Calendar Entry
              </h1>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 30px 20px 30px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #333;">
                Hi Melinda and Julie,
              </p>
              <p style="margin: 0 0 20px 0; font-size: 16px; color: #333;">
                The following new item was created today (${today}):
              </p>
            </td>
          </tr>

          <!-- Item Name Highlight -->
          <tr>
            <td style="padding: 0 30px 20px 30px;">
              <div style="background-color: #f0f8ff; border-left: 4px solid #00739d; padding: 15px; border-radius: 4px;">
                <h2 style="margin: 0; color: #00739d; font-size: 20px; font-weight: 600;">
                  ${itemName}
                </h2>
              </div>
            </td>
          </tr>

          <!-- Item Details Table -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <h3 style="color: #034e6a; font-size: 18px; margin: 0 0 15px 0; font-weight: 600;">
                Event Details
              </h3>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
                ${detailsHtml}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px 30px 30px; border-top: 2px solid #e0e0e0;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">
                Best regards,<br>
                <strong style="color: #00739d;">Timbot2000</strong>
              </p>
              <p style="margin: 15px 0 0 0; font-size: 12px; color: #999;">
                This is an automated notification from the Alliance Manager Portal.<br>
                Sent from: techalliancemanagement@guidewire.com<br>
                Please do not reply to this email. For questions, contact
                <a href="mailto:tkennedy@guidewire.com" style="color: #00739d;">tkennedy@guidewire.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  return html;
}
