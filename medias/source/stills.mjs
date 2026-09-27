import {chromium} from '../../node_modules/@playwright/test/index.mjs';
import fs from 'node:fs'; import {serve} from './serve.mjs';
const V = process.argv.includes('-v');
const CFG = V
  ? {page:'reel-vertical.html', w:1080, h:1920, out:'../maqua-app-reel-vertical.mp4', tag:'v'}
  : {page:'reel.html',          w:1920, h:1080, out:'../maqua-app-reel.mp4',          tag:''};
const ARGS = process.argv.slice(2).filter(a=>a!=='-v');

const {s,port}=await serve();
const b=await chromium.launch({args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--font-render-hinting=none','--disable-lcd-text']});
const p=await b.newPage({viewport:{width:CFG.w,height:CFG.h},deviceScaleFactor:1});
p.on('console',m=>console.log('[page]',m.type(),m.text()));
p.on('pageerror',e=>console.log('[pageerror]',e.message));
await p.goto(`http://127.0.0.1:${port}/${CFG.page}`);
await p.waitForFunction('window.__ready===true || window.__err',null,{timeout:30000}).catch(()=>{});
const err=await p.evaluate('window.__err||null'); if(err){console.error('BOOT ERROR:\n'+err);await b.close();s.close();process.exit(1);}
fs.mkdirSync('stills',{recursive:true});
const times=ARGS.map(Number);
for(const t of times){
  const t0=Date.now();
  const d=await p.evaluate(tt=>window.__still(tt,Math.round(tt*60)),t);
  fs.writeFileSync(`stills/${CFG.tag}t${t.toFixed(2)}.png`,Buffer.from(d.split(',')[1],'base64'));
  console.log('t='+t.toFixed(2),'ms',Date.now()-t0);
}
await b.close(); s.close();
