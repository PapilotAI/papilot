<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="Papilot logo">
</picture>

<h1>Papilot</h1>

<p><b>Revise LaTeX papers with an AI agent. Review every change as a PDF diff.</b></p>

<p>English · <a href="README.zh-CN.md">简体中文</a></p>

[![CI](https://github.com/cu1ch3n/papilot/actions/workflows/ci.yml/badge.svg)](https://github.com/cu1ch3n/papilot/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/papilot?color=2563eb&logo=npm)](https://www.npmjs.com/package/papilot)
[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522.22-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-087EA4?logo=react&logoColor=white)](https://react.dev)
[![LaTeX](https://img.shields.io/badge/LaTeX-008080?logo=latex&logoColor=white)](https://www.latex-project.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e)](https://github.com/cu1ch3n/papilot/pulls)

[![Codex](https://img.shields.io/badge/Codex-supported-10A37F?logo=openai&logoColor=white)](#-agents)
[![Claude](https://img.shields.io/badge/Claude-supported-D97757?logo=claude&logoColor=white)](#-agents)
[![Antigravity](https://img.shields.io/badge/Antigravity-supported-4285F4?logo=google&logoColor=white)](#-agents)

<br>

<img src="docs/assets/demo.gif" alt="Papilot: describe a revision, review the typeset diff, read the PDF, annotate it and commit" width="100%">

</div>

<br>

Papilot is a workspace that runs on your own computer. Describe a revision, and an agent edits your paper in its own Git worktree. Papilot compiles the result and shows you **what changed in the typeset PDF**. You accept, reject or comment on each change. Nothing reaches your manuscript until you accept it.

## ✨ Features

|  |  |
| --- | --- |
| 🌳 **Isolated tasks** | Every task edits its own Git worktree, and up to two run at once. |
| 🔍 **Typeset diffs** | Changes show as before and after snippets of the PDF, and the LaTeX source is one click away. |
| ✅ **You decide** | Accept, reject or comment on each change. Accept all and Reject all touch only the changes you haven't decided yet. Every decision can be undone. |
| 🤖 **Your agent** | Codex, Claude or Antigravity, each with your own login. Papilot remembers your model and reasoning effort. |
| 📖 **A real PDF reader** | pdf.js with contents, search and sharp zoom. Selecting text picks exactly the printed words. |
| 📝 **Notes on the page** | Select text or mark an equation, and SyncTeX sends the agent the exact LaTeX lines. |
| 🌿 **Git built in** | Diff files, commit the ones you choose, then fetch, pull or push. |
| 📱 **Anywhere** | Runs on your computer, and you can open it from your phone over Tailscale. |

## 🚀 Quick start

```sh
npm install -g papilot
papilot demo
```

Open **http://127.0.0.1:4317**. The demo adds an example paper to revise: a 26-page LaTeX paper about Papilot itself, full of equations. When you are ready, run `papilot` and choose **Add paper** to add any LaTeX project in a Git repository.

> [!NOTE]
> You need **Node.js 22.22+**, **Git**, a **TeX** distribution with `latexmk`, and one signed-in agent.

## 🤖 Agents

| Agent | Sign in once | How Papilot runs it |
| --- | --- | --- |
| **Codex** | `npx @openai/codex login` | Through the Codex app server, in its workspace sandbox. Your plan's usage appears on the new-task page. |
| **Claude** | Set `ANTHROPIC_API_KEY` | Through the Claude Agent SDK. The SDK does not accept a Pro or Max subscription login. |
| **Antigravity** | Sign in to `agy` | `agy -p`, one process per turn, editing files only. If your region needs it, set `PAPILOT_AGY_PROXY`. |

Papilot never reads, stores or forwards your credentials. An agent that isn't installed or signed in shows as unavailable.

## 🧭 How it works

```mermaid
flowchart LR
  A["✍️ Describe a revision"] --> B["🤖 Agent edits<br/>a task worktree"]
  B --> C["⚙️ latexmk builds<br/>both versions"]
  C --> D["🔍 PDF diff"]
  D -->|accept| E["📄 Your manuscript"]
  D -->|comment| B
```

The review engine builds the paper before and after the agent's edits, finds what changed in the PDF, and links each change to its LaTeX lines. Accepted changes are merged into the manuscript's working tree, and you commit them whenever you like.

<details>
<summary><b>⚙️ Options and remote access</b></summary>

<br>

```sh
papilot --port 4400            # another local port
papilot --data ~/papilot-data  # keep state somewhere else (default ~/.papilot)
papilot service install        # macOS: start after login, restart if it exits
```

Papilot listens only on `127.0.0.1`. To use it from another device, publish it on your tailnet with Tailscale Serve and set `PAPILOT_PUBLIC_ORIGIN` and `PAPILOT_TAILSCALE_LOGIN`. Papilot then checks the host, the browser origin and the Tailscale identity of every request. The [guide](docs/guide.md#remote-access-with-tailscale) has the steps.

</details>

<details>
<summary><b>🛠️ Develop</b></summary>

<br>

```sh
git clone https://github.com/cu1ch3n/papilot && cd papilot
npm ci && npm run setup:review
npm run build && npm start
```

Run `npm run typecheck`, `npm test` and `npm run test:ui` before sending a pull request.

</details>

## 📚 Documentation

The **[guide](docs/guide.md)** covers every part of the workspace, the configuration variables, recovery after restarts, and development. The example paper in [`examples/papilot-paper`](examples/papilot-paper) explains the design in depth, with proofs.

## 📄 License

[MIT](LICENSE) © 2026 Cui Chen. The bundled review engine in [`vendor/latex-review`](vendor/latex-review) is also MIT-licensed.
