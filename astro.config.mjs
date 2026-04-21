import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://gameswu.github.io',
  // user site（<user>.github.io）部署在根路径，无需 base
  integrations: [mdx(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    build: {
      // mermaid 单 chunk ~700KB，预期之内；抬高警告阈值避免噪音
      chunkSizeWarningLimit: 1000,
    },
  },
  markdown: {
    // Shiki 双主题：light / dark 分别配色，由 CSS 变量在运行时切换
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'tokyo-night',
      },
      wrap: true,
    },
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      rehypeSlug,
      rehypeKatex,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'append',
          properties: {
            className: ['heading-anchor'],
            ariaLabel: '锚点链接',
          },
          content: {
            type: 'element',
            tagName: 'span',
            properties: { className: ['heading-anchor-icon'] },
            children: [{ type: 'text', value: '#' }],
          },
        },
      ],
    ],
  },
});
