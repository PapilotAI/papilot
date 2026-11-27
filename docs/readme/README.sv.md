<div align="center">

<img src="../assets/wordmark.svg#gh-light-mode-only" width="220" height="69" alt="Papilot"><img src="../assets/wordmark-dark.svg#gh-dark-mode-only" width="220" height="69" alt="Papilot"><br>**Nästa generations AI-baserade LaTeX-redigerare**

<h3>Läs&nbsp;eller&nbsp;skriv&nbsp;inte&nbsp;<code>.tex</code>&emsp; Arbeta&nbsp;direkt&nbsp;i&nbsp;<img src="../assets/pdf.svg" width="17" height="24" align="absmiddle" alt="PDF"></h3>

<a href="https://papilot.ai"><b>papilot.ai</b></a>&emsp;<a href="https://papilot.ai/demo">Onlinedemo</a>&emsp;<a href="#get-started">Kom igång</a>&emsp;<a href="#agents">Agenter</a>&emsp;<a href="#how-it-works">Så fungerar det</a>

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
  <img src="../assets/readme-showcase/hero.png" alt="Papilot visar en AI-redigering som typsatt före och efter i PDF:en, med Godkänn, Avvisa och Kommentera." width="900">
</picture>
</a>
</p>

<a id="features"></a>

<a id="why-papilot"></a>

## Varför Papilot

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-annotate-dark.png"><img src="../assets/readme-showcase/why-annotate.png" alt="En mening och en figur markerade med ramar i PDF:en, var och en med en anteckning till agenten." width="100%"></picture><br>
<b>Markera direkt på sidan</b><br>
Markera en mening eller rama in en ekvation eller en figur och skriv vad som ska ändras. Din agent får exakt rätt källkodsrader, oavsett vilken fil de ligger i.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-review-dark.png"><img src="../assets/readme-showcase/why-review.png" alt="En ändring som visas färdigtypsatt, före och efter, med Godkänn, Avvisa och Kommentera." width="100%"></picture><br>
<b>Granska varje ändring färdigtypsatt</b><br>
Varje redigering visas som före och efter direkt i PDF:en. Godkänn, avvisa eller kommentera den – ingenting hamnar i din artikel förrän du har godkänt det.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-overleaf-dark.png"><img src="../assets/readme-showcase/why-overleaf.png" alt="Papilot och Overleaf sida vid sida, synkroniserade i realtid åt båda hållen, med medförfattarnas markörer i Overleaf." width="100%"></picture><br>
<b><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/overleaf-dark.svg"><img src="../assets/readme-icons/overleaf.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;Realtidssynkronisering med Overleaf</b><br>
Medförfattare fortsätter skriva i Overleaf. Dina godkända ändringar når dem på ungefär en sekund, och deras ändringar hamnar i dina filer och i din PDF med deras namn.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-agents-dark.png"><img src="../assets/readme-showcase/why-agents.png" alt="Modellmenyn under chatten, med modeller från Codex, Claude och GLM." width="100%"></picture><br>
<b>Valfri agent, valfri modell</b><br>
Välj en modell från valfri ansluten agent under chatten. Byt till en annan agent så kör Papilot om din förfrågan med den.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-record-dark.png"><img src="../assets/readme-showcase/why-record.png" alt="Godkända ändringar som har checkats in med ett meddelande och pushats, i versionshistoriken." width="100%"></picture><br>
<b>Varje ändring sparas i historiken</b><br>
Varje uppgift körs i ett eget Git-arbetsträd, åtskilt från dina filer. Att checka in godkända ändringar är ett separat steg, och varje ändring finns kvar i din Git-historik.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-phone-dark.png"><img src="../assets/readme-showcase/why-phone.png" alt="Samma granskning på en mobiltelefon, framför skrivbordsfönstret." width="100%"></picture><br>
<b>Granska från mobilen</b><br>
Öppna Papilot på din mobil eller surfplatta via <a href="../guide.md#remote-access-with-tailscale">Tailscale</a>, och läs PDF:en, gör markeringar och godkänn ändringar även när du inte sitter vid skrivbordet.
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-universe-dark.png"><img src="../assets/readme-showcase/why-universe.png" alt="Papilot Universe: LaTeX-mallar för avhandlingar, tidskrifter, konferenser, CV:n och postrar." width="100%"></picture><br>
<b>Börja från en mall</b><br>
<a href="https://papilot.ai/universe/">Papilot Universe</a> innehåller mallar för avhandlingar, tidskrifter och konferenser, presentationer, postrar, CV:n och böcker, och kopplar mer än 400 konferenser till den mall som deras inbjudan (call for papers) kräver. Välj en mall så skapar Papilot artikeln, redo att kompileras.
</td>
</tr>
</table>

<a id="quick-start"></a>
<a id="get-started"></a>
<a id="downloads"></a>

<a id="get-started"></a>

## Kom igång

<p align="center">
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/mac-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/mac-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/mac-compact.png"><img src="../assets/readme-downloads/mac.png" alt="Ladda ner för macOS: Apple Silicon och Intel, DMG eller ZIP." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/windows-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/windows-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/windows-compact.png"><img src="../assets/readme-downloads/windows.png" alt="Ladda ner för Windows: x64-installationsprogram eller portabel app." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/linux-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/linux-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/linux-compact.png"><img src="../assets/readme-downloads/linux.png" alt="Ladda ner för Linux: AppImage, .deb eller Nix." width="49%"></picture></a>
<a href="../guide.md#install-and-run"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/terminal-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact.png"><img src="../assets/readme-downloads/terminal.png" alt="Installera i en terminal: npm install -g papilot, sedan papilot demo. Kräver Node.js 22.22+." width="49%"></picture></a>
</p>

<p align="center"><sub>Kostnadsfritt och med öppen källkod. Kräver Git, en TeX-distribution och en inloggad <a href="#agents">agent</a>.</sub></p>

<a id="agents"></a>

<a id="works-with-your-agent"></a>

## Fungerar med din agent

<p align="center">
  <a href="../guide.md#agents">
    <picture>
      <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-agents/grid-compact-dark.png">
      <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-agents/grid-dark.png">
      <source media="(max-width: 600px)" srcset="../assets/readme-agents/grid-compact.png">
      <img src="../assets/readme-agents/grid.png" alt="Papilot Writer, Codex, Claude, Cursor, GitHub Copilot, Grok, Antigravity, Kimi, GLM, ZCode, DeepSeek, Qwen, OpenCode, Qoder, CodeBuddy, WorkBuddy och Pi" width="848">
    </picture>
  </a>
</p>

<p align="center"><sub>Använd den inloggning eller API-nyckel du redan har, eller använd inbyggda Papilot Writer. <a href="../guide.md#agents">Konfiguration</a></sub></p>

<a id="how-it-works"></a>

<a id="how-it-works"></a>

## Så fungerar det

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/flow-compact-dark.png">
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/flow-dark.png">
    <source media="(max-width: 600px)" srcset="../assets/readme-showcase/flow-compact.png">
    <img src="../assets/readme-showcase/flow.png" alt="1. Öppna din artikel: en mapp, ett Overleaf-projekt eller en mall. 2. Markera i PDF:en. 3. Agenten redigerar en kopia i ett eget Git-arbetsträd. 4. Se resultatet typsatt: meningen blir slutledningsregeln T-Abs, utritad på sidan. 5. Du bestämmer: godkänn, avvisa eller kommentera för en ny vända. 6. Checka in och synkronisera: ändringarna hamnar i dina filer och i din Git-historik, och synkroniseras till Overleaf om projektet är länkat." width="1000">
  </picture>
</p>

<a id="documentation-and-community"></a>

<a id="community"></a>

## Gemenskap

<p align="center">
<a href="https://github.com/PapilotAI/papilot/issues/new/choose"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/issue-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/issue-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/issue-compact.png"><img src="../assets/readme-community/issue.png" alt="Rapportera en bugg: skapa ett ärende, även ett enkelt utkast." width="49%"></picture></a>
<a href="https://github.com/PapilotAI/papilot/discussions"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discussion-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discussion-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discussion-compact.png"><img src="../assets/readme-community/discussion.png" alt="Ställ en fråga eller dela en idé i Discussions." width="49%"></picture></a>
<a href="https://discord.gg/WdgZDDAvwj"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discord-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discord-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discord-compact.png"><img src="../assets/readme-community/discord.png" alt="Chatta på Discord med personerna som bygger och använder Papilot." width="49%"></picture></a>
<a href="../../.github/CONTRIBUTING.md"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/contribute-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/contribute-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/contribute-compact.png"><img src="../assets/readme-community/contribute.png" alt="Bidra: pull requests är välkomna, även sådana som skrivits med AI-agenter." width="49%"></picture></a>
</p>

Papilot uppdateras ofta: se [ändringsloggen](../../CHANGELOG.md).

<a id="contributors"></a>

## Medverkande

<p>
  <a href="https://github.com/PapilotAI/papilot/graphs/contributors">
    <picture>
      <source media="(max-width: 600px)" srcset="https://papilot.ai/readme-contributors/compact.svg">
      <img src="https://papilot.ai/readme-contributors/desktop.svg" alt="Medverkande till Papilot">
    </picture>
  </a>
</p>

<a id="star-history"></a>

## Stjärnhistorik

Om Papilot sparar tid åt dig hjälper en stjärna andra forskare att hitta det.

<a href="https://www.star-history.com/?repos=papilotai%2Fpapilot&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
   <img alt="Diagram över stjärnhistorik" src="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
 </picture>
</a>

---

<p align="center"><sub><a href="../../LICENSE">MIT</a> © 2026 PapilotAI. Tack till våra vänner på <a href="https://linux.do/">LINUX DO</a>.</sub></p>
