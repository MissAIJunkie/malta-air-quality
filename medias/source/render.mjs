import {chromium} from '../../node_modules/@playwright/test/index.mjs';
import {spawn} from 'node:child_process'; import {serve} from './serve.mjs';
import fs from 'node:fs';
const V = process.argv.includes('-v');
const CFG = V
  ? {page:'reel-vertical.html', w:1080, h:1920, out:'../maqua-app-reel-vertical.mp4', tag:'v'}
  : {page:'reel.html',          w:1920, h:1080, out:'../maqua-app-reel.mp4',          tag:''};
const ARGS = process.argv.slice(2).filter(a=>a!=='-v');

const FPS=60, DUR=15.0, N=Math.round(FPS*DUR);
const OUT=ARGS[0]||CFG.out;
const {s,port}=await serve();
const b=await chromium.launch({args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--font-render-hinting=none','--disable-lcd-text']});
const p=await b.newPage({viewport:{width:CFG.w,height:CFG.h},deviceScaleFactor:1});
p.on('pageerror',e=>console.log('[pageerror]',e.message));
await p.goto(`http://127.0.0.1:${port}/${CFG.page}`);
await p.waitForFunction('window.__ready===true || window.__err',null,{timeout:60000});
const err=await p.evaluate('window.__err||null');
if(err){console.error('BOOT ERROR:\n'+err); await b.close(); s.close(); process.exit(1);}
const ff=spawn('ffmpeg',['-y','-f','image2pipe','-framerate',String(FPS),'-c:v','png','-i','-',
  '-c:v','libx264','-preset','slow','-crf','19','-pix_fmt','yuv420p','-profile:v','high','-level','4.2',
  '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-movflags','+faststart',OUT],
  {stdio:['pipe','ignore','pipe']});
let ffErr=''; ff.stderr.on('data',d=>{ffErr+=d.toString(); if(ffErr.length>8000) ffErr=ffErr.slice(-4000);});
const done=new Promise((res,rej)=>ff.on('close',c=>c===0?res():rej(new Error('ffmpeg exit '+c+'\n'+ffErr))));
const t0=Date.now();
for(let i=0;i<N;i++){
  const d=await p.evaluate(([i,f])=>window.__frame(i,f),[i,FPS]);
  const buf=Buffer.from(d.split(',')[1],'base64');
  if(i===Math.round(FPS*13.7)) fs.writeFileSync(OUT.replace(/\.mp4$/,'-poster.png'),buf);
  if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));
  if(i%120===0) console.log(`frame ${i}/${N}  ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
ff.stdin.end();
await done;
await b.close(); s.close();
console.log('rendered',N,'frames in',((Date.now()-t0)/1000).toFixed(1),'s ->',OUT);
