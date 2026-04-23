# 觉的博客 · Satori Blog

基于 [Astro](https://astro.build) 构建的个人博客，以东方 Project 古明地觉为主题。
明暗双主题、Markdown + KaTeX + Mermaid、Pagefind 全站搜索、GitHub Pages 自动部署。

---

## 快速开始

要求 **Node.js ≥ 22.12**。

```bash
npm install
npm run dev        # 本地开发
npm run build      # 构建（含 pagefind 索引）
npm run preview    # 预览 dist/
```

推送到 `main` 分支，GitHub Actions 自动构建并部署到 GitHub Pages。

---

## 写文章

文章位于 `src/content/posts/`。**推荐每篇文章一个目录**，便于同目录管理封面与配图：

```
src/content/posts/
├── my-post/
│   ├── index.md        # 正文
│   ├── cover.png       # 封面
│   └── demo.png        # 正文引用的图
└── another-post.md     # 也支持单文件（无配图时）
```

> URL slug 以目录名 / 文件名为准，`foo/index.md` 与 `foo.md` 生成相同的 `/posts/foo/`。

### Frontmatter

```markdown
---
title: '文章标题'               # 必填
date: '2025-01-01'             # 必填（YYYY-MM-DD）
description: '摘要'             # 可选
tags: ['标签1', '标签2']        # 可选
cover: './cover.png'           # 可选，走 Astro 图片管线；缺省用 covers/default
draft: false                   # 可选，true 时列表不显示
order: 10                      # 可选，同一天发布时排序的 tiebreaker（大在前）
prev: 'slug-of-prev-post'      # 可选，文末 "上一篇" 链接（填 slug）
next: 'slug-of-next-post'      # 可选，文末 "下一篇" 链接
---

正文。支持 GFM、KaTeX 数学公式 `$E=mc^2$`、Mermaid 图表（```mermaid 代码块）、
脚注、任务列表等。
```

### 正文引用同目录配图

```markdown
![示意图](./demo.png)
```

相对路径会被 Astro 图片管线处理（优化、生成多格式），**不要**放到 `public/`。

### 封面注意事项

Astro 图片管线会对**内容完全相同**的图片去重，跨文章引用同一张图会出 build 期 404 bug。
**每篇文章的封面请使用内容独一无二的图片**（像素级不同即可，哪怕改一个像素）。

---

## 静态资源（public/）

项目按"缺图即报错"策略管理资源：构建期调用 `img()` 若找不到对应基础名的文件，**直接中断构建**。

### 图片（`public/images/<subdir>/<basename>.<ext>`）

支持扩展名（按优先级）：`.webp .avif .jpg .jpeg .png .gif`。  
**不支持 `.svg` 素材文件**（favicon `public/third-eye.svg` 是例外）。

文件名只认**基础名**，扩展名任意。替换素材只需把同名文件（任意支持格式）放入对应目录，**无需改代码**。

| 目录 | 用途 | 必需基础名 |
|---|---|---|
| `covers/` | 文章兜底封面 | `default` *(必需，缺失 build 失败)* |
| `characters/` | 主题立绘 | `satori-main`（首页 Hero 用） |
| `scenes/` | 场景图 | `chireiden`（地灵殿场景） |
| `avatars/` | 关于页头像 | 由 `about` 集合 frontmatter 指定 |
| `links/` | 友链 logo | 由 `links` 集合每项的 `logo` 字段指定（缺省回退 `covers/default`） |
| `decorations/` | 预留装饰图 | — |

### 音乐（`public/music/`）

把音频文件放进 `public/music/` 即可，**无需任何配置**。  
曲目列表在构建时自动扫描，**文件名（去扩展名）直接作为曲名**显示。

- 支持扩展名：`.mp3 .ogg .m4a .flac .wav`
- 曲目按文件名拼音/字母排序
- 目录为空或没有可用文件 → **音乐盒组件不渲染**（不报错）

### 彩蛋素材（可选，缺失时功能自动禁用）

- **Q 版古明地觉**（页面任意位置 1.2 秒内连点 5 下触发）：  
  `public/images/characters/satori-q.<ext>`

- **觉的立绘表情组**（音乐盒播放状态驱动）：  
  `public/images/characters/satori-full-<state>-<n>.<ext>`  
  - `state = { idle, playing, paused }`
  - `n` 为正整数，同一状态下多张图会在 40–50 秒间随机切换
  - 至少需要 `satori-full-idle-1.*` 才启用立绘；`playing` / `paused` 缺失会回退到 `idle` 组

### 占位图生成

`npm run gen:placeholders` 用纯 Node 生成占位图（无需 sharp / canvas）。  
⚠️ **会覆盖已有同名文件**，仅在需要重置占位集时运行。

---

## 站点文案

所有 Header / Footer / Hero 文案与导航项在 `src/config/site.ts` 的 `siteMeta` / `siteProfile` 中配置，**组件不硬编码字符串**。

---

## 技术栈

- Astro 6 · TypeScript · Tailwind v4（纯 CSS 配置，无 `tailwind.config.*`）
- Markdown：GFM · KaTeX · Shiki 双主题（`github-light` / `tokyo-night`）· rehype-slug + autolink-headings
- Mermaid（npm 本地打包，带源码/图切换器）
- Pagefind 全站搜索（构建期索引）
- `@astrojs/sitemap`、`@astrojs/rss` 自动生成 sitemap 与 RSS

路径别名（`tsconfig.json`）：`@/*`、`@components/*`、`@layouts/*`、`@content/*`。优先使用别名而非相对路径。

---

## 目录结构

```
src/
├── components/       # 组件（PostCard / Header / MusicBox / SatoriQSwarm / CursorTrail …）
├── content/
│   ├── posts/        # 文章集合
│   ├── about/        # 关于页（单文件集合）
│   └── links/        # 友链（单文件集合）
├── config/
│   ├── site.ts       # 站点元数据 / 资源解析 / 排序 helper
│   └── music.ts      # 音乐盒物料解析
├── layouts/
├── pages/
└── styles/global.css
public/
├── images/           # 站点图片（见上表）
├── music/            # 音乐文件 + manifest.json
├── third-eye.svg     # favicon（项目中唯一的 SVG 素材）
└── ...
```
