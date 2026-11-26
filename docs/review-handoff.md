# Experimental review handoffs

Use `papilot handoff` to ask an external reviewer such as GPT Pro in ChatGPT on the web to suggest changes to a committed version of a paper. The local agent implements the suggestions in an isolated task. You can exchange the request, proposal, and receipt through a Git repository or a ChatGPT Space Page.

## Request a review

From the paper's Git repository, choose the files and ask a focused question. Keep the exchange files outside the paper checkout.

```sh
papilot handoff request --question 'Shorten the introduction while preserving its claims.' chapters/introduction.tex > /path/to/exchange/request.md
```

The request contains the current commit, a request ID, approved file paths, and a proposal template. Share the commit through a Git remote the reviewer can read. To provide the selected files in the request itself, add `--include-source` before the file paths. It includes the complete text of each listed file as committed. Use a private repository or Page for private material.

In ChatGPT, provide the request and ask for a proposal using its template. If the GitHub plugin is available in that conversation, point the reviewer to the repository, base commit, and file paths. For a Space Page, paste the request and keep the proposal in its own JSON code block. Where the conversation can edit the Page directly, ask it to put the block there. You can also copy its response into the Page or save the JSON locally. A GitHub plugin's write actions depend on the ChatGPT surface, selected model, and repository access.

## Implement a proposal

Save the proposal JSON or the Page's Markdown locally. For proposals stored in Git, fetch the review branch and use `git show origin/review:proposal.json` to retrieve the file. For Space, copying the JSON block into `proposal.json` is sufficient. The second argument to `prepare` also accepts `-` for standard input.

Open a clean checkout at the request's base commit. Use a worktree to keep the agent's edits separate from your paper. Replace `BASE_COMMIT` with the commit in the request.

```sh
git worktree add --detach ../paper-review BASE_COMMIT
papilot handoff prepare -C ../paper-review /path/to/exchange/request.md /path/to/exchange/proposal.json > /path/to/exchange/task.md
```

Always use your original local request as the first input. The command checks the request ID, base commit, listed files, and whether each quoted passage appears exactly once in the corresponding committed file. Read the generated task, then paste it into a Papilot task on that base with your chosen local agent, or give it to a local agent in the review worktree. Review the agent's diff and run the paper's normal checks before saving the result. The proposal can suggest prose changes to existing UTF-8 files. Record any omitted suggestions when you report the result.

## Return the result

After checking and committing the changes, run the following in the repository that contains the result commit. Replace `RESULT_COMMIT` with the commit you reviewed.

```sh
papilot handoff receipt --result RESULT_COMMIT /path/to/exchange/request.md /path/to/exchange/proposal.json > /path/to/exchange/receipt.md
```

The receipt identifies the request, the proposal, the result commit, and changed files. The result must descend from the base commit and touch only files listed in the proposal. The receipt means the commit is ready for review. Add a short note for any changes the agent did not implement. Push a review branch if the reviewer needs to see the diff, and put the receipt next to the proposal in Git or on the Page. The commands read local files and commits and print Markdown. You or your agents handle publishing and task submission.
