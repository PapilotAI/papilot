# Papilot Discord operations

Server: `1568215729063329955`. Keep the community small and navigable; use forum posts for individual problems and ideas.

## Channels and ownership

| Area | Channel | Purpose |
| --- | --- | --- |
| Start here | welcome-and-rules | Rules, downloads, navigation, helper commands |
| Start here | announcements | Official releases via the existing Papilot Releases webhook |
| Community | general / 中文交流 | Conversation in English and Chinese |
| Support | help | One support problem per forum post |
| Support | feedback | One product idea or bug per forum post; use tags and reactions |
| Development | development | Contributor discussion and implementation plans |
| Development | github-feed | Issues/PRs, development failures/recoveries, weekly triage |
| Staff (private) | staff / mod-log | Internal coordination, AutoMod alerts and Carl-bot moderation logs |

Maintainers own engineering decisions; moderators own community moderation. Do not give community helpers Administrator permission. Existing Carl-bot tags can be used by members; tag management is restricted to moderators.

## Helper commands

Mention Carl-bot followed by a name, e.g. `@Carl-bot download` (select the actual bot mention). The `papilot` command lists all helpers.

| Command | Function |
| --- | --- |
| papilot | Command directory and channel links |
| download | Current desktop release, CLI install/update and guide |
| doctor | Version/environment checks, `papilot doctor`, minimal reproduction and redacted logs |
| bug | GitHub bug form, original Discord post link and private security reporting |
| feature | Writing scenario, problem, workaround, expected result and feature form |
| contribute | Contribution guide, issue queue and development channel |
| roadmap | Open enhancements, PRs and released versions; no promised delivery dates |

Commands are Carl-bot tags, not AI agents. They do not read papers, execute local commands or automatically create GitHub issues. Manage them in the private mod-log channel with `@Carl-bot tag list`, `@Carl-bot tag raw NAME` and `@Carl-bot tag edit NAME CONTENT`. Keep `tag modonly enable` set.

## Feedback workflow

1. Search for duplicates, then create a help/feedback forum post with one topic.
2. Capture the writing task, Papilot version, OS, agent and a minimal reproduction. Do not request private manuscripts or secrets.
3. A maintainer confirms the problem or clarifies the feature. Actionable work becomes a GitHub issue using the bug/feature form. The author or maintainer copies the Discord post link into the form and replies to the original post with the issue link.
4. New form submissions receive `needs-triage` plus `bug` or `enhancement`. Remove `needs-triage` after assigning the next action. Use existing `duplicate`, `wontfix`, `help wanted` and `good first issue` labels when appropriate.
5. Link the implementing PR to the issue. Once released, reply to the original Discord post with the version and release link, then mark the forum post resolved/shipped.

This is an explicit human handoff between Discord and GitHub. No background copying of private messages or automatic cross-posting is configured.

## Notifications

Existing GitHub repository webhooks:

- `708160215`: `release` → Papilot Releases → announcements.
- `708160915`: `issues`, `pull_request` → Papilot GitHub → github-feed.

Both use Discord's `/github` adapter. Do not add push/comment/review traffic indiscriminately or duplicate these subscriptions in Actions.

The `Discord Community` workflow uses the existing development webhook through repository secret `DISCORD_DEV_WEBHOOK_URL` (without `/github`). No webhook token is stored in the repository.

- Watches CI, Release, Pages and Desktop Dev completions.
- Reports failures and recovery after failure for main; Release also covers version tags.
- Skips pull requests, forks, feature branches, ordinary success and cancellation.
- Every Monday at 01:17 UTC / 09:17 Asia/Shanghai, summarizes all open GitHub issues, triage, bugs and issues untouched for 14 days. GitHub schedule delivery can be delayed.
- Includes links to the two Discord forums for manual review; does not claim to summarize Discord content.
- Never pings roles or everyone, executes PR code, downloads PR artifacts, or logs webhook credentials.
- Discord rate limits are retried with bounded backoff. Other failures fail visibly in Actions; ambiguous network failures are not retried to avoid duplicate messages.

## Verification and maintenance

```sh
node --test tests/discord-community.test.mjs
gh workflow run discord-community.yml -f mode=test
gh workflow run discord-community.yml -f mode=digest
```

Verify the completed Actions run and the resulting message in github-feed. Use GitHub Settings → Webhooks → Recent Deliveries for the two native hooks. A 2xx response confirms delivery. If a webhook is rotated, update both its GitHub hook URL and the Actions secret. Never paste the token into an issue, chat or commit.

To pause only the scheduled/custom notifications, disable `Discord Community` in Actions; native release/Issue/PR hooks and Carl-bot helpers remain independent.

Official references: [Discord webhooks](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks), [Carl-bot tags](https://docs.carl.gg/#/tagstriggers), [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
