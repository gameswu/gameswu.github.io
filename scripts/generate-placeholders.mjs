/**
 * 占位图生成脚本
 *
 * 在 public/images/ 下生成纯色 PNG / JPG 与 favicon.ico，
 * 使项目在素材缺失时仍可构建。所有文件可由真实素材原地替换（保持同名）。
 *
 * 仅使用 Node 内置模块（无 sharp / canvas 依赖）。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const IMG = path.join(ROOT, 'public', 'images');

// ---------- 颜色工具 ----------
/** HEX -> {r,g,b} */
function hex(h) {
  const s = h.replace('#', '');
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/** 线性插值两色 */
function mix(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

// ---------- PNG 编码器（支持带 Alpha / 垂直渐变） ----------
/**
 * 生成 PNG buffer
 * @param {number} width
 * @param {number} height
 * @param {(x:number,y:number)=>{r:number,g:number,b:number,a?:number}} pixel
 * @param {boolean} alpha
 */
function encodePNG(width, height, pixel, alpha = false) {
  const channels = alpha ? 4 : 3;
  const rowLen = width * channels + 1; // +1 for filter byte
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      const off = y * rowLen + 1 + x * channels;
      raw[off] = p.r;
      raw[off + 1] = p.g;
      raw[off + 2] = p.b;
      if (alpha) raw[off + 3] = p.a ?? 255;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // color type: RGBA / RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// CRC32 for PNG
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- 文字位图（5×7 像素字体，仅 ASCII 大写 + 数字 + 少量符号） ----------
// 每字符 5 列 × 7 行，行用位（低位到高位或反之，这里高位先）
const FONT_5x7 = {
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01110','10001','10000','10000','10000','10001','01110'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01110','10001','10000','10111','10001','10001','01110'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['01110','00100','00100','00100','00100','00100','01110'],
  'J': ['00111','00010','00010','00010','00010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','10001','11001','10101','10011','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','10101','01010'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','10001','01010','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '_': ['00000','00000','00000','00000','00000','00000','11111'],
  '.': ['00000','00000','00000','00000','00000','00000','00100'],
  ':': ['00000','00100','00000','00000','00000','00100','00000'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'],
};

/** 在像素回调中叠加文字，返回新的 pixel 函数 */
function overlayText(basePixel, text, { x, y, scale = 1, color }) {
  const glyphs = text.toUpperCase().split('').map((ch) => FONT_5x7[ch] ?? FONT_5x7[' ']);
  const glyphW = 5;
  const glyphH = 7;
  const gap = 1;
  const textW = glyphs.length * (glyphW + gap) * scale;
  const textH = glyphH * scale;

  return (px, py) => {
    const base = basePixel(px, py);
    if (px < x || py < y || px >= x + textW || py >= y + textH) return base;
    const localX = Math.floor((px - x) / scale);
    const localY = Math.floor((py - y) / scale);
    const glyphIdx = Math.floor(localX / (glyphW + gap));
    const inGlyphX = localX % (glyphW + gap);
    if (inGlyphX >= glyphW) return base; // gap column
    const g = glyphs[glyphIdx];
    if (!g) return base;
    if (g[localY][inGlyphX] === '1') return { ...color, a: 255 };
    return base;
  };
}

// ---------- 封面生成（1600×900 对角渐变 PNG，保存为 .jpg 扩展名） ----------
// 注：虽然扩展名是 .jpg，内容是 PNG；浏览器依 MIME 嗅探可正常显示。
// 仍然生成为 PNG 是因为手写 JPEG 编码器复杂度过高。此占位由用户替换为真实 jpg 后无遗留问题。
// 为避免误导，实际写入时使用 .png 扩展名，然后在 site.ts 的 fallback 中默认 .png。
// 经考量：保持扩展名真实性更重要。

function writeCover(filePath, colorA, colorB, label) {
  const W = 1600;
  const H = 900;
  const a = hex(colorA);
  const b = hex(colorB);
  const base = (x, y) => {
    const t = (x / W + y / H) / 2;
    return mix(a, b, t);
  };
  const scale = 8;
  const text = label;
  const textW = text.length * 6 * scale;
  const withText = overlayText(base, text, {
    x: Math.floor((W - textW) / 2),
    y: Math.floor(H / 2 - (7 * scale) / 2),
    scale,
    color: { r: 255, g: 255, b: 255 },
  });
  const buf = encodePNG(W, H, withText, false);
  fs.writeFileSync(filePath, buf);
  console.log(`  ✓ ${path.relative(ROOT, filePath)} (${W}x${H})`);
}

// ---------- 头像/立绘（透明 PNG） ----------
function writeAvatar(filePath, bgHex, label) {
  const S = 512;
  const bg = hex(bgHex);
  const cx = S / 2;
  const cy = S / 2;
  const r = S / 2 - 4;
  const base = (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r) return { r: 0, g: 0, b: 0, a: 0 };
    // 径向渐变：外圈深，中心亮
    const t = 1 - dist / r;
    const lighter = mix(bg, { r: 255, g: 220, b: 240 }, t * 0.4);
    return { ...lighter, a: 255 };
  };
  const scale = 6;
  const textW = label.length * 6 * scale;
  const pixel = overlayText(base, label, {
    x: Math.floor((S - textW) / 2),
    y: Math.floor(S / 2 - (7 * scale) / 2),
    scale,
    color: { r: 255, g: 255, b: 255 },
  });
  fs.writeFileSync(filePath, encodePNG(S, S, pixel, true));
  console.log(`  ✓ ${path.relative(ROOT, filePath)} (${S}x${S} RGBA)`);
}

function writeCharacter(filePath, bgHex, label) {
  const W = 800;
  const H = 1200;
  const bg = hex(bgHex);
  const base = (x, y) => {
    // 椭圆遮罩
    const dx = (x - W / 2) / (W / 2 - 10);
    const dy = (y - H / 2) / (H / 2 - 10);
    if (dx * dx + dy * dy > 1) return { r: 0, g: 0, b: 0, a: 0 };
    const t = y / H;
    const top = mix(bg, { r: 255, g: 220, b: 240 }, 0.3);
    const bot = bg;
    const c = mix(top, bot, t);
    return { ...c, a: 255 };
  };
  const scale = 8;
  const textW = label.length * 6 * scale;
  const pixel = overlayText(base, label, {
    x: Math.floor((W - textW) / 2),
    y: Math.floor(H / 2 - (7 * scale) / 2),
    scale,
    color: { r: 255, g: 255, b: 255 },
  });
  fs.writeFileSync(filePath, encodePNG(W, H, pixel, true));
  console.log(`  ✓ ${path.relative(ROOT, filePath)} (${W}x${H} RGBA)`);
}

// ---------- favicon.ico (32x32, ICO 包装 PNG) ----------
function writeFavicon(filePath) {
  const S = 32;
  const bg = hex('7c3aed');
  const eye = hex('ec4899');
  const pixel = (x, y) => {
    const dx = x - S / 2;
    const dy = y - S / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > S / 2 - 1) return { r: 0, g: 0, b: 0, a: 0 };
    // 中央瞳孔
    if (dist < 5) return { ...eye, a: 255 };
    // 外圈
    if (dist < 10) return { r: 255, g: 255, b: 255, a: 255 };
    return { ...bg, a: 255 };
  };
  const png = encodePNG(S, S, pixel, true);

  // ICO 文件头
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(1, 4); // 1 image

  const entry = Buffer.alloc(16);
  entry[0] = S === 256 ? 0 : S; // width
  entry[1] = S === 256 ? 0 : S; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8); // size
  entry.writeUInt32LE(6 + 16, 12); // offset

  fs.writeFileSync(filePath, Buffer.concat([header, entry, png]));
  console.log(`  ✓ ${path.relative(ROOT, filePath)} (${S}x${S} ICO)`);
}

// ---------- 主流程 ----------
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  console.log('Generating placeholder assets...\n');

  ensureDir(path.join(IMG, 'covers'));
  ensureDir(path.join(IMG, 'characters'));
  ensureDir(path.join(IMG, 'avatars'));

  // 封面（紫/玫红渐变族）
  const covers = [
    ['default', '#3b1d5a', '#7c3aed', 'DEFAULT COVER'],
    ['tech', '#1e1b4b', '#7c3aed', 'TECH COVER'],
    ['daily', '#831843', '#ec4899', 'DAILY COVER'],
    ['reading', '#3b0764', '#a855f7', 'READING COVER'],
  ];
  for (const [name, a, b, label] of covers) {
    writeCover(path.join(IMG, 'covers', `${name}.png`), a, b, label);
  }

  // 角色立绘
  writeCharacter(path.join(IMG, 'characters', 'satori-main.png'), '#6d28d9', 'SATORI MAIN');

  // 头像
  writeAvatar(path.join(IMG, 'avatars', 'satori.png'), '#7c3aed', 'SATORI');

  // Favicon
  writeFavicon(path.join(ROOT, 'public', 'favicon.ico'));

  // 清理旧 SVG
  const oldSvg = path.join(ROOT, 'public', 'favicon.svg');
  if (fs.existsSync(oldSvg)) {
    fs.unlinkSync(oldSvg);
    console.log(`  ✗ removed old favicon.svg`);
  }

  console.log('\nDone. Replace any file in-place with your real asset (keep the same name & extension).');
}

main();
