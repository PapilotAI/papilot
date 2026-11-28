## Reusable skills

Type `/` at the start of a prompt (or open the **+** menu beside the composer) to apply a reusable instruction set instead of retyping the same review rubric every time. You can add optional scope text after a skill, such as `Section 3 only` or `keep within 8 pages`.

### Built-in skills

| Skill | What it asks the agent to do | Edits files? |
| --- | --- | --- |
| **Polish** | Improve clarity, flow and academic phrasing while keeping technical meaning intact | Yes (worktree) |
| **Proofread** | Fix grammar, spelling, punctuation and typographical slips | Yes (worktree) |
| **Shorten** | Tighten wording to meet page or column limits without dropping key claims | Yes (worktree) |
| **Check math** | Audit derivations, notation consistency and proof steps | Yes (worktree) |
| **Consistency** | Align terminology, symbols, capitalization and cross-references across sections | Yes (worktree) |
| **Fix LaTeX warnings** | Resolve overfull boxes, broken references and compiler warnings | Yes (worktree) |
| **Address reviewers** | Plan and apply revisions responding to pasted or attached referee comments | Yes (worktree) |
| **AI review** (`/ai-review`) | Produce short, line-anchored suggestions under **AI suggestions** | **No** (read-only) |

### Custom skills

Manage your own skills in **Settings → Skills**:

- **Global skills**: stored under `~/.papilot/skills/` and available across every paper you open.
- **This paper**: stored under `<paper>/.papilot/skills/` for venue-specific checklists or coauthor conventions.

## Writing memory

Save lasting writing preferences (such as voice, terminology, claim strength, LaTeX macros or heading case) in **Settings → Memory** so every editing task, `/ai-review` run and Collaboration mode worker follows them automatically:

| Scope | File | Who receives it |
| --- | --- | --- |
| **This paper** | `<paper>/.papilot/memory.local.md` | Only this checkout (excluded locally via `.git/info/exclude`). |
| **Shared with coauthors** | `<paper>/.papilot/memory.md` | Everyone sharing the Git repository once committed (skipped by Overleaf sync). |
| **All papers** | `~/.papilot/memory.md` | Every paper you open (override with `PAPILOT_MEMORY`). |

### Learning from reviews and chat

- **Learning from reviews**: after you finish reviewing a task, Papilot can read repeated corrections in a read-only background turn and propose a lasting preference below the save bar. Nothing is saved until you click **Remember** (with **Undo** available); turn learning off or choose **Memory language** anytime in **Settings → Memory**.
- **Asking an agent directly**: tell an agent in chat to remember, reword or forget a preference; it updates the matching Markdown list using the built-in memory tools. Current task instructions and PDF notes always take precedence over saved memory.

## File and image attachments

Attach reference materials via **+ → Add files…**, drag-and-drop onto the composer, or pasting an image from your clipboard:

- **Per-message limits**: up to **10 files** per message, **25 MB** per file, **5 MB** per PNG/JPEG/GIF/WebP image, and **100 MB** total per message.
- **How agents receive them**: Codex, Claude, Papilot Writer, Kimi and other vision-capable models receive raster images natively (DeepSeek Harness is text-only). Other files are stored outside the manuscript tree and passed by local path so the agent can read referee PDFs, data tables or notes — or copy a new figure into the task worktree for typeset review.
