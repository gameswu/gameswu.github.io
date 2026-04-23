/**
 * 音乐盒资源解析（构建期）
 *
 * 曲目：直接扫描 `public/music/` 下的音频文件，文件名（去扩展名）作为显示标题。
 * 不维护 manifest；放入即自动出现在播放列表中。
 *
 * 支持扩展名：.mp3 / .ogg / .m4a / .flac / .wav
 * 目录不存在或无可用文件 → 返回空数组，前端据此不渲染 MusicBox（build 不报错）。
 *
 * 立绘：`public/images/characters/satori-full-<state>-<n>.*`
 *   - state ∈ { idle, playing, paused }
 *   - n 为正整数（1、2、3…）
 *   - 同一 state 下多张图在运行时 40–50s 随机切换
 *   - 缺 idle 整个表情切换禁用（UI 仍可用，但不显示立绘）
 *   - 缺 playing / paused 单独回退到 idle
 */

import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_DIR = path.resolve('./public');
const MUSIC_DIR = path.join(PUBLIC_DIR, 'music');
const CHAR_DIR = path.join(PUBLIC_DIR, 'images', 'characters');

const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.m4a', '.flac', '.wav']);
const IMG_EXTS = ['.webp', '.avif', '.jpg', '.jpeg', '.png', '.gif'];

export interface Track {
  src: string;
  title: string;
}

export interface CharacterSprites {
  /** 每个 state 的图片 URL 列表，运行时随机/轮换显示 */
  idle: string[];
  playing: string[];
  paused: string[];
}

export interface MusicBoxConfig {
  tracks: Track[];
  sprites: CharacterSprites | null;
}

function loadTracks(): Track[] {
  if (!fs.existsSync(MUSIC_DIR)) return [];
  const files = fs.readdirSync(MUSIC_DIR);
  const tracks: Track[] = [];
  for (const f of files) {
    const parsed = path.parse(f);
    if (!AUDIO_EXTS.has(parsed.ext.toLowerCase())) continue;
    tracks.push({
      src: `/music/${f}`,
      title: parsed.name,
    });
  }
  tracks.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  return tracks;
}

function scanStateImages(state: 'idle' | 'playing' | 'paused'): string[] {
  if (!fs.existsSync(CHAR_DIR)) return [];
  const prefix = `satori-full-${state}-`;
  const files = fs.readdirSync(CHAR_DIR);
  const results: { num: number; url: string }[] = [];
  for (const f of files) {
    const parsed = path.parse(f);
    if (!parsed.name.startsWith(prefix)) continue;
    if (!IMG_EXTS.includes(parsed.ext.toLowerCase())) continue;
    const numStr = parsed.name.slice(prefix.length);
    const num = Number.parseInt(numStr, 10);
    if (!Number.isFinite(num)) continue;
    results.push({ num, url: `/images/characters/${f}` });
  }
  results.sort((a, b) => a.num - b.num);
  return results.map((r) => r.url);
}

function loadSprites(): CharacterSprites | null {
  const idle = scanStateImages('idle');
  if (idle.length === 0) return null; // 无 idle → 不启用立绘
  const playing = scanStateImages('playing');
  const paused = scanStateImages('paused');
  return {
    idle,
    playing: playing.length > 0 ? playing : idle,
    paused: paused.length > 0 ? paused : idle,
  };
}

export function getMusicBoxConfig(): MusicBoxConfig {
  return {
    tracks: loadTracks(),
    sprites: loadSprites(),
  };
}
