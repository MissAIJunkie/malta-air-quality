/* maqua.app motion reels — shared engine.
   A scene file is loaded after this one and supplies sceneInit() and render(t, frameIndex).
   Stage size comes from window.__W / window.__H, set by the scene's HTML. */
'use strict';
const W = window.__W, H = window.__H, DUR = 15.0;
const cv = document.getElementById('stage');
const ctx = cv.getContext('2d', { alpha: false });

/* ---------- palette (from src/app/globals.css + design.md) ---------- */
const C = {
  bg:     '#0b1015',
  bgDeep: '#060a0e',
  fg:     '#e8edf2',
  mute:   '#8d9aa8',
  faint:  'rgba(232,237,242,0.10)',
  hair:   'rgba(232,237,242,0.16)',
  brand:  '#143c59',
  glass:  '#6fd3ac',
  cobalt: '#8fb4ff',
  sea:    '#0d1620',
  land:   '#111c26',
};
const BANDS = [
  { id:1, name:'Good',           col:'#50f0e6', on:'#04322f', pat:'none' },
  { id:2, name:'Fair',           col:'#50ccaa', on:'#043024', pat:'none' },
  { id:3, name:'Moderate',       col:'#f0e641', on:'#3a3405', pat:'dots' },
  { id:4, name:'Poor',           col:'#ff5050', on:'#3d0000', pat:'diagonal' },
  { id:5, name:'Very poor',      col:'#960032', on:'#ffe4ec', pat:'dense' },
  { id:6, name:'Extremely poor', col:'#7d2181', on:'#fbe9fc', pat:'ring' },
];

/* ---------- real station data (src/config/stations.ts) ---------- */
const ST = [
  { n:'Għarb',         id:'MT00007', isl:'Gozo',  ty:'Background', alt:114, lon:14.197074, lat:36.06705,  band:1 },
  { n:"St Paul's Bay", id:'MT00009', isl:'Malta', ty:'Traffic',    alt:7,   lon:14.385739, lat:35.944845, band:2 },
  { n:'Msida',         id:'MT00011', isl:'Malta', ty:'Traffic',    alt:2,   lon:14.493217, lat:35.895563, band:3 },
  { n:'Attard',        id:'MT00008', isl:'Malta', ty:'Background', alt:86,  lon:14.434573, lat:35.890091, band:2 },
  { n:'Żejtun',        id:'MT00004', isl:'Malta', ty:'Background', alt:56,  lon:14.538941, lat:35.852266, band:2 },
];
const MSIDA = ST[2];
/* Illustrative reading for Msida. Values chosen to sit in the bands named,
   per AQI_BREAKPOINTS in src/config/thresholds.ts. Captioned as illustrative. */
const READ = [
  { k:'PM2.5', v:12, band:2, scale:120 },
  { k:'PM10',  v:58, band:3, scale:120 },
  { k:'NO₂',   v:34, band:3, scale:100 },
  { k:'SO₂',   v:9,  band:1, scale:125 },
];

/* ---------- math ---------- */
const cl=(x,a=0,b=1)=>x<a?a:x>b?b:x;
const T=(t,a,b)=>cl((t-a)/(b-a));
const lerp=(a,b,u)=>a+(b-a)*u;
const eOut=u=>1-Math.pow(1-u,3);
const eOut4=u=>1-Math.pow(1-u,4);
const eExpo=u=>u>=1?1:1-Math.pow(2,-10*u);
const eInOut=u=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2;
const eIn=u=>u*u*u;
const eBack=u=>{const c=1.70158+1;return 1+c*Math.pow(u-1,3)+1.70158*Math.pow(u-1,2)};
function h(i,s){const x=Math.sin(i*127.1+s*311.7+13.1)*43758.5453;return x-Math.floor(x);}
function vnoise(x,s){const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return lerp(h(i,s),h(i+1,s),u);}

/* ---------- fonts ---------- */
const FD=[['Space Grotesk',[500,600,700],'SpaceGrotesk'],['Public Sans',[400,600],'PublicSans'],['IBM Plex Mono',[400,500,600],'IBMPlexMono']];
async function loadFonts(){
  const jobs=[];
  for(const [fam,ws,file] of FD) for(const w of ws){
    const f=new FontFace(fam,`url(fonts/${file}-${w}.ttf)`,{weight:String(w)});
    jobs.push(f.load().then(x=>document.fonts.add(x)));
  }
  await Promise.all(jobs); await document.fonts.ready;
}
const DISP='"Space Grotesk"', SANS='"Public Sans"', MONO='"IBM Plex Mono"';
function setF(fam,w,size,track){
  ctx.font=`${w} ${size}px ${fam}`;
  ctx.letterSpacing = track==null ? '0px' : (typeof track==='number'? track+'px' : track);
}
function txt(s,x,y,o){
  o=o||{};
  setF(o.fam||SANS,o.w||400,o.size||16,o.track);
  ctx.textAlign=o.align||'left'; ctx.textBaseline=o.base||'alphabetic';
  if(o.a!=null) ctx.globalAlpha=o.a;
  ctx.fillStyle=o.col||C.fg;
  ctx.fillText(s,x,y);
  ctx.globalAlpha=1; ctx.letterSpacing='0px';
  return s;
}
function mw(s,o){o=o||{};setF(o.fam||SANS,o.w||400,o.size||16,o.track);const m=ctx.measureText(s).width;ctx.letterSpacing='0px';return m;}
/* typewriter with a block caret */
function typeOn(s,x,y,o,u){
  const n=Math.floor(cl(u)*s.length+0.0001);
  const shown=s.slice(0,n);
  txt(shown,x,y,o);
  if(u>0&&u<1){
    const wdt=mw(shown,o), cw=(o.size||16)*0.5;
    ctx.globalAlpha=(o.a==null?1:o.a)*(Math.floor(u*40)%2?0.35:0.9);
    ctx.fillStyle=o.col||C.fg;
    ctx.fillRect(x+wdt+2,y-(o.size||16)*0.72,cw,(o.size||16)*0.72);
    ctx.globalAlpha=1;
  }
  return shown;
}

/* ---------- geo projection ---------- */
let RINGS=[], LOGO=null, BB=null, K=1, CEN=[0,0];
function proj(lon,lat){return [(lon-CEN[0])*K,-(lat-CEN[1])];}
/* camera: focus (world), anchor (screen), s (px per degree of latitude) */
function cam(fx,fy,ax,ay,s){return {fx,fy,ax,ay,s};}
const sx=(c,p)=>c.ax+(p[0]-c.fx)*c.s;
const sy=(c,p)=>c.ay+(p[1]-c.fy)*c.s;
function lerpCam(a,b,u){return cam(lerp(a.fx,b.fx,u),lerp(a.fy,b.fy,u),lerp(a.ax,b.ax,u),lerp(a.ay,b.ay,u),lerp(a.s,b.s,u));}

/* ---------- coastline sampling for particle targets ---------- */
let COAST=[];           // world-space points sampled evenly along every ring
let RINGLEN=[];         // world-space length of each ring
function buildCoast(n){
  const segs=[]; let total=0;
  RINGS.forEach((r,ri)=>{
    let L=0;
    for(let i=0;i<r.length-1;i++){
      const a=r[i],b=r[i+1],d=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(d>0){segs.push([a,b,d,total]);total+=d;L+=d;}
    }
    RINGLEN[ri]=L;
  });
  COAST=[];
  for(let i=0;i<n;i++){
    const u=((i*0.6180339887498949)%1)*total;   // golden-ratio stratified, deterministic
    let lo=0,hi=segs.length-1;
    while(lo<hi){const m=(lo+hi)>>1; if(segs[m][3]+segs[m][2]<u) lo=m+1; else hi=m;}
    const s=segs[lo], f=(u-s[3])/s[2];
    COAST.push([lerp(s[0][0],s[1][0],f),lerp(s[0][1],s[1][1],f)]);
  }
}

/* ---------- wordmark particle targets ---------- */
let WORD=[];
function buildWordmark(){
  const off=document.createElement('canvas'); off.width=1400; off.height=280;
  const o=off.getContext('2d');
  o.fillStyle='#fff'; o.textAlign='center'; o.textBaseline='middle';
  o.letterSpacing='-4px';
  o.font='700 200px "Space Grotesk"';
  o.fillText('maqua.app',700,146);
  const d=o.getImageData(0,0,1400,280).data;
  const pts=[];
  for(let y=0;y<280;y+=2) for(let x=0;x<1400;x+=2){
    if(d[(y*1400+x)*4+3]>140) pts.push([x,y]);
  }
  WORD=pts;
}

/* ---------- band textures ---------- */
const PAT={};
function buildPatterns(){
  const mk=(draw,sz)=>{const c=document.createElement('canvas');c.width=c.height=sz;const g=c.getContext('2d');draw(g,sz);return g.canvas;};
  PAT.dots=mk((g,s)=>{g.fillStyle='rgba(0,0,0,.42)';g.beginPath();g.arc(s/2,s/2,1.4,0,7);g.fill();},7);
  PAT.diagonal=mk((g,s)=>{g.strokeStyle='rgba(0,0,0,.38)';g.lineWidth=2;g.beginPath();g.moveTo(-s,s);g.lineTo(s,-s);g.moveTo(0,2*s);g.lineTo(2*s,0);g.stroke();},8);
  PAT.dense=mk((g,s)=>{g.strokeStyle='rgba(255,255,255,.30)';g.lineWidth=1.6;g.beginPath();g.moveTo(-s,s);g.lineTo(s,-s);g.moveTo(0,2*s);g.lineTo(2*s,0);g.stroke();},5);
  PAT.ring=mk((g,s)=>{g.strokeStyle='rgba(255,255,255,.30)';g.lineWidth=1.4;g.beginPath();g.arc(s/2,s/2,s/2-1.6,0,7);g.stroke();},10);
}
function bandFill(g,x,y,w,hh,b,a,pa){
  pa=pa==null?1:pa;
  g.globalAlpha=a; g.fillStyle=b.col; g.fillRect(x,y,w,hh);
  if(PAT[b.pat]&&pa>0.01){ g.globalAlpha=a*0.9*pa; g.fillStyle=g.createPattern(PAT[b.pat],'repeat'); g.fillRect(x,y,w,hh); }
  g.globalAlpha=1;
}

/* ---------- grain (breaks 8-bit banding on the dark ground) ---------- */
const GR=[];
function buildGrain(){
  for(let k=0;k<7;k++){
    const c=document.createElement('canvas'); c.width=c.height=384;
    const g=c.getContext('2d'), im=g.createImageData(384,384), d=im.data;
    for(let i=0;i<384*384;i++){
      const v=Math.floor(h(i+k*99991,k+3)*8);
      d[i*4]=v; d[i*4+1]=v; d[i*4+2]=v; d[i*4+3]=255;
    }
    g.putImageData(im,0,0); GR.push(c);
  }
}
function grain(fi){
  /* 30 Hz grain: dithers the dark ground without giving the encoder a new
     noise field on every single frame. */
  const k=Math.floor(fi/2), g=GR[k%GR.length];
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  ctx.translate(-Math.floor(h(k,7)*384),-Math.floor(h(k,11)*384));
  const p=ctx.createPattern(g,'repeat'); ctx.fillStyle=p;
  ctx.fillRect(0,0,W+400,H+400);
  ctx.restore();
}
let VIG=null;
function vignette(){
  if(!VIG){ VIG=ctx.createRadialGradient(W/2,H/2,H*0.32,W/2,H/2,H*1.02);
    VIG.addColorStop(0,'rgba(0,0,0,0)'); VIG.addColorStop(1,'rgba(0,0,0,0.62)'); }
  ctx.fillStyle=VIG; ctx.fillRect(0,0,W,H);
}


/* ---------- shapes ---------- */
function roundRect(g,x,y,w,hh,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+hh,r);g.arcTo(x+w,y+hh,x,y+hh,r);g.arcTo(x,y+hh,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}

/* ================= particles ================= */
const NP=3000, P=[];
for(let i=0;i<NP;i++){
  P.push({r1:h(i,1.7),r2:h(i,9.3),r3:h(i,4.13),r4:h(i,13.7),r5:h(i,21.1),
          ph:h(i,4.13)*6.2832, sp:0.35+h(i,13.7)*1.25, sz:0.55+h(i,2.9)*2.0, st:h(i,17.3)});
}
function drift(p,t){
  const sw=W+520, sh=H+520;
  let x=p.r1*sw + Math.sin(t*0.46*p.sp+p.ph)*78 + Math.cos(t*0.21+p.ph*1.7)*46 + t*30*(p.r3-0.34);
  let y=p.r2*sh + Math.cos(t*0.37*p.sp+p.ph*1.31)*58 - t*22*(0.4+p.r1);
  x=((x%sw)+sw)%sw-260; y=((y%sh)+sh)%sh-260;
  return [x,y];
}

/* ---------- PM10 bands and the illustrative series ---------- */
const PM10=[[1,15],[16,45],[46,120],[121,195],[196,270],[271,1200]];
const HIST=[],FCST=[];
for(let j=0;j<48;j++){
  let v=30+26*vnoise(j*0.24,5)+9*Math.sin(j*0.31)+5*vnoise(j*0.9,11);
  if(j>41) v=lerp(v,58,(j-41)/6);
  HIST.push(v);
}
for(let j=0;j<5;j++) FCST.push(52+18*vnoise(j*0.8+3.3,17)-6*j*0.4);

let ARCS=null,GLY=null;

/* ---------- generic map + effect drawing (layout knobs below) ---------- */
let GRAT={x0:90,x1:W-90,y0:110,y1:H-110,lonLabY:H-120,latLabX:96};
let LANDGRAD=[300,900];
function graticule(c,a){
  if(a<=0.004) return;
  ctx.save(); ctx.globalAlpha=a;
  ctx.lineWidth=1;
  for(let lon=14.10;lon<=14.70;lon+=0.05){
    const x=sx(c,proj(lon,0)); if(x<GRAT.x0-50||x>GRAT.x1+50) continue;
    const maj=Math.abs(lon*100-Math.round(lon*10)*10)<0.01;
    ctx.strokeStyle='rgba(143,180,255,'+(maj?0.16:0.07)+')';
    ctx.beginPath();ctx.moveTo(x,GRAT.y0);ctx.lineTo(x,GRAT.y1);ctx.stroke();
    if(maj) txt(lon.toFixed(1)+'°E',x+6,GRAT.lonLabY,{fam:MONO,w:400,size:10.5,track:1.4,a:a*0.75,col:C.cobalt});
  }
  for(let lat=35.70;lat<=36.20;lat+=0.05){
    const y=sy(c,proj(0,lat)); if(y<GRAT.y0||y>GRAT.y1) continue;
    const maj=Math.abs(lat*100-Math.round(lat*10)*10)<0.01;
    ctx.strokeStyle='rgba(143,180,255,'+(maj?0.16:0.07)+')';
    ctx.beginPath();ctx.moveTo(GRAT.x0,y);ctx.lineTo(GRAT.x1,y);ctx.stroke();
    if(maj) txt(lat.toFixed(1)+'°N',GRAT.latLabX,y-8,{fam:MONO,w:400,size:10.5,track:1.4,a:a*0.75,col:C.cobalt});
  }
  ctx.restore();
}
function islands(c,a,drawU,fillU){
  if(a<=0.004) return;
  ctx.save(); ctx.globalAlpha=a;
  ctx.lineJoin='round'; ctx.lineCap='round';
  RINGS.forEach((r,ri)=>{
    ctx.beginPath();
    ctx.moveTo(sx(c,r[0]),sy(c,r[0]));
    for(let i=1;i<r.length;i++) ctx.lineTo(sx(c,r[i]),sy(c,r[i]));
    ctx.closePath();
    if(fillU>0){
      const g=ctx.createLinearGradient(0,LANDGRAD[0],0,LANDGRAD[1]);
      g.addColorStop(0,'rgba(20,60,89,'+(0.50*fillU)+')');
      g.addColorStop(1,'rgba(10,22,32,'+(0.86*fillU)+')');
      ctx.fillStyle=g; ctx.fill();
    }
    const len=RINGLEN[ri]*c.s+8;
    ctx.setLineDash([len,len]);
    ctx.lineDashOffset=len*(1-cl(drawU*1.18-ri*0.045));
    /* coastal bloom */
    ctx.strokeStyle='rgba(111,211,172,0.13)'; ctx.lineWidth=11; ctx.stroke();
    ctx.strokeStyle='rgba(111,211,172,0.85)'; ctx.lineWidth=1.9; ctx.stroke();
    ctx.setLineDash([]);
  });
  ctx.restore();
}
function radar(c,a,t){
  if(a<=0.004) return;
  const p=proj(MSIDA.lon,MSIDA.lat), x=sx(c,p), y=sy(c,p);
  ctx.save(); ctx.globalAlpha=a; ctx.globalCompositeOperation='lighter';
  const ang=(t*0.62)%(Math.PI*2);
  const g=ctx.createConicGradient(ang,x,y);
  g.addColorStop(0,'rgba(111,211,172,0.0)');
  g.addColorStop(0.020,'rgba(111,211,172,0.16)');
  g.addColorStop(0.155,'rgba(111,211,172,0.0)');
  g.addColorStop(1,'rgba(111,211,172,0.0)');
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,2300,0,7); ctx.fill();
  ctx.restore();
}
function marker(c,s,a,pop,dim,pulseT){
  if(a<=0.004) return null;
  const p=proj(s.lon,s.lat), x=sx(c,p), y=sy(c,p);
  const b=BANDS[s.band-1], sc=eBack(cl(pop));
  ctx.save(); ctx.globalAlpha=a;
  /* expanding pulses */
  for(let k=0;k<3;k++){
    const u=((pulseT*0.5+k/3)%1);
    if(pop>0.75){
      ctx.globalAlpha=a*(1-u)*0.34*(1-dim*0.7);
      ctx.strokeStyle=b.col; ctx.lineWidth=1.6;
      ctx.beginPath(); ctx.arc(x,y,9+u*46*sc,0,7); ctx.stroke();
    }
  }
  ctx.globalAlpha=a;
  const gg=ctx.createRadialGradient(x,y,0,x,y,38*sc);
  gg.addColorStop(0,b.col+'55'); gg.addColorStop(1,b.col+'00');
  ctx.fillStyle=gg; ctx.beginPath(); ctx.arc(x,y,38*sc,0,7); ctx.fill();
  ctx.globalAlpha=a*(1-dim*0.55);
  ctx.fillStyle=b.col; ctx.beginPath(); ctx.arc(x,y,8.4*sc,0,7); ctx.fill();
  ctx.fillStyle='rgba(11,16,21,0.9)'; ctx.beginPath(); ctx.arc(x,y,3.4*sc,0,7); ctx.fill();
  ctx.strokeStyle=b.col; ctx.lineWidth=1.4; ctx.globalAlpha=a*0.8;
  ctx.beginPath(); ctx.arc(x,y,13.5*sc,0,7); ctx.stroke();
  ctx.restore();
  return [x,y];
}
function dust(t,c){
  const a=T(t,0.10,0.78)*(1-T(t,2.66,3.12));
  if(a<=0.004) return;
  ctx.save();
  for(let i=0;i<NP;i++){
    const p=P[i], d=drift(p,t);
    const m=eExpo(T(t,1.52+p.st*0.46,2.42+p.st*0.46));
    let x=d[0],y=d[1];
    if(m>0){const g=COAST[i%COAST.length];x=lerp(x,sx(c,g),m);y=lerp(y,sy(c,g),m);}
    ctx.globalAlpha=a*(0.22+p.r5*0.78)*(1-m*0.3);
    ctx.fillStyle=p.r4>0.88?C.glass:(p.r4>0.55?'#9db5c6':'#54697a');
    if(p.r5>0.978){
      const s=p.sz*3.4;
      const g2=ctx.createRadialGradient(x,y,0,x,y,s);
      g2.addColorStop(0,'rgba(111,211,172,0.55)');g2.addColorStop(1,'rgba(111,211,172,0)');
      ctx.fillStyle=g2;ctx.beginPath();ctx.arc(x,y,s,0,7);ctx.fill();
    } else {
      const s=p.sz*(1+m*0.35);
      ctx.fillRect(x,y,s,s);
    }
  }
  ctx.restore();
}
function sweep(t){
  const wins=[[0.2,1.9],[9.0,9.9],[11.9,12.5]];
  wins.forEach(([s,e])=>{
    if(t<s||t>e) return;
    const u=(t-s)/(e-s), y=lerp(-160,H+160,u);
    ctx.save(); ctx.globalCompositeOperation='lighter';
    const g=ctx.createLinearGradient(0,y-150,0,y+150);
    g.addColorStop(0,'rgba(111,211,172,0)'); g.addColorStop(0.5,'rgba(111,211,172,0.055)');
    g.addColorStop(1,'rgba(111,211,172,0)');
    ctx.fillStyle=g; ctx.fillRect(0,y-150,W,300);
    ctx.globalAlpha=0.5; ctx.fillStyle='rgba(111,211,172,0.12)'; ctx.fillRect(0,y,W,1.2);
    ctx.restore();
  });
}
function logo(t,cxp,cyp,R){
  const pop=T(t,12.42,12.92), a=T(t,12.42,12.66);
  if(a<=0.004) return;
  const sc=lerp(0.6,1,eOut4(pop))*(1+0.012*Math.sin((t-12.9)*1.4));
  ctx.save(); ctx.globalAlpha=a;
  ctx.translate(cxp,cyp); ctx.scale(sc,sc);
  /* bloom */
  const bg=ctx.createRadialGradient(0,0,R*0.5,0,0,R*2.4);
  bg.addColorStop(0,'rgba(111,211,172,0.18)'); bg.addColorStop(1,'rgba(111,211,172,0)');
  ctx.fillStyle=bg; ctx.beginPath(); ctx.arc(0,0,R*2.4,0,7); ctx.fill();
  ctx.scale(R/48,R/48); ctx.translate(-50,-50);
  ctx.beginPath(); ctx.arc(50,50,48,0,7); ctx.fillStyle='#143c59'; ctx.fill();
  ctx.strokeStyle='rgba(111,211,172,0.35)'; ctx.lineWidth=0.8; ctx.stroke();
  /* arcs: stroke on, then a slow live rotation */
  const du=eOut(T(t,12.62,13.22));
  if(du>0){
    ctx.save(); ctx.translate(50,50);
    ctx.rotate(lerp(-0.30,0,eOut(T(t,12.62,13.4)))+Math.max(0,t-13.4)*0.16);
    ctx.translate(-50,-50);
    ctx.strokeStyle='#71ceb6'; ctx.lineWidth=5; ctx.lineCap='round';
    ctx.setLineDash([64,64]); ctx.lineDashOffset=64*(1-du);
    ARCS.forEach(p=>ctx.stroke(p));
    ctx.setLineDash([]); ctx.restore();
  }
  const gu=eOut(T(t,12.98,13.42));
  if(gu>0){ ctx.globalAlpha=a*gu; ctx.fillStyle='#f3eee3';
    ctx.save(); ctx.translate(50,50); ctx.scale(lerp(0.88,1,gu),lerp(0.88,1,gu)); ctx.translate(-50,-50);
    GLY.forEach(p=>ctx.fill(p)); ctx.restore(); }
  ctx.restore();
}


/* ---------- boot ---------- */
async function bootCore(){
  const [isl,lg]=await Promise.all([
    fetch('islands.json').then(r=>r.json()),
    fetch('logo.json').then(r=>r.json()),
  ]);
  await loadFonts();
  if(!document.fonts.check('600 48px "Space Grotesk"')) throw new Error('Space Grotesk missing');
  if(!document.fonts.check('400 16px "IBM Plex Mono"')) throw new Error('IBM Plex Mono missing');
  /* bbox + projection constants */
  let a=1e9,b=1e9,cc=-1e9,d=-1e9;
  isl.forEach(r=>r.forEach(([x,y])=>{a=Math.min(a,x);b=Math.min(b,y);cc=Math.max(cc,x);d=Math.max(d,y);}));
  CEN=[(a+cc)/2,(b+d)/2]; K=Math.cos(CEN[1]*Math.PI/180);
  RINGS=isl.map(r=>r.map(([x,y])=>proj(x,y)));
  /* recompute ring lengths + coastline samples in world space */
  RINGLEN=RINGS.map(r=>{let L=0;for(let i=0;i<r.length-1;i++)L+=Math.hypot(r[i+1][0]-r[i][0],r[i+1][1]-r[i][1]);return L;});
  (function(){
    const segs=[];let total=0;
    RINGS.forEach(r=>{for(let i=0;i<r.length-1;i++){const p=r[i],q=r[i+1],dd=Math.hypot(q[0]-p[0],q[1]-p[1]);if(dd>0){segs.push([p,q,dd,total]);total+=dd;}}});
    COAST=[];
    for(let i=0;i<NP;i++){
      const u=((i*0.6180339887498949)%1)*total;
      let lo=0,hi=segs.length-1;
      while(lo<hi){const m=(lo+hi)>>1;if(segs[m][3]+segs[m][2]<u)lo=m+1;else hi=m;}
      const s=segs[lo],f=(u-s[3])/s[2];
      COAST.push([lerp(s[0][0],s[1][0],f),lerp(s[0][1],s[1][1],f)]);
    }
  })();
  ARCS=lg.arcs.map(s=>new Path2D(s));
  GLY=lg.glyphs.map(s=>new Path2D(s));
  buildPatterns(); buildGrain(); buildWordmark();
  if(WORD.length<400) throw new Error('wordmark sample too sparse: '+WORD.length);
  sceneInit();
  window.__ready=true;
  window.__frame=(i,fps)=>{ render(i/fps,i); return cv.toDataURL('image/png'); };
  window.__still=(tt,i)=>{ render(tt,i||0); return cv.toDataURL('image/png'); };
}
window.__boot=()=>bootCore().then(()=>{window.__frame(0,60);})
                           .catch(e=>{window.__err=String(e&&e.stack||e);});
