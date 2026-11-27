# Experimental review handoffs

Ask ChatGPT Pro on the web or another reviewer to suggest changes to a committed version of a paper. A Papilot agent implements the proposal in a task you can review against that same version.

## Follow a review in Papilot

Enable **External reviews** under **Settings → Experiments**. Start a new task and choose **ChatGPT Pro (web)** in the model picker. Write what you want reviewed or add PDF annotations to the task. On send, Papilot pins the current Git commit and uses the selected notes’ committed source files. If the notes have no committed source, or you sent a text request alone, Papilot uses the current root document. The saved request shows which files it includes. Open the conversation again from the task list to resume the review.

To review your PDF annotations, add them to the task from the PDF or **My notes**. You can send the selected notes by themselves or add an overall request. Both Git and Space prompts include the selected notes, their marked PDF text, color-group instructions, and source locations when Papilot can match them to the committed text. Open **PDF notes** in the saved request to check what will be shared before you copy the prompt. The PDF page number refers to the build you marked. The proposal still needs to quote the exact committed text it proposes to change.

1. **Send to ChatGPT.** Choose **Publish and copy prompt** to save the request to the existing Git repository and copy a link to the exact request commit. Then choose **Open ChatGPT**, select **Pro**, and paste the prompt. Git publication includes the base commit and its history, the question, source paths, and selected PDF notes. Use **Review details** to choose a different remote, a Space Page, or **Chat only** if ChatGPT cannot retrieve the files. With no Git remote, **Copy prompt** includes the selected committed source and asks for a reply in chat.
2. **Import the proposal.** Open **Paste reply** in the same Papilot conversation and paste the ChatGPT reply, including the proposal block. Choose **Check reply**. Papilot verifies the request, the files, and the exact original passages. The [standard GitHub app in ChatGPT](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt) provides read access. For a reviewer with write access, **Review details** also lets you fetch their proposal from the published Git branch.
3. **Implement locally.** Choose a local agent and start it. Papilot gives the agent a copy of the requested commit and shows its changes in the normal PDF review. Accept or reject the changes you want to share.
4. **Return result.** In the task's conversation, expand **Return result** and prepare a receipt. Publish the result branch to the same repository to share the accepted edits, the checked proposal, and the receipt. The receipt points back to the review request. You can also copy it into the Space Page or review chat. To apply the changes to your manuscript, use the ordinary Papilot task controls.

The request and result branches keep the review exchange alongside the manuscript's Git history. Start from the saved request and its base commit when resuming from another agent or checkout. The publication step shares the base history and the notes you selected with people who can read the destination repository.

The **External review** sidebar entry also opens prior review requests and accepts the same proposal format from other reviewers.

## Command line handoffs

`papilot handoff` uses the same review format without opening the app. Use it to exchange files with other reviewers or local agents.

### Request a review

From the paper's Git repository, choose the files and ask a focused question. Keep the exchange files outside the paper checkout.

```sh
papilot handoff request --question 'Shorten the introduction while preserving its claims.' chapters/introduction.tex > /path/to/exchange/request.md
```

The request contains the current commit, a request ID, approved file paths, and a proposal template. Share the commit through a Git remote the reviewer can read. To provide the selected files in the request itself, add `--include-source` before the file paths. It includes the complete text of each listed file as committed. Use a private repository or Page for private material.

In ChatGPT, provide the request and ask for a proposal using its template. If the GitHub plugin is available in that conversation, point the reviewer to the repository, base commit, and file paths. Save the proposed JSON from the chat or ask a reviewer with Git write access to save it on the review branch. For a Space Page, keep the proposal in its own JSON code block.

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
