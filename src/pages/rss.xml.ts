import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { siteMeta, sortPostsByDate } from '@/config/site';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const sorted = sortPostsByDate(posts);

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
