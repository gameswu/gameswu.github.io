/**
 * 站点资源集中配置
 *
 * 策略：**缺图即报错**。构建期被调用时如果找不到指定基础名对应的任何格式文件，
 * 会直接抛错中断 build，避免上线后才发现 404。
 *
 * 支持的图片格式：.jpg / .jpeg / .png / .webp / .gif / .avif
 * （项目明确不使用 .svg 素材文件）
 *
 * 替换图片：
 * 1. 把图片放入 public/images/ 对应子目录
 * 2. 文件名基础名与本文件中引用一致即可；扩展名任意（取上述之一）
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ImageMetadata } from 'astro';

const PUBLIC_IMAGES_DIR = path.resolve('./public/images');
/** 按优先级排序的图片扩展名（较优格式在前） */
const SUPPORTED_EXTS = ['.webp', '.avif', '.jpg', '.jpeg', '.png', '.gif'];

/** 在指定子目录中查找以 baseName 命名的任意格式图片，返回 URL 或 null */
function findImage(subdir: string, baseName: string): string | null {
  const dir = path.join(PUBLIC_IMAGES_DIR, subdir);
  if (!fs.existsSync(dir)) return null;

  for (const ext of SUPPORTED_EXTS) {
    const filePath = path.join(dir, baseName + ext);
    if (fs.existsSync(filePath)) {
      return `/images/${subdir}/${baseName}${ext}`;
    }
  }

  try {
    const files = fs.readdirSync(dir);
    const match = files.find((f) => {
      const parsed = path.parse(f);
      return parsed.name === baseName && SUPPORTED_EXTS.includes(parsed.ext.toLowerCase());
    });
    if (match) return `/images/${subdir}/${match}`;
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * 图片引用：基础名解析为真实 URL，找不到直接 throw 中断构建。
 */
function img(subdir: string, baseName: string): string {
  const found = findImage(subdir, baseName);
  if (found) return found;
  throw new Error(
    `[site.ts] 缺少素材：public/images/${subdir}/${baseName}.(${SUPPORTED_EXTS
      .map((e) => e.slice(1))
      .join('|')}) — 请放入对应文件后重试。`
  );
}

/** 解析头像基础名（供 about 集合等处动态使用） */
export function resolveAvatar(baseName: string): string {
  return img('avatars', baseName);
}

/**
 * 解析 Q 版古明地觉图像（SatoriQSwarm 彩蛋使用）。
 *
 * 与其他资源不同，这里**缺图不报错**：组件在 URL 为 null 时直接禁用彩蛋，
 * 允许在用户尚未准备图片的情况下照常 build。放入任意支持格式的
 * `public/images/characters/satori-q.*` 后即自动启用。
 */
export function resolveCharacterQ(): string | null {
  return findImage('characters', 'satori-q');
}

/**
 * 解析友链 logo 基础名。
 * - 传入基础名 → 在 public/images/links/ 下按 SUPPORTED_EXTS 查找，缺图抛错
 * - 未传入     → 回退到兜底封面（covers/default）以保证页面始终可渲染
 */
export function resolveLinkLogo(baseName: string | undefined): string {
  if (!baseName) return siteAssets.covers.default;
  return img('links', baseName);
}

export const siteAssets = {
  covers: {
    /** 兜底封面必须存在（缺图报错是预期行为） */
    default: img('covers', 'default'),
  },
  characters: {
    heroMain: img('characters', 'satori-main'),
  },
  scenes: {
    chireiden: img('scenes', 'chireiden'),
  },
} as const;

/**
 * 根据文章 frontmatter 推断封面。
 *
 * 文章 frontmatter 的 `cover` 字段在 content.config.ts 里用 `image()` helper
 * 声明，所以此处接收到的是 Astro 图片管线处理后的 ImageMetadata（或 undefined）。
 *
 * - 有值 → 原样返回 ImageMetadata（调用方通过 `.src` 取 URL，或传给 `<Image />`）
 * - 无值 → 回退到 public/images/covers/default.* 字符串 URL（加载期已查盘）
 *
 * 返回类型是联合类型，调用方判别：`typeof v === 'string' ? v : v.src`
 */
export function resolveCover(
  explicitCover: ImageMetadata | undefined
): ImageMetadata | string {
  if (explicitCover) return explicitCover;
  return siteAssets.covers.default;
}

/** 把 resolveCover 的返回值归一为 `src` 字符串，便于原生 `<img>` 使用 */
export function coverSrcOf(cover: ImageMetadata | string): string {
  return typeof cover === 'string' ? cover : cover.src;
}

/**
 * 统一的文章排序：`date` 降序为主，同日时 `order` 降序为次（未填 order 视为 0）。
 *
 * 需要这个 tiebreaker 是因为单纯按 date 排序时，同一天发布的多篇文章顺序
 * 不稳定（取决于 loader 读取顺序）。作者可在 frontmatter 填 `order: <int>`
 * 来显式指定：数值大 = 更新 = 排前面。
 *
 * 不破坏原数组（返回新数组），与之前的 `.sort()` 行为差异仅在此处 —— 调用方
 * 通常也不依赖原地排序。
 */
export function sortPostsByDate<T extends { data: { date: string; order?: number } }>(
  posts: readonly T[]
): T[] {
  return [...posts].sort((a, b) => {
    const diff = new Date(b.data.date).getTime() - new Date(a.data.date).getTime();
    if (diff !== 0) return diff;
    return (b.data.order ?? 0) - (a.data.order ?? 0);
  });
}

export const siteMeta = {
  title: '觉的博客',
  description: '古明地觉的个人博客 — 窥探内心深处的文字世界',
  author: '古明地觉',
  url: 'https://gameswu.github.io',
} as const;

/**
 * 站点身份 & UI 文案集中配置
 * 所有 Header/Footer/Hero 使用的非正文文案都在此处，避免组件内硬编码。
 */
export const siteProfile = {
  /** 顶栏 logo 旁显示的文字（可与 siteMeta.title 不同） */
  brand: '觉的博客',

  /** 首页 Hero 区域 */
  hero: {
    eyebrow: '地灵殿 · Chireiden',
    title: '觉的博客',
    tagline: '「所有的思绪，皆可被读取」',
    subtitle: '来自地灵殿的文字记录 — 技术、思考与日常的碎片',
    ctaPrimary: { label: '浏览文章', href: '/posts' },
    ctaSecondary: { label: '关于我', href: '/about' },
    characterAlt: '古明地觉',
  },

  /** 全站导航菜单 */
  nav: [
    { label: '首页', href: '/' },
    { label: '文章', href: '/posts' },
    { label: '友链', href: '/links' },
    { label: '关于', href: '/about' },
  ] as const,

  /** 页脚 */
  footer: {
    copyright: '觉的博客 — 所有思绪皆可读',
    decoration: '地灵殿',
    links: [
      { label: '文章', href: '/posts' },
      { label: '友链', href: '/links' },
      { label: '关于', href: '/about' },
    ] as const,
  },

  /** 社交 / 外链（icon 为内置键名：github / rss） */
  social: [
    { icon: 'rss', label: 'RSS 订阅', href: '/rss.xml' },
    { icon: 'github', label: 'GitHub', href: 'https://github.com/gameswu' },
  ] as const,
} as const;
