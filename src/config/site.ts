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
 * 优先级：显式 cover > 默认封面
 * cover 字段可以是：
 *   - 完整路径（以 / 或 http 开头）→ 原样返回
 *   - 基础名（如 "test"）→ 在 public/images/covers/ 下按支持的扩展名解析
 * 显式基础名找不到即 throw（用户意图明确，不容忍静默 fallback）。
 */
export function resolveCover(explicitCover: string | undefined): string {
  if (explicitCover) {
    if (explicitCover.startsWith('/') || explicitCover.startsWith('http')) {
      return explicitCover;
    }
    const resolved = findImage('covers', explicitCover);
    if (resolved) return resolved;
    throw new Error(
      `[site.ts] 文章 frontmatter 指定的封面 "${explicitCover}" 在 public/images/covers/ 下找不到对应文件。`
    );
  }

  return siteAssets.covers.default;
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
    { label: '关于', href: '/about' },
  ] as const,

  /** 页脚 */
  footer: {
    copyright: '觉的博客 — 所有思绪皆可读',
    decoration: '地灵殿',
    links: [
      { label: '文章', href: '/posts' },
      { label: '关于', href: '/about' },
    ] as const,
  },

  /** 社交 / 外链（icon 为内置键名：github / rss） */
  social: [
    { icon: 'rss', label: 'RSS 订阅', href: '/rss.xml' },
    { icon: 'github', label: 'GitHub', href: 'https://github.com/gameswu' },
  ] as const,
} as const;
