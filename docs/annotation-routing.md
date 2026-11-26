# Collaboration mode

An opt-in multi-agent mode that routes simple annotations to a fast model and races subjective or high-stakes annotation clusters across multiple models in parallel, with a rigorous blind judge selecting the default proposal and exposing competing options inline on the PDF.

Open **Settings → Experiments**, then turn on **Enable collaboration mode**. It works with any agents connected in **Settings → Agents** (Codex is no longer required). Turning it off hides new choices while existing tasks can continue.

## Choosing a strategy in a task

Select **Collaboration mode** in the task model picker and choose a strategy:

| Strategy | Behavior |
| --- | --- |
| **Balanced · Auto route & race** *(default)* | Fast router assigns mechanical edits directly to a single worker, routes pure questions to read-only answers, and races subjective or technical passages across the race pool with blind rigorous judging. |
| **Fast · Route only** | Fast router splits and assigns each annotation cluster to the best single worker without racing. |
| **Thorough · Race & verify** | Races every editing cluster across the race pool with blind rigorous judging and fidelity checks. |

Tasks with no localized PDF annotations (such as whole-paper restructuring or follow-up build fixes) run directly on the **Rigorous & judging** worker in the task worktree.

## Auto-configured team and overrides

By default, every slot is set to **Auto**, and Papilot builds a complementary cross-family team from the models currently connected on your host:

| Slot | Role | Default auto-selection |
| --- | --- | --- |
| **Quick & routing** | Fast dispatcher and mechanical fixes (typos, macros, punctuation, straightforward deletions) | Fastest read-only model (for example `DeepSeek V4.1 Flash UltraFast` or Flash/mini models) |
| **Polishing** | Natural, readable academic prose | Fluent prose model from a complementary family (for example `Gemini 4 Neon` at `xhigh` or `Claude Sonnet`) |
| **Rigorous & judging** | Mathematical/formal rigor, citations, blind race judging, and overlap reconciliation | Highest-rigor reasoning model (for example `GPT-6.2-Sol` at `xhigh` with Fast mode, or `Claude Opus`) |
| **Race pool** | 2–4 competing models that edit raced clusters in parallel | Cross-family `[Rigorous, Polishing]` pair |
| **Advanced overrides** | Independent **Router** and **Judge** overrides | Follow **Quick & routing** and **Rigorous & judging** when read-only |

Every slot accepts any connected agent and model, along with its reasoning effort and Codex Fast mode where supported. Click **Reset to auto** to restore automatic selection.

## How per-annotation racing works

1. **Spatial pre-clustering**: Papilot locates current-turn annotations via SyncTeX anchors (falling back to normalized quote matching) and groups notes in the same paragraph into one cluster so concurrent workers do not collide.
2. **Fast routing**: The router receives a compact structured summary of clusters and outputs a JSON routing plan (`assign`, `race`, or `answer`). Deterministic validation guarantees every cluster is covered and enforces the chosen strategy.
3. **Isolated parallel execution**: Read-only-capable agents edit each cluster via sandboxed JSON patches against the same base snapshot (with read-only preamble macros and BibTeX keys provided for context), avoiding tool-approval deadlocks and keeping concurrent workers isolated. Edit-only agents run in file-whitelisted temporary copies. Each running worker or racer appears in the task timeline with an individual **Stop worker** control.
4. **Fidelity checks & blind rigorous judging**:
   - Deterministic checks verify LaTeX brace/math/environment balance, `\cite`/`\ref`/`\label` preservation, scope boundaries, and approximate line deltas.
   - Identical normalized edits collapse into a single consensus candidate.
   - When two or more distinct valid candidates remain, the **Judge** evaluates them anonymously (**rigor and formal faithfulness first**, **natural readable prose second**), flags any fluent candidate that weakened a quantifier, dropped a condition, or altered technical meaning (`Rigor caution`), and may synthesize a combined candidate that keeps natural phrasing while restoring strict technical rigor.
5. **Inline PDF review**: The recommended winner is three-way merged into the task worktree for the main PDF review, and competing candidates are attached inline to that note's PDF change card so you can preview typeset differences, mix and match winners across notes, and accept your preferred wording directly.

## Development checks

- `tests/collaboration-v2.test.ts` and `tests/collaboration.test.ts` cover auto-team resolution, legacy settings migration, spatial clustering, fidelity checks, consensus deduplication, blind judging/synthesis, boundary-divergent span expansion in `preparedOptionEdits` and `optionCandidate`, and end-to-end `CollaborationRuntime` orchestration with deterministic fake runtimes.
- UI controls follow Modern Web Guidance `switch`, `accordion`, `tabs`, `forms`, and `accessibility` guides.
