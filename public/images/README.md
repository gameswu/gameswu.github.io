# 素材资源说明

所有图片素材存放在这里。**支持任意常见图片格式**（`.jpg`、`.png`、`.webp`、`.gif`、`.avif`、`.svg`），系统会自动识别实际文件扩展名。

> **无需修改代码**：只要文件的**基础名**（不含扩展名）与下表一致，放到对应子目录即可自动生效。
> 例如把 `default.jpg`、`default.png`、`default.webp` 任一格式放到 `covers/`，都能被识别为默认封面。

---

## 目录结构与推荐规格

### `covers/` — 文章封面图
横幅形式，显示在文章详情页顶部、文章卡片上方。

| 基础名 | 用途 | 推荐尺寸 | 推荐格式 |
|--------|------|----------|----------|
| `default` | 所有未指定 cover 的文章默认封面 | 1600 × 900（16:9） | `.jpg` |
| `tech` | 技术类文章（TypeScript、Astro、Web开发、学习笔记）| 1600 × 900 | `.jpg` |
| `daily` | 日常随笔类（日常、随笔、公告）| 1600 × 900 | `.jpg` |
| `reading` | 读书笔记类 | 1600 × 900 | `.jpg` |

**在文章 frontmatter 中使用封面**，两种写法都可以：

```yaml
# 写法 1：只写基础名（推荐）—— 自动在 covers/ 匹配任意扩展名
cover: 'my-custom-cover'

# 写法 2：完整路径
cover: '/images/covers/my-custom-cover.jpg'
```

### `characters/` — 角色立绘
**透明背景** PNG 效果最好。用于首页 Hero 区。

| 基础名 | 用途 | 推荐尺寸 | 推荐格式 |
|--------|------|----------|----------|
| `satori-main` | 首页 Hero 主视觉立绘 | 高度 ≥ 800px，透明背景 | `.png` |

### `avatars/` — 头像
圆形裁切，用于关于页等。

| 基础名 | 用途 | 推荐尺寸 | 推荐格式 |
|--------|------|----------|----------|
| `satori` | 关于页主头像 | 512 × 512 | `.png` / `.jpg` |

### `scenes/` — 场景背景
全屏背景。

| 基础名 | 用途 | 推荐尺寸 | 推荐格式 |
|--------|------|----------|----------|
| `chireiden` | 地灵殿场景（备用） | 1920 × 1080 | `.jpg` |

### `decorations/` — 装饰元素
透明背景小图。

| 基础名 | 用途 | 推荐尺寸 | 推荐格式 |
|--------|------|----------|----------|
| `flower-1` | 角落装饰花纹 | 200 × 200 | `.png` |
| `flower-2` | 另一种花纹 | 200 × 200 | `.png` |
| `eye-pattern` | 第三只眼图案 | 300 × 300 | `.png` |

---

## 快速替换示例

**场景一**：你拿到一张觉的立绘，文件名叫 `satori_stand.png`。
1. 重命名为 `satori-main.png`
2. 放到 `public/images/characters/satori-main.png`
3. 刷新网页 —— 首页 Hero 区立即显示

**场景二**：你给某篇文章单独配一张封面 `my-article.webp`。
1. 放到 `public/images/covers/my-article.webp`
2. 在文章 frontmatter 写 `cover: 'my-article'`
3. 刷新即可

## 图片还没准备好？

当前目录下没有任何占位图片。网站首次运行时，缺失的图片会显示浏览器默认的「图片损坏」图标。这是**预期行为**——作为视觉提醒，督促你尽快补齐素材。

如果希望临时有占位图，可以使用以下任一方案：
- 用纯色块 + 文字的 PNG 临时替代
- 从 [unsplash.com](https://unsplash.com) 下载免费图片
- 使用 [placehold.co](https://placehold.co) 生成的占位图

## 版权提醒

东方 Project 角色素材请遵循 [上海爱丽丝幻乐团二次创作准则](https://touhou-project.news/guideline_en.html)。
