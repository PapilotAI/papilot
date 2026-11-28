# Development and internals

Developer setup, automated verification, website statistics operations, release procedures and review-engine architecture for Papilot. For everyday writing and troubleshooting, see the [user guide](guide.md) ([简体中文](guide.zh-CN.md)). For pull-request basics, start with [Contributing](../.github/CONTRIBUTING.md).

Papilot is built with TypeScript, React/Vite, Fastify, `node:sqlite`, Electron, the official Codex app-server over stdio, the bundled Pi SDK for Papilot Writer, native Pi over RPC, the Claude and Cursor SDKs, the Antigravity CLI, ZCode CLI, and ACP adapters for Copilot, Grok, Kimi, DeepSeek, Qwen, OpenCode, Qoder, CodeBuddy and WorkBuddy (plus the VS Code extension in `vscode/`).

## Local development and checks

You need Node.js **22.22+**, npm, Git and a full TeX distribution with `latexmk` and `synctex`. With [Nix](nix.md), `nix develop` supplies these tools inside the checkout. For native Windows PowerShell commands and desktop smoke tests, see [Windows setup](windows.md).

```sh
npm ci
npm run setup:review   # install and build engine/
npm run build
npm start              # http://127.0.0.1:7274
```

`npm run dev` watches the TypeScript backend. After frontend changes, run `npm run build` and reload the browser; the server serves rebuilt assets without a restart. Rebuild `engine/` (`npm --prefix engine run build`) when the embedded review viewer changes. Backend restarts interrupt active agent turns, so wait for running tasks to finish first.

A source checkout stores its state in `.papilot` inside the checkout, and `npm run demo` registers the disposable example paper (`examples/papilot-paper`). To develop alongside an existing Papilot instance, pass a separate port and data directory:

```sh
PAPILOT_PORT=7276 PAPILOT_DATA="$HOME/.papilot-dev" PAPILOT_PUBLIC_ORIGIN= npm run dev
```

### Verification commands

```sh
npm run typecheck
npm test
npm run build
npm run test:ui
npm --prefix engine run check
npm run i18n -- check
npm run i18n:check-app
npm run test:site
```

- **Backend and unit tests (`npm test`)** cover restart recovery, access restrictions, review proxy routes, Codex RPC, worktree reservations, stale events, uncertain-operation reconciliation, rebuilt frontend assets, localization pipelines, and draft preservation during feedback, retries and concurrent editing. Codex recovery uses the bundled CLI's generated protocol definitions and the [official app-server protocol](https://developers.openai.com/codex/app-server): it matches the pending message identity before adopting a turn and never treats a transport timeout as proof that a turn stopped.
- **Browser checks (`npm run test:ui`)** use Playwright from `engine/node_modules` and an installed Chrome browser (`PAPILOT_BROWSER_CHANNEL=chromium` in CI). They exercise keyboard focus, desktop and mobile layouts, light and dark themes, the PDF viewer (contents, paging, zoom, search, text/region/sticky/quick notes, anchors, peek and cropping) against disposable fixtures, request failures, navigation during submission, stale snapshots, unanswered agent requests, blocked browser storage, connection recovery, long conversations, Overleaf sync and Git workflows. Browser checks use an isolated local server and simulated task data; they never call live models or modify real manuscripts.
- **Live sample smoke (`scripts/verify-demo.ts --allow-example-writes`)** is an opt-in integration check for the generated `.papilot/example-paper` sample only. After real Codex turns and a reviewer-requested second round, it checks conflict rejection, accepted changes from independent worktrees, undo and proxied SVG delivery. Its safety guard refuses to run against any other repository.

## Website, documentation and translations

The static website at [papilot.ai](https://papilot.ai/) lives in `site/` and builds into `_site` via `npm run site` (`scripts/build-site.mjs`).

- **Homepage (`site/index.html`)**: English and Simplified Chinese are authored side by side in `lang="en"` and `lang="zh-CN"` spans (with Chinese attribute values in `data-zh-*`). The build reads every non-English locale, including `zh-CN`, from `site/locales/<locale>.json`, so `site/locales/zh-CN.json` must match the inline Chinese spans. Translate or check other locales with `npm run i18n -- translate --scope site` and `npm run i18n -- check --scope site` (see [i18n/README.md](../i18n/README.md)).
- **Product windows**: The homepage's product demonstrations are drawn in HTML and CSS rather than video. A script in `site/index.html` loops each scene while visible, pauses offscreen, in background tabs, under the pointer or when explicitly paused, and yields to keyboard/pointer interaction where controls are live. `prefers-reduced-motion: reduce` and no-JavaScript environments show complete static states. When shared UI illustrations change, run `npm run readme:showcase` to recapture `docs/assets/readme-showcase/` and `docs/assets/social-preview.png`.
- **User documentation (`/guide/` and `/zh-CN/guide/`)**: `docs/guide/` (`docs/guide/manifest.json`) is the single source of truth for user documentation. `scripts/site-docs.mjs` builds static HTML pages with grouped sidebar navigation, client-side search indexes (`search-<locale>.json`), copyable code blocks, accessible tables, checked internal/asset links, and build-time code tokens injected from `src/shared.ts`, `package.json`, and `i18n/languages.json`. `docs/guide.md` and `docs/guide.zh-CN.md` are slim GitHub directory hubs that preserve inbound `#anchor` links without duplicating prose.
- **Blog (`/blog/`)**: `scripts/site-blog.mjs` builds localized articles from `site/blog/posts/`.
- **Verification**: `npm run test:site` builds `_site` (including the static `/demo` playground) and runs Playwright checks across desktop and phone viewports, themes, reduced motion, no-JavaScript rendering, SEO links, privacy controls and mocked analytics.

### Privacy notice and Umami statistics

The bilingual notice at `/privacy/` lives in `site/privacy.html`. The homepage footer includes a translated privacy-notice link as its sole privacy/statistics entry. Statistics controls live on `/privacy/`, which loads only local `statistics-preferences.js` and never loads Umami or `analytics.js`, and remains readable without JavaScript. Update `site/privacy.html` whenever the operator, purposes, service, region or retention settings change. `node scripts/check-site-privacy.mjs` validates the page.

When production configuration is set, [Umami](https://docs.umami.is/docs/collect-data) statistics start on by default on HTTPS `papilot.ai` and `www.papilot.ai`. Visitors can opt out or re-enable statistics on `/privacy/`. The preference is stored in `localStorage` as `papilot-statistics-disabled` (`true` or `false`) without automatic expiry and propagates across open tabs via `storage` and `BroadcastChannel`. Legacy refusals in `papilot-statistics-consent`, browser DNT/GPC signals, `umami.disabled`, or unreadable `localStorage` disable collection. Failed `localStorage` writes still disable collection in the current document and broadcast to open tabs.

When enabled, pageviews record the localized path and reduce referrers to their origin, stripping query strings, fragments, UTM parameters and click IDs. Interaction events use fixed categories (`site/analytics.js`):

| Event | Records |
| --- | --- |
| `navigation` | Navigation to a page section or the homepage through header, hero or footer links. |
| `outbound_click` | Clicks to GitHub, releases, npm, documentation, changelog, license, discussions, Discord or TeX distributions, identified by fixed destination categories. |
| `menu_open` | Opening a download or language menu. |
| `download_click` | Choosing a specific installer, with platform, architecture, package format and placement. |
| `copy_install` / `copy_install_failed` | Copying an install command, without clipboard contents or error text. |
| `language_change` | Selecting a language by locale code. |
| `theme_change` | Choosing light or dark appearance. |
| `demo_interaction` | Interacting with homepage product windows (accept, reject, reopen, source toggle or workflow controls). |
| `section_view` | A main section or feature window staying at least half visible for 1 second. |
| `scroll_depth` | Newly reached scroll milestones at 25%, 50%, 75% and 100%. |
| `engaged_time` | Visible-page milestones at 15, 30, 60 and 120 seconds (excluding hidden-tab time). |

Automatic demo loops do not emit user events, and no typed text, clipboard contents, account IDs, session replays or heatmaps are collected.

Cookieless collection still processes personal data (such as IP addresses and User-Agent headers in Umami and infrastructure logs; see Umami's [metric definitions](https://docs.umami.is/docs/metric-definitions) and [FAQ](https://docs.umami.is/docs/faq)). Before enabling statistics in production, the operator must verify the legal basis and local ePrivacy/GDPR consent rules (see [CNIL guidance](https://www.cnil.fr/fr/node/677) and [European Commission transparency guidance](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en)), review processor terms ([Umami DPA](https://umami.is/dpa), [subprocessors](https://umami.is/subprocessors), [Cloud FAQ](https://docs.umami.is/docs/cloud/faq)), publish an accurate privacy notice, and configure these GitHub Actions variables together (or leave all three unset to disable statistics):

| Variable | Value |
| --- | --- |
| `PAPILOT_UMAMI_SCRIPT_URL` | Full HTTPS tracker script URL (Umami 2.18+ with `before-send`). |
| `PAPILOT_UMAMI_WEBSITE_ID` | Website UUID from the tracking snippet. |
| `PAPILOT_ANALYTICS_PRIVACY_URL` | Public HTTPS URL of the site's privacy notice. |

Run the **Site** workflow after changing variables. `node scripts/check-site-analytics.mjs` tests the full flow offline.

## Releases

Follow [.github/workflows/release.yml](../.github/workflows/release.yml) and [Papilot Desktop](../desktop/README.md):

1. Review commits, merged pull requests and linked issues since the previous tag so release notes cover the delivered scope and credit external contributors and issue reporters with verified GitHub handles and links.
2. Update `package.json`, `package-lock.json`, `CHANGELOG.md` (`## [x.y.z] - YYYY-MM-DD`) and `docs/releases/x.y.z/release-notes.md` consistently.
3. Verify `npm run typecheck`, `npm test`, `npm run i18n -- check`, `npm run i18n:check-app`, `npm run test:site` and affected native desktop/UI checks.
4. Commit and push tag `vx.y.z`. The **Release** workflow verifies tag/version consistency, builds and smoke-tests macOS, Windows and Linux installers, publishes to npm via [trusted publishing](https://docs.npmjs.com/trusted-publishers), creates the GitHub release `Papilot x.y.z`, and uploads the update manifest (`desktop.json`) last. When correcting published notes later, update both `docs/releases/x.y.z/release-notes.md` and the GitHub release body.

## Review engine architecture

`engine/` is Papilot's PDF build and comparison service (documented in [engine/docs/reference.md](../engine/docs/reference.md) and [Compilation performance](performance.md)):

- Compiles isolated Git snapshots with warm `latexmk` (or experimental PhiTeX) caches stored under `.git/papilot`, and maps diffs between LaTeX source and typeset PDF pages (see [Fine-grained PDF diffs](fine-grained-diff.md)).
- Compares full PDFs word by word when **Track indirect changes** is enabled to locate downstream layout or numbering changes.
- Parses `.bib` changes entry by entry (`engine/src/core/bib.ts`, `engine/src/core/verify.ts`, `GET /api/tasks/:name/rounds/:number/references`) for online verification against doi.org, arXiv, Crossref and DBLP.
- Papilot communicates with `engine/` exclusively over its public HTTP API and never writes its SQLite database directly. The embedded review proxy exposes only review assets and decision endpoints, never shutdown or task-deletion routes.

See also [Agent tools](agent-tools.md) and [Papilot Writer architecture](paper-agent.md) for agent runtime details.
