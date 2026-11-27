# Experimental review handoffs

Ask ChatGPT Pro on the web or another reviewer to suggest changes to a committed version of a paper. A Papilot agent implements the proposal in a task you can review against that same version.

## Follow a review in Papilot

Enable **External reviews** under **Settings → Experiments**. Start a new task and choose **ChatGPT Pro (web)** in the model picker. Write what you want reviewed and check **Files to review** to change the committed files included in the request. Sending saves the request as a conversation in the task list. Open that conversation again to resume the review.

1. **Send to ChatGPT.** Open an ordinary ChatGPT web chat, choose **Pro**, and paste the prompt from the Papilot conversation. For GitHub, publish the review branch first and use `@GitHub` in the chat if the app is available. Publishing sends the base commit and its history to the selected Git remote. For a Space Page, copy the Space prompt, which includes the selected committed text. Ask ChatGPT to create a private Page or edit one you can access. Save its link in Papilot to open it again from the conversation.
2. **Import the proposal.** In the same Papilot conversation, fetch the proposal from the published Git branch or paste the JSON block from Space or the chat. Papilot checks the request, the files, and the exact original passages. Read the checked suggestions before continuing.
3. **Implement locally.** Choose a local agent and start it. Papilot gives the agent a copy of the requested commit and shows its changes in the normal PDF review. Accept or reject the changes you want to share.
4. **Return result.** In the task's conversation, expand **Return result** and prepare a receipt. Publish a separate Git result branch, or copy the receipt into the Space Page or review chat. To apply the changes to your manuscript, use the ordinary Papilot task controls.

The **External review** sidebar entry also opens prior review requests and accepts the same proposal format from other reviewers.

## Command line handoffs

`papilot handoff` uses the same review format without opening the app. Use it to exchange files with other reviewers or local agents.

### Request a review

From the paper's Git repository, choose the files and ask a focused question. Keep the exchange files outside the paper checkout.

```sh
papilot handoff request --question 'Shorten the introduction while preserving its claims.' chapters/introduction.tex > /path/to/exchange/request.md
```

The request contains the current commit, a request ID, approved file paths, and a proposal template. Share the commit through a Git remote the reviewer can read. To provide the selected files in the request itself, add `--include-source` before the file paths. It includes the complete text of each listed file as committed. Use a private repository or Page for private material.

In ChatGPT, provide the request and ask for a proposal using its template. If the GitHub plugin is available in that conversation, point the reviewer to the repository, base commit, and file paths. For a Space Page, paste the request and keep the proposal in its own JSON code block. Where the conversation can edit the Page directly, ask it to put the block there. You can also copy its response into the Page or save the JSON locally. A GitHub plugin's write actions depend on the ChatGPT surface, selected model, and repository access.

### Implement a proposal

Save the proposal JSON or the Page's Markdown locally. For proposals stored in Git, fetch the review branch and use `git show origin/review:proposal.json` to retrieve the file. For Space, copying the JSON block into `proposal.json` is sufficient. The second argument to `prepare` also accepts `-` for standard input.

Open a clean checkout at the request's base commit. Use a worktree to keep the agent's edits separate from your paper. Replace `BASE_COMMIT` with the commit in the request.

```sh
git worktree add --detach ../paper-review BASE_COMMIT
papilot handoff prepare -C ../paper-review /path/to/exchange/request.md /path/to/exchange/proposal.json > /path/to/exchange/task.md
```

Always use your original local request as the first input. The command checks the request ID, base commit, listed files, and whether each quoted passage appears exactly once in the corresponding committed file. Read the generated task, then paste it into a Papilot task on that base with your chosen local agent, or give it to a local agent in the review worktree. Review the agent's diff and run the paper's normal checks before saving the result. The proposal can suggest prose changes to existing UTF-8 files. Record any omitted suggestions when you report the result.

### Return the result

After checking and committing the changes, run the following in the repository that contains the result commit. Replace `RESULT_COMMIT` with the commit you reviewed.

```sh
papilot handoff receipt --result RESULT_COMMIT /path/to/exchange/request.md /path/to/exchange/proposal.json > /path/to/exchange/receipt.md
```

The receipt identifies the request, the proposal, the result commit, and changed files. The result must descend from the base commit and touch only files listed in the proposal. The receipt means the commit is ready for review. Add a short note for any changes the agent did not implement. Push a review branch if the reviewer needs to see the diff, and put the receipt next to the proposal in Git or on the Page. The commands read local files and commits and print Markdown. You or your agents handle publishing and task submission.
