import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA } from '../src/server/paths.ts';
import { Store } from '../src/server/store.ts';
import { Workspace } from '../src/server/workspace.ts';

const folder = path.join(DATA, 'example-paper');
if (!fs.existsSync(folder)) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'main.tex'), String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb}
\usepackage[colorlinks=true,linkcolor=teal]{hyperref}
\title{Small Steps, Clearer Papers}
\author{Papilot Example Workspace}
\date{}
\begin{document}
\maketitle
\begin{abstract}
Writing a research paper is a process that involves many different rounds of
revision. In this short example paper, we describe a simple workflow in which
independent editing tasks are reviewed before their changes are included in the
main manuscript. The workflow keeps a record of feedback and makes it possible
for an author to return to a task at a later time. This example is intended to
demonstrate the Papilot review interface; it does not report an empirical study.
\end{abstract}
\section{Introduction}
A useful writing assistant should make it easier for an author to inspect and
understand proposed changes. The author should be able to compare an original
passage with a proposed revision, leave a comment, and decide whether the revision
belongs in the manuscript. These decisions should remain available when the
author changes devices.

We consider a workflow with three separate steps: propose a change, review the
change, and incorporate accepted text. Keeping these steps explicit allows an
author to maintain control over the final argument.
\section{A Simple Review Model}
Let $D_t$ denote the accepted document after round $t$, and let $\Delta_t$ be a
proposed revision. A review decision $a_t\in\{0,1\}$ indicates whether the author
accepts the proposed revision. In a simplified model,
\begin{equation}
 D_{t+1}=\begin{cases}
 D_t\oplus\Delta_t, & a_t=1,\\
 D_t, & a_t=0.
 \end{cases}
\end{equation}
The operator $\oplus$ applies a compatible revision. If two changes conflict,
the author requests a new proposal instead of silently replacing accepted text.
Compilation is a useful check, but it does not establish that the mathematical
meaning of a revised passage is correct.
\section{Discussion}
Separating editing from acceptance creates a natural place for feedback. The
author can ask for a shorter explanation, a clearer definition, or a correction
to an assumption. The next round should preserve earlier accepted decisions
while addressing the new request.
\end{document}
`);
  fs.writeFileSync(path.join(folder, '.latex-review.json'), JSON.stringify({ main: 'main.tex', engine: 'pdflatex' }, null, 2));
  fs.writeFileSync(path.join(folder, '.gitignore'), '*.aux\n*.log\n*.out\n*.pdf\n*.fls\n*.fdb_latexmk\n*.synctex.gz\n');
  execFileSync('git', ['init', '-q', folder]);
  execFileSync('git', ['-C', folder, 'add', '.']);
  execFileSync('git', ['-C', folder, '-c', 'user.name=Papilot Example', '-c', 'user.email=papilot@localhost', 'commit', '-qm', 'Add example paper']);
}
const store = new Store(path.join(DATA, 'papilot.sqlite'));
const workspace = new Workspace(store);
const project = await workspace.addProject(folder, '示例论文 · Small Steps');
console.log(JSON.stringify({ project, note: 'Example ready. Create a task in the web UI to run real Codex.' }, null, 2));
store.close();
