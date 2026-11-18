# Papilot Writer: the built-in paper agent (based on Pi)

Status: implemented on `branch/papilot-writer-agent`.

## Goal

An agent that belongs to Papilot itself and is made for writing papers, not
code. It runs in-process on the [Pi](https://github.com/badlogic/pi-mono) SDK
(`@mariozechner/pi-coding-agent`, MIT). It is listed first as **Papilot Writer**,
with a "Based on Pi" subtitle. It differs from the other agents in two ways:

1. **Context is organized around the paper.** The title, abstract and a live
   map of the manuscript are always in context, so the model does not have
   to grep around to find its way.
2. **Its tools are about papers**: outline, reading-text search, typeset
   pages, the build and references. Each action has a safety tier. Reading
   and editing LaTeX run freely. Data, deletions and commands ask first.

The separate **Pi** agent runs an installed Pi CLI with its existing providers, skills and extensions. See the [Pi setup guide](guide.md#agents). Writer keeps the SDK configuration and writing tools described here.

## Packaging

`@mariozechner/pi-coding-agent` is a pinned regular dependency, so the agent
works offline from the first launch. Only the SDK (`createAgentSession`) is
used, never Pi's CLI, TUI or `~/.pi` discovery:

- `DefaultResourceLoader` with extensions, skills, prompt templates, themes
  and context-file discovery turned off. It supplies only our charter and the
  worktree's own `AGENTS.md`/`CLAUDE.md`.
- `ModelRegistry.inMemory` (no `models.json`) and in-memory settings.
- Credentials live in `DATA/papilot-writer/auth.json`, separate from Pi's.

This means a user's Pi setup or third-party Pi plugins cannot change how
Papilot works. The third-party license list and the Nix package both read
`package-lock.json`, so neither needed a change. `papilot doctor` also
recognizes import-only packages now.

## Runtime shape

`WriterAgent extends Adapter` (`src/server/writer/agent.ts`), AgentId
`papilot`. It speaks the same Codex app-server surface as every other agent,
so queueing, approvals, review rounds and pausing stay in `workspace.ts`.

| Papilot surface | Pi |
| --- | --- |
| `thread/start`, `thread/resume` | `createAgentSession` with a session file per thread under `DATA/papilot-writer/sessions` (in memory for ephemeral threads) |
| `turn/start` | `session.prompt(map + text)` |
| `turn/interrupt` | `session.abort()` |
| `model/list` | configured providers' models, ids `provider/model` |
| `effort` | `setThinkingLevel` (the model's supported levels) |
| `item/*` notifications | text deltas, tool start/end → `fileChange`, `commandExecution`, `dynamicToolCall` items |
| approvals | tools await `item/fileChange/requestApproval` or `item/commandExecution/requestApproval` |
| questions | `ask_author` → `item/tool/requestUserInput` |
| typeset pages, build | `view_pages`/`check_build` → `item/tool/call`, answered by Papilot's view route |

### Credentials

Settings → Agents → Papilot Writer:

- **Subscriptions**: ChatGPT Plus/Pro (`openai-codex`) and GitHub Copilot,
  through Pi's OAuth flows. The sign-in page opens in the browser. If its
  redirect cannot reach the Papilot host, the author pastes the redirect URL.
- **API keys**: Anthropic, OpenAI, Google, OpenRouter, DeepSeek, xAI,
  Moonshot, Z.ai, Mistral. Keys in Papilot's environment work too.
- Claude is API-key only. Anthropic does not allow subscription logins
  through third-party harnesses, so `sk-ant-oat` tokens are refused.

### Default agent

Papilot Writer is first in `AGENT_IDS`, so a fresh install picks it once a
provider is configured. If the author chose an agent before, that choice is
kept and a dismissible banner suggests trying Papilot Writer.

## Context organization

1. **Charter** (system prompt, stable and cached): role, context layers, tool
   workflow, chore mode and ask-first behaviour (`charter.ts`), plus
   Papilot's task instructions.
2. **Paper map** (rebuilt every turn from source, `paper-map.ts`), sent in
   front of the author's message inside `<paper-map>`:
   - pinned **title** and **abstract**, with their `file:line`;
   - main file, document class, source files;
   - a nested outline with `file:start-end` line ranges, word counts and
     labels (`- 1 Introduction — main.tex:11-14 (17 words) [sec:intro]`);
   - labels, with undefined and unused references; floats with captions;
     the paper's macros; a references summary; the last build's result.
   The map stays in history, which keeps the provider's prompt cache stable.
   Compaction summaries leave maps out, since the next turn brings a fresh one.
3. **Working memory**: Pi's session history. Its compaction instructions keep
   decisions, rejected edits, style preferences and open questions, and drop
   raw file dumps.

## Tools

All paths are relative to the task worktree. Paths outside it, through a
symlink or into `.git/` are always refused. The rules are in `policy.ts`.

### Reading (always allowed)

| Tool | What it does |
| --- | --- |
| `paper_outline` | The live nested outline, or one section's subtree, with files and line ranges. |
| `read_file` | A file by path and lines, or a section by title or label. Images come back as images. |
| `search_text` | Searches the **reading text**, not the source. Comments, `~`, line breaks, `\emph`, user macros (`\method` → its text) and citations are projected away, and each match maps back to `file:line`. |
| `search_source` | Regex search over the source. |
| `find_references` | Where a label, citation key or macro is defined and used. |
| `list_files` | The worktree, skipping build output and caches. |
| `check_build` | Compiles the task worktree. Returns page count, errors and warnings with locations. |
| `view_pages` | The typeset pages as images, by location, page number or section. |
| `lookup_reference` | Crossref and DBLP search, and BibTeX from doi.org or arXiv. |
| `read_webpage` | Reads a web page. |
| `ask_author` | Asks the author a question. |

### Writing (paper edits mode)

| Tool | Runs freely | Asks first |
| --- | --- | --- |
| `edit_file` (exact replacements, returns a diff) | `.tex`, `.bib`, `.ltx` | anything else (data, scripts, `.sty`, build settings) |
| `write_file` | a new `.tex`/`.bib` | overwriting, other file types, binaries |
| `add_reference` | an entry the published record confirms | an entry that could not be confirmed |
| `move_file`, `delete_file` | — | always |

### Chore mode

Shell access is off by default. When a task needs commands (regenerate a
figure, run a script, tidy files), the agent calls `enter_chore_mode` with a
reason and a plan, and the author approves. `run_command` is then available,
and each command still asks in paper edits mode. The agent calls
`exit_chore_mode` when it is done. Chore mode always ends with the turn.

Pi fixes the tool set for each run. So entering or leaving chore mode ends
the run, and the adapter re-prompts within the same Papilot turn with the new
tool set.

### Permission modes

- **Paper edits** (default): LaTeX edits run, other changes ask first.
- **Full access**: never asks, still confined to the worktree.
- **Read-only** (review tasks): no writes, moves, deletes or commands.

## UI

- Agent tile with Papilot's nib icon and a "Based on Pi" subtitle. The
  drawer shows the models and the provider setup (`writer-setup.tsx`).
- The suggestion banner for authors who already chose another agent.
- Strings are in all 10 locales.

## Tests

`tests/writer.test.ts` covers the policy table, the reading-text projection,
the paper map, every tool, approvals and chore gating, credentials, item
translation, and a full turn against Pi's faux provider.

## Later

- Web search through the provider's own search tool, where supported.
- Attach the author's PDF notes to the turn as a focus layer.
- A default-model choice per provider in settings.
