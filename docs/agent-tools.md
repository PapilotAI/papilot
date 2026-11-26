# Agent tools

Papilot gives the agent of every editing task the same set of tools for the paper's PDF, its notes, its cited works and the author's writing memory. They work on the manuscript PDF and Papilot's own data, not on the task's unaccepted edits, and only during the agent's turn. AI review tasks do not get them.

## How agents reach them

| Agent | Transport |
| --- | --- |
| Papilot Writer | Built-in tools. |
| Codex and Collaboration mode | Dynamic tools on the thread, when the Codex version offers them. |
| Claude, and ACP agents such as DeepSeek, Kimi, Qwen and OpenCode | A `papilot` MCP server (`bin/papilot-mcp.mjs`) the agent starts with its session. Claude may use its tools without asking. |
| Every agent with a shell | A JSON client, `node bin/paper-tools.mjs SESSION TOOL JSON`, named in each turn's instructions; `help` lists the schemas, and `@FILE` or `-` passes arguments without shell quoting. |

Each task has one private session file holding a local address and a token. The token changes every turn and stops working when the turn ends, so a tool server started with the session reaches every later turn of that task and nothing else. Calls go only to `127.0.0.1`.

## Tools

**Manuscript PDF.** `paper_search` finds literal text across line breaks and returns line anchors; `paper_read` reads a small range by anchor, page or cursor. Results carry the PDF's key, and a changed PDF asks the agent to search again.

**Notes on the manuscript.** `annotations_list`, `annotation_read`, `annotation_create`, `annotation_update`, `annotation_delete` and `annotation_restore` list, read and change the author's notes on the PDF, with optional color groups and quick-note stamps. Revisions protect against concurrent changes, and notes already sent to a task cannot be changed.

**Cited works.** `library_list` lists the works the paper cites and whether the Library has each PDF; `library_search` and `library_read` search and read those PDFs by line anchors; `library_add` adds a missing PDF from an openly available copy, which Papilot downloads and keeps only when its first page shows the work.

**Citation checks.** `citations_list` lists the sentences citing works, with the verdicts recorded so far; `citation_record` records whether a cited work supports a sentence, with the work's lines as evidence, which Papilot quotes from the PDF.

**Writing memory.** `memory_list` lists the author's saved writing preferences by scope (`paper`, `shared`, `personal`) with each file's revision; `memory_add`, `memory_update` and `memory_remove` change one preference when the author asks. See [Writing memory](guide.md#writing-memory).

Outputs are kept small for the agent's context, with cursors to continue; they never limit how long a paper, a note or a library can be.
