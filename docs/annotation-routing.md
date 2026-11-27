# Collaboration mode

An opt-in multi-agent mode that routes each PDF annotation into a matching **task lane**. Single-model lanes run directly while lanes configured with 2–4 models race in parallel, with deterministic LaTeX/citation fidelity checks and a blind rigorous judge selecting the default proposal and exposing competing options inline on the PDF.

Open **Settings → Experiments**, then turn on **Enable collaboration mode**. It works with any agents connected in **Settings → Agents** (Codex is not required). Turning it off hides new choices while existing tasks can continue.

## Choosing a strategy in a task

Select **Collaboration mode** in the task model picker and choose a strategy:

| Strategy | Behavior |
| --- | --- |
| **Balanced · Auto route & race** *(default)* | Fast router classifies each annotation cluster into its matching task lane; lanes with 1 model run directly, lanes with 2+ models race with blind rigorous judging, and pure questions go to read-only answers. |
| **Fast · Route only** | Fast router assigns each annotation cluster to the lead model of its matching lane without racing. |
| **Thorough · Race & verify** | Races every editing cluster across its lane's models (falling back to the cross-family race pool when a lane has 1 model) with blind rigorous judging and fidelity checks. |

Tasks with no localized PDF annotations (such as whole-paper restructuring or follow-up build fixes) run directly on the rigorous worker in the task worktree.

## Interactive team graph and task lanes

In **Settings → Experiments**, the active team is shown as a 3-stage pipeline: **Router → Task lanes → Judge**.

By default, every slot is set to **Auto**, and Papilot builds a complementary cross-family team from the models currently connected on your host:

| Stage / Lane | Purpose | Default auto-selection |
| --- | --- | --- |
| **Router** | Fast read-only classifier that routes each annotation into the matching lane | Fastest read-only model (for example `DeepSeek V4.1 Flash UltraFast` or Flash/mini models) |
| **Simple edits** *(built-in lane)* | Typos, punctuation, word swaps, and minor mechanical fixes | Fastest available model (1 model, Direct) |
| **Prose & polish** *(built-in lane)* | Clarity, flow, conciseness, phrasing, and academic tone | Fluent prose model from a complementary family (1 model, Direct) |
| **Math & rigorous** *(built-in lane)* | Proofs, lemmas, typing rules, claims, citations, and technical correctness | Highest-rigor reasoning model (1 model, Direct) |
| **Layout & LaTeX** *(built-in lane)* | Tables, figures, spacing, macros, formatting, and visual layout | Rigorous/fast available model (1 model, Direct) |
| **Custom lanes** *(optional, up to 8 total)* | User-defined lanes (for example TikZ diagrams, citations, or notation) with custom name, routing description, and icon | Starts with 1 model; click `+` to add competing models |
| **Judge** | Rigorous read-only evaluator that blind-compares proposals whenever any lane has 2+ models | Highest-rigor read-only reasoning model |

- Click any model pill to customize its agent, model, reasoning effort, and Codex speed tier (**Standard**, **Fast**, or **Ultrafast** where supported).
- Click `+` on any lane to add up to 4 competing models and enable parallel racing for that lane; click `-` to return a lane to single-model direct execution.
- Click a lane title to edit its routing description (and name/icon for custom lanes). Click **Reset to auto** to restore automatic selection.

## Live routing & dispatch in chat

When Collaboration mode processes annotations, the conversation timeline displays a live **Routing & dispatch** card showing:

- The active **Router** and overall progress (`Routing…`, `N running`, `Done`, or `N failed`).
- One row per annotation cluster (`#1`, `#2`, …) with its target file, task lane badge (including custom lane icons), and the exact assigned agent(s) and models with live status indicators.
- For raced clusters, competing models (`vs`), the blind **Judge**, and a `★` winner highlight once judged.
- A collapsible **Details & steps** drawer underneath with raw tool output, worker sub-steps, diffs, and per-worker **Stop worker** controls.

## How per-annotation racing works

1. **Spatial pre-clustering**: Papilot locates current-turn annotations via SyncTeX anchors (falling back to normalized quote matching) and groups notes in the same paragraph into one cluster so concurrent workers do not collide.
2. **Fast routing**: The router receives a compact structured summary of clusters and configured lanes and outputs a JSON routing plan (`assign`, `race`, or `answer`). Deterministic validation guarantees every cluster is covered and enforces the chosen strategy.
3. **Isolated parallel execution**: Read-only-capable agents edit each cluster via sandboxed JSON patches against the same base snapshot (with read-only preamble macros and BibTeX keys provided for context), avoiding tool-approval deadlocks and keeping concurrent workers isolated. Edit-only agents run in file-whitelisted temporary copies.
4. **Fidelity checks & blind rigorous judging**:
   - Deterministic checks verify LaTeX brace/math/environment balance, `\cite`/`\ref`/`\label` preservation, scope boundaries, and approximate line deltas.
   - Identical normalized edits collapse into a single consensus candidate.
   - When two or more distinct valid candidates remain, the **Judge** evaluates them anonymously (**rigor and formal faithfulness first**, **natural readable prose second**), flags any fluent candidate that weakened a quantifier, dropped a condition, or altered technical meaning (`Rigor caution`), and may synthesize a combined candidate that keeps natural phrasing while restoring strict technical rigor.
5. **Inline PDF review**: The recommended winner is three-way merged into the task worktree for the main PDF review, and competing candidates are attached inline to that note's PDF change card so you can preview typeset differences, mix and match winners across notes, and accept your preferred wording directly.

## Development checks

- `tests/collaboration-v2.test.ts` and `tests/collaboration.test.ts` cover auto-team resolution, per-task lane defaults and custom lanes/icons, legacy settings migration, spatial clustering, fidelity checks, consensus deduplication, blind judging/synthesis, boundary-divergent span expansion in `preparedOptionEdits` and `optionCandidate`, structured dispatch metadata, and end-to-end `CollaborationRuntime` orchestration with deterministic fake runtimes.
- `scripts/check-collaboration.mjs` and `scripts/check-collaboration-workers.mjs` verify the interactive lane graph, icon picker, custom lanes, live Routing & dispatch card, worker steps, diffs, and stop controls across desktop/mobile and light/dark themes.
- UI controls follow Modern Web Guidance `css`, `content-first-noise-reduction`, `forms`, `switch`, `tabs`, and `accessibility` guides.
