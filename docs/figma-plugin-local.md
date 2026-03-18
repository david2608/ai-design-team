# Figma Plugin Local Instructions

## Build

Run:

`pnpm dev:figma-plugin`

Make sure the API is already running:

`pnpm dev:api`

This builds the plugin bundle into:

- [dist/code.js](/Users/davit/Documents/Codex/ai-design-team-mvp/apps/figma-plugin/dist/code.js)
- [dist/index.html](/Users/davit/Documents/Codex/ai-design-team-mvp/apps/figma-plugin/dist/index.html)

## Load In Figma

1. Open Figma desktop.
2. Go to `Plugins` -> `Development` -> `Import plugin from manifest...`
3. Select [manifest.json](/Users/davit/Documents/Codex/ai-design-team-mvp/apps/figma-plugin/manifest.json)
4. Run the plugin from `Plugins` -> `Development`

## Local Behavior

- The plugin reads current selection context from the Figma document.
- It sends workflow requests to the backend at `FIGMA_PLUGIN_API_BASE_URL`.
- It never calls model APIs directly.
- It can request revisions for the latest project created from the plugin UI.

## Before Running

Make sure these are already running:

- API server on `http://127.0.0.1:3000`
- database migrations
- Telegram bot if you want mirrored summaries

If you also want Telegram mirroring locally, start:

`pnpm dev:telegram-bot`
