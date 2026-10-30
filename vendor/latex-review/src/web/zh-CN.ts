// Simplified Chinese for the review viewer, keyed by the English text.
export const zhCN: Record<string, string> = {
  // Overview
  "All reviews": "全部审阅",
  "Search reviews": "搜索审阅",
  "Search by title or task name": "按标题或任务名搜索",
  "Filter reviews": "筛选审阅",
  "All tasks": "全部任务",
  "Awaiting your review": "等待你审阅",
  "Not published yet": "尚未发布",
  "Review →": "审阅 →",
  "Open →": "打开 →",
  "No reviews match this filter.": "没有符合筛选条件的审阅。",
  "No open reviews yet. Start a task from your document repository.":
    "还没有进行中的审阅。请在文档仓库中开始一个任务。",
  "{n} open review": "{n} 个进行中的审阅",
  "{n} open reviews": "{n} 个进行中的审阅",
  "{n} accepted": "{n} 已接受",
  "{n} rejected": "{n} 已拒绝",
  "{n} commented": "{n} 已评论",
  "{n} pending": "{n} 待定",

  // Review states
  Editing: "编辑中",
  "In review": "审阅中",
  "Awaiting revision": "等待修订",
  "All decided": "全部已决定",
  "Publish failed": "发布失败",
  Publishing: "发布中",
  Pending: "待定",
  Accepted: "已接受",
  Rejected: "已拒绝",
  Commented: "已评论",
  Mixed: "部分决定",

  // Publishing
  "Taking a snapshot": "正在保存快照",
  "Compiling LaTeX": "正在编译 LaTeX",
  "Rendering the diff": "正在生成差异",
  Starting: "正在启动",
  "Queued…": "排队中…",
  "Queued behind {n} other round…": "排在另外 {n} 轮之后…",
  "Queued behind {n} other rounds…": "排在另外 {n} 轮之后…",
  "Round {round} is ready": "第 {round} 轮已就绪",

  // Toolbar
  "Round {round}": "第 {round} 轮",
  " (earlier round)": "（较早的轮次）",
  " (latest)": "（最新）",
  "{decided} of {total} decided": "已决定 {decided}/{total}",
  "Accept all ({n})": "全部接受（{n}）",
  "Reject all ({n})": "全部拒绝（{n}）",
  "Accept all": "全部接受",
  "Reject all": "全部拒绝",
  "Accept the {n} undecided change in this round. Decided and commented changes stay as they are. Undo reverses the whole batch.":
    "接受本轮 {n} 处待定修改。已决定和已评论的修改保持不变。撤销会还原整批操作。",
  "Accept the {n} undecided changes in this round. Decided and commented changes stay as they are. Undo reverses the whole batch.":
    "接受本轮 {n} 处待定修改。已决定和已评论的修改保持不变。撤销会还原整批操作。",
  "Reject the {n} undecided change in this round. Decided and commented changes stay as they are. Undo reverses the whole batch.":
    "拒绝本轮 {n} 处待定修改。已决定和已评论的修改保持不变。撤销会还原整批操作。",
  "Reject the {n} undecided changes in this round. Decided and commented changes stay as they are. Undo reverses the whole batch.":
    "拒绝本轮 {n} 处待定修改。已决定和已评论的修改保持不变。撤销会还原整批操作。",
  "Reconnecting…": "正在重新连接…",
  Finished: "已结束",
  History: "历史",
  "Earlier decisions and rounds": "之前的决定和轮次",
  "Keyboard shortcuts": "键盘快捷键",
  "Review view": "审阅视图",
  "Review round": "审阅轮次",
  "Undo {action} · {changes}": "撤销{action} · {changes}",
  "Change {list}": "修改 {list}",
  "Changes {list}": "修改 {list}",
  "Undo last decision": "撤销上一次决定",
  "Back to review": "返回审阅",

  // A change
  "Change map": "修改导航",
  "Change {n}": "修改 {n}",
  "Review the current change": "审阅当前修改",
  "Previous change": "上一处修改",
  "Previous change (K or ←)": "上一处修改（K 或 ←）",
  "Next change": "下一处修改",
  "Next change (J or →)": "下一处修改（J 或 →）",
  Accept: "接受",
  Reject: "拒绝",
  Comment: "评论",
  "Next undecided": "下一处待定",
  "Review complete": "审阅完成",
  "Earlier round": "较早的轮次",
  Text: "文本",
  Layout: "版式",
  Moved: "位置移动",
  "No visible change": "无可见变化",
  "Source only": "仅源码",
  Reflow: "重新排版",
  Before: "修改前",
  After: "修改后",
  "{label}, PDF page {page}": "{label}，PDF 第 {page} 页",
  "Reviewed changes · View in History": "已审阅的修改 · 在历史中查看",
  "Copy selected text with this change’s file, line numbers and PDF page":
    "复制选中的文本，并附上这处修改的文件、行号和 PDF 页码",
  "Copy reference": "复制引用",
  "Show the LaTeX source (S)": "显示 LaTeX 源码（S）",
  "{n} edits · LaTeX": "{n} 处编辑 · LaTeX",
  "Revised after your comment in round {round}: ":
    "根据你在第 {round} 轮的评论修订：",
  "No visible change in the PDF; see the LaTeX source.":
    "PDF 中没有可见变化，请查看 LaTeX 源码。",
  "Continued: only line breaks moved here.": "续：这里只有换行位置变化。",
  "Affects {n} place": "影响 {n} 处",
  "Affects {n} places": "影响 {n} 处",
  "with {changes}": "需与{changes}一起",
  "Show {n} more": "再显示 {n} 处",
  "Loading…": "正在加载…",
  "Your comment: ": "你的评论：",
  "lines {start}–{end}": "第 {start}–{end} 行",
  "Binary file changed.": "二进制文件已更改。",
  "Long change: the source is shortened.": "修改较长，源码已截断显示。",
  "new file": "新文件",
  deleted: "已删除",
  "p. {pages}": "第 {pages} 页",
  "Unchanged text": "未修改的文本",
  "Unchanged text is folded": "未修改的文本已折叠",
  "Other changes": "其他修改",
  Changes: "修改",
  "This round has no changes.": "本轮没有修改。",

  // Banners and status
  "This review is finished. Accepted changes are in your manuscript.":
    "本次审阅已结束。已接受的修改已写入你的稿件。",
  "The latest publish failed: ": "最近一次发布失败：",
  "The agent is publishing a new round. You can keep reviewing; the new round will include your decisions.":
    "智能体正在发布新一轮。你可以继续审阅，新一轮会保留你的决定。",
  "You are viewing round {round}.": "你正在查看第 {round} 轮。",
  "Go to round {round} →": "前往第 {round} 轮 →",
  "{n} new LaTeX warning": "{n} 条新的 LaTeX 警告",
  "{n} new LaTeX warnings": "{n} 条新的 LaTeX 警告",
  "Agent needs your input": "智能体需要你的回复",
  "Feedback queued": "反馈已排队",
  "Feedback sent · Agent is working": "反馈已发送 · 智能体正在处理",
  "Preparing the next review…": "正在准备下一轮审阅…",
  "All changes reviewed": "所有修改均已审阅",
  "Open Chat to answer the agent's question.": "打开对话回答智能体的问题。",
  "New changes will appear here when ready.": "新的修改准备好后会显示在这里。",
  "Your comments are saved. Send feedback so the agent can revise.":
    "你的评论已保存。发送反馈后，智能体会据此修订。",
  "Accepted changes are in your manuscript.": "已接受的修改已写入你的稿件。",
  "Your decisions are saved. Send them to the agent to continue.":
    "你的决定已保存。发送给智能体以继续。",
  "Your comments are saved for the agent.": "你的评论已为智能体保存。",
  "There are no new changes to review. Previous decisions are available in History.":
    "没有需要审阅的新修改。之前的决定可在历史中查看。",
  "Waiting for the agent to publish its changes.": "正在等待智能体发布修改。",
  "This page updates by itself.": "本页面会自动更新。",
  "All changes reviewed. Your decisions are saved.":
    "所有修改均已审阅，你的决定已保存。",
  "Last decision undone. The restored changes need review again.":
    "已撤销上一次决定，恢复的修改需要重新审阅。",
  "Copied selected text with file, lines and PDF page.":
    "已复制选中的文本及其文件、行号和 PDF 页码。",
  "Copied the change location.": "已复制修改的位置。",
  "Clipboard unavailable. Select the PDF text and use your browser’s Copy command.":
    "无法使用剪贴板。请选中 PDF 文本，然后使用浏览器的复制命令。",

  // Locks sent by Papilot
  "This task is no longer available in Papilot. Return to the workspace.":
    "此任务已不在 Papilot 中，请返回工作区。",
  "This task is being deleted. Review actions and comments are unavailable.":
    "此任务正在删除，无法审阅或评论。",
  "Select Check status in Papilot before accepting, rejecting, or undoing changes. You can still add comments.":
    "请先在 Papilot 中选择“检查状态”，再接受、拒绝或撤销修改。你仍可以添加评论。",
  "Wait for the PDF build before accepting, rejecting, or undoing changes. You can still add comments.":
    "请等待 PDF 构建完成后再接受、拒绝或撤销修改。你仍可以添加评论。",
  "Pause this task in Papilot before accepting, rejecting, or undoing changes. You can still add comments.":
    "请先在 Papilot 中暂停此任务，再接受、拒绝或撤销修改。你仍可以添加评论。",
  "Wait for the current review action before accepting, rejecting, or undoing changes. You can still add comments.":
    "请等待当前审阅操作完成后再接受、拒绝或撤销修改。你仍可以添加评论。",

  // Comments and help
  "Comment on change {n}": "评论修改 {n}",
  "What should the agent change here?": "希望智能体在这里做什么修改？",
  "⌘↵ send · Esc cancel": "⌘↵ 发送 · Esc 取消",
  Cancel: "取消",
  Send: "发送",
  "J / K or → / ←": "J / K 或 → / ←",
  "Next / previous change": "下一处 / 上一处修改",
  "Show LaTeX source": "显示 LaTeX 源码",
  Undo: "撤销",
  "Copy selected PDF text": "复制选中的 PDF 文本",
  "Select text directly in the PDF preview. Copy reference includes the selection and its file, line numbers and page. Review shortcuts pause while text is selected.":
    "可直接在 PDF 预览中选择文本。复制引用会包含选中的文本及其文件、行号和页码。选中文本时，审阅快捷键会暂停。",
  Close: "关闭",

  // Uncommitted changes, when a host such as Papilot shows them
  "Uncommitted changes": "未提交的修改",
  Stage: "暂存",
  Revert: "还原",
  Unstage: "取消暂存",
  Unstaged: "未暂存",
  Staged: "已暂存",
  Reverted: "已还原",
  Edited: "已改动",
  "Partly staged": "部分暂存",
  "All changes are staged.": "所有修改都已暂存。",
  "Revert undone. The changes are back in your files.": "已撤销还原，这些修改已回到你的文件中。",
  "Next unstaged": "下一处未暂存",
  "Since the last commit": "自上次提交以来",
  "{staged} of {total} staged": "已暂存 {staged} / {total}",
  "Stage the {n} unstaged change.": "暂存这 {n} 处未暂存的修改。",
  "Stage the {n} unstaged changes.": "暂存这 {n} 处未暂存的修改。",
  "Stage all ({n})": "全部暂存（{n}）",
  "Stage all": "全部暂存",
  "Comparison failed": "比较失败",
  "Put back what the last revert removed (U)": "恢复上一次还原掉的内容（U）",
  "Undo revert": "撤销还原",
  "The comparison could not be built: ": "无法生成比较：",
  "Updating the comparison with your latest edits. You can keep staging and reverting meanwhile.":
    "正在根据最新修改更新比较。在此期间你可以继续暂存或还原。",
  "All changes are staged": "所有修改都已暂存",
  "No uncommitted changes": "没有未提交的修改",
  "Commit them when you are ready.": "准备好后就可以提交。",
  "The PDF matches the last commit.": "PDF 与上次提交一致。",
  "Comparing with the last commit…": "正在与上次提交比较…",
  "Stage or unstage": "暂存或取消暂存",
  "Finish or abort the merge in the Git panel before staging or reverting changes.":
    "请先在 Git 面板中完成或中止合并，再暂存或还原修改。",
  "The last commit changed. The comparison is being updated.": "上次提交已变化，正在更新比较。",
};
