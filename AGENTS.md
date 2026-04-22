# AGENTS.md

Astro 6 static blog → deploys to `https://gameswu.github.io` as a **user site** (root path, no `base`). Node **>=22.12**; package manager is **npm** (lockfile present).

## Commands

- `npm run dev` — local dev server
- `npm run build` — **`astro build && pagefind --site dist`**. Pagefind is part of the build; skipping it breaks on-site search. Don't replace with bare `astro build`.
- `npm run preview` — preview `dist/`
- `npm run gen:placeholders` — regenerate placeholder images (see "Assets")

No lint / test / typecheck scripts exist. For type checking use `npx astro check` (strict config via `astro/tsconfigs/strict`).

## Deploy

GitHub Actions (`.github/workflows/deploy.yml`) on push to `main`: Node 22 → `npm ci` → `npm run build` → upload `./dist` → Pages. No manual deploy step.

## Architecture quirks

- **Content collections** (`src/content.config.ts`):
  - `posts` loader uses custom `generateId`: `foo/index.md` and `foo.md` both produce id `foo`, so URLs `/posts/foo/` are stable whether the post is a flat file or a directory with assets. When adding a post with co-located images, use the directory form.
  - `posts.cover` is declared with the `image()` helper → typed as `ImageMetadata`. Use `resolveCover()` + `coverSrcOf()` from `src/config/site.ts`; never hand-roll cover URL logic.
  - `prev` / `next` in frontmatter are slug strings; dangling slugs are silently dropped in `src/pages/posts/[...slug].astro` — don't treat them as required to exist.
  - Post listing order is unified via `sortPostsByDate()` in `src/config/site.ts`: `date` desc, with optional `order: <int>` frontmatter as the **same-day tiebreaker** (larger = newer, unset = 0). Use this helper anywhere posts are listed — don't re-implement the `.sort()` inline.
  - `about` and `links` are **single-file** collections (`src/content/<name>/index.md`) whose frontmatter is the structured payload; body is optional descriptive prose rendered above the structured data.
- **Path aliases** (`tsconfig.json`): `@/*`, `@components/*`, `@layouts/*`, `@content/*`. Prefer these over relative paths.
- **Styling**: Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.*`, no PostCSS config — configure in CSS). Global styles in `src/styles/global.css`.
- **Markdown pipeline** (see `astro.config.mjs`): GFM + KaTeX math + rehype-slug + autolink-headings (appends `#` span with class `heading-anchor`). Shiki dual-theme (`github-light` / `tokyo-night`) switched by CSS variables — don't hardcode a single theme.
- **Mermaid** produces a ~700KB chunk; `chunkSizeWarningLimit` is intentionally raised. Don't "fix" the warning by removing mermaid.

## Assets (important — build will fail on missing images)

`src/config/site.ts` resolves images from `public/images/<subdir>/<basename>.<ext>` by trying extensions `.webp .avif .jpg .jpeg .png .gif` in order. **If a referenced basename has no matching file, `img()` throws and aborts the build.** This is by design.

- SVG asset files are explicitly **not** supported by the resolver.
- Required basenames currently referenced: `covers/default`, `characters/satori-main`, `scenes/chireiden`, `avatars/satori`. Friend-link logos live under `public/images/links/<basename>.<ext>`; `resolveLinkLogo(undefined)` falls back to `covers/default` so a link without a logo won't break the build.
- To replace a placeholder, drop a file with the same basename into the same subdir (any supported extension). Don't edit `site.ts` just to change an extension.
- `npm run gen:placeholders` (pure-Node PNG encoder, no `sharp`/`canvas`) regenerates the fallback set and rewrites `public/favicon.ico`. Running it will **overwrite** real assets that share those basenames — run only when intentionally resetting placeholders.

## Writing posts

Layout and schema are defined in `src/content.config.ts`. Minimal frontmatter: `title`, `date`; optional `description`, `tags[]`, `cover` (relative path like `./cover.png` for image-pipeline handling), `draft`, `prev`, `next`. See `src/content/posts/agent-dev-basis-1/` for the directory-with-cover pattern.

## Site text / nav

All header/footer/hero copy and nav entries live in `src/config/site.ts` (`siteMeta`, `siteProfile`). Edit there instead of component files — components intentionally avoid hardcoded strings.
