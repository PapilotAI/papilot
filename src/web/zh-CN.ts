// Simplified Chinese for the workspace, keyed by the English text (see i18n.ts).
// Chinese text keeps a space around numbers and Latin words: "第 2 轮", "PDF 批注".
export const zhCN: Record<string, string> = {
  // Reasoning effort
  'None': '无', 'Minimal': '最低', 'Low': '低', 'Medium': '中', 'High': '高', 'Extra high': '超高', 'Max': '最高',
  'Default': '默认', 'Reasoning effort': '推理强度', 'Reasoning effort: {label}': '推理强度：{label}', 'Model default': '模型默认',

  // Requests
  'Request failed. Please try again.': '请求失败，请重试。',
  'The connection is taking too long. Check your network and try again.': '连接时间过长。请检查网络后重试。',
  'The request timed out and may still be processing. Check the task status before retrying.': '请求超时，可能仍在处理中。重试前请先检查任务状态。',

  // Task status
  'Ready': '就绪', 'Queued': '排队中', 'Needs your reply': '等待你的回复', 'Building PDF review': '正在生成 PDF 审阅', 'Ready for review': '待审阅',
  'Paused': '已暂停', 'Needs attention': '需要处理', 'Check task status': '请检查任务状态', 'Deleting task': '正在删除任务',
  'Review complete': '审阅完成', '{agent} is editing': '{agent} 正在编辑',

  // Time
  'now': '刚刚', '{n}m': '{n} 分钟', '{n}h': '{n} 小时', '{n}d': '{n} 天', 'just now': '刚刚', '{time} ago': '{time}前',

  // Chat
  'Add details, or send to run the skill': '补充细节，或直接发送以运行技能',
  '{agent} needs your input': '{agent} 需要你的回答', 'Approve this action': '批准此操作', 'Or type your own answer': '或输入你自己的回答',
  '{agent} is requesting permission for this action.': '{agent} 请求执行此操作的权限。', 'Apply file changes': '应用文件修改',
  'Decline': '拒绝', 'Submitting…': '正在提交…', 'Reply to {agent}': '回复 {agent}', 'Allow this action': '允许此操作',
  'Copied': '已复制', 'Copy message': '复制消息', 'Copy': '复制',
  'You, {time}': '你，{time}', 'Note on the PDF': 'PDF 上的批注', '{n} notes on the PDF': 'PDF 上的 {n} 条批注', 'Marked region': '标记的区域',
  '{n} accepted': '{n} 处已接受', '{n} rejected': '{n} 处已拒绝', '{n} comment': '{n} 条评论', '{n} comments': '{n} 条评论', '{n} undone': '{n} 处已撤销', 'build error': '编译错误',
  'You sent review feedback, {time}': '你发送了审阅反馈，{time}', 'Review feedback · Round {round}': '审阅反馈 · 第 {round} 轮', 'Review feedback': '审阅反馈',
  'With review feedback · Round {round}': '附带审阅反馈 · 第 {round} 轮', 'With review feedback': '附带审阅反馈',
  'Run command': '运行命令', 'Edited {file}': '编辑了 {file}', 'Edited {n} files': '编辑了 {n} 个文件', 'Run tool': '使用工具',
  'Running': '运行中', 'Declined': '已拒绝', 'Failed': '失败',
  'ran {n} command': '运行了 {n} 条命令', 'ran {n} commands': '运行了 {n} 条命令', 'edited {file}': '编辑了 {file}', 'edited {n} files': '编辑了 {n} 个文件',
  'used {n} tool': '使用了 {n} 个工具', 'used {n} tools': '使用了 {n} 个工具', ', ': '，', '{n} failed': '{n} 个失败',
  'This task is being deleted': '此任务正在删除', 'Check task status before sending': '发送前请先检查任务状态', 'Sending feedback…': '正在发送反馈…', 'Sending…': '正在发送…',
  '{n} review update will be sent with this message': '{n} 项审阅更新将随此消息发送', '{n} review updates will be sent with this message': '{n} 项审阅更新将随此消息发送',
  '{agent} is working · new instructions run next': '{agent} 正在工作 · 新指令将在下一轮执行',
  'Enter to send · / for skills': 'Enter 发送 · / 选择技能', 'Enter to send · Shift+Enter for a new line': 'Enter 发送 · Shift+Enter 换行',
  'Default model': '默认模型', '{agent} conversation': '{agent} 对话', 'Chat': '对话',
  'the default model on this host ({model})': '此主机上的默认模型（{model}）', 'the default model on this host': '此主机上的默认模型',
  'Loading conversation…': '正在加载对话…', 'Retry conversation': '重新加载对话',
  '{agent} is working on this task': '{agent} 正在处理此任务', 'Task saved. Waiting for an available {agent} session.': '任务已保存。正在等待可用的 {agent} 会话。',
  'Round {round} is ready · {n} change to decide': '第 {round} 轮已就绪 · {n} 处修改待定', 'Round {round} is ready · {n} changes to decide': '第 {round} 轮已就绪 · {n} 处修改待定',
  'Open review': '打开审阅', 'This step needs attention': '此步骤需要处理', 'Latest messages': '最新消息',
  'Instructions for {agent}': '给 {agent} 的指令', 'Queue instructions for the next turn…': '为下一轮排队添加指令…', 'Ask for another revision…': '提出新的修改要求…',
  'Pause task': '暂停任务', 'Pause {agent}': '暂停 {agent}', 'Send instructions': '发送指令', 'Send (Enter) · New line (Shift+Enter)': '发送（Enter）· 换行（Shift+Enter）',

  // Review feedback
  '{n} review update not sent yet': '{n} 项审阅更新尚未发送', '{n} review updates not sent yet': '{n} 项审阅更新尚未发送',
  'Send your review decisions and comments to the agent': '把你的审阅决定和评论发送给智能体', 'Send feedback': '发送反馈',

  // Git
  'detached': '游离', '{n} changed': '{n} 处改动', 'clean': '无改动',
  'Modified': '已修改', 'Added': '已添加', 'Deleted': '已删除', 'Renamed': '已重命名', 'Conflict': '冲突', 'Untracked': '未跟踪', 'Type changed': '类型已改变',
  'No textual changes.': '没有文本改动。', 'The diff is too long to show in full.': '差异太长，无法完整显示。',
  'Git status': 'Git 状态', 'Reading Git status…': '正在读取 Git 状态…', 'Committed {hash}.': '已提交 {hash}。',
  '{n} new commit on {upstream}.': '{upstream} 上有 {n} 个新提交。', '{n} new commits on {upstream}.': '{upstream} 上有 {n} 个新提交。',
  'Up to date with the remote.': '已与远程保持同步。', 'Pulled the latest commits.': '已拉取最新提交。', 'Pushed to {upstream}.': '已推送到 {upstream}。', 'Pushed to the remote.': '已推送到远程。',
  'detached HEAD': '游离 HEAD', 'Compared with {upstream}': '与 {upstream} 比较', 'up to date': '已同步',
  'Pulling…': '正在拉取…', 'Pull': '拉取', 'Pushing…': '正在推送…', 'Push': '推送', 'Publish branch': '发布分支', 'Fetch from the remote': '从远程获取',
  'Tracking': '跟踪', 'Include all changes': '包含全部改动', 'Uncommitted changes': '未提交的改动', 'Commit message': '提交信息', 'Committing…': '正在提交…',
  'Commit 1 file': '提交 1 个文件', 'Commit all {n} files': '提交全部 {n} 个文件', 'Commit {chosen} of {n} files': '提交 {n} 个文件中的 {chosen} 个',
  'Include {path}': '包含 {path}', 'Changes in {path}': '{path} 的改动', 'Loading the diff…': '正在加载差异…', 'No uncommitted changes': '没有未提交的改动',

  // PDF and notes
  'Page {n}': '第 {n} 页', 'PDF notes': 'PDF 批注', 'Show note {n} on the page': '在页面上显示批注 {n}', 'Delete note {n}': '删除批注 {n}', 'Delete note': '删除批注',
  '{file}, the LaTeX that produced the marked region': '{file}，生成所标记区域的 LaTeX 源码', 'Marked on an earlier version of the PDF.': '标记于较早版本的 PDF。',
  'Select text in the PDF and choose Add note, or use Mark region for a figure or equation. All notes go to the agent as one task.': '在 PDF 中选中文字后选择“添加批注”，或用“标记区域”框选图表或公式。所有批注会作为一个任务发送给智能体。',
  'Send {n} note to the agent': '把 {n} 条批注发送给智能体', 'Send {n} notes to the agent': '把 {n} 条批注发送给智能体', 'Send notes to the agent': '把批注发送给智能体',
  'PDF preview': 'PDF 预览', 'The manuscript did not compile.': '稿件编译失败。', 'Compiling the latest changes…': '正在编译最新改动…', 'Opening the PDF…': '正在打开 PDF…',
  'Compiling the PDF…': '正在编译 PDF…', 'The first build of a paper can take a minute.': '论文第一次编译可能需要一分钟。',
  'Contents, Notes and Git': '目录、批注和 Git', 'PDF panels': 'PDF 面板', 'Contents': '目录', 'Notes': '批注', 'PDF contents': 'PDF 目录',
  'This PDF has no bookmarks.': '此 PDF 没有书签。', 'Contents will appear when the PDF is ready.': 'PDF 就绪后会显示目录。',
  'You are offline. Your draft is kept in this browser.': '你已离线。草稿保存在此浏览器中。',
  'Agent': '智能体', ' · unavailable': ' · 不可用', 'Model': '模型', 'Wait for the PDF to compile.': '请等待 PDF 编译完成。',
  'Fit width': '适合宽度', 'Fit page': '适合页面', 'Note for the agent': '给智能体的批注', 'What should change here?': '这里应该怎么改？', 'Add note': '添加批注', 'Adding…': '正在添加…',
  'PDF controls': 'PDF 控件', 'Previous page': '上一页', 'Page number': '页码', 'Next page': '下一页',
  'Zoom out': '缩小', 'Zoom out (⌘−)': '缩小（⌘−）', 'Zoom': '缩放', 'Zoom in': '放大', 'Zoom in (⌘+)': '放大（⌘+）',
  'Find in PDF': '在 PDF 中查找', 'Find (⌘F)': '查找（⌘F）', 'Mark region': '标记区域', 'Mark a figure or region': '标记图表或区域', 'Search the PDF': '搜索 PDF',
  'No matches': '无匹配', '{current} of {total}': '{current}/{total}', 'Previous match': '上一个匹配', 'Next match': '下一个匹配', 'Close search': '关闭搜索',
  'Drag across the page to mark a figure, equation or region. Press Escape to stop.': '在页面上拖动以标记图表、公式或区域。按 Esc 结束。',
  'PDF pages': 'PDF 页面', 'The PDF could not be opened: {error}': '无法打开 PDF：{error}', 'Note {n}: {comment}': '批注 {n}：{comment}',

  // Review
  '{title} PDF change review': '{title} 的 PDF 修改审阅', 'The PDF review could not be loaded.': '无法加载 PDF 审阅。',
  'The PDF review is taking longer than expected.': 'PDF 审阅加载时间比预期长。', 'Loading PDF review…': '正在加载 PDF 审阅…', 'Reload review': '重新加载审阅',
  'Mark a region in the review PDF': '在审阅 PDF 中标记区域', 'Review notes, {n}': '审阅批注，{n} 条', 'Review notes': '审阅批注', 'Review note: {comment}': '审阅批注：{comment}',
  'Review PDF notes': '审阅 PDF 批注', 'Review notes ({n})': '审阅批注（{n}）', 'Close review notes': '关闭审阅批注',
  'Drag over a figure, equation or paragraph to add a note.': '拖动框选图表、公式或段落来添加批注。', 'Delete review note {n}': '删除审阅批注 {n}',
  'Marked on an earlier review round.': '标记于较早的审阅轮次。',
  'Select text in the review PDF and choose Add note, or use Mark region. Notes can also be added to accepted, rejected and unchanged text.': '在审阅 PDF 中选中文字后选择“添加批注”，或使用“标记区域”。已接受、已拒绝和未修改的文字也可以添加批注。',
  'Check the task status before sending notes.': '发送批注前请先检查任务状态。',
  'Full PDF': '完整 PDF', 'Open the full PDF after round {round}': '打开第 {round} 轮之后的完整 PDF', 'Build review': '生成审阅', 'Build the review again': '重新生成审阅',
  'Open review in new tab': '在新标签页中打开审阅',

  // Sidebar and header
  'Rename {name}': '重命名 {name}', 'Rename paper: {name}': '重命名论文：{name}', '{name} · Click to rename': '{name} · 点击重命名',
  'Papers and tasks': '论文和任务', 'Hide task list': '隐藏任务列表', 'Paper': '论文', 'Paper: {name}': '论文：{name}', 'Add paper…': '添加论文…', 'Add paper': '添加论文',
  'Git status of the manuscript': '稿件的 Git 状态', 'New task': '新任务', 'Tasks': '任务', 'Task list': '任务列表',
  '{n} change to decide': '{n} 处修改待定', '{n} changes to decide': '{n} 处修改待定', 'Task actions for {title}': '{title} 的任务操作',
  'Rename…': '重命名…', 'Check status': '检查状态', 'Retry deletion…': '重试删除…', 'Delete task…': '删除任务…',
  'No tasks yet. Start one with New task.': '还没有任务。用“新任务”开始一个。', 'Add a paper to get started.': '添加一篇论文即可开始。',
  'Settings': '设置', 'Host': '主机', 'Connected': '已连接', 'Reconnecting': '正在重新连接', '{n} active task': '{n} 个活动任务', '{n} active tasks': '{n} 个活动任务',
  'Close task list': '关闭任务列表', 'Show task list': '显示任务列表',
  'Loading': '加载中', 'Compiling': '编译中', 'Build failed': '编译失败', 'Compiled {time}': '{time}编译',
  'PDF options': 'PDF 选项', 'Recompile': '重新编译', 'Open the PDF file': '打开 PDF 文件', 'Compile the PDF again': '重新编译 PDF',
  'Open the PDF file in a new tab': '在新标签页中打开 PDF 文件', 'Open PDF': '打开 PDF', 'PDF view': 'PDF 视图', 'Notes, {n}': '批注，{n} 条', 'Git, {n} changed': 'Git，{n} 处改动',
  'Retry deletion': '重试删除', 'Pause': '暂停', 'View details': '查看详情', 'Workspace view': '工作区视图',
  'Review, {n} to decide': '审阅，{n} 处待定', 'Review': '审阅', 'Chat (reply needed)': '对话（需要回复）', 'PDF review only': '只看 PDF 审阅',
  'Split': '分栏', 'Review and chat side by side': '审阅和对话并排', 'Chat only': '只看对话',
  'Connection lost. Showing the last update; your draft is kept.': '连接已断开。正在显示最近一次更新，你的草稿仍然保留。', 'Retry connection': '重新连接',
  'Connecting to {agent}…': '正在连接 {agent}…', 'Connecting…': '正在连接…', 'Reconnect': '重新连接',
  'Resize chat panel': '调整对话面板宽度', 'Drag to resize · Double-click to reset': '拖动调整宽度 · 双击还原',
  'PDF review': 'PDF 审阅', 'The latest review build failed.': '最近一次审阅生成失败。', 'Retry build': '重新生成',
  'Deletion is in progress': '正在删除', 'This task is reserved until its worktree cleanup is confirmed. Use Retry deletion if the connection was interrupted.': '在确认工作树清理完成之前，此任务会保留。如果连接中断，请使用“重试删除”。',
  'Building PDF review…': '正在生成 PDF 审阅…', 'No review yet': '还没有审阅', 'The review will appear when the build finishes.': '编译完成后会显示审阅。',
  'PDF changes will appear here after {agent} finishes editing.': '{agent} 完成编辑后，PDF 修改会显示在这里。',

  // Home
  'Opening your workspace': '正在打开工作区', 'Connecting to your papers and tasks…': '正在连接你的论文和任务…', 'What are we revising next?': '接下来要修改什么？',
  'Describe the revision': '描述修改', 'Describe the revision, or type / for a skill…': '描述修改，或输入 / 选择技能…',
  'Describe the revision, what to preserve, and how to judge the result…': '描述要做的修改、需要保留的内容，以及如何判断结果…',
  'Start task': '开始任务', 'Start task (Enter)': '开始任务（Enter）', '{agent} is unavailable on this host: {error}': '{agent} 在此主机上不可用：{error}',
  'Add your first paper': '添加你的第一篇论文',
  'Connect a LaTeX Git repository on this host. An agent edits it in isolated worktrees, and you review every change as a PDF diff.': '连接此主机上的一个 LaTeX Git 仓库。智能体在隔离的工作树中编辑，你以 PDF 差异的形式审阅每一处修改。',
  'Dismiss error': '关闭错误提示', 'Close': '关闭', 'Add a paper': '添加论文',
  'Choose an existing LaTeX Git repository on this host. It needs at least one commit and must compile with latexmk.': '选择此主机上已有的 LaTeX Git 仓库。它至少需要一个提交，并且能用 latexmk 编译。',
  'Repository path': '仓库路径', '/Users/you/papers/my-paper': '/Users/you/papers/my-paper', 'Display name (optional)': '显示名称（可选）', 'My research paper': '我的研究论文', 'Cancel': '取消',
  'Copied path': '已复制路径', 'Copy path: {path}': '复制路径：{path}',

  // Notifications
  '{agent} is waiting for your approval': '{agent} 正在等待你的批准',
  'Review ready · {n} change to decide': '审阅已就绪 · {n} 处修改待定', 'Review ready · {n} changes to decide': '审阅已就绪 · {n} 处修改待定',
  '{agent} finished': '{agent} 已完成', 'A task needs attention': '有任务需要处理',
  'Notifications are on': '通知已开启', 'Papilot will tell you here when a task needs you.': '任务需要你时，Papilot 会在这里通知你。',

  // Settings
  'This browser cannot show notifications.': '此浏览器无法显示通知。',
  'Browsers show notifications only on HTTPS or localhost. Open Papilot at a secure address to use them.': '浏览器只在 HTTPS 或 localhost 上显示通知。请通过安全地址打开 Papilot 后再使用。',
  'Notifications are blocked for this site. Allow them in the browser’s site settings, then turn them on here.': '此网站的通知已被屏蔽。请先在浏览器的网站设置中允许通知，再回到这里开启。',
  'These preferences apply to this browser.': '这些偏好设置只对此浏览器生效。',
  'Appearance': '外观', 'Light': '浅色', 'Dark': '深色', 'System': '跟随系统', 'Language': '语言', 'Browser default ({language})': '浏览器默认（{language}）',
  'Notifications': '通知',
  'Notify me when a task needs my reply, its review is ready, or it stops with an error, while Papilot is in the background.': 'Papilot 在后台时，如果任务需要我回复、审阅已就绪或因错误停止，就通知我。',
  'Send a test notification': '发送测试通知',
  'Sent. If nothing appeared, allow notifications for this browser in your system settings.': '已发送。如果没有看到通知，请在系统设置中允许此浏览器发送通知。',
  'This browser could not show the notification.': '此浏览器无法显示这条通知。',

  // Skills
  'Skills': '技能', 'This paper': '本论文', 'Yours': '你的', 'No skill matches. Press Enter to send the text as it is.': '没有匹配的技能。按 Enter 直接发送文字。',
  'Skill: {name}': '技能：{name}', 'Remove the {name} skill': '移除技能 {name}', 'Start from a skill': '从技能开始',

  // Delete task
  'Pause this task before deleting it.': '删除前请先暂停此任务。', 'Wait for the PDF build to finish before deleting this task.': '请等 PDF 编译完成后再删除此任务。',
  'Check task status before deleting this task.': '删除前请先检查任务状态。', 'Delete task?': '删除任务？',
  'This permanently removes the task from Papilot, including its conversation, worktree, and PDF review files. Unaccepted edits and saved comments will be discarded, and review decisions can no longer be undone.': '这会从 Papilot 中永久删除此任务，包括它的对话、工作树和 PDF 审阅文件。未接受的修改和已保存的评论将被丢弃，审阅决定也无法再撤销。',
  'Accepted changes in your manuscript stay in place. Other tasks are not affected.': '稿件中已接受的修改会保留，其他任务不受影响。',
  'Deletion has already started. Retry to confirm the cleanup and remove the task.': '删除已经开始。重试以确认清理并移除任务。',
  'Deleting…': '正在删除…', 'Delete task': '删除任务',

  // Usage
  'Weekly limit': '每周额度', 'Daily limit': '每日额度', '{n}-day limit': '{n} 天额度', '{n}-hour limit': '{n} 小时额度', '{n}-minute limit': '{n} 分钟额度', 'Usage limit': '用量额度',
  'resets now': '即将重置', 'resets in {hours} h {minutes} min': '{hours} 小时 {minutes} 分钟后重置', 'resets in {minutes} min': '{minutes} 分钟后重置', 'resets {time}': '{time} 重置',
  '{name} used': '{name}已用', '{used}% used': '已用 {used}%', 'Limit reached': '已达上限', '{agent} usage': '{agent} 用量',
  'Unlimited credits': '无限额度', '{n} credits': '{n} 点额度', 'Credits available': '有可用额度',
};
