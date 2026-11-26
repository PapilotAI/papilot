# Papilot 0.14.0

Teach agents your writing preferences across tasks, switch agents in place without losing conversation context, choose which agents and models appear in menus, and inspect local workspace activity statistics.

## Writing memory

- **Learn and reuse writing preferences across tasks.** When you save a task, the task's agent reviews your feedback across the paper with its light model (alongside drafting the commit message) and may suggest a writing preference below the save step together with the edits it is based on. Save preferences for the current paper or all papers, or share them with coauthors via `.papilot/memory.md`. Papilot avoids suggesting preferences you have already saved. ([#313](https://github.com/PapilotAI/papilot/issues/313), [#321](https://github.com/PapilotAI/papilot/pull/321))
- **Consistent guidance everywhere.** Editing agents, AI reviews, and Collaboration mode workers follow saved preferences automatically. Manage, edit, and move memories or choose the suggestion language in **Settings → Memory**. See [Writing memory](https://github.com/PapilotAI/papilot/blob/v0.14.0/docs/guide.md#writing-memory). ([#313](https://github.com/PapilotAI/papilot/issues/313), [#321](https://github.com/PapilotAI/papilot/pull/321))

## Agents, models, and in-place switching

- **Turn agents off and hide individual models.** In **Settings → Agents**, disable agents you do not use and choose which models appear in model menus. Disabled agents are not started and leave every model menu (including **Settings → Git**), while existing tasks on that agent can still continue when needed. Hidden models leave the menus and are skipped by automatic helpers such as commit-message generation; hiding every model of an agent disables it, and **Reset** restores all agents and models. Choices are saved on the Papilot host and shared across the desktop app and browsers. ([#326](https://github.com/PapilotAI/papilot/pull/326))
- **Switch task agents in place.** Picking another agent's model from the composer menu keeps the conversation, proposed changes, review decisions, and unsent drafts in the same task instead of starting a replacement task. The next turn starts the new agent's session with the conversation so far, stopping any in-progress turn first and forwarding queued instructions. Tasks whose repository moved also hand their conversation to the next session. ([#322](https://github.com/PapilotAI/papilot/pull/322))

## Workspace activity statistics

- **Inspect activity across all papers or per paper.** **Settings → Statistics** displays accepted and rejected changes, agent working time, and tasks started above a pageable activity calendar with active days and streaks, followed by acceptance rate, token usage and provider-reported or API-equivalent spend, a weekday-by-hour activity heatmap, and agent/model breakdowns. ([#319](https://github.com/PapilotAI/papilot/pull/319))
- **Shareable summary and durable local ledger.** Use **Share** to save or copy a summary image of your figures and recent activity. Activity records are stored locally in SQLite, backfilled from existing workspace history on upgrade, and preserved even if tasks or papers are later removed. ([#319](https://github.com/PapilotAI/papilot/pull/319))

## Reliability fixes, Settings layout, and website

- **Discover DeepSeek Harness on macOS.** Papilot now locates the `dsh` command inside the installed DeepSeek Harness macOS app when it is not on `PATH`, matching existing Windows discovery. ([#323](https://github.com/PapilotAI/papilot/issues/323), [#325](https://github.com/PapilotAI/papilot/pull/325))
- **Stop lingering tool spinners after turns end.** When an agent disconnects, fails, is interrupted, or Papilot restarts mid-turn, any tool step that was still running now settles as stopped instead of spinning indefinitely. ([#324](https://github.com/PapilotAI/papilot/issues/324), [#325](https://github.com/PapilotAI/papilot/pull/325))
- **Clearer Settings organization.** Settings now groups review preferences, quick notes, skills, and memory under **Writing and review**, Overleaf under **Runtime**, and statistics under **Application**. ([#321](https://github.com/PapilotAI/papilot/pull/321))
- **Updated homepage.** The website now leads with the README's reasons to use Papilot, adding dedicated interactive showcases for live Overleaf sync, mid-task agent switching, phone review, and Universe templates with links to the demo, guide, and Universe. ([#259](https://github.com/PapilotAI/papilot/issues/259), [#320](https://github.com/PapilotAI/papilot/pull/320))

## Update or install

- **Desktop:** upgrading from 0.13.0 requires downloading the new 0.14.0 desktop installer/package because the desktop shell changed (`bin/agent-paths.mjs`). Download the matching release asset (macOS Apple Silicon/Intel DMG or ZIP, Windows x64 installer or portable executable, or Linux x64 AppImage/deb) or open the release link from **Settings → Updates**. Quit Papilot before replacing the application; your papers, tasks, and settings stay intact.
- **Command line and web server:** run `npm install -g papilot@0.14.0` with Node.js 22.22 or newer, then restart Papilot.
- **Managed, APT, and AUR installations:** update through your package manager or deployment system.

Compiling manuscripts requires Git and a TeX distribution on the host. Experiments remain off unless enabled.

[Detailed changelog](https://github.com/PapilotAI/papilot/blob/v0.14.0/CHANGELOG.md) · [All changes since 0.13.0](https://github.com/PapilotAI/papilot/compare/v0.13.0...v0.14.0)
