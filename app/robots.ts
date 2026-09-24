import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login'],
        disallow: [
          '/api/',
          '/dashboard',
          '/customers',
          '/ledger',
          '/payments',
          '/daily-book',
          '/settings',
          '/users',
          '/reports',
          '/reliability-audit',
        ],
      },
    ],
    sitemap: 'https://www.buugaxisaabta.online/sitemap.xml',
  };
}
