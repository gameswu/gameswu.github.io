import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { siteMeta } from '@/config/site';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const sorted = posts.sort(
    (a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
  );

  return rss({
    title: siteMeta.title,
    description: siteMeta.description,
    site: context.site ?? siteMeta.url,
    items: sorted.map((post) => ({
      title: post.data.title,
      description: post.data.description ?? '',
      pubDate: new Date(post.data.date),
      link: `/posts/${post.id}/`,
      categories: post.data.tags,
    })),
    customData: `<language>zh-CN</language>`,
  });
}
