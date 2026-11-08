# Publishing on the Papilot blog

The blog uses the website’s existing static build and GitHub Pages deployment. Articles are fully rendered HTML; reading, navigation, language switching and RSS do not require JavaScript. No CMS, database or additional runtime service is needed.

## Add an article

Create `site/blog/posts/your-article-slug/` containing:

- `post.json`: publication date and localized title, description, lead and hero image metadata.
- `en.md` and/or `zh-CN.md`: the article body in each published language. Start headings at `##`; the template supplies the title. Use ordinary Markdown links and images. An image’s optional title becomes its figure caption.

Copy the first article’s structure as a starting point. Each locale present in `post.json` needs its corresponding Markdown file. Add `"draft": true` to keep a work in progress out of the HTML, RSS and sitemap. Remove the flag when ready. Dates use `YYYY-MM-DD`; an optional `updated` date must be at least the publication date. The publication date is editorial metadata, not a future scheduling mechanism.

Put new PNG or SVG images in `site/blog/assets/` and reference `/assets/blog/filename.png` from Markdown. SVGs need a numeric `viewBox="0 0 width height"`. An optional `filename-compact.en.svg` alongside `filename.en.svg` supplies a readable phone layout (also supported for `zh-CN`). Include meaningful image alt text. The build also reuses the repository’s localized light/dark and mobile product illustrations, without duplicating those source files.

```sh
npm run site
node scripts/check-site-blog.mjs
npm run test:site
```

Output goes to `_site/`. English lives at `/blog/`, Simplified Chinese at `/zh-CN/blog/`, and each has a `feed.xml`. Articles get their own canonical URLs, reciprocal language alternatives, `BlogPosting` and breadcrumb structured data, social previews and sitemap entries. The generator rejects unsupported locales and invalid metadata; broken local links fail the site build.

Preview `_site/` with any local static HTTP server. Check both languages, light/dark mode, and desktop/mobile widths before publishing. A merge to `main` runs the existing Pages workflow and publishes the site; building locally does not publish it.

## First article

“When the PDF Becomes Our Interface for Talking with AI” / “当 PDF 成为我们与 AI 的对话界面” was written in English and Simplified Chinese with `agy` using `gemini-4-argon-medium`. The founder selected the Chinese title and subtitle: “Papilot：重新定义人与 AI 协作写 LaTeX 的方式”. The essay introduces the rendered manuscript as the interface for expressing intent, collaborating with AI, and reviewing changes to a real local LaTeX project. Its figures combine existing Papilot product illustrations and a localized SVG revision loop.

The essay explicitly criticizes Overleaf and Prism’s source-centered interaction model and explains Papilot’s decision to leave source editing to external editors. The comparison links to official product documentation, acknowledges Overleaf’s Visual Editor and layout controls, and notes OpenAI’s announced retirement of Prism. The retirement is not presented as evidence for the design critique. Editorial checks corrected a typo and narrowed unsupported absolute claims about attention, scientific risk, and Git history.

The SEO metadata follows Google’s guidance for [article structured data](https://developers.google.com/search/docs/appearance/structured-data/article) and [localized pages](https://developers.google.com/search/docs/specialty/international/localized-versions).
