import { useState } from 'react';
import { youtubeId } from './pitch/video';

/** Video for an exercise. YouTube loads only after a tap (privacy-enhanced embed); other links open in a new tab. */
export function ExerciseVideo({ url, title }: { url: string; title: string }) {
  const [open, setOpen] = useState(false);
  const id = youtubeId(url);
  if (!id) {
    return (
      <a className="os-btn os-btn--ghost os-btn--sm" href={url} target="_blank" rel="noopener noreferrer">
        ▶ פתיחת הסרטון
      </a>
    );
  }
  if (!open) {
    return (
      <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => setOpen(true)}>
        ▶ צפייה בסרטון
      </button>
    );
  }
  return (
    <div className="os-video">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
        title={`סרטון: ${title}`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
      <a className="os-small" href={url} target="_blank" rel="noopener noreferrer">
        פתיחה ב־YouTube
      </a>
    </div>
  );
}
