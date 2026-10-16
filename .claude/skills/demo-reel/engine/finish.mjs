// node finish.mjs  Muxes out/silent.mp4 with out/score.wav at -14 LUFS into out/<REEL.name>.mp4,
// then writes the review images: contact sheet, phone-size sheet and poster frame.
import './timeline.js';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const run = (...args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const video = `out/${REEL.name}.mp4`;
// The phone sheet shows each frame at 360 px on the film's short side, the size a phone feed plays it.
const phone = REEL.width <= REEL.height ? 'scale=360:-1' : 'scale=-1:360';

run('-i', 'out/silent.mp4', '-i', 'out/score.wav',
  '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-ar', '48000',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', video);
run('-i', video, '-vf', `fps=2,scale=216:-1,tile=8x${Math.ceil(REEL.duration * 2 / 8)}:padding=4:color=0x222222`, '-frames:v', '1', 'out/contact-final.png');
run('-i', video, '-vf', `fps=1,${phone},tile=10x${Math.ceil(REEL.duration / 10)}:padding=4:color=0x222222`, '-frames:v', '1', 'out/phone.png');
run('-ss', String(REEL.poster), '-i', video, '-frames:v', '1', 'out/poster.png');
console.log(`${video}, out/contact-final.png, out/phone.png, out/poster.png`);
