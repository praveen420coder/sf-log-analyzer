# Privacy Policy & Terms of Use for SF Spotlight

**Last Updated:** June 30, 2026

## Introduction

SF Spotlight ("the Extension") is a Chrome browser extension that helps Salesforce administrators and developers navigate their org, analyze Apex debug logs, inspect Lightning Web Components, and perform related development tasks directly from their Salesforce environment. This document explains how the Extension handles your data and sets out important terms governing your use of it.

By installing or using the Extension you acknowledge that you have read and agree to this Privacy Policy and to the **Disclaimer** and **Responsible Use** terms below.

## Data Collection and Usage

### What Data We Access

The Extension accesses the following data only within your browser:

1. **Salesforce Session Cookies** — used to authenticate API requests to your Salesforce organization.
2. **Salesforce Instance URL** — to identify which Salesforce org you're working with.
3. **Salesforce Metadata and Records** — retrieved from your org via Salesforce APIs, including Apex debug logs, org limits, and (for the Component Inspector) Lightning Web Component source files.
4. **User Information** — basic profile information (name, email) from your Salesforce user account.

### How We Use This Data

All data accessed by the Extension is used exclusively to provide its features, including:

- Authenticating with your Salesforce organization.
- Retrieving and displaying debug logs, org limits, metadata, and records.
- Managing debug trace flags and sessions.
- Inspecting Lightning Web Components rendered on the page and, **at your explicit request**, reading and saving (deploying) the source of components your org owns.

### Reading and Writing Code (Component Inspector)

The Component Inspector can read the source of Lightning Web Components in your org via the Salesforce Tooling API. For components your org owns (unmanaged / unlocked), it can also **modify and deploy** that source back to your org **only when you explicitly choose to save a change**. These write operations:

- Are performed directly against your org's official Salesforce Tooling API using your existing session.
- Are subject to your Salesforce user's permissions; Salesforce enforces all access controls and validation.
- Are never performed automatically — every deploy requires your action, and deploys to production orgs require an additional explicit confirmation.

### Data Storage

- **Session Storage** — authentication credentials (session ID and instance URL) are held temporarily in the browser and cleared when the session ends.
- **Extension Storage** — your settings/preferences are stored locally in the browser and never leave your machine.
- **No Persistent Copies of Org Data** — the Extension does not permanently store your Salesforce records, logs, or code.
- **No Remote Servers** — all processing happens locally in your browser; no data is sent to servers operated by the Extension or its author.

## Data Sharing and Third Parties

**We do not share, sell, or transmit your data to any third parties.**

The Extension communicates only with your Salesforce organization's servers via official Salesforce APIs. No other external services are contacted.

## Permissions Explanation

- **activeTab** — to inject the Extension UI into Salesforce pages.
- **scripting** — to run content scripts that detect Salesforce pages.
- **storage** — to store your settings and temporary session credentials locally.
- **cookies** — to read Salesforce session cookies for authentication.
- **host_permissions** — to access Salesforce domains and make API calls to your org.

## Data Security

- All communication with Salesforce servers uses HTTPS encryption.
- Session credentials are kept in browser storage and cleared when the session ends.
- No data is transmitted to third-party servers.

## Disclaimer of Warranty and Limitation of Liability

**The Extension is provided "AS IS" and "AS AVAILABLE", without warranty of any kind**, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, accuracy, and non-infringement.

**You use the Extension entirely at your own risk.** To the maximum extent permitted by law, the author and contributors of SF Spotlight **accept no responsibility or liability for any loss, damage, data loss, corrupted or broken metadata, failed or unintended deployments, downtime, or any other harm** arising from or related to your use of the Extension — including, without limitation, any consequences of reading, editing, saving, or deploying Lightning Web Component source or any other metadata through the Extension.

You are solely responsible for any changes you make to your Salesforce organization using the Extension, and for ensuring you have appropriate backups, permissions, and authorization before making them.

## Responsible Use — Development, Not Production

**The Extension is intended for development and testing purposes.**

- **Do not edit or deploy code directly in production orgs using the Extension.** Use a sandbox, scratch org, or development environment instead.
- Changes made through the Component Inspector compile and deploy **immediately** to the targeted org. There is no automatic backup, version control, or undo.
- For production changes, use your organization's standard, source-controlled deployment process (e.g. version control, CI/CD, change sets, or the Metadata API) with proper review and testing.
- Always verify changes in a non-production environment first, and keep your own backup of any source you modify.

When you attempt to save a change to a production org, the Extension will warn you and require an explicit confirmation — but the decision, and any consequences, remain entirely yours.

## Your Data Rights

- **Access** — all data displayed is retrieved in real time from your Salesforce org.
- **Deletion** — removing the Extension immediately clears all locally stored session data and settings.
- **Control** — you can revoke access by logging out of Salesforce or removing your session.

## Changes to This Policy

We may update this policy from time to time. Changes are reflected in the "Last Updated" date above. Continued use after changes constitutes acceptance of the updated policy.

## Contact Information

- Open an issue on our [GitHub repository](https://github.com/praveen420coder/sf-log-analyzer)
- Contact: kumar.praveen.sfdev@gmail.com

## Compliance

This Extension is designed to align with:

- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)

## Open Source

This Extension is open source. You can review the complete source code at:
https://github.com/praveen420coder/sf-log-analyzer

---

**Summary:** SF Spotlight processes all data locally in your browser and shares nothing with third parties. It is a development tool, provided as-is with no warranty and no liability for any harm; do not use it to edit or deploy code directly in production.

> This document is provided for general informational purposes and is not legal advice. Consider having a qualified lawyer review it before you rely on it for your published listing.
