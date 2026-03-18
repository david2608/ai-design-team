# AI Design Team MVP

Phase 3 Telegram ingress and project flow for the approved generator-first Telegram MVP.

## Active workspace

- `apps/api`
- `apps/worker`
- `apps/figma-plugin` placeholder only
- `packages/types`
- `packages/db`
- `packages/core`
- `packages/ai`
- `packages/integrations-telegram`
- `packages/integrations-openai`
- `packages/integrations-figma`
- `packages/utils`

## Architecture baseline

- generator-first
- artifact-first
- API + worker only
- persisted design artifact is the primary deliverable
- Telegram ingress and delivery run through adapter boundaries
- Figma is optional and non-blocking

## Setup

1. `pnpm install`
2. `pnpm setup:local`
3. Fill in `.env`, `apps/api/.env.local`, and `apps/worker/.env`
4. `pnpm db:migrate`
5. Optional: `pnpm db:seed`

## Run

- `pnpm dev:api`
- `pnpm dev:worker`
- `pnpm dev:figma-plugin`

`apps/api` now accepts Telegram webhook updates at `/telegram/webhook`, and `apps/worker` delivers compact artifact messages with Finish / Revise callbacks when a Telegram binding exists.

## Gemini defaults

- Gemini is the default generation provider for new Telegram threads unless the user explicitly sends `use_gpt`.
- Planning defaults to `GEMINI_MODEL=gemini-2.5-pro`.
- Rendering defaults to `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview`.
- For higher-end rendering, you can switch `GEMINI_IMAGE_MODEL` to `gemini-3-pro-image-preview`.
- Uploaded Telegram images are passed through as real model inputs during generation.

## Build and typecheck

- `pnpm build`
- `pnpm typecheck`

## Deploy

- The database can stay on Supabase through `POSTGRES_URL`.
- `apps/api` and `apps/worker` still need stable hosting outside your laptop.
- A minimal Render blueprint is included in [render.yaml](/Users/davit/Documents/Codex/ai-design-team-mvp/render.yaml):
  - web service: `ai-design-team-api`
  - background worker: `ai-design-team-worker`
- After the API is live, point Telegram webhook to:
  - `https://YOUR_API_HOST/telegram/webhook`

## Phase 3 scope

- Telegram webhook normalization for plain text, callback actions, and `/stop`, `/debug_on`, `/debug_off`
- Project creation and continuation from Telegram conversation state
- Binding-scoped debug toggle and revision follow-up capture
- Queue-safe job enqueue from Telegram without running generation in the API request path
- Basic Telegram artifact delivery with inline Like / Dislike / Revise actions
- Existing Phase 2 runtime backbone for jobs, artifacts, approvals, revisions, stop, and recovery

## Not included yet

- Full AI pipeline behavior
- Narrator-first workflow contracts
- Portal, billing, or future assistant modules
- Figma MVP runtime behavior
- Old Telegram formatter/runtime migration
