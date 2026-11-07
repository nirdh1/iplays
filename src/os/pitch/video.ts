// Video links on exercises: only links, no hosting. Pure helpers (unit tested).
const RX = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|drive\.google\.com)\/[^\s<>"]+$/;

/** Same rule as the database check. Empty = no video. */
export const isVideoUrl = (u: string) => u.trim() === '' || (u.trim().length <= 300 && RX.test(u.trim()));

/** YouTube id from watch / youtu.be / shorts / embed links, or null. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
        id = m ? m[2] : null;
      }
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
