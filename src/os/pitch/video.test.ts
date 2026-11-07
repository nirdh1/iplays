// Run: node scripts/run-os-tests.mjs
import { isVideoUrl, youtubeId } from './video';
let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
eq('watch link', youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
eq('short link', youtubeId('https://youtu.be/dQw4w9WgXcQ?si=x'), 'dQw4w9WgXcQ');
eq('shorts', youtubeId('https://youtube.com/shorts/abcDEF12345'), 'abcDEF12345');
eq('drive is not youtube', youtubeId('https://drive.google.com/file/d/1/view'), null);
eq('garbage', youtubeId('not a url'), null);
eq('empty is allowed', isVideoUrl(''), true);
eq('drive allowed', isVideoUrl('https://drive.google.com/file/d/1abc/view'), true);
eq('http refused', isVideoUrl('http://youtu.be/x'), false);
eq('other host refused', isVideoUrl('https://example.com/v'), false);
eq('lookalike host refused', isVideoUrl('https://youtube.com.evil.io/x'), false);
if (failed) process.exit(1);
