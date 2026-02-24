# Privacy Policy for SF Log Analyzer

**Last Updated:** February 24, 2026

## Introduction

SF Log Analyzer ("the Extension") is a Chrome browser extension designed to help Salesforce administrators and developers analyze system debug logs directly from their Salesforce environment. This Privacy Policy explains how the Extension handles your data.

## Data Collection and Usage

### What Data We Access

The Extension accesses the following data only within your browser:

1. **Salesforce Session Cookies**: Used to authenticate API requests to your Salesforce organization
2. **Salesforce Instance URL**: To identify which Salesforce org you're working with
3. **Salesforce Debug Logs**: Retrieved from your org via Salesforce APIs
4. **User Information**: Basic profile information (name, email) from your Salesforce user account

### How We Use This Data

All data accessed by the Extension is used exclusively for the following purposes:

- Authenticating with your Salesforce organization
- Retrieving and displaying debug logs from your Salesforce org
- Managing debug trace flags and sessions
- Providing log analysis and insights

### Data Storage

- **Session Storage**: Authentication credentials (session ID and instance URL) are stored temporarily in Chrome's session storage and are cleared when you close the browser
- **No Persistent Storage**: The Extension does not permanently store any of your Salesforce data
- **No Remote Servers**: All data processing happens locally in your browser; no data is sent to external servers

## Data Sharing and Third Parties

**We do not share, sell, or transmit your data to any third parties.**

The Extension communicates only with:
- Your Salesforce organization's servers (via official Salesforce APIs)
- No other external services or servers are contacted

## Permissions Explanation

The Extension requires the following Chrome permissions:

- **activeTab**: To inject the Extension UI into Salesforce pages
- **scripting**: To run content scripts that detect Salesforce pages
- **storage**: To temporarily store session credentials in Chrome's session storage
- **cookies**: To read Salesforce session cookies for authentication
- **host_permissions**: To access Salesforce domains and make API calls to your Salesforce organization

## Data Security

- All communication with Salesforce servers uses HTTPS encryption
- Session credentials are stored securely in Chrome's session storage
- No data is transmitted to third-party servers
- Credentials are automatically cleared when the browser session ends

## Your Data Rights

You have full control over your data:

- **Access**: All data displayed is retrieved in real-time from your Salesforce org
- **Deletion**: You can remove the Extension at any time, which will immediately clear all stored session data
- **Control**: You can revoke the Extension's access by logging out of Salesforce or removing your Salesforce session

## Changes to This Privacy Policy

We may update this Privacy Policy from time to time. Any changes will be reflected in the "Last Updated" date at the top of this document. Continued use of the Extension after changes constitutes acceptance of the updated policy.

## Contact Information

If you have questions or concerns about this Privacy Policy, please:

- Open an issue on our [GitHub repository](https://github.com/praveen420coder/sf-log-analyzer)
- Contact us at [kumar.praveen.sfdev@gmail.com]

## Compliance

This Extension complies with:
- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)

## Open Source

This Extension is open source. You can review the complete source code at:
https://github.com/praveen420coder/sf-log-analyzer

---

**Summary**: SF Log Analyzer is a privacy-focused tool that processes all data locally in your browser. We do not collect, store, or share your personal information or Salesforce data with any third parties.
