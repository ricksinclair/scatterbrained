// links.js — pure URL helpers for the link/video content components (ROADMAP #19).
// No DOM, no network; fully unit-tested. Embeds use privacy-friendly endpoints
// (youtube-nocookie) and are rendered inside a sandboxed iframe by the registry.

// Parse a video URL → { provider, id, embedUrl, direct? } or null if not a video.
//   youtube.com/watch?v=ID · youtu.be/ID · youtube.com/embed/ID · /shorts/ID
//   vimeo.com/ID
//   a direct .mp4/.webm/.ogg file
export function parseVideoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    let id = u.searchParams.get('v') || '';
    if (!id && u.pathname.startsWith('/embed/')) id = u.pathname.slice('/embed/'.length);
    if (!id && u.pathname.startsWith('/shorts/')) id = u.pathname.slice('/shorts/'.length);
    id = id.split('/')[0];
    if (/^[\w-]{6,}$/.test(id)) return { provider: 'youtube', id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    if (/^[\w-]{6,}$/.test(id)) return { provider: 'youtube', id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = (u.pathname.match(/\/(?:video\/)?(\d+)/) || [])[1];
    if (id) return { provider: 'vimeo', id, embedUrl: `https://player.vimeo.com/video/${id}` };
  }
  if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) return { provider: 'file', id: null, embedUrl: u.href, direct: true };
  return null;
}

export function isVideoUrl(url) { return !!parseVideoUrl(url); }

// The bare hostname (no leading www) for a link card's domain line.
export function domainOf(url) {
  try { return new URL(String(url).trim()).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

// Is this a real http(s) web URL (vs a file path or junk)? Drives the `link` card.
export function isWebUrl(url) {
  try { const u = new URL(String(url).trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}
