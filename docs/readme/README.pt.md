<div align="center">

<img src="../assets/wordmark.svg#gh-light-mode-only" width="220" height="69" alt="Papilot"><img src="../assets/wordmark-dark.svg#gh-dark-mode-only" width="220" height="69" alt="Papilot"><br>**Editor LaTeX de nova geração com IA**

<h3>Não&nbsp;leia&nbsp;nem&nbsp;escreva&nbsp;<code>.tex</code>&emsp; Trabalhe&nbsp;diretamente&nbsp;no&nbsp;<img src="../assets/pdf.svg" width="17" height="24" align="absmiddle" alt="PDF"></h3>

<a href="https://papilot.ai"><b>papilot.ai</b></a>&emsp;<a href="https://papilot.ai/demo">Demonstração online</a>&emsp;<a href="#get-started">Primeiros passos</a>&emsp;<a href="#agents">Agentes</a>&emsp;<a href="#how-it-works">Como funciona</a>

<!-- BEGIN BADGES -->
[![License: MIT](https://img.shields.io/github/license/PapilotAI/papilot?style=flat&color=22c55e)](../../LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/PapilotAI/papilot/ci.yml?branch=main&style=flat&label=CI)](https://github.com/PapilotAI/papilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/PapilotAI/papilot?style=flat&label=release&color=0969da)](https://github.com/PapilotAI/papilot/releases/latest)
[![GitHub total downloads](https://img.shields.io/github/downloads/PapilotAI/papilot/total?style=flat&logo=github&label=downloads&color=0969da)](https://github.com/PapilotAI/papilot/releases)
[![npm monthly downloads](https://img.shields.io/npm/dm/papilot?style=flat&logo=npm&label=downloads&color=cb3837)](https://www.npmjs.com/package/papilot)
[![GitHub stars](https://img.shields.io/github/stars/PapilotAI/papilot?style=flat&logo=github&label=stars&color=0969da)](https://github.com/PapilotAI/papilot/stargazers)
[![Discord](https://img.shields.io/badge/Discord-Join%20us-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/WdgZDDAvwj)
<!-- END BADGES -->

<p data-language-switcher><sub><a href="../../README.md">English</a>&emsp;<a href="README.zh-CN.md">简体中文</a>&emsp;<a href="README.zh-Hant.md">繁體中文</a>&emsp;<a href="README.ja.md">日本語</a>&emsp;<a href="README.ko.md">한국어</a>&emsp;<a href="README.de.md">Deutsch</a>&emsp;<a href="README.fr.md">Français</a>&emsp;<a href="README.es.md">Español</a>&emsp;<a href="README.pt.md">Português</a>&emsp;<a href="README.it.md">Italiano</a>&emsp;<a href="README.sv.md">Svenska</a></sub></p>

</div>

<p align="center">
<a href="https://papilot.ai">
<picture>
  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/hero-compact-dark.png">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/hero-dark.png">
  <source media="(max-width: 600px)" srcset="../assets/readme-showcase/hero-compact.png">
  <img src="../assets/readme-showcase/hero.png" alt="O Papilot mostra uma edição de IA diagramada como antes e depois no PDF, com opções para Aceitar, Rejeitar e Comentar." width="900">
</picture>
</a>
</p>

<a id="features"></a>

<a id="why-papilot"></a>

## Por que o Papilot

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-annotate-dark.png"><img src="../assets/readme-showcase/why-annotate.png" alt="Uma frase e uma figura demarcadas no PDF, cada uma com uma anotação para o agente." width="100%"></picture><br>
<b>Aponte na página</b><br>
Selecione uma frase ou demarque uma equação ou figura e escreva o que deve mudar. Seu agente recebe as linhas exatas do código-fonte, em qualquer arquivo em que estejam.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-review-dark.png"><img src="../assets/readme-showcase/why-review.png" alt="Uma alteração mostrada já diagramada, antes e depois, com opções para Aceitar, Rejeitar e Comentar." width="100%"></picture><br>
<b>Revise cada alteração já diagramada</b><br>
Cada edição retorna como um antes e depois no PDF. Aceite, rejeite ou comente; nada entra no seu artigo até que você aceite.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-overleaf-dark.png"><img src="../assets/readme-showcase/why-overleaf.png" alt="Papilot e Overleaf lado a lado, sincronizados em tempo real nos dois sentidos, com os cursores dos coautores no Overleaf." width="100%"></picture><br>
<b><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/overleaf-dark.svg"><img src="../assets/readme-icons/overleaf.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;Sincronização em tempo real com o Overleaf</b><br>
Os coautores continuam escrevendo no Overleaf. Suas alterações aceitas chegam até eles em cerca de um segundo, e as deles aparecem nos seus arquivos e no PDF com os respectivos nomes.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-agents-dark.png"><img src="../assets/readme-showcase/why-agents.png" alt="O menu de modelos abaixo do chat, com modelos de Codex, Claude e GLM." width="100%"></picture><br>
<b>Qualquer agente, qualquer modelo</b><br>
Escolha um modelo de qualquer agente conectado abaixo do chat. Mude para outro agente e o Papilot executa novamente sua solicitação com ele.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-record-dark.png"><img src="../assets/readme-showcase/why-record.png" alt="Alterações aceitas confirmadas com uma mensagem e enviadas no histórico de versões." width="100%"></picture><br>
<b>Cada alteração registrada</b><br>
Cada tarefa é executada em sua própria árvore de trabalho do Git, separada dos seus arquivos. Confirmar as alterações aceitas é uma etapa à parte, e cada modificação permanece no seu histórico do Git.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-phone-dark.png"><img src="../assets/readme-showcase/why-phone.png" alt="A mesma revisão em um celular, em frente à janela do computador." width="100%"></picture><br>
<b>Revise pelo celular</b><br>
Abra o Papilot no seu celular ou tablet via <a href="../guide.md#remote-access-with-tailscale">Tailscale</a> para ler o PDF, fazer marcações e aceitar alterações longe da sua mesa.
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-universe-dark.png"><img src="../assets/readme-showcase/why-universe.png" alt="Papilot Universe: modelos LaTeX para teses, periódicos, conferências, currículos e pôsteres." width="100%"></picture><br>
<b>Comece a partir de um modelo</b><br>
O <a href="https://papilot.ai/universe/">Papilot Universe</a> reúne modelos para teses, pacotes de periódicos e conferências, slides, pôsteres, currículos e livros, além de associar mais de 400 conferências ao modelo exigido em suas chamadas de artigos. Escolha um e o Papilot cria o artigo, pronto para compilar.
</td>
</tr>
</table>

<a id="quick-start"></a>
<a id="get-started"></a>
<a id="downloads"></a>

<a id="get-started"></a>

## Primeiros passos

<p align="center">
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/mac-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/mac-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/mac-compact.png"><img src="../assets/readme-downloads/mac.png" alt="Baixar para macOS: Apple Silicon e Intel, DMG, ZIP ou Homebrew." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/windows-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/windows-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/windows-compact.png"><img src="../assets/readme-downloads/windows.png" alt="Baixar para Windows: instalador x64, aplicativo portátil ou Scoop." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/linux-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/linux-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/linux-compact.png"><img src="../assets/readme-downloads/linux.png" alt="Baixar para Linux: AppImage, APT (.deb), AUR ou Nix." width="49%"></picture></a>
<a href="../guide.md#install-and-run"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/terminal-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact.png"><img src="../assets/readme-downloads/terminal.png" alt="Instalar pelo terminal: npm install -g papilot e depois papilot demo. Requer Node.js 22.22+." width="49%"></picture></a>
</p>

<details>
<summary><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/pm-bar-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/pm-bar-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/pm-bar-compact.png"><img src="../assets/readme-downloads/pm-bar.png" alt="Gerenciadores de pacotes: Homebrew, Scoop, APT, AUR e Nix — mostrar comandos de instalação" width="96%" align="absmiddle"></picture></summary>

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/homebrew-dark.svg"><img src="../assets/readme-icons/homebrew.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;<b>macOS</b> · <a href="https://github.com/PapilotAI/homebrew-tap">Homebrew</a>

```sh
brew tap PapilotAI/tap
brew trust PapilotAI/tap
brew install --cask PapilotAI/tap/papilot
```

<sub>Sem assinatura — permita em Privacidade e Segurança na primeira execução (<a href="https://github.com/PapilotAI/homebrew-tap#gatekeeper-note">detalhes</a>).</sub>
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/scoop-dark.svg"><img src="../assets/readme-icons/scoop.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;<b>Windows</b> · <a href="https://github.com/PapilotAI/scoop-bucket">Scoop</a>

```powershell
scoop bucket add papilot https://github.com/PapilotAI/scoop-bucket
scoop install papilot/papilot
```

<sub>Atualize quando quiser com <code>scoop update papilot</code>.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/debian-dark.svg"><img src="../assets/readme-icons/debian.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/ubuntu-dark.svg"><img src="../assets/readme-icons/ubuntu.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<b>Debian / Ubuntu</b> · <a href="../apt.md">APT</a>

```sh
curl -fsSL https://papilot.ai/apt/gpg.key | \
  sudo gpg --dearmor -o /etc/apt/keyrings/papilot.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/papilot.gpg] https://papilot.ai/apt stable main" | \
  sudo tee /etc/apt/sources.list.d/papilot.list
sudo apt update && sudo apt install papilot
```

<sub>Repositório assinado — verifique a impressão digital no <a href="../apt.md">guia APT</a>.</sub>
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/archlinux-dark.svg"><img src="../assets/readme-icons/archlinux.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<b>Arch</b> · <a href="../aur.md">AUR</a> &nbsp;&amp;&nbsp; <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/nixos-dark.svg"><img src="../assets/readme-icons/nixos.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<b>Nix</b> · <a href="../nix.md">Flake</a>

```sh
# Arch Linux (AUR)
paru -S papilot-bin

# Nix
nix run github:PapilotAI/papilot -- demo
```

<sub>Veja o <a href="../aur.md">guia Arch</a> e o <a href="../nix.md">guia Nix</a>.</sub>
</td>
</tr>
</table>

</details>

<p align="center"><sub>Gratuito e de código aberto. Requer Git, uma distribuição TeX e um <a href="#agents">agente</a> autenticado.</sub></p>

<a id="agents"></a>

<a id="works-with-your-agent"></a>

## Funciona com o seu agente

<p align="center">
  <a href="../guide.md#agents">
    <picture>
      <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-agents/grid-compact-dark.png">
      <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-agents/grid-dark.png">
      <source media="(max-width: 600px)" srcset="../assets/readme-agents/grid-compact.png">
      <img src="../assets/readme-agents/grid.png" alt="Papilot Writer, Codex, Claude, Cursor, GitHub Copilot, Grok, Antigravity, Kimi, GLM, ZCode, DeepSeek, Qwen, OpenCode, Qoder, CodeBuddy, WorkBuddy e Pi" width="848">
    </picture>
  </a>
</p>

<p align="center"><sub>Use a conta ou chave de API que você já possui, ou utilize o Papilot Writer integrado. <a href="../guide.md#agents">Configuração</a></sub></p>

<a id="how-it-works"></a>

<a id="how-it-works"></a>

## Como funciona

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/flow-compact-dark.png">
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/flow-dark.png">
    <source media="(max-width: 600px)" srcset="../assets/readme-showcase/flow-compact.png">
    <img src="../assets/readme-showcase/flow.png" alt="1. Abra seu artigo: uma pasta, um projeto do Overleaf ou um modelo. 2. Marque o PDF. 3. O agente edita uma cópia em sua própria árvore de trabalho do Git. 4. Veja o resultado diagramado: a frase se torna a regra de inferência T-Abs, desenhada na página. 5. Você decide: aceite, rejeite ou comente para uma nova rodada. 6. Confirme e sincronize: as alterações vão para os seus arquivos e histórico do Git, e sincronizam com o Overleaf se estiver vinculado." width="1000">
  </picture>
</p>

<a id="documentation-and-community"></a>

<a id="community"></a>

## Comunidade

<p align="center">
<a href="https://github.com/PapilotAI/papilot/issues/new/choose"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/issue-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/issue-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/issue-compact.png"><img src="../assets/readme-community/issue.png" alt="Relatar um erro: abra uma issue, mesmo que preliminar." width="49%"></picture></a>
<a href="https://github.com/PapilotAI/papilot/discussions"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discussion-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discussion-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discussion-compact.png"><img src="../assets/readme-community/discussion.png" alt="Tire uma dúvida ou compartilhe uma ideia nas Discussões." width="49%"></picture></a>
<a href="https://discord.gg/WdgZDDAvwj"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discord-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discord-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discord-compact.png"><img src="../assets/readme-community/discord.png" alt="Converse no Discord com as pessoas que desenvolvem e usam o Papilot." width="49%"></picture></a>
<a href="../../.github/CONTRIBUTING.md"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/contribute-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/contribute-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/contribute-compact.png"><img src="../assets/readme-community/contribute.png" alt="Contribua: pull requests são bem-vindos, inclusive os criados com agentes de IA." width="49%"></picture></a>
</p>

O Papilot recebe atualizações frequentes: consulte o [histórico de alterações](../../CHANGELOG.md).

<a id="contributors"></a>

## Contribuidores

<p>
  <a href="https://github.com/PapilotAI/papilot/graphs/contributors">
    <picture>
      <source media="(max-width: 600px)" srcset="https://papilot.ai/readme-contributors/compact.svg">
      <img src="https://papilot.ai/readme-contributors/desktop.svg" alt="Contribuidores do Papilot">
    </picture>
  </a>
</p>

<a id="star-history"></a>

## Histórico de estrelas

Se o Papilot economiza seu tempo, uma estrela ajuda outros pesquisadores a encontrá-lo.

<a href="https://www.star-history.com/?repos=papilotai%2Fpapilot&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
   <img alt="Gráfico do histórico de estrelas" src="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
 </picture>
</a>

---

<p align="center"><sub><a href="../../LICENSE">MIT</a> © 2026 PapilotAI. Agradecimentos aos nossos amigos da <a href="https://linux.do/">LINUX DO</a>.</sub></p>
