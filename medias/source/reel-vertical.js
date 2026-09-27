/* maqua.app — 15s motion reel, 9:16 for TikTok / Reels / Shorts. Scene for core.js.
 *
 * Not a reflow of the 16:9 cut: the panels stack, the six-band scale stands up
 * vertically (which is what the value axis wants anyway, so beat 4 morphs more
 * directly than it does in landscape), and the station list is keyed to the map
 * by numbered badges rather than leader lines, which do not survive a portrait
 * frame. Same five beats, same timings.
 *
 * Platform chrome is respected: nothing load-bearing sits above y=300, below
 * y=1600, or inside the right-hand action rail (x>930 once y>1000).
 */
const SAFE_L=96, SAFE_R=984, M=56;

/* ================= timeline ================= */
const B=[
  {t0:0.00,t1:2.45,l:'01 — PARTICULATE'},
  {t0:2.15,t1:5.70,l:'02 — THE NETWORK'},
  {t0:5.45,t1:9.05,l:'03 — THE READING'},
  {t0:8.80,t1:12.10,l:'04 — THE SCALE'},
  {t0:11.95,t1:15.00,l:'05 — MAQUA.APP'},
];
const LBL=[[0.22,2.34],[2.42,5.56],[5.64,8.92],[9.00,11.86],[11.94,13.95]];

/* ================= HUD ================= */
const FT=200, FB=1660;   /* the HUD frame, inset from the platform chrome */
/* Portrait keeps far less clear space than landscape, and the top strip is also
   where the platform draws its own chrome. Scrims hold the HUD legible whatever
   the map is doing behind it. */
function scrims(){
  const top=ctx.createLinearGradient(0,0,0,330);
  top.addColorStop(0,'rgba(5,9,13,0.88)'); top.addColorStop(0.55,'rgba(5,9,13,0.52)');
  top.addColorStop(1,'rgba(5,9,13,0)');
  ctx.fillStyle=top; ctx.fillRect(0,0,W,330);
  const bot=ctx.createLinearGradient(0,H,0,H-300);
  bot.addColorStop(0,'rgba(5,9,13,0.82)'); bot.addColorStop(0.5,'rgba(5,9,13,0.42)');
  bot.addColorStop(1,'rgba(5,9,13,0)');
  ctx.fillStyle=bot; ctx.fillRect(0,H-300,W,300);
}
function hud(t){
  const a=T(t,0.18,0.95);
  ctx.save();
  ctx.strokeStyle='rgba(232,237,242,0.28)'; ctx.lineWidth=1.5;
  const L=lerp(10,34,eOut(T(t,0.2,1.1)));
  [[M,FT,1,1],[W-M,FT,-1,1],[M,FB,1,-1],[W-M,FB,-1,-1]].forEach(([x,y,dx,dy])=>{
    ctx.globalAlpha=a*0.9;ctx.beginPath();ctx.moveTo(x+dx*L,y);ctx.lineTo(x,y);ctx.lineTo(x,y+dy*L);ctx.stroke();
  });
  /* a tick rail down the left edge — the portrait answer to the landscape one */
  ctx.globalAlpha=a*0.5;
  for(let i=0;i<=44;i++){const y=lerp(FT+40,FB-40,i/44);const tall=i%5===0;
    ctx.strokeStyle='rgba(232,237,242,'+(tall?0.30:0.14)+')';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(M-9,y);ctx.lineTo(M-9-(tall?8:4),y);ctx.stroke();}
  ctx.restore();

  txt('MAQUA.APP',SAFE_L,FT+44,{fam:MONO,w:600,size:17,track:3.6,a:a,col:C.fg});
  txt('MALTA AIR QUALITY',SAFE_L,FT+70,{fam:MONO,w:400,size:12.5,track:2.6,a:a*0.55,col:C.mute});
  txt('EEA EUROPEAN AQI',SAFE_R,FT+44,{fam:MONO,w:400,size:12.5,track:2.2,a:a*0.55,col:C.mute,align:'right'});
  txt('DIRECTIVE 2008/50/EC',SAFE_R,FT+70,{fam:MONO,w:400,size:12.5,track:2.2,a:a*0.55,col:C.mute,align:'right'});

  for(let i=0;i<LBL.length;i++){
    const [s,e]=LBL[i]; if(t<s-0.05||t>e+0.35) continue;
    const inn=T(t,s,s+0.30), out=1-T(t,e,e+0.22);
    const al=a*inn*out; if(al<=0.002) continue;
    const dx=SAFE_L+lerp(16,0,eOut(inn)), split=(1-inn)*7;
    const dy=lerp(15,0,eOut(inn))+lerp(0,-15,1-out);
    const o={fam:MONO,w:500,size:15,track:2.8,base:'alphabetic'};
    ctx.save(); ctx.translate(0,dy);
    if(split>0.3){
      ctx.globalCompositeOperation='lighter';
      txt(B[i].l,dx-split,FB-44,Object.assign({},o,{a:al*0.5,col:'#ff3860'}));
      txt(B[i].l,dx+split,FB-44,Object.assign({},o,{a:al*0.5,col:'#39e0ff'}));
      ctx.globalCompositeOperation='source-over';
    }
    txt(B[i].l,dx,FB-44,Object.assign({},o,{a:al,col:C.fg}));
    const wdt=mw(B[i].l,o);
    ctx.globalAlpha=al*0.5;ctx.fillStyle=C.glass;
    ctx.fillRect(dx,FB-34,wdt*cl((t-s)/(e-s)),1.5);ctx.globalAlpha=1;
    ctx.restore();
  }
}

/* ================= cameras ================= */
const CAM2=cam(0,0,540,900,1780);
let CAM3=null, CAM4=null;
function camAt(t){
  if(t<5.45) return CAM2;
  if(t<6.78) return lerpCam(CAM2,CAM3,eInOut(T(t,5.45,6.78)));
  /* settle down-right rather than up-left: in portrait an upward creep walks
     Gozo into the top-left HUD */
  if(t<8.95){const u=T(t,6.78,8.95);return cam(CAM3.fx,CAM3.fy,CAM3.ax+u*8,CAM3.ay-u*6,CAM3.s*(1+u*0.02));}
  return lerpCam(cam(CAM3.fx,CAM3.fy,CAM3.ax+8,CAM3.ay-6,CAM3.s*1.02),CAM4,eInOut(T(t,8.95,9.9)));
}

/* ================= beat 2 — the network ================= */
const ROW0=1236, ROWDY=68;
/* per-station badge offsets, hand-placed so no numeral sits on a coastline */
const BADGE=[[-32,-28],[28,-22],[38,-34],[-38,26],[32,24]];
function netColumn(t){
  const a=T(t,2.62,3.15)*(1-T(t,5.62,6.18));
  if(a<=0.004) return;
  txt('THE MONITORING NETWORK',SAFE_L,352,{fam:MONO,w:500,size:12.5,track:3.2,a:a*0.8,col:C.glass});
  ['Five stations.','Two islands.'].forEach((s,i)=>{
    const u=eOut(T(t,2.78+i*0.14,3.42+i*0.14));
    ctx.save();ctx.globalAlpha=a*u;
    txt(s,SAFE_L,442+i*76,{fam:DISP,w:700,size:66,track:-1.7,col:C.fg});
    ctx.restore();
  });
  txt("Operated by Malta's Environment & Resources Authority.",SAFE_L,570,
      {fam:SANS,w:400,size:21,a:a*eOut(T(t,3.15,3.7))*0.72,col:C.mute});
  txt('ILLUSTRATIVE BANDS — NOT LIVE READINGS',SAFE_L,ROW0+5*ROWDY-12,
      {fam:MONO,w:500,size:12,track:2.4,a:a*eOut(T(t,4.1,4.6))*0.42,col:'#f0e641'});
}
function netRows(t,c){
  const aCol=T(t,2.62,3.15)*(1-T(t,5.62,6.18));
  ST.forEach((s,i)=>{
    const t0=2.95+i*0.115;
    const pop=eOut(T(t,t0,t0+0.55));
    const dim=T(t,5.3,5.9)*(s===MSIDA?0:1);
    const mk=marker(c,s,T(t,t0,t0+0.3)*(1-T(t,8.95,9.55)),pop,dim,t-t0);
    const b=BANDS[s.band-1];
    /* numbered badge on the map, matched by the row below */
    if(mk&&pop>0.2){
      const ba=T(t,t0+0.2,t0+0.6)*(1-T(t,8.95,9.4))*(1-dim*0.6);
      ctx.save(); ctx.globalAlpha=ba;
      const bx=mk[0]+BADGE[i][0], by=mk[1]+BADGE[i][1];
      ctx.fillStyle='rgba(11,16,21,0.72)'; ctx.beginPath(); ctx.arc(bx,by,14,0,7); ctx.fill();
      ctx.strokeStyle=b.col; ctx.lineWidth=1.3; ctx.stroke();
      txt(String(i+1),bx,by+5,{fam:MONO,w:600,size:14,col:b.col,align:'center'});
      ctx.restore();
    }
    if(aCol<=0.004) return;
    const ry=ROW0+i*ROWDY, ra=aCol*eOut(T(t,t0+0.12,t0+0.7));
    const dx=lerp(26,0,eOut(T(t,t0+0.12,t0+0.72)));
    ctx.save(); ctx.globalAlpha=ra;
    ctx.strokeStyle=C.faint; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(SAFE_L+dx,ry+20); ctx.lineTo(906,ry+20); ctx.stroke();
    txt(String(i+1),SAFE_L+dx,ry,{fam:MONO,w:600,size:15,a:ra*0.55,col:C.mute});
    bandFill(ctx,SAFE_L+dx+30,ry-20,22,22,b,ra);
    ctx.globalAlpha=ra;
    txt(s.n,SAFE_L+dx+66,ry,{fam:DISP,w:600,size:29,track:-0.5,col:C.fg});
    txt(s.ty.toUpperCase()+' · '+s.isl.toUpperCase(),906,ry-2,
        {fam:MONO,w:400,size:12,track:1.8,a:0.58,col:C.mute,align:'right'});
    ctx.restore();
  });
}

/* ================= beat 3 — the reading ================= */
const CX0=80,CY0=860,CW0=850,CH0=720;
const CBX=124,CBY=1020,CBW=782,CBH=84;
function card(t,c){
  const u=eOut(T(t,5.72,6.42)), a=T(t,5.72,6.0)*(1-T(t,8.96,9.28));
  if(a<=0.004) return;
  /* hairline tying the selected marker to the panel below it */
  const mp2=proj(MSIDA.lon,MSIDA.lat), mx=sx(c,mp2), my=sy(c,mp2);
  const cu=eOut(T(t,5.66,6.18));
  if(cu>0.01&&my<CY0-30){
    ctx.save(); ctx.globalAlpha=a*0.45; ctx.strokeStyle=BANDS[2].col; ctx.lineWidth=1.1;
    ctx.beginPath(); ctx.moveTo(mx,my);
    ctx.lineTo(mx,lerp(my,CY0-56,Math.min(cu*2,1)));
    if(cu>0.5){ctx.lineTo(lerp(mx,300,eOut(T(cu,0.5,0.85))),CY0-56);
      if(cu>0.85) ctx.lineTo(300,lerp(CY0-56,CY0,T(cu,0.85,1)));}
    ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.globalAlpha=a;
  const hh=CH0*u;
  roundRect(ctx,CX0,CY0,CW0,hh,14);
  ctx.fillStyle='rgba(18,29,40,0.80)'; ctx.fill();
  ctx.strokeStyle='rgba(232,237,242,0.14)'; ctx.lineWidth=1.2; ctx.stroke();
  ctx.save(); roundRect(ctx,CX0,CY0,CW0,hh,14); ctx.clip();
  if(u<1){ const g=ctx.createLinearGradient(0,CY0+hh-120,0,CY0+hh);
    g.addColorStop(0,'rgba(111,211,172,0)'); g.addColorStop(1,'rgba(111,211,172,0.18)');
    ctx.fillStyle=g; ctx.fillRect(CX0,CY0+hh-120,CW0,120); }

  txt('MT00011 · TRAFFIC · URBAN · 2 M ASL',124,924,
      {fam:MONO,w:500,size:13,track:2.6,a:eOut(T(t,6.1,6.55))*0.7,col:C.glass});
  const nu=eOut(T(t,6.16,6.72));
  ctx.save(); ctx.globalAlpha=a*nu;
  txt('Msida',124,996,{fam:DISP,w:700,size:64,track:-1.8,col:C.fg});
  ctx.restore();

  const bu=eOut(T(t,6.42,6.92)), b=BANDS[2];
  if(bu>0&&t<8.98){
    ctx.save(); roundRect(ctx,CBX,CBY,CBW*bu,CBH,10); ctx.clip();
    bandFill(ctx,CBX,CBY,CBW,CBH,b,1);
    txt('MODERATE',CBX+28,CBY+CBH/2+13,{fam:DISP,w:700,size:38,track:0.4,col:b.on});
    txt('BAND 3 OF 6',CBX+CBW-28,CBY+CBH/2+6,{fam:MONO,w:600,size:13,track:2.2,col:b.on,align:'right',a:0.95});
    ctx.restore();
  }
  const lu=eOut(T(t,6.92,7.35));
  ctx.save(); ctx.globalAlpha=a*lu;
  txt('LEADING POLLUTANT',124,1166,{fam:MONO,w:500,size:12.5,track:3.0,a:0.6,col:C.mute});
  const n=Math.round(lerp(0,58,eOut(T(t,7.0,7.62))));
  txt(String(n).padStart(2,'0'),124,1238,{fam:MONO,w:600,size:72,track:-1,col:BANDS[2].col});
  const nwd=mw(String(n).padStart(2,'0'),{fam:MONO,w:600,size:72,track:-1});
  txt('µg/m³',124+nwd+20,1238,{fam:MONO,w:400,size:24,a:0.62,col:C.mute});
  txt('PM10 · HOURLY MEAN',124+nwd+20,1202,{fam:MONO,w:500,size:12.5,track:2.2,a:0.55,col:C.mute});
  ctx.restore();
  ctx.globalAlpha=a*lu*0.5; ctx.strokeStyle=C.faint; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(124,1276); ctx.lineTo(906,1276); ctx.stroke();
  ctx.globalAlpha=a;

  READ.forEach((r,i)=>{
    const t0=7.28+i*0.13, ru=eOut(T(t,t0,t0+0.5)), bu2=eOut4(T(t,t0+0.08,t0+0.75));
    if(ru<=0.004) return;
    const y=1334+i*52, bb=BANDS[r.band-1];
    ctx.save(); ctx.globalAlpha=a*ru;
    txt(r.k,124,y,{fam:MONO,w:500,size:17,track:0.6,col:C.fg,a:0.88});
    const bx=250,bw=430;
    ctx.fillStyle='rgba(232,237,242,0.08)'; roundRect(ctx,bx,y-12,bw,10,5); ctx.fill();
    const fw=bw*(r.v/r.scale)*bu2;
    ctx.fillStyle=bb.col; roundRect(ctx,bx,y-12,Math.max(fw,1),10,5); ctx.fill();
    if(PAT[bb.pat]&&fw>6){ctx.save();roundRect(ctx,bx,y-12,fw,10,5);ctx.clip();
      ctx.fillStyle=ctx.createPattern(PAT[bb.pat],'repeat');ctx.fillRect(bx,y-12,fw,10);ctx.restore();}
    txt(String(Math.round(r.v*bu2)),906,y,{fam:MONO,w:600,size:17,col:C.fg,align:'right'});
    txt(bb.name.toUpperCase(),836,y,{fam:MONO,w:400,size:11,track:1.4,col:bb.col,align:'right',a:0.8});
    ctx.restore();
  });
  txt('ILLUSTRATIVE VALUES — NOT A LIVE READING',124,1548,
      {fam:MONO,w:500,size:12,track:2.4,a:eOut(T(t,7.9,8.3))*0.5,col:'#f0e641'});
  ctx.restore(); ctx.restore();
}

/* ================= beat 4 — the scale stands up, then becomes a series ======= */
const RX=104,RW=816,RY=460,RH=920,SEGH=RH/6;
const GX=104,GY=540,GW=816,GH=840,VMAX=140;
const yv=v=>GY+GH-cl(v/VMAX)*GH;
/* Good sits at the bottom, so the rail already is a value axis. */
function railRect(i){return [RX,RY+(5-i)*SEGH,RW,SEGH];}
function stripeRect(i){
  const [lo,hi]=PM10[i];
  const top=yv(Math.min(hi,VMAX)), bot=yv(Math.max(lo-1,0));
  return [GX,top,GW,Math.max(bot-top,0)];
}
function beat4(t){
  const morph=eInOut(T(t,10.98,11.5));
  const out=1-T(t,11.98,12.3);
  if(out<=0.004) return;
  for(let i=0;i<6;i++){
    const b=BANDS[i], tgt=railRect(i);
    let r0;
    if(i===2){ const u=eInOut(T(t,8.98,9.78));
      r0=[lerp(CBX,tgt[0],u),lerp(CBY,tgt[1],u),lerp(CBW,tgt[2],u),lerp(CBH,tgt[3],u)];
      if(u<=0) continue;
    } else {
      const t0=9.58+Math.abs(i-2)*0.10, u=eOut(T(t,t0,t0+0.52));
      if(u<=0) continue;
      const c0=railRect(2)[1]+SEGH/2;
      r0=[RX,lerp(c0,tgt[1],u),RW,lerp(0,SEGH,u)];
    }
    const s1=stripeRect(i);
    const rr=[lerp(r0[0],s1[0],morph),lerp(r0[1],s1[1],morph),lerp(r0[2],s1[2],morph),lerp(r0[3],s1[3],morph)];
    let a=out*lerp(1,0.13,morph);
    if(i>=4) a*=lerp(1,0,T(t,11.0,11.35));
    if(rr[3]<=0.4||a<=0.004) continue;
    bandFill(ctx,rr[0],rr[1],rr[2],rr[3],b,a,1-morph*0.85);
    const la=out*(1-morph)*eOut(T(t,9.95,10.45));
    if(la>0.01&&morph<0.98){
      const cy=rr[1]+rr[3]/2;
      txt(b.name,rr[0]+28,cy+9,{fam:DISP,w:600,size:27,track:-0.4,a:la,col:b.on});
      txt(i===5?PM10[i][0]+'+':PM10[i][0]+'–'+PM10[i][1],rr[0]+rr[2]-28,cy+6,
          {fam:MONO,w:500,size:14,track:1.4,a:la*0.8,col:b.on,align:'right'});
    }
  }
  const ha=out*(1-morph);
  if(ha>0.01){
    txt('THE EUROPEAN AIR QUALITY SCALE',RX,RY-76,{fam:MONO,w:500,size:13,track:3.2,a:ha*eOut(T(t,9.5,10.0))*0.8,col:C.glass});
    txt('PM10 · µg/m³ · HOURLY',RX,RY-48,{fam:MONO,w:400,size:12.5,track:2.2,a:ha*eOut(T(t,9.6,10.1))*0.5,col:C.mute});
    const nu=eInOut(T(t,10.22,11.0));
    if(nu>0){
      const b3=railRect(2), f58=(58-PM10[2][0])/(PM10[2][1]-PM10[2][0]);
      const ny=lerp(RY+RH-6,b3[1]+b3[3]*(1-f58),nu);
      ctx.save(); ctx.globalAlpha=ha;
      ctx.strokeStyle=C.fg; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(RX-22,ny); ctx.lineTo(RX+RW+22,ny); ctx.stroke();
      const lbl='MSIDA · PM10 58', wdt=mw(lbl,{fam:MONO,w:600,size:14,track:2})+34;
      roundRect(ctx,540-wdt/2,ny-16,wdt,32,16); ctx.fillStyle=C.fg; ctx.fill();
      txt(lbl,540,ny+5,{fam:MONO,w:600,size:14,track:2,col:'#0b1015',align:'center'});
      ctx.restore();
    }
  }
  const ca=out*eOut(T(t,11.32,11.62));
  if(ca<=0.004) return;
  ctx.save(); ctx.globalAlpha=ca;
  for(let i=0;i<6;i++){
    const [lo,hi]=PM10[i], top=yv(Math.min(hi,VMAX)), bot=yv(Math.max(lo-1,0));
    if(bot-top<20) continue;
    const b=BANDS[i];
    ctx.globalAlpha=ca*0.40; ctx.strokeStyle=b.col; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(GX,top); ctx.lineTo(GX+GW,top); ctx.stroke();
    txt(b.name.toUpperCase(),GX+GW-16,(top+bot)/2+4,{fam:MONO,w:500,size:12,track:1.6,a:ca*0.62,col:b.col,align:'right'});
  }
  ctx.globalAlpha=ca;
  [0,50,100].forEach(v=>{
    txt(String(v),GX+14,yv(v)-10,{fam:MONO,w:400,size:12,track:1.2,a:ca*0.45,col:C.mute});
  });
  ctx.strokeStyle=C.hair; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(GX,GY+GH); ctx.lineTo(GX+GW,GY+GH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(GX,GY); ctx.lineTo(GX,GY+GH); ctx.stroke();

  const SPLIT=GX+GW*0.60;
  const hx=j=>GX+j/47*(SPLIT-GX);
  const pts=HIST.map((v,j)=>[hx(j),yv(v)]);
  const wipe=eOut(T(t,11.36,11.80));
  ctx.save(); ctx.beginPath(); ctx.rect(GX-4,GY-40,(SPLIT-GX+8)*wipe,GH+80); ctx.clip();
  ctx.beginPath(); ctx.moveTo(pts[0][0],GY+GH);
  pts.forEach(p=>ctx.lineTo(p[0],p[1])); ctx.lineTo(pts[47][0],GY+GH); ctx.closePath();
  const ag=ctx.createLinearGradient(0,GY,0,GY+GH);
  ag.addColorStop(0,'rgba(111,211,172,0.42)'); ag.addColorStop(1,'rgba(111,211,172,0.02)');
  ctx.fillStyle=ag; ctx.fill();
  ctx.beginPath(); pts.forEach((p,j)=>j?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  ctx.strokeStyle='rgba(111,211,172,0.25)'; ctx.lineWidth=9; ctx.stroke();
  ctx.strokeStyle=C.glass; ctx.lineWidth=2.8; ctx.stroke();
  ctx.restore();
  const hp=pts[Math.min(47,Math.floor(wipe*47))];
  if(wipe>0.02){ctx.fillStyle=C.fg;ctx.beginPath();ctx.arc(hp[0],hp[1],4.5,0,7);ctx.fill();}

  const fw=eOut(T(t,11.62,12.02));
  if(fw>0.01){
    const fx=j=>SPLIT+(j+1)/5*(GX+GW-14-SPLIT);
    const fp=FCST.map((v,j)=>[fx(j),yv(v)]);
    ctx.save(); ctx.beginPath(); ctx.rect(SPLIT-2,GY-40,(GX+GW-SPLIT+6)*fw,GH+80); ctx.clip();
    ctx.beginPath(); ctx.moveTo(SPLIT,yv(HIST[47]-4));
    fp.forEach((p,j)=>ctx.lineTo(p[0],yv(FCST[j]-7-j*1.9)));
    for(let j=fp.length-1;j>=0;j--) ctx.lineTo(fp[j][0],yv(FCST[j]+7+j*1.9));
    ctx.closePath(); ctx.fillStyle='rgba(143,180,255,0.17)'; ctx.fill();
    ctx.strokeStyle='rgba(143,180,255,0.24)'; ctx.lineWidth=1; ctx.stroke();
    ctx.setLineDash([9,7]);
    ctx.beginPath(); ctx.moveTo(SPLIT,yv(HIST[47])); fp.forEach(p=>ctx.lineTo(p[0],p[1]));
    ctx.strokeStyle=C.cobalt; ctx.lineWidth=2.4; ctx.stroke(); ctx.setLineDash([]);
    fp.forEach(p=>{ctx.fillStyle=C.cobalt;ctx.beginPath();ctx.arc(p[0],p[1],3.6,0,7);ctx.fill();});
    ctx.restore();
    ctx.globalAlpha=ca*0.35; ctx.setLineDash([3,6]); ctx.strokeStyle=C.fg; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(SPLIT,GY-24); ctx.lineTo(SPLIT,GY+GH); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha=ca;
  }
  txt('48 HOURS OBSERVED',GX,GY-26,{fam:MONO,w:500,size:13,track:2.6,a:ca*0.72,col:C.glass});
  txt('5-DAY MODELLED OUTLOOK',GX+GW,GY-26,{fam:MONO,w:500,size:13,track:2.6,a:ca*fw*0.72,col:C.cobalt,align:'right'});
  txt('ILLUSTRATIVE SERIES — NOT A LIVE FORECAST',GX,GY+GH+40,{fam:MONO,w:500,size:12,track:2.4,a:ca*0.42,col:'#f0e641'});
  ctx.restore();
}

/* ================= beat 5 — lockup ================= */
const WMY=938, WMS=0.75;
function reform(t){
  const a=T(t,11.98,12.24)*(1-T(t,13.10,13.58));
  if(a<=0.004) return;
  ctx.save();
  for(let i=0;i<NP;i++){
    const p=P[i];
    const s0x=lerp(GX-20,GX+GW+20,h(i,31.7)), s0y=lerp(GY-40,GY+GH+40,h(i,37.1));
    const burst=eOut(T(t,11.98,12.62));
    const bx=s0x+(s0x-540)*0.26*burst+Math.sin(t*2.1+p.ph)*12;
    const by=s0y+(s0y-940)*0.34*burst+Math.cos(t*2.1+p.ph)*12;
    const st=p.st*0.34;
    const m=eExpo(T(t,12.16+st,13.06+st));
    const wp=WORD[i%WORD.length];
    const tx=540+(wp[0]-700)*WMS, ty=WMY+(wp[1]-146)*WMS;
    const x=lerp(bx,tx,m), y=lerp(by,ty,m);
    ctx.globalAlpha=a*(0.3+p.r5*0.7)*lerp(0.7,1,m);
    ctx.fillStyle=m>0.6?'#dfe8ef':(p.r4>0.6?C.glass:'#8fa6b6');
    const s=p.sz*lerp(1,1.35,m);
    ctx.fillRect(x,y,s,s);
  }
  ctx.restore();
}
function endcard(t){
  const wa=T(t,13.04,13.46);
  if(wa>0.004){
    ctx.save(); ctx.globalAlpha=wa;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.letterSpacing='-3px'; ctx.font='700 150px "Space Grotesk"';
    ctx.fillStyle=C.fg; ctx.fillText('maqua.app',540,WMY);
    ctx.letterSpacing='0px'; ctx.restore();
  }
  const ta=eOut(T(t,13.34,13.78));
  if(ta>0.004){
    ctx.save();
    ctx.globalAlpha=ta*0.6; ctx.strokeStyle=C.hair; ctx.lineWidth=1;
    const hw=lerp(0,300,eOut(T(t,13.34,13.9)));
    ctx.beginPath(); ctx.moveTo(540-hw,1030); ctx.lineTo(540+hw,1030); ctx.stroke();
    ctx.restore();
    txt('Live readings, forecasts and context',540,1084,{fam:SANS,w:400,size:26,a:ta*0.82,col:C.mute,align:'center'});
    txt('for Malta and Gozo.',540,1122,{fam:SANS,w:400,size:26,a:ta*0.82,col:C.mute,align:'center'});
  }
  const ca=eOut(T(t,13.62,14.06));
  if(ca>0.004){
    txt('OFFICIAL EEA DATA · FIVE ERA STATIONS',540,1188,{fam:MONO,w:500,size:13,track:2.6,a:ca*0.5,col:C.glass,align:'center'});
    txt('NEXT.JS 16 · REACT 19 · TYPESCRIPT · MIT',540,1218,{fam:MONO,w:500,size:13,track:2.6,a:ca*0.5,col:C.glass,align:'center'});
    txt('COASTLINE © OPENSTREETMAP CONTRIBUTORS, ODbL',540,1258,
        {fam:MONO,w:400,size:11,track:2.0,a:ca*0.3,col:C.mute,align:'center'});
  }
}

/* ================= beat 1 ================= */
function ghostTitle(t){
  const a=T(t,0.55,1.35)*(1-T(t,2.1,2.7));
  if(a<=0.004) return;
  const sc=lerp(0.94,1.04,eOut(T(t,0.55,2.7)));
  ctx.save();
  ctx.translate(540,900); ctx.scale(sc,sc);
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.letterSpacing='-7px'; ctx.font='700 250px "Space Grotesk"';
  ctx.globalAlpha=a*0.05; ctx.fillStyle=C.fg; ctx.fillText('MALTA',0,0);
  ctx.globalAlpha=a*0.30; ctx.lineWidth=1.6; ctx.strokeStyle='rgba(111,211,172,0.9)';
  ctx.strokeText('MALTA',0,0);
  ctx.letterSpacing='0px'; ctx.restore();
}
function beat1Text(t){
  const a=T(t,0.7,1.1)*(1-T(t,2.3,2.72));
  if(a<=0.004) return;
  txt('WHAT THE AIR OVER MALTA IS MADE OF',SAFE_L,1304,
    {fam:MONO,w:400,size:13,track:2.8,a:a*eOut(T(t,1.5,2.0))*0.5,col:C.mute});
  typeOn('PM2.5 · PM10 · NO₂ · O₃ · SO₂',SAFE_L,1360,
    {fam:MONO,w:500,size:30,track:2.6,a:a,col:C.glass},T(t,0.78,1.62));
}

/* ================= main ================= */
function render(t,fi){
  ctx.setTransform(1,0,0,1,0,0);
  const bgg=ctx.createRadialGradient(540,900,120,540,900,1500);
  bgg.addColorStop(0,'#101a23'); bgg.addColorStop(1,C.bgDeep);
  ctx.fillStyle=bgg; ctx.fillRect(0,0,W,H);

  const c=camAt(t);
  const mapA=(1-T(t,8.95,9.7));
  /* keep the grid inside whatever band the map currently occupies, so its
     labels never land on the headline, the panel or the station list */
  const gu=eInOut(T(t,5.45,6.78));
  GRAT.y0=lerp(600,300,gu); GRAT.y1=lerp(1200,830,gu); GRAT.lonLabY=GRAT.y1-14;
  ghostTitle(t);
  graticule(c,0.62*T(t,0.3,1.5)*mapA);
  radar(c,0.55*T(t,3.1,3.9)*mapA,t);
  islands(c,T(t,2.30,2.52)*mapA,T(t,2.34,3.55),eOut(T(t,2.9,3.95)));
  dust(t,c);
  netRows(t,c);
  netColumn(t);
  card(t,c);
  beat4(t);
  beat1Text(t);
  reform(t);
  logo(t,540,672,118);
  endcard(t);
  sweep(t);
  vignette();
  scrims();
  hud(t);
  grain(fi);
  const fin=1-T(t,0,0.26);
  if(fin>0){ ctx.fillStyle='#000'; ctx.globalAlpha=fin; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }
}

/* ================= scene ================= */
function sceneInit(){
  GRAT={x0:80,x1:1000,y0:300,y1:1560,lonLabY:1548,latLabX:88};
  LANDGRAD=[520,1500];
  const mp=proj(MSIDA.lon,MSIDA.lat);
  CAM3=cam(mp[0],mp[1],620,580,2400);
  CAM4=cam(mp[0],mp[1],500,420,1700);
}
window.__boot();
