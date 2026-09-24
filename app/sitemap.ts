import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://www.buugaxisaabta.online';

  return [
    {
      url: baseUrl,
      lastModified: '2026-09-24',
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: '2026-09-24',
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}
