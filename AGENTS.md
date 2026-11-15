# Papilot development guide

Repository guidelines for coding agents working in Papilot. See [CONTRIBUTING](.github/CONTRIBUTING.md) for setup and pull request basics.

## Workflow

- Read the issue, PR discussion, screenshots, logs and relevant code before asking questions; ask only for missing details that change the diagnosis or decision.
- State the observable problem and expected behavior. Reproduce bugs along the reported path before patching when possible, and note what could or could not be reproduced.
- Carry tasks through implementation, verification, review and the requested delivery steps. If blocked, finish independent work first and report the specific blocker.
- Report the actual state clearly (investigating, proposed fix, verified locally, CI passed, merged, or released) along with what changed, what was tested, relevant links and any remaining limitations.

## Git and parallel work

- Check the current branch and diff, and keep commits focused on the intended change.
- Use a separate branch or worktree for independent changes or PRs, based on the target remote branch rather than assuming local `main` is current.
- When splitting investigation, implementation and review across agents, assign clear scope, acceptance criteria and file/worktree ownership under a single integrator.
- Have an independent reviewer check substantial behavior changes against the actual diff and acceptance criteria, then re-verify after resolving findings.
- Clean up temporary worktrees, branches, servers and files created for the task when finished.

## Implementation and verification

- Fix root causes simply and generally, following surrounding code conventions without fixture-specific special cases, redundant fallback layers, duplicated state or speculative abstractions.
- Add or update regression checks wired into the test suite and CI for behavior changes rather than standalone one-off scripts.
- Keep automated tests deterministic and free of live model calls, using disposable fixtures and isolated app data. When live-agent verification is needed, run it separately on disposable examples and report mock and live results separately.
- Run targeted checks while iterating, then the full checks for the changed scope. Diagnose failures and inspect artifacts rather than rerunning blindly or weakening assertions.
- For UI changes, exercise the built interface and inspect screenshots across affected desktop/mobile sizes, themes, interactions and states (loading, empty, error, recovery).
- For platform-specific bugs, verify on the reported platform or native CI covering the failure path, and state if only another OS or simulation was tested.
- For PDF/LaTeX changes, verify the generated document and the end-to-end review/compile path, not only source-level assertions.

## Web platform code

For HTML, CSS and client-side JavaScript or TypeScript in `src/web/`, `engine/src/web/`, `desktop/` windows and `site/`, follow [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) before writing ad hoc solutions or adding dependencies. Skip it for server, CLI, build, CI, test-only and copy-only changes.

Run the CLI pinned to an exact release, `npx -y modern-web-guidance@1.0.0 <command>`, never `@latest`: published npm versions are immutable, so a later compromised release cannot run in the checkout. Bump the version in a reviewed change.

1. Search once per platform capability or UI pattern with a generic 2–5 word query that names the UI primitive, without React, Papilot, file or manuscript names: `search "light dismiss dialog"`. If the results are weak, rephrase once with the concrete element (`dialog`, `popover`, `textarea`, `table`); if nothing matches, proceed without a guide.
2. Retrieve the matching guides together with the discipline guide that applies (`html`, `css`, `forms`, `accessibility`, `performance`, `security`): `retrieve "dialog,accessibility"`. When the CLI saves long output to a temporary file, read that file in full.
3. Adapt the vanilla examples to React without dropping the platform feature: call `showModal()` through refs, use `useId()` for per-instance IDs and anchor names, and keep `:root` and `@starting-style` rules unscoped. Check the result against the guide before finishing.
4. Name the guide IDs that shaped the change, and the pitfall each avoided, in the final report and PR description.

- Search runs locally, but the CLI reports queries and guide IDs as anonymous telemetry; set `DISABLE_TELEMETRY=1` to opt out. Grant network access to the pinned command only, never to bare `npx`; when offline, retry with `npx --offline` from the npm cache.
- Run `legacy-scan <path> --json` only for an explicitly requested broad modernization audit. Check each finding against its `keepWhen`/`dropWhen` rubric and keep intentional fallbacks.

The workspace and review viewer run in the Electron desktop app and in any desktop or mobile browser that opens the server, including iOS Safari over Tailscale; the site and playground are public. Browser support policy:

- Use Baseline Widely available features without fallbacks, matching Vite's default `baseline-widely-available` build target.
- Treat Newly available and limited-availability features as progressive enhancements: feature-detect APIs and apply the guide's fallback so the interface still works without them, as the code does for `requestIdleCallback` and `startViewTransition`. Electron support alone is not enough, except in windows that only Electron loads (`desktop/environment*`).
- Prefer graceful degradation or a small local fallback over polyfills and new dependencies. Do not opt into Origin Trial or volatile-feature guides (`.mwgrc`).

## Repository map and checks

Check `package.json` scripts and [.github/workflows/ci.yml](.github/workflows/ci.yml) for the current executable checks.

| Area | Location |
| --- | --- |
| Server, agent adapters, tasks, Git and compilation | `src/server/` |
| React workspace and shared types | `src/web/`, `src/shared.ts` |
| PDF comparison and review service/viewer | `engine/` (own npm package, lockfile and tests) |
| Electron runtime, updates and packaging | `desktop/`, `scripts/desktop*.mjs` |
| CLI, root tests and browser checks | `bin/`, `tests/`, `scripts/check-*.mjs` |
| Website, translations and user documentation | `site/`, `i18n/`, `docs/` |

- Requires Node.js **22.22+**, npm, Git and a full TeX distribution when exercising compilation. In a fresh checkout, run `npm ci`, `npm run setup:review` and `npm run build` (see [docs/nix.md](docs/nix.md) for Nix).
- `npm run dev` watches the backend. Run `npm run build` and reload after frontend changes; rebuild `engine/` when its viewer changes.
- Use a separate `PAPILOT_DATA` directory and `PAPILOT_PORT` when running alongside another instance.
- Access the review engine through its public HTTP interface rather than writing its SQLite database directly.

| Changed scope | Verification |
| --- | --- |
| Application code | `npm run typecheck`, `npm test`, `npm run build` |
| Workspace UI | Also `npm run test:ui`, with inspected screenshots |
| Review engine | Also `npm --prefix engine run check`; relevant `npm --prefix engine run test:browser` checks for viewer behavior |
| UI text/translations | `npm run i18n -- check`, `npm run i18n:check-app`; relevant locale/layout checks |
| Website | `npm run test:site` |
| Desktop/runtime/installers | Build and smoke checks from [desktop/README.md](desktop/README.md), plus affected native CI jobs |
| Documentation only | Check accuracy, links and formatting |

Root tests use Node's test runner (`node --import tsx --test tests/NAME.test.ts`); engine tests use Vitest. Browser checks use Playwright from `engine/` (`PAPILOT_BROWSER_CHANNEL=chromium` in CI).

## Product, documentation and language

- Keep the interface simple, responsive and consistent with existing controls. Expose implementation detail only when it helps the user make a decision.
- Tie any length, annotation or turn limits to real resource or correctness constraints, using batching or graceful degradation rather than arbitrary caps.
- Use concise, concrete English for default product copy, commit messages and public PRs.
- Write short imperative commit subjects that describe the change.
- Keep source UI strings in English with `t(...)` / `tn(...)`. Update affected locales and translation state together per [i18n/README.md](i18n/README.md), preserving curated translations and overrides.
- Update user docs and changelog entries for user-visible changes. When UI shown on the homepage changes, update `site/index.html`, regenerate README visuals with `npm run readme:showcase`, and keep translated READMEs and `site/` aligned.

## Issues, PRs and releases

- Keep each PR to one coherent change following the [PR template](.github/pull_request_template.md) (problem, resulting behavior, linked issue, validation, limitations and UI evidence).
- Check related issues/PRs and existing review comments. Address substantive review findings and verify CI on the latest commit.
- In issue follow-ups, distinguish fixes on `main` from fixes available in a published release.
- For releases, follow [.github/workflows/release.yml](.github/workflows/release.yml) and [desktop/README.md](desktop/README.md):
  1. Review commits, merged PRs and linked issues since the previous release so notes cover the full delivered scope and built artifacts expose the expected features.
  2. Keep `package.json`, `package-lock.json`, `CHANGELOG.md` (with compare links) and `docs/releases/VERSION/release-notes.md` consistent.
  3. Credit external contributors and issue reporters with verified GitHub handles and contribution links, keeping repository notes and the GitHub release body in sync.
  4. Verify tests, native platform results, translations, docs and visual assets; document user-visible changes, installation/update steps and known limitations.
  5. Push a `vVERSION` tag to start the release workflow. The GitHub release title is `Papilot VERSION`, and its body uses curated versioned notes when available, otherwise the changelog. Verify the workflow, native installers, npm package and update assets through completion, with the update manifest uploaded last.
