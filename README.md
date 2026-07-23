# SF Spotlight

A Salesforce log analysis tool available as both a **browser extension** and **web application**. The browser extension integrates directly with Salesforce, automatically extracting your credentials to fetch and analyze ApexLogs.

## Quick Start - Browser Extension

The easiest way to use SF Spotlight is as a Chrome/Firefox extension that auto-detects your Salesforce session.

### Installation

1. **Build the extension:**
   ```bash
   npm install
   npm run build
   ```

2. **Load into browser:**
   - **Chrome:** Open `chrome://extensions/` → Enable "Developer mode" → Click "Load unpacked" → Select `dist/` folder
   - **Firefox:** Open `about:debugging` → Click "Load Temporary Add-on" → Select `public/manifest.json`

3. **Start backend server:**
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   Server runs on `http://localhost:5000`

4. **Use the extension:**
   - Log into your Salesforce instance
   - Click the **SF Spotlight** icon in your browser toolbar
   - Extension automatically detects your credentials
   - Click **Fetch Session Logs** to view your ApexLogs

See [EXTENSION_SETUP.md](EXTENSION_SETUP.md) for detailed setup and troubleshooting.

## Alternative: Web Application

For web-based usage without installing an extension:

### Installation & Setup

#### 1. Frontend Setup
From the root directory:

```bash
npm install
npm run dev
```

Frontend will start on `http://localhost:5173`

#### 2. Backend Setup
In a new terminal, navigate to the backend:

```bash
cd backend
npm install
npm run dev
```

Backend will start on `http://localhost:5000`

**Important**: The frontend expects the backend to be running on port 5000. Make sure both servers are running for full functionality.

### Web App Usage

1. Enter your Salesforce Instance URL
2. Enter your Authentication Token/Session ID
3. Click "Fetch Logs"
4. Browse and analyze your Salesforce ApexLogs

## Features

SF Spotlight is a Salesforce developer toolkit that lives inside your org, with auto-detected credentials (nothing is stored — session ids are read live from cookies).

- **🔎 Spotlight Search** - One search box across Setup, objects, flows, users, permissions, apps and your own tools
- **🐞 Log Explorer & Apex Log Analyzer** - Fetch, filter and analyze debug logs (timeline, call tree, SOQL/DML, insights, governor limits)
- **🌊 Flow Manager** - View every flow's active/latest version and activate, deactivate or open flows (and any specific version)
- **✅ Validation Rule Manager** - Activate, deactivate and open validation rules by object
- **🧩 Metadata Explorer** - Browse metadata types and their records
- **🧪 Apex Test Runner** - Run tests and watch results with coverage
- **🛠️ Object Manager** - Create objects and fields with FLS
- **⚡ Execute Anonymous, REST Explorer, Where Used, Org Limits & more** - A full Tools drawer
- **🔔 In-panel notifications** - A stacked toast system with fetch confirmations across every tool
- **⚙️ Rebuilt Settings** - Appearance, drag-and-drop tab ordering, cache/history, notifications, API version, Data Export, connection manager and usage stats
- **🔐 Auto-Detection** - Automatic credential extraction from your Salesforce session
- **🛡️ TypeScript** - Fully type-safe, Chrome Manifest V3

## Tech Stack

- **React 19** - UI library
- **TypeScript** - Type-safe development
- **Vite** - Build tool
- **Express** - Backend API
- **Tailwind CSS** - Styling
- **Chrome Manifest V3** - Extension specification

## Architecture

### Browser Extension Flow

```
Salesforce Page
    ↓
Content Script (extracts credentials)
    ↓
Extension Storage
    ↓
Popup UI (loads React)
    ↓
Background Script (message handler)
    ↓
Backend API
    ↓
Salesforce Tooling API
```

### Backend API

The backend provides RESTful endpoints for log management:

- `GET /api/logs?instanceUrl=X` - Fetch ApexLogs from Salesforce
- `GET /api/logs/:id` - Get single log details
- `GET /api/logs/stats` - Get log statistics
- `GET /api/logs/search?q=query` - Search logs
- `GET /api/health` - Health check

See [backend/README.md](backend/README.md) for complete API documentation.

## Project Structure

```
sf-log-analyzer/
├── src/
│   ├── ExtensionApp.tsx          # Extension popup component
│   ├── extension-main.tsx        # Extension entry point
│   ├── App.tsx                   # Web app version
│   ├── hooks/
│   │   ├── useExtensionLogAPI.ts # Extension API hook
│   │   └── useLogAPI.ts          # Web API hook
│   ├── components/               # Shared UI components
│   └── types/                    # TypeScript types
├── public/
│   ├── manifest.json            # Extension manifest
│   ├── content.js               # Content script
│   ├── background.js            # Background service worker
│   └── popup.html               # Extension popup
├── backend/                      # Express server
│   ├── src/
│   │   ├── server.ts
│   │   ├── controllers/
│   │   ├── routes/
│   │   └── data/
│   └── package.json
├── EXTENSION_SETUP.md           # Extension setup guide
└── README.md                    # This file
```

## Development

### Build Extension
```bash
npm install
npm run build
```

### Start Development Servers

**Terminal 1 - Frontend:**
```bash
npm run dev
```

**Terminal 2 - Backend:**
```bash
cd backend
npm run dev
```

### Scripts

**Frontend:**
- `npm run dev` - Dev server
- `npm run build` - Production build
- `npm run lint` - Linting
- `npm run preview` - Preview build

**Backend:**
- `cd backend && npm run dev` - Dev server
- `cd backend && npm run build` - Build
- `cd backend && npm start` - Production

## Browser Support

| Browser | Extension | Web App |
|---------|-----------|---------|
| Chrome  | ✅ Yes    | ✅ Yes  |
| Edge    | ✅ Yes    | ✅ Yes  |
| Firefox | ✅ Yes    | ✅ Yes  |
| Safari  | ⚠️ Soon   | ✅ Yes  |

## Troubleshooting

See [EXTENSION_SETUP.md](EXTENSION_SETUP.md#troubleshooting) for detailed troubleshooting guides.

### Common Issues

- **Extension not detecting credentials?** - Ensure you're on a Salesforce page and logged in
- **Backend not connecting?** - Verify `npm run dev` is running in the backend folder
- **Logs not displaying?** - Check browser console (F12) for errors

## Contributing

This project is open to contributions. Please feel free to submit issues and pull requests.

## License

MIT - Your Salesforce log analysis tool
