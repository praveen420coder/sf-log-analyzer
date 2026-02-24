# Host Permissions Justification for SF Log Analyzer

## Extension Purpose

SF Log Analyzer is a developer tool designed for Salesforce administrators and developers to analyze debug logs directly from their Salesforce environment. The extension retrieves debug logs via Salesforce's official REST APIs and provides enhanced analysis capabilities within the Salesforce interface.

## Core Functionality Requirements

The extension requires host permissions to perform four essential functions:

1. **Authentication**: Read Salesforce session cookies (`sid`) to authenticate REST API requests without requiring users to re-enter credentials
2. **API Access**: Make authenticated calls to Salesforce Tooling API and Data API to retrieve debug logs, trace flags, and user information
3. **UI Injection**: Inject the analyzer interface into Salesforce pages for seamless integration with the user's workflow
4. **Real-time Data Retrieval**: Fetch and display debug logs, manage trace flags, and provide log analysis in real-time

## Why Each Domain Pattern Is Required

### Standard Salesforce Domains

**`*.salesforce.com`** - Primary production domain covering hundreds of Salesforce instances (e.g., `na1.salesforce.com`, `cs42.salesforce.com`, `ap5.salesforce.com`). This domain is essential for accessing standard Salesforce orgs.

**`*.salesforce-setup.com`** - Required for orgs using MyDomain with custom URLs. Many enterprises use this domain for branding (e.g., `mycompany.salesforce-setup.com`).

**`*.force.com`** - Critical for MyDomain instances which became mandatory for all Salesforce orgs in Winter '22. Modern Salesforce orgs primarily use this domain pattern (e.g., `mycompany.my.salesforce.com`).

**`*.lightning.force.com`** - Covers Lightning Experience interface domains. Essential for users working in Lightning Experience, which is now the standard Salesforce UI.

### Visualforce Domains

**`*.visualforce.com` and `*.vf.force.com`** - Visualforce pages are served from separate domains for security isolation. Many Salesforce applications and custom pages use Visualforce, making these domains essential for comprehensive Salesforce access.

### Legacy and Regional Domains

**`*.cloudforce.com`** - Legacy Salesforce domain still used by some older instances and sandboxes. Required for backward compatibility.

**`*.sfcrmapps.cn` and `*.sfcrmproducts.cn`** - Chinese Salesforce instances operated by Alibaba Cloud. Required for users in China and organizations with Chinese Salesforce orgs.

### Government and Compliance

**`*.salesforce.mil`, `*.force.mil`, `*.cloudforce.mil`, `*.visualforce.mil`, `*.crmforce.mil`** - US Government Cloud instances that are FedRAMP certified. Required for federal, state, and local government customers who must use these dedicated government cloud environments.

### Enterprise Security

**`*.force.com.mcas.ms`** - Organizations using Microsoft Defender for Cloud Apps route Salesforce traffic through Microsoft's security proxy. This domain is essential for enterprise customers with advanced security requirements.

### Experience Cloud

**`*.builder.salesforce-experience.com`** - Experience Builder (formerly Community Builder) domains for Salesforce Experience Cloud sites and customer/partner portals.

## API Endpoints Accessed

All host permissions enable access to the following Salesforce REST API endpoints:

**Tooling API** (Primary functionality):
- `GET /services/data/v*/tooling/query` - Query ApexLog, TraceFlag, and DebugLevel objects
- `GET /services/data/v*/tooling/sobjects/ApexLog/{Id}/Body` - Retrieve actual log file content
- `POST /services/data/v*/tooling/sobjects/TraceFlag` - Create debug trace flags to start logging sessions
- `DELETE /services/data/v*/tooling/sobjects/TraceFlag/{Id}` - Stop debug sessions
- `POST /services/data/v*/tooling/sobjects/DebugLevel` - Create custom debug level configurations

**Data API**:
- `GET /services/data/v*/chatter/users/me` - Retrieve current user profile information
- `GET /services/data/v*/query` - Query User records for debug session management

**Bulk API**:
- `POST /services/data/v*/jobs/ingest` - Efficiently delete multiple debug logs in batch operations

## Why Wildcard Patterns Are Necessary

Salesforce uses a complex multi-tenant architecture with dynamic instance assignment. There are several hundred production instances (`na1` through `na200+`, `cs1` through `cs150+`, plus `ap`, `eu`, and other regional instances). Sandbox instances use customer-specific subdomains that are unpredictable and created on-demand.

Wildcard patterns are required because:
- Users frequently work across multiple Salesforce orgs (production, sandboxes, multiple enterprises)
- Instance domains are dynamically assigned by Salesforce infrastructure
- Sandbox names are customer-specific and cannot be predicted
- No public registry exists of all possible Salesforce instance domains
- MyDomain allows unlimited custom subdomain variations

Alternative approaches are not viable:
- **Specific domain lists**: Would require thousands of entries and break when users access new orgs or Salesforce provisions new instances
- **User-inputted domains**: Creates poor user experience and security risks from mistyped domains
- **activeTab permission only**: Insufficient for reading cookies and making API calls necessary for core functionality

## Data Privacy and Security

The extension implements strict privacy and security measures:

**No External Data Transmission**: All data remains exclusively between the user's browser and their Salesforce organization. The extension does not communicate with any third-party servers or external services.

**Local Processing**: All log analysis, parsing, and visualization happens locally in the browser. No data is uploaded to external servers for processing.

**Session-Only Storage**: Authentication credentials are stored only in Chrome's session storage and are automatically cleared when the browser session ends. No persistent storage of credentials occurs.

**Read-Only Cookie Access**: The extension reads Salesforce session cookies but cannot modify them, minimizing security risks.

**HTTPS Encryption**: All API communications use HTTPS encryption provided by Salesforce's secure endpoints.

**No Password Storage**: The extension never accesses or stores user passwords, relying entirely on existing Salesforce session authentication.

## Verification and Transparency

This extension is open source, allowing complete transparency:
- Full source code available at: [GitHub Repository URL]
- Chrome Web Store reviewers can verify all network requests go exclusively to Salesforce domains
- Users can inspect the code to confirm no unauthorized data collection
- No obfuscated code or hidden functionality

**Summary**: Host permissions are essential for SF Log Analyzer to authenticate with and retrieve debug logs from any Salesforce organization across all official deployment types (production, sandbox, government, international, and specialized cloud environments). The wildcard domain patterns are necessary due to Salesforce's dynamic multi-tenant architecture and are limited strictly to official Salesforce domains.
