import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/posts',
    /**
     * slug 生成规则：
     * - `foo.md`          → id = "foo"（平铺文件）
     * - `foo/index.md`    → id = "foo"（目录形式，资源与正文同目录）
     * - `foo/bar.md`      → id = "foo/bar"
     * 目的：让目录形式与平铺形式产出相同 URL /posts/foo/
     */
    generateId: ({ entry }) => {
      const noExt = entry.replace(/\.(md|mdx)$/, '');
      return noExt.replace(/\/index$/, '');
    },
  }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.string(),
    tags: z.array(z.string()).default([]),
    /**
     * 封面图。相对路径（`./cover.png`）走 Astro 图片管线，得到带宽高的
     * ImageMetadata，构建时被 emit 到 `_astro/` 下并带哈希；
     * 未指定时由 resolveCover() 兜底为 public 下的 default.*。
     */
    cover: image().optional(),
    draft: z.boolean().default(false),
    /** 上一篇文章 slug（对应 src/content/posts/<slug>.md 文件名）。
     *  留空或指向不存在的文章时，文章页不渲染"上一篇"跳转。 */
    prev: z.string().optional(),
    /** 下一篇文章 slug。同上。 */
    next: z.string().optional(),
  }),
});

/**
 * "关于" 页面内容集合（单文件 index.md）
 * - frontmatter 提供页面元数据（姓名、副标、头像、技能、引言）
 * - body 为 markdown 正文（走 prose-satori 样式）
 */
const about = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/about' }),
  schema: z.object({
    name: z.string(),
    subtitle: z.string().optional(),
    avatar: z.string(),          // 基础名（对应 public/images/avatars/<name>）
    skills: z.array(z.string()).default([]),
    quote: z.string().optional(),
  }),
});

export const collections = { posts, about };
