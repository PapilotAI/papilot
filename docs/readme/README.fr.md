<div align="center">

<img src="../assets/wordmark.svg#gh-light-mode-only" width="220" height="69" alt="Papilot"><img src="../assets/wordmark-dark.svg#gh-dark-mode-only" width="220" height="69" alt="Papilot"><br>**Éditeur LaTeX IA de nouvelle génération**

<h3>Ne&nbsp;lisez&nbsp;et&nbsp;n'écrivez&nbsp;plus&nbsp;de&nbsp;<code>.tex</code>&emsp; Travaillez&nbsp;directement&nbsp;sur&nbsp;le&nbsp;<img src="../assets/pdf.svg" width="17" height="24" align="absmiddle" alt="PDF"></h3>

<a href="https://papilot.ai"><b>papilot.ai</b></a>&emsp;<a href="https://papilot.ai/demo">Démo en ligne</a>&emsp;<a href="#get-started">Prise en main</a>&emsp;<a href="#agents">Agents</a>&emsp;<a href="#how-it-works">Fonctionnement</a>

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
  <img src="../assets/readme-showcase/hero.png" alt="Papilot affiche une modification de l'IA sous forme de comparatif avant/après composé directement sur le PDF, avec les options Accepter, Rejeter et Commenter." width="900">
</picture>
</a>
</p>

<a id="features"></a>

<a id="why-papilot"></a>

## Pourquoi Papilot

<table>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-annotate-dark.png"><img src="../assets/readme-showcase/why-annotate.png" alt="Une phrase et une figure encadrées sur le PDF, chacune accompagnée d'une annotation pour l'agent." width="100%"></picture><br>
<b>Pointez directement sur la page</b><br>
Sélectionnez une phrase ou encadrez une équation ou une figure, puis indiquez la modification souhaitée. Votre agent reçoit les lignes sources exactes, quel que soit le fichier où elles se trouvent.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-review-dark.png"><img src="../assets/readme-showcase/why-review.png" alt="Une modification affichée avec son rendu composé, avant et après, avec les options Accepter, Rejeter et Commenter." width="100%"></picture><br>
<b>Faites la révision de chaque modification composée</b><br>
Chaque modification revient sous forme de comparatif avant/après sur le PDF. Acceptez-la, rejetez-la ou commentez-la ; rien n'est intégré à votre article tant que vous ne l'avez pas accepté.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-overleaf-dark.png"><img src="../assets/readme-showcase/why-overleaf.png" alt="Papilot et Overleaf côte à côte, synchronisés en temps réel dans les deux sens, avec les curseurs des coauteurs dans Overleaf." width="100%"></picture><br>
<b><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-icons/overleaf-dark.svg"><img src="../assets/readme-icons/overleaf.svg" width="16" height="16" align="absmiddle" alt=""></picture>&nbsp;Synchronisation en temps réel avec Overleaf</b><br>
Vos coauteurs continuent d'écrire dans Overleaf. Vos modifications acceptées leur parviennent en une seconde environ, et les leurs apparaissent dans vos fichiers et votre PDF avec leur nom.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-agents-dark.png"><img src="../assets/readme-showcase/why-agents.png" alt="Le menu des modèles sous la discussion, avec des modèles de Codex, Claude et GLM." width="100%"></picture><br>
<b>N'importe quel agent, n'importe quel modèle</b><br>
Choisissez un modèle parmi tous les agents connectés sous la discussion. Passez à un autre agent et Papilot relance votre demande avec celui-ci.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-record-dark.png"><img src="../assets/readme-showcase/why-record.png" alt="Modifications acceptées validées avec un message et poussées, dans l'historique des versions." width="100%"></picture><br>
<b>Chaque modification est tracée</b><br>
Chaque tâche s'exécute dans son propre arbre de travail Git, à l'écart de vos fichiers. La validation des modifications acceptées est une étape distincte, et chaque changement reste conservé dans votre historique Git.
</td>
<td width="50%" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-phone-dark.png"><img src="../assets/readme-showcase/why-phone.png" alt="La même révision sur un téléphone, devant la fenêtre sur ordinateur." width="100%"></picture><br>
<b>Faites vos révisions depuis votre téléphone</b><br>
Ouvrez Papilot sur votre téléphone ou votre tablette via <a href="../guide.md#remote-access-with-tailscale">Tailscale</a>, puis lisez le PDF, ajoutez des annotations et acceptez des modifications loin de votre bureau.
</td>
</tr>
<tr>
<td colspan="2" valign="top">
<picture><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/why-universe-dark.png"><img src="../assets/readme-showcase/why-universe.png" alt="Papilot Universe : modèles LaTeX pour thèses, revues, conférences, CV et posters." width="100%"></picture><br>
<b>Démarrez à partir d'un modèle</b><br>
<a href="https://papilot.ai/universe/">Papilot Universe</a> propose des modèles de thèses, des kits pour revues et conférences, des présentations, des posters, des CV et des livres, et associe plus de 400 conférences au modèle exigé par leur appel à communications. Choisissez-en un et Papilot crée l'article, prêt à être compilé.
</td>
</tr>
</table>

<a id="quick-start"></a>
<a id="get-started"></a>
<a id="downloads"></a>

<a id="get-started"></a>

## Prise en main

<p align="center">
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/mac-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/mac-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/mac-compact.png"><img src="../assets/readme-downloads/mac.png" alt="Télécharger pour macOS : Apple silicon et Intel, DMG ou ZIP." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/windows-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/windows-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/windows-compact.png"><img src="../assets/readme-downloads/windows.png" alt="Télécharger pour Windows : installateur x64 ou application portable." width="49%"></picture></a>
<a href="https://papilot.ai/#download"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/linux-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/linux-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/linux-compact.png"><img src="../assets/readme-downloads/linux.png" alt="Télécharger pour Linux : AppImage, .deb ou Nix." width="49%"></picture></a>
<a href="../guide.md#install-and-run"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-downloads/terminal-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-downloads/terminal-compact.png"><img src="../assets/readme-downloads/terminal.png" alt="Installer dans un terminal : npm install -g papilot, puis papilot demo. Nécessite Node.js 22.22+." width="49%"></picture></a>
</p>

<p align="center"><sub>Gratuit et open source. Nécessite Git, une distribution TeX et un <a href="#agents">agent</a> connecté.</sub></p>

<a id="agents"></a>

<a id="works-with-your-agent"></a>

## Fonctionne avec votre agent

<p align="center">
  <a href="../guide.md#agents">
    <picture>
      <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-agents/grid-compact-dark.png">
      <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-agents/grid-dark.png">
      <source media="(max-width: 600px)" srcset="../assets/readme-agents/grid-compact.png">
      <img src="../assets/readme-agents/grid.png" alt="Papilot Writer, Codex, Claude, Cursor, GitHub Copilot, Grok, Antigravity, Kimi, GLM, ZCode, DeepSeek, Qwen, OpenCode, Qoder, CodeBuddy, WorkBuddy et Pi" width="848">
    </picture>
  </a>
</p>

<p align="center"><sub>Utilisez le compte ou la clé API dont vous disposez déjà, ou utilisez l'agent intégré Papilot Writer. <a href="../guide.md#agents">Configuration</a></sub></p>

<a id="how-it-works"></a>

<a id="how-it-works"></a>

## Fonctionnement

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-showcase/flow-compact-dark.png">
    <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-showcase/flow-dark.png">
    <source media="(max-width: 600px)" srcset="../assets/readme-showcase/flow-compact.png">
    <img src="../assets/readme-showcase/flow.png" alt="1. Ouvrez votre article : un dossier, un projet Overleaf ou un modèle. 2. Annotez le PDF. 3. L'agent modifie une copie dans son propre arbre de travail Git. 4. Visualisez le rendu composé : la phrase devient la règle d'inférence T-Abs, mise en forme sur la page. 5. Vous décidez : acceptez, rejetez ou commentez pour une nouvelle itération. 6. Validez et synchronisez : les modifications sont intégrées à vos fichiers et à votre historique Git, et synchronisées avec Overleaf s'il est lié." width="1000">
  </picture>
</p>

<a id="documentation-and-community"></a>

<a id="community"></a>

## Communauté

<p align="center">
<a href="https://github.com/PapilotAI/papilot/issues/new/choose"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/issue-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/issue-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/issue-compact.png"><img src="../assets/readme-community/issue.png" alt="Signaler un bug : ouvrez un ticket, même succinct." width="49%"></picture></a>
<a href="https://github.com/PapilotAI/papilot/discussions"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discussion-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discussion-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discussion-compact.png"><img src="../assets/readme-community/discussion.png" alt="Posez une question ou partagez une idée dans les Discussions." width="49%"></picture></a>
<a href="https://discord.gg/WdgZDDAvwj"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/discord-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/discord-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/discord-compact.png"><img src="../assets/readme-community/discord.png" alt="Discutez sur Discord avec les personnes qui développent et utilisent Papilot." width="49%"></picture></a>
<a href="../../.github/CONTRIBUTING.md"><picture><source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="../assets/readme-community/contribute-compact-dark.png"><source media="(prefers-color-scheme: dark)" srcset="../assets/readme-community/contribute-dark.png"><source media="(max-width: 600px)" srcset="../assets/readme-community/contribute-compact.png"><img src="../assets/readme-community/contribute.png" alt="Contribuer : les pull requests sont les bienvenues, y compris celles rédigées avec des agents IA." width="49%"></picture></a>
</p>

Papilot évolue fréquemment : consultez le [journal des modifications](../../CHANGELOG.md).

<a id="contributors"></a>

## Contributeurs

<p>
  <a href="https://github.com/PapilotAI/papilot/graphs/contributors">
    <picture>
      <source media="(max-width: 600px)" srcset="https://papilot.ai/readme-contributors/compact.svg">
      <img src="https://papilot.ai/readme-contributors/desktop.svg" alt="Contributeurs de Papilot">
    </picture>
  </a>
</p>

<a id="star-history"></a>

## Historique des étoiles

Si Papilot vous fait gagner du temps, une étoile aide d'autres chercheurs à le découvrir.

<a href="https://www.star-history.com/?repos=papilotai%2Fpapilot&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
   <img alt="Graphique de l'historique des étoiles" src="https://api.star-history.com/chart?repos=papilotai/papilot&type=date&legend=bottom-right" />
 </picture>
</a>

---

<p align="center"><sub><a href="../../LICENSE">MIT</a> © 2026 PapilotAI. Merci à nos amis de <a href="https://linux.do/">LINUX DO</a>.</sub></p>
