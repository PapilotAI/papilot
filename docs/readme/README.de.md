<div align="center">

<img src="../assets/wordmark.svg#gh-light-mode-only" width="220" height="69" alt="Papilot"><img src="../assets/wordmark-dark.svg#gh-dark-mode-only" width="220" height="69" alt="Papilot"><br>**KI-gestützter LaTeX-Editor der nächsten Generation**

<h3>Kein&nbsp;Lesen&nbsp;oder&nbsp;Schreiben&nbsp;von&nbsp;<code>.tex</code>&emsp; Arbeiten&nbsp;Sie&nbsp;direkt&nbsp;im&nbsp;<img src="../assets/pdf.svg" width="17" height="24" align="absmiddle" alt="PDF"></h3>

<a href="https://papilot.ai"><b>papilot.ai</b></a>&emsp;<a href="https://papilot.ai/demo">Online-Demo</a>&emsp;<a href="#get-started">Erste Schritte</a>&emsp;<a href="#agents">Agenten</a>&emsp;<a href="#how-it-works">Funktionsweise</a>

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
  <img src="../assets/readme-showcase/hero.png" alt="Papilot zeigt eine KI-Bearbeitung als gesetzten Vorher-Nachher-Vergleich im PDF mit den Optionen Übernehmen, Ablehnen und Kommentieren." width="900">
</picture>
</a>
</p>

<a id="features"></a>

<a id="why-papilot"></a>

## Warum Papilot

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-annotate-dark.png"><img src="../assets/readme-showcase/why-annotate.png" alt="Ein Satz und eine Abbildung, die im PDF eingerahmt sind, jeweils mit einer Anmerkung für den Agenten." width="100%"></picture><br>
<b>Direkt auf der Seite markieren</b><br>
Markieren Sie einen Satz oder rahmen Sie eine Gleichung bzw. Abbildung ein und schreiben Sie, was geändert werden soll. Ihr Agent erhält die exakten Quellzeilen – unabhängig davon, in welcher Datei sie liegen.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-review-dark.png"><img src="../assets/readme-showcase/why-review.png" alt="Eine gesetzte Änderung im Vorher-Nachher-Vergleich mit Übernehmen, Ablehnen und Kommentieren." width="100%"></picture><br>
<b>Jede Änderung fertig gesetzt überprüfen</b><br>
Jede Bearbeitung wird als Vorher-Nachher-Vergleich im PDF angezeigt. Übernehmen, ablehnen oder kommentieren Sie den Vorschlag – nichts gelangt in Ihren Artikel, bevor Sie es übernehmen.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-overleaf-dark.png"><img src="../assets/readme-showcase/why-overleaf.png" alt="Papilot und Overleaf nebeneinander, in Echtzeit in beide Richtungen synchronisiert, mit den Cursorn der Mitautoren in Overleaf." width="100%"></picture><br>
<b><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/overleaf-dark.svg"><img src="../assets/readme-icons/overleaf.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;Live-Synchronisierung mit Overleaf</b><br>
Mitautoren schreiben wie gewohnt in Overleaf weiter. Ihre übernommenen Änderungen kommen dort in etwa einer Sekunde an, und deren Änderungen erscheinen mit Namen in Ihren Dateien und im PDF.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-agents-dark.png"><img src="../assets/readme-showcase/why-agents.png" alt="Das Modellmenü unter dem Chat mit Modellen von Codex, Claude und GLM." width="100%"></picture><br>
<b>Jeder Agent, jedes Modell</b><br>
Wählen Sie unter dem Chat ein Modell eines beliebigen verbundenen Agenten aus. Wechseln Sie zu einem anderen Agenten, und Papilot führt Ihre Anfrage erneut damit aus.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-record-dark.png"><img src="../assets/readme-showcase/why-record.png" alt="Übernommene Änderungen, die mit einer Nachricht im Versionsverlauf committet und gepusht wurden." width="100%"></picture><br>
<b>Jede Änderung nachvollziehbar</b><br>
Jede Aufgabe läuft in ihrem eigenen Git-Arbeitsbaum, getrennt von Ihren Dateien. Das Committen übernommener Änderungen ist ein separater Schritt, und jede Änderung bleibt in Ihrem Git-Verlauf erhalten.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-phone-dark.png"><img src="../assets/readme-showcase/why-phone.png" alt="Dieselbe Überprüfung auf einem Smartphone vor dem Desktop-Fenster." width="100%"></picture><br>
<b>Überprüfung auf dem Smartphone</b><br>
Öffnen Sie Papilot auf Ihrem Smartphone oder Tablet über <a href="../guide.md#remote-access-with-tailscale">Tailscale</a>, um das PDF unterwegs zu lesen, mit Anmerkungen zu versehen und Änderungen zu übernehmen.
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-universe-dark.png"><img src="../assets/readme-showcase/why-universe.png" alt="Papilot Universe: LaTeX-Vorlagen für Abschlussarbeiten, Fachzeitschriften, Konferenzen, Lebensläufe und Poster." width="100%"></picture><br>
<b>Mit einer Vorlage beginnen</b><br>
<a href="https://papilot.ai/universe/">Papilot Universe</a> bietet Vorlagen für Abschlussarbeiten, Fachzeitschriften, Konferenzen, Präsentationen, Poster, Lebensläufe und Bücher und verknüpft über 400 Konferenzen direkt mit der im jeweiligen Call for Papers geforderten Vorlage. Wählen Sie eine Vorlage aus, und Papilot erstellt den Artikel kompilierfertig.
</td>
</tr>
</table>

<a id="quick-start"></a>
<a id="get-started"></a>
<a id="downloads"></a>

<a id="get-started"></a>

## Erste Schritte

<p align="center">
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/mac-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/mac-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/mac-compact.png"><img src="../assets/readme-downloads/mac.png" alt="Download für macOS: Apple Silicon und Intel, DMG oder ZIP." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/windows-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/windows-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/windows-compact.png"><img src="../assets/readme-downloads/windows.png" alt="Download für Windows: x64-Installer oder portable App." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/linux-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/linux-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/linux-compact.png"><img src="../assets/readme-downloads/linux.png" alt="Download für Linux: AppImage, .deb oder Nix." width="49%"></picture></a>
<a href="../guide.md#install-and-run"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/terminal-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact.png"><img src="../assets/readme-downloads/terminal.png" alt="Im Terminal installieren: npm install -g papilot, dann papilot demo. Erfordert Node.js 22.22+." width="49%"></picture></a>
</p>

<p align="center"><sub>Kostenlos und Open Source. Erfordert Git, eine TeX-Distribution und einen angemeldeten <a href="#agents">Agenten</a>.</sub></p>

<a id="agents"></a>

<a id="works-with-your-agent"></a>

## Funktioniert mit Ihrem Agenten

<p align="center">
  <a href="../guide.md#agents">
    <picture>
      <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-agents/grid-compact-dark.png">
      <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-agents/grid-dark.png">
      <source media="(max-width: 600px)" srcset="../assets/readme-agents/grid-compact.png">
      <img src="../assets/readme-agents/grid.png" alt="Papilot Writer, Codex, Claude, Cursor, GitHub Copilot, Grok, Antigravity, Kimi, GLM, ZCode, DeepSeek, Qwen, OpenCode, Qoder, CodeBuddy, WorkBuddy und Pi" width="848">
    </picture>
  </a>
</p>

<p align="center"><sub>Nutzen Sie Ihr vorhandenes Konto bzw. Ihren API-Schlüssel oder verwenden Sie den integrierten Papilot Writer. <a href="../guide.md#agents">Einrichtung</a></sub></p>

<a id="how-it-works"></a>

<a id="how-it-works"></a>

## Funktionsweise

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/flow-compact-dark.png">
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/flow-dark.png">
    <source media="(max-width: 600px)" srcset="../assets/readme-showcase/flow-compact.png">
    <img src="../assets/readme-showcase/flow.png" alt="1. Artikel öffnen: einen Ordner, ein Overleaf-Projekt oder eine Vorlage. 2. Im PDF markieren. 3. Der Agent bearbeitet eine Kopie in seinem eigenen Git-Arbeitsbaum. 4. Fertig gesetzt ansehen: Aus dem Satz wird die Inferenzregel T-Abs, direkt auf der Seite dargestellt. 5. Sie entscheiden: übernehmen, ablehnen oder für eine weitere Runde kommentieren. 6. Committen und synchronisieren: Änderungen gelangen in Ihre Dateien und den Git-Verlauf und werden bei Verknüpfung mit Overleaf synchronisiert." width="1000">
  </picture>
</p>

<a id="documentation-and-community"></a>

<a id="community"></a>

## Community

<p align="center">
<a href="https://github.com/PapilotAI/papilot/issues/new/choose"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/issue-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/issue-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/issue-compact.png"><img src="../assets/readme-community/issue.png" alt="Fehler melden: Erstellen Sie ein Issue, gern auch kurz gehalten." width="49%"></picture></a>
<a href="https://github.com/PapilotAI/papilot/discussions"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discussion-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discussion-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discussion-compact.png"><img src="../assets/readme-community/discussion.png" alt="Stellen Sie eine Frage oder teilen Sie eine Idee in Discussions." width="49%"></picture></a>
<a href="https://discord.gg/WdgZDDAvwj"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discord-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discord-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discord-compact.png"><img src="../assets/readme-community/discord.png" alt="Chatten Sie auf Discord mit den Entwicklern und Nutzern von Papilot." width="49%"></picture></a>
<a href="../../.github/CONTRIBUTING.md"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/contribute-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/contribute-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/contribute-compact.png"><img src="../assets/readme-community/contribute.png" alt="Mitwirken: Pull Requests sind willkommen, auch solche, die mit KI-Agenten erstellt wurden." width="49%"></picture></a>
</p>

Papilot veröffentlicht regelmäßig Updates: siehe das [Änderungsprotokoll](../../CHANGELOG.md).

<a id="contributors"></a>

## Mitwirkende

<p>
  <a href="https://github.com/PapilotAI/papilot/graphs/contributors">
    <picture>
      <source media="(max-width: 600px)" srcset="https://papilot.ai/readme-contributors/compact.svg">
      <img src="https://papilot.ai/readme-contributors/desktop.svg" alt="Mitwirkende an Papilot">
    </picture>
  </a>
</p>

<a id="star-history"></a>

## Star-Verlauf

Wenn Papilot Ihnen Zeit spart, hilft ein Star anderen Forschenden, das Projekt zu finden.

<a href="https://www.star-history.com/?repos=papilotai%2Fpapilot&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
   <img alt="Star-Verlaufsdiagramm" src="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
 </picture>
</a>

---

<p align="center"><sub><a href="../../LICENSE">MIT</a> © 2026 PapilotAI. Vielen Dank an unsere Freunde bei <a href="https://linux.do/">LINUX DO</a>.</sub></p>
