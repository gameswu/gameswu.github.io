import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.string(),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
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
