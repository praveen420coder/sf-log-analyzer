# SF Spotlight — Component Inspector

> Marketing one-pager / release-notes copy for the Component Inspector feature.

## Headline

**See every Lightning Web Component on the page — then edit it without leaving Salesforce.**

## One-liner

Component Inspector turns any Salesforce page into a live map of its LWCs: hit a key, see every custom component outlined with its name, click to read the source, and — for your own components — edit and deploy right from the browser.

## The hook (elevator pitch)

You're staring at a Lightning page wondering *which* component renders that section, what it's called, and where its code lives. Today that means digging through Setup, guessing developer names, and flipping over to VS Code. Component Inspector collapses that into one keystroke: **Alt + Z** (Windows) / **Option + Z** (Mac) outlines every custom LWC on the page with its name. Click one to read its HTML, JS, CSS, and metadata instantly. If it's your org's own component, edit it inline and deploy — with production guardrails built in.

## What it does

- **One-key reveal.** Alt/Option + Z highlights every custom LWC on the current page with a labeled border — instant visual map of what's rendering and what it's called.
- **Click to read.** Open any component's real source (html / js / css / js-meta.xml) in a clean, tabbed viewer, pulled live via the Salesforce Tooling API. Copy any file in a click.
- **Edit & deploy in place.** For your org's own components, switch to edit mode and push changes back without opening an IDE — ideal for quick fixes and learning.
- **Production guardrails.** Deploys are confirmed every time. On a production org you get a red warning and a required "I understand this edits production" checkbox before anything ships. Sandbox vs. production is detected automatically.
- **Deploy verification.** After every save, SF Spotlight re-reads the component from the org and confirms the change actually landed — "Deployed and verified," not just "request sent."
- **Knows what's yours.** Managed-package and base components are clearly marked read-only; only your own components are editable.

## Who it's for

Salesforce developers, admins-who-tinker, consultants jumping between orgs, and anyone onboarding onto an unfamiliar codebase who needs to map a page to its components fast.

## Why it's different

Existing inspectors (including Salesforce's own) can show a component tree — but they stop at *viewing*. Component Inspector goes from **page → component → source → safe deploy** in a single panel, on the page you're already looking at. No context switch, no IDE, no guesswork.

## Taglines (pick one)

- *"Right-click for the web. Alt+Z for Salesforce."*
- *"From 'which component is that?' to deployed fix — without leaving the tab."*
- *"X-ray vision for Lightning pages."*
- *"See it. Read it. Fix it. Ship it."*

## Suggested release-notes blurb

**New: Component Inspector.** Press Alt/Option + Z on any Salesforce page to highlight every Lightning Web Component with its name. Click to view the full source (HTML/JS/CSS/meta), and edit & deploy your own components inline — with automatic production warnings and post-deploy verification so you always know the change landed.

---

### Notes for positioning (internal)

- Lead with the *inspection* benefit (broad appeal, zero risk); treat *edit & deploy* as the "wow," not the headline, since it's power-user territory.
- Always pair "edit & deploy" with "guardrails / production warnings / verified" in the same breath — it converts a scary capability into a trustworthy one.
- Honest scope: editing works on org-owned (unmanaged/unlocked) components; managed-package and base components are view-only by design.
