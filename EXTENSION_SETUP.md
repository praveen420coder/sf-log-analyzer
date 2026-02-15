# Browser Extension Setup Guide

This project now includes a browser extension that integrates directly with Salesforce, automatically extracting your instance URL and session ID to avoid manual credential entry.

## Architecture

### Extension Components

1. **manifest.json** - Extension configuration (Chrome Manifest V3)
2. **content.ts** - Runs on Salesforce pages, extracts credentials (compiled to content.js)
3. **background.ts** - Service worker, handles messaging and API calls (compiled to background.js)
4. **popup.html** - Extension popup UI (loads React app)
5. **ExtensionApp.tsx** - React component for extension popup
6. **useExtensionLogAPI.ts** - Hook for extension-based API calls

All TypeScript source files (.ts, .tsx) are compiled to JavaScript during the build process.

## Building the Extension

### 1. Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..
```

### 2. Build the Extension

```bash
npm run build
```

This creates a `dist/` folder with all compiled files:
- `popup.html` - Extension popup page
- `main.js` - Extension popup script (React)
- `content.js` - Content script (compiled from TypeScript)
- `background.js` - Background service worker (compiled from TypeScript)
- `manifest.json` - Extension manifest (copied from public)

The TypeScript files (`src/extension/content.ts` and `src/extension/background.ts`) are automatically compiled to JavaScript during the build.

## Installation Instructions

### Chrome/Chromium

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `dist/` folder from your project
5. Extension appears in your Chrome toolbar

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `public/manifest.json`
4. Extension loads temporarily (persists until browser restart)

For permanent installation, package as `.xpi` using Firefox's web-ext tool.

## Usage

### Prerequisites

1. **Salesforce Account** - Must be logged into a Salesforce instance
2. **Backend Server** - Running on `http://localhost:5000`
3. **Browser** - Chrome, Edge, or Firefox with extension installed

### Steps

1. **Log in to Salesforce** 
   - Go to your Salesforce org (production or sandbox)
   - Ensure you're logged in

2. **Run Backend Server**
   ```bash
   cd backend
   npm run dev
   ```
   Should output: `🚀 Server running on http://localhost:5000`

3. **Open Extension**
   - Click the **SF Log Analyzer** extension icon in your toolbar
   - The popup opens and automatically:
     - Detects your Salesforce instance URL
     - Extracts your session ID
     - Shows connection status

4. **Fetch Logs**
   - Click **Fetch Session Logs** button
   - View your Salesforce ApexLogs in the dashboard
   - Click any log to see details

## How It Works

### Credential Extraction

The extension automatically extracts Salesforce credentials without user input:

```
User in Salesforce Page
        ↓
Content Script Detects SF Page
        ↓
Extracts: Instance URL + Session ID
        ↓
Stores in Extension Storage
        ↓
Popup Retrieves on Open
        ↓
Auto-fills in UI
```

### Data Flow

```
Extension Popup
        ↓
useExtensionLogAPI Hook
        ↓
Background Script (chrome.runtime.sendMessage)
        ↓
Backend API (http://localhost:5000/api/logs)
        ↓
Salesforce Tooling API
        ↓
ApexLogs
        ↓
Display in Dashboard
```

## Manifest Permissions

The extension requests:

| Permission | Purpose |
|-----------|---------|
| `activeTab` | Access current tab info |
| `scripting` | Run content scripts |
| `storage` | Store session credentials |
| `host_permissions` | Access Salesforce pages |

## Development

### Modify Extension

1. Edit TypeScript source files:
   - `src/ExtensionApp.tsx` - Popup UI
   - `src/extension/content.ts` - Credential extraction logic
   - `src/extension/background.ts` - Message handling and API proxying
   - `src/hooks/useExtensionLogAPI.ts` - Extension API hook

2. Rebuild (TypeScript is automatically compiled to JavaScript):
   ```bash
   npm run build
   ```

3. Reload in browser:
   - Chrome: Click reload icon on extensions page
   - Firefox: Click reload button in about:debugging

### Debug

**Content Script:**
```
Right-click Salesforce page → Inspect → Console
```

**Background Script:**
```
Chrome: Extensions page → SF Log Analyzer → Service Worker
Firefox: about:debugging → SF Log Analyzer → Inspect
```

**Popup:**
```
Extension Menu → Inspect Popup
```

## Troubleshooting

### "Could not extract Salesforce credentials"

- Ensure you're on a Salesforce page (salesforce.com or force.com domain)
- Reload the Salesforce page
- Reload the extension
- Check console for errors (Right-click → Inspect)

### "Not authenticated with Salesforce"

- You're not logged in to Salesforce
- Log in to your Salesforce org
- Reload the extension popup

### Backend not connecting

- Verify backend is running: `npm run dev` in `/backend`
- Check port 5000 is available
- No firewall blocking localhost:5000

### Logs not appearing

- Confirm Salesforce credentials are shown in popup
- Check backend console for API errors
- Verify instance URL and session ID are correct
- Check browser console for JavaScript errors

## Security

- Session ID is stored only in extension storage
- Never transmitted to extension store
- Credentials cleared on extension uninstall
- Backend validates all requests to Salesforce

## File Structure

```
sf-log-analyzer/
├── src/
│   ├── ExtensionApp.tsx          # Extension popup component
│   ├── extension-main.tsx        # Extension entry point
│   ├── App.tsx                   # Web version (optional)
│   ├── extension/                # TypeScript extension scripts
│   │   ├── content.ts            # Content script (compiled to content.js)
│   │   └── background.ts         # Background service worker (compiled to background.js)
│   ├── hooks/
│   │   ├── useExtensionLogAPI.ts # Extension-specific API hook
│   │   └── useLogAPI.ts          # Web version API hook
│   └── components/               # Shared UI components
├── public/
│   ├── manifest.json            # Extension manifest
│   └── popup.html               # Popup entry point
├── backend/
│   └── src/
│       ├── server.ts
│       ├── controllers/          # API handlers
│       ├── routes/               # API routes
│       └── data/                 # Database layer
└── vite.config.ts               # Vite build config (multi-entry)
```

## Next Steps

1. Build: `npm run build`
2. Load extension into browser
3. Start backend: `cd backend && npm run dev`
4. Log into Salesforce
5. Click extension icon → Fetch Logs

## Support

For issues, check:
- Browser console (F12)
- Extension service worker logs
- Backend console output
