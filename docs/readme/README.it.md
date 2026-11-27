<div align="center">

<img src="../assets/wordmark.svg#gh-light-mode-only" width="220" height="69" alt="Papilot"><img src="../assets/wordmark-dark.svg#gh-dark-mode-only" width="220" height="69" alt="Papilot"><br>**Editor LaTeX con IA di nuova generazione**

<h3>Non&nbsp;leggere&nbsp;o&nbsp;scrivere&nbsp;<code>.tex</code>&emsp; Lavora&nbsp;direttamente&nbsp;sul&nbsp;<img src="../assets/pdf.svg" width="17" height="24" align="absmiddle" alt="PDF"></h3>

<a href="https://papilot.ai"><b>papilot.ai</b></a>&emsp;<a href="https://papilot.ai/demo">Demo online</a>&emsp;<a href="#get-started">Per iniziare</a>&emsp;<a href="#agents">Agenti</a>&emsp;<a href="#how-it-works">Come funziona</a>

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
  <img src="../assets/readme-showcase/hero.png" alt="Papilot mostra una modifica dell'IA impaginata con confronto prima e dopo direttamente sul PDF, con le opzioni Accetta, Rifiuta e Commenta." width="900">
</picture>
</a>
</p>

<a id="features"></a>

<a id="why-papilot"></a>

## Perché Papilot

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-annotate-dark.png"><img src="../assets/readme-showcase/why-annotate.png" alt="Una frase e una figura riquadrate sul PDF, ciascuna con un'annotazione per l'agente." width="100%"></picture><br>
<b>Indica direttamente sulla pagina</b><br>
Seleziona una frase, oppure riquadra un'equazione o una figura, e scrivi cosa modificare. Il tuo agente riceve le righe sorgente esatte, in qualunque file si trovino.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-review-dark.png"><img src="../assets/readme-showcase/why-review.png" alt="Una modifica mostrata impaginata, prima e dopo, con le opzioni Accetta, Rifiuta e Commenta." width="100%"></picture><br>
<b>Revisiona ogni modifica impaginata</b><br>
Ogni modifica viene presentata sul PDF come confronto prima e dopo. Accettala, rifiutala o commentala: nulla viene applicato al tuo articolo finché non lo accetti.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-overleaf-dark.png"><img src="../assets/readme-showcase/why-overleaf.png" alt="Papilot e Overleaf affiancati, sincronizzati in tempo reale in entrambe le direzioni, con i cursori dei coautori in Overleaf." width="100%"></picture><br>
<b><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/overleaf-dark.svg"><img src="../assets/readme-icons/overleaf.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;Sincronizzazione in tempo reale con Overleaf</b><br>
I coautori continuano a scrivere su Overleaf. Le modifiche che accetti li raggiungono in circa un secondo, mentre le loro arrivano nei tuoi file e nel PDF con i rispettivi nomi.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-agents-dark.png"><img src="../assets/readme-showcase/why-agents.png" alt="Il menu dei modelli sotto la chat, con modelli di Codex, Claude e GLM." width="100%"></picture><br>
<b>Qualsiasi agente, qualsiasi modello</b><br>
Scegli un modello di qualsiasi agente connesso sotto la chat. Passa a un altro agente e Papilot rieseguirà la tua richiesta con quello selezionato.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-record-dark.png"><img src="../assets/readme-showcase/why-record.png" alt="Modifiche accettate registrate con un messaggio di commit e inviate tramite push, nella cronologia delle versioni." width="100%"></picture><br>
<b>Ogni modifica tracciata</b><br>
Ogni attività viene eseguita nel proprio albero di lavoro Git, separata dai tuoi file. Eseguire il commit delle modifiche accettate è un passaggio distinto e ogni modifica resta nella tua cronologia Git.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-phone-dark.png"><img src="../assets/readme-showcase/why-phone.png" alt="La stessa revisione su uno smartphone, davanti alla finestra desktop." width="100%"></picture><br>
<b>Revisiona dal telefono</b><br>
Apri Papilot sul tuo telefono o tablet tramite <a href="../guide.md#remote-access-with-tailscale">Tailscale</a>, quindi leggi il PDF, aggiungi annotazioni e accetta le modifiche anche lontano dalla scrivania.
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-universe-dark.png"><img src="../assets/readme-showcase/why-universe.png" alt="Papilot Universe: modelli LaTeX per tesi, riviste, conferenze, CV e poster." width="100%"></picture><br>
<b>Inizia da un modello</b><br>
<a href="https://papilot.ai/universe/">Papilot Universe</a> offre modelli per tesi, pacchetti per riviste e conferenze, presentazioni, poster, CV e libri, e collega oltre 400 conferenze al modello richiesto dal relativo invito a presentare articoli. Scegline uno e Papilot creerà l'articolo, pronto da compilare.
</td>
</tr>
</table>

<a id="quick-start"></a>
<a id="get-started"></a>
<a id="downloads"></a>

<a id="get-started"></a>

## Per iniziare

<p align="center">
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/mac-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/mac-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/mac-compact.png"><img src="../assets/readme-downloads/mac.png" alt="Scarica per macOS: Apple Silicon e Intel, DMG, ZIP o Homebrew." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/windows-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/windows-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/windows-compact.png"><img src="../assets/readme-downloads/windows.png" alt="Scarica per Windows: installer x64, app portatile o Scoop." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/linux-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/linux-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/linux-compact.png"><img src="../assets/readme-downloads/linux.png" alt="Scarica per Linux: AppImage, APT (.deb), AUR o Nix." width="49%"></picture></a>
<a href="../guide.md#install-and-run"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/terminal-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact.png"><img src="../assets/readme-downloads/terminal.png" alt="Installa da terminale: npm install -g papilot, poi papilot demo. Richiede Node.js 22.22+." width="49%"></picture></a>
</p>

<details>
<summary><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/pm-bar-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/pm-bar-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/pm-bar-compact.png"><img src="../assets/readme-downloads/pm-bar.png" alt="Gestori di pacchetti: Homebrew, Scoop, APT, AUR e Nix — mostra i comandi di installazione" width="96%" align="absmiddle"></picture></summary>

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/homebrew-dark.svg"><img src="../assets/readme-icons/homebrew.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;<b>macOS</b> · <a href="https://github.com/PapilotAI/homebrew-tap">Homebrew</a>

```sh
brew tap PapilotAI/tap
brew trust PapilotAI/tap
brew install --cask PapilotAI/tap/papilot
```

<sub>Non firmato — consenti in Privacy e sicurezza al primo avvio (<a href="https://github.com/PapilotAI/homebrew-tap#gatekeeper-note">dettagli</a>).</sub>
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/scoop-dark.svg"><img src="../assets/readme-icons/scoop.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;<b>Windows</b> · <a href="https://github.com/PapilotAI/scoop-bucket">Scoop</a>

```powershell
scoop bucket add papilot https://github.com/PapilotAI/scoop-bucket
scoop install papilot/papilot
```

<sub>Aggiorna in qualsiasi momento con <code>scoop update papilot</code>.</sub>
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

<sub>Repository firmato — verifica l’impronta nella <a href="../apt.md">guida APT</a>.</sub>
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/archlinux-dark.svg"><img src="../assets/readme-icons/archlinux.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<b>Arch</b> · <a href="../aur.md">AUR</a> &nbsp;&amp;&nbsp; <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/nixos-dark.svg"><img src="../assets/readme-icons/nixos.svg" width="15" height="15" align="absmiddle" alt=""></picture>&nbsp;<b>Nix</b> · <a href="../nix.md">Flake</a>

```sh
# Arch Linux (AUR)
paru -S papilot-bin

# Nix
nix run github:PapilotAI/papilot -- demo
```

<sub>Vedi la <a href="../aur.md">guida Arch</a> e la <a href="../nix.md">guida Nix</a>.</sub>
</td>
</tr>
</table>

</details>

<p align="center"><sub>Gratuito e open source. Richiede Git, una distribuzione TeX e un <a href="#agents">agente</a> con accesso effettuato.</sub></p>

<a id="agents"></a>

<a id="works-with-your-agent"></a>

## Funziona con il tuo agente

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

<p align="center"><sub>Usa l'account o la chiave API che hai già, oppure usa Papilot Writer integrato. <a href="../guide.md#agents">Configurazione</a></sub></p>

<a id="how-it-works"></a>

<a id="how-it-works"></a>

## Come funziona

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/flow-compact-dark.png">
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/flow-dark.png">
    <source media="(max-width: 600px)" srcset="../assets/readme-showcase/flow-compact.png">
    <img src="../assets/readme-showcase/flow.png" alt="1. Apri il tuo articolo: una cartella, un progetto Overleaf o un modello. 2. Annota il PDF. 3. L'agente modifica una copia nel proprio albero di lavoro Git. 4. Visualizza il risultato impaginato: la frase diventa la regola di inferenza T-Abs, tracciata sulla pagina. 5. Decidi tu: accetta, rifiuta o commenta per un'ulteriore revisione. 6. Esegui il commit e sincronizza: le modifiche vengono applicate ai tuoi file e alla cronologia Git, e sincronizzate con Overleaf se collegato." width="1000">
  </picture>
</p>

<a id="documentation-and-community"></a>

<a id="community"></a>

## Comunità

<p align="center">
<a href="https://github.com/PapilotAI/papilot/issues/new/choose"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/issue-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/issue-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/issue-compact.png"><img src="../assets/readme-community/issue.png" alt="Segnala un bug: apri una segnalazione, anche sintetica." width="49%"></picture></a>
<a href="https://github.com/PapilotAI/papilot/discussions"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discussion-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discussion-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discussion-compact.png"><img src="../assets/readme-community/discussion.png" alt="Fai una domanda o condividi un'idea in Discussions." width="49%"></picture></a>
<a href="https://discord.gg/WdgZDDAvwj"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discord-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discord-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discord-compact.png"><img src="../assets/readme-community/discord.png" alt="Chatta su Discord con chi sviluppa e utilizza Papilot." width="49%"></picture></a>
<a href="../../.github/CONTRIBUTING.md"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/contribute-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/contribute-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/contribute-compact.png"><img src="../assets/readme-community/contribute.png" alt="Contribuisci: le pull request sono benvenute, comprese quelle realizzate con agenti IA." width="49%"></picture></a>
</p>

Papilot rilascia aggiornamenti frequenti: consulta il [changelog](../../CHANGELOG.md).

<a id="contributors"></a>

## Collaboratori

<p>
  <a href="https://github.com/PapilotAI/papilot/graphs/contributors">
    <picture>
      <source media="(max-width: 600px)" srcset="https://papilot.ai/readme-contributors/compact.svg">
      <img src="https://papilot.ai/readme-contributors/desktop.svg" alt="I collaboratori di Papilot">
    </picture>
  </a>
</p>

<a id="star-history"></a>

## Cronologia delle stelle

Se Papilot ti fa risparmiare tempo, una stella aiuta altri ricercatori a scoprirlo.

<a href="https://www.star-history.com/?repos=papilotai%2Fpapilot&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
   <img alt="Grafico della cronologia delle stelle" src="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
 </picture>
</a>

---

<p align="center"><sub><a href="../../LICENSE">MIT</a> © 2026 PapilotAI. Grazie ai nostri amici di <a href="https://linux.do/">LINUX DO</a>.</sub></p>
