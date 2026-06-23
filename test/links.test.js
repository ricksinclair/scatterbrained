import { describe, it, expect } from 'vitest';
import { parseVideoUrl, isVideoUrl, domainOf, isWebUrl } from '../public/lib/links.js';

describe('links — URL helpers', () => {
  it('parses YouTube watch / short / embed / shorts to a nocookie embed', () => {
    const want = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ').embedUrl).toBe(want);
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ').embedUrl).toBe(want);
    expect(parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ').embedUrl).toBe(want);
    expect(parseVideoUrl('https://youtube.com/shorts/dQw4w9WgXcQ').embedUrl).toBe(want);
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s').provider).toBe('youtube');
  });

  it('parses Vimeo and direct video files', () => {
    expect(parseVideoUrl('https://vimeo.com/123456789').embedUrl).toBe('https://player.vimeo.com/video/123456789');
    const mp4 = parseVideoUrl('https://cdn.example.com/clip.mp4');
    expect(mp4.provider).toBe('file');
    expect(mp4.direct).toBe(true);
  });

  it('returns null for non-video and junk', () => {
    expect(parseVideoUrl('https://example.com/article')).toBe(null);
    expect(parseVideoUrl('not a url')).toBe(null);
    expect(parseVideoUrl('')).toBe(null);
    expect(parseVideoUrl(null)).toBe(null);
    expect(isVideoUrl('https://example.com')).toBe(false);
    expect(isVideoUrl('https://youtu.be/abcdef')).toBe(true);
  });

  it('domainOf strips www; isWebUrl gates http(s)', () => {
    expect(domainOf('https://www.nytimes.com/2026/article')).toBe('nytimes.com');
    expect(domainOf('garbage')).toBe('');
    expect(isWebUrl('https://x.com')).toBe(true);
    expect(isWebUrl('/Users/demo/file.md')).toBe(false);
    expect(isWebUrl('ftp://x')).toBe(false);
  });
});
