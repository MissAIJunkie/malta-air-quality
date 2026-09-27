/* maqua.app — 15s motion reel, 16:9. Scene for core.js.
   Pure function of t: no rAF, no Date, no state accumulated between frames. */
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
function hud(t){
  const M=68, a=T(t,0.18,0.95)*(1-T(t,14.55,15.0)*0.0);
  /* corner brackets */
  ctx.save();
  ctx.strokeStyle='rgba(232,237,242,0.28)'; ctx.lineWidth=1.5;
  const L=lerp(10,34,eOut(T(t,0.2,1.1)));
  [[M,M,1,1],[W-M,M,-1,1],[M,H-M,1,-1],[W-M,H-M,-1,-1]].forEach(([x,y,dx,dy])=>{
    ctx.globalAlpha=a*0.9;ctx.beginPath();ctx.moveTo(x+dx*L,y);ctx.lineTo(x,y);ctx.lineTo(x,y+dy*L);ctx.stroke();
  });
  /* tick rail, top edge */
  ctx.globalAlpha=a*0.5;
  for(let i=0;i<=40;i++){const x=lerp(M+40,W-M-40,i/40);const tall=i%5===0;
    ctx.strokeStyle='rgba(232,237,242,'+(tall?0.30:0.14)+')';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x,M-9);ctx.lineTo(x,M-9-(tall?8:4));ctx.stroke();}
  ctx.restore();

  const HI=M+42;
  txt('MAQUA.APP',HI,M+4,{fam:MONO,w:600,size:15,track:3.4,a:a,col:C.fg});
  txt('MALTA AIR QUALITY',HI,M+26,{fam:MONO,w:400,size:11.5,track:2.6,a:a*0.55,col:C.mute});
  txt('EEA EUROPEAN AQI · DIRECTIVE 2008/50/EC',W-HI,M+4,{fam:MONO,w:400,size:11.5,track:2.2,a:a*0.55,col:C.mute,align:'right'});
  txt('35.9375°N   14.3754°E',W-HI,H-M-6,{fam:MONO,w:400,size:11.5,track:2.2,a:a*0.55,col:C.mute,align:'right'});

  /* beat label — cross-dissolving, with a 2px chromatic split on entry */
  for(let i=0;i<LBL.length;i++){
    const [s,e]=LBL[i]; if(t<s-0.05||t>e+0.35) continue;
    const inn=T(t,s,s+0.30), out=1-T(t,e,e+0.22);
    const al=a*inn*out; if(al<=0.002) continue;
    const dx=M+42+lerp(16,0,eOut(inn)), split=(1-inn)*7;
    const dy=lerp(15,0,eOut(inn))+lerp(0,-15,1-out);
    const o={fam:MONO,w:500,size:13,track:2.8,base:'alphabetic'};
    ctx.save(); ctx.translate(0,dy);
    if(split>0.3){
      ctx.globalCompositeOperation='lighter';
      txt(B[i].l,dx-split,H-M-6,Object.assign({},o,{a:al*0.5,col:'#ff3860'}));
      txt(B[i].l,dx+split,H-M-6,Object.assign({},o,{a:al*0.5,col:'#39e0ff'}));
      ctx.globalCompositeOperation='source-over';
    }
    txt(B[i].l,dx,H-M-6,Object.assign({},o,{a:al,col:C.fg}));
    /* progress hairline under the label */
    const wdt=mw(B[i].l,o);
    ctx.globalAlpha=al*0.5;ctx.fillStyle=C.glass;
    ctx.fillRect(dx,H-M+4,wdt*cl((t-s)/(e-s)),1.5);ctx.globalAlpha=1;
    ctx.restore();
  }
}


/* ================= map ================= */
const CAM2=cam(0,0,560,562,2100);
let CAM3=null, CAM4=null;
function camAt(t){
  if(t<5.45) return CAM2;
  if(t<6.78) return lerpCam(CAM2,CAM3,eInOut(T(t,5.45,6.78)));
  if(t<8.95){const u=T(t,6.78,8.95);return cam(CAM3.fx,CAM3.fy,CAM3.ax-u*26,CAM3.ay-u*10,CAM3.s*(1+u*0.055));}
  return lerpCam(cam(CAM3.fx,CAM3.fy,CAM3.ax-26,CAM3.ay-10,CAM3.s*1.055),CAM4,eInOut(T(t,8.95,9.9)));
}

/* ================= beat 2 — the network ================= */
const RAILX=958, COLX=1000, ROW0=536, ROWDY=72;
function netColumn(t){
  const a=T(t,2.62,3.15)*(1-T(t,5.62,6.18));
  if(a<=0.004) return;
  txt('THE MONITORING NETWORK',COLX,264,{fam:MONO,w:500,size:12,track:3.2,a:a*0.8,col:C.glass});
  ['Five stations.','Two islands.'].forEach((s,i)=>{
    const u=eOut(T(t,2.78+i*0.14,3.42+i*0.14));
    ctx.save();ctx.globalAlpha=a*u;
    txt(s,COLX,336+i*66,{fam:DISP,w:700,size:58,track:-1.5,col:C.fg});
    ctx.restore();
  });
  txt("Operated by Malta's Environment & Resources Authority.",COLX,448,
      {fam:SANS,w:400,size:19,a:a*eOut(T(t,3.15,3.7))*0.72,col:C.mute});
  txt('ILLUSTRATIVE BANDS — NOT LIVE READINGS',COLX,ROW0+5*ROWDY-8,
      {fam:MONO,w:500,size:11,track:2.4,a:a*eOut(T(t,4.1,4.6))*0.42,col:'#f0e641'});
}
function netRows(t,c){
  const aCol=T(t,2.62,3.15)*(1-T(t,5.62,6.18));
  ST.forEach((s,i)=>{
    const t0=2.95+i*0.115;
    const pop=eOut(T(t,t0,t0+0.55));
    const dim=T(t,5.3,5.9)*(s===MSIDA?0:1);
    const mk=marker(c,s,T(t,t0,t0+0.3)*(1-T(t,8.95,9.55)),pop,dim,t-t0);
    if(aCol<=0.004||!mk) return;
    const ry=ROW0+i*ROWDY, ra=aCol*eOut(T(t,t0+0.12,t0+0.7));
    const b=BANDS[s.band-1];
    /* leader line: marker -> rail -> row */
    const segs=[[mk[0],mk[1]],[RAILX,mk[1]],[RAILX,ry-8],[COLX-16,ry-8]];
    let tot=0; for(let k=1;k<segs.length;k++) tot+=Math.hypot(segs[k][0]-segs[k-1][0],segs[k][1]-segs[k-1][1]);
    const drawn=tot*eOut(T(t,t0+0.18,t0+0.85));
    ctx.save(); ctx.globalAlpha=ra*0.55; ctx.strokeStyle=b.col; ctx.lineWidth=1.1;
    ctx.beginPath(); ctx.moveTo(segs[0][0],segs[0][1]); let acc=0;
    for(let k=1;k<segs.length;k++){
      const d=Math.hypot(segs[k][0]-segs[k-1][0],segs[k][1]-segs[k-1][1]);
      const f=cl((drawn-acc)/d);
      ctx.lineTo(lerp(segs[k-1][0],segs[k][0],f),lerp(segs[k-1][1],segs[k][1],f));
      acc+=d; if(f<1) break;
    }
    ctx.stroke(); ctx.restore();
    /* row */
    const dx=lerp(26,0,eOut(T(t,t0+0.12,t0+0.72)));
    ctx.save(); ctx.globalAlpha=ra;
    ctx.strokeStyle=C.faint; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(COLX+dx,ry+22); ctx.lineTo(W-68,ry+22); ctx.stroke();
    bandFill(ctx,COLX+dx,ry-22,22,22,b,ra);
    ctx.globalAlpha=ra;
    txt(s.n,COLX+dx+38,ry,{fam:DISP,w:600,size:27,track:-0.5,col:C.fg});
    txt(s.id+' · '+s.ty.toUpperCase()+' · '+s.isl.toUpperCase()+' · '+s.alt+' M',
        W-68,ry-2,{fam:MONO,w:400,size:12,track:1.8,a:0.58,col:C.mute,align:'right'});
    ctx.restore();
  });
}

/* ================= beat 3 — the reading ================= */
const CX0=1000,CY0=232,CW0=848,CH0=616;
const CBX=1044,CBY=372,CBW=760,CBH=72;
function card(t,c){
  const u=eOut(T(t,5.72,6.42)), a=T(t,5.72,6.0)*(1-T(t,8.96,9.28));
  if(a<=0.004) return;
  /* hairline tying the selected marker to its panel */
  const mp2=proj(MSIDA.lon,MSIDA.lat), mx=sx(c,mp2), my=sy(c,mp2);
  const cu=eOut(T(t,5.66,6.18));
  if(cu>0.01&&mx<CX0-30){
    ctx.save(); ctx.globalAlpha=a*0.45; ctx.strokeStyle=BANDS[2].col; ctx.lineWidth=1.1;
    ctx.beginPath(); ctx.moveTo(mx,my);
    ctx.lineTo(lerp(mx,CX0-60,Math.min(cu*2,1)),my);
    if(cu>0.5){ctx.lineTo(CX0-60,lerp(my,408,eOut(T(cu,0.5,0.85))));
      if(cu>0.85) ctx.lineTo(lerp(CX0-60,CX0,T(cu,0.85,1)),408);}
    ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.globalAlpha=a;
  const hh=CH0*u;
  roundRect(ctx,CX0,CY0,CW0,hh,14);
  ctx.fillStyle='rgba(20,32,44,0.62)'; ctx.fill();
  ctx.strokeStyle='rgba(232,237,242,0.14)'; ctx.lineWidth=1.2; ctx.stroke();
  ctx.save(); roundRect(ctx,CX0,CY0,CW0,hh,14); ctx.clip();
  /* wipe highlight along the growing edge */
  if(u<1){ const g=ctx.createLinearGradient(0,CY0+hh-120,0,CY0+hh);
    g.addColorStop(0,'rgba(111,211,172,0)'); g.addColorStop(1,'rgba(111,211,172,0.18)');
    ctx.fillStyle=g; ctx.fillRect(CX0,CY0+hh-120,CW0,120); }

  txt('MT00011 · TRAFFIC · URBAN · 2 M ASL',1044,290,
      {fam:MONO,w:500,size:12.5,track:2.6,a:eOut(T(t,6.1,6.55))*0.7,col:C.glass});
  const nu=eOut(T(t,6.16,6.72));
  ctx.save(); ctx.globalAlpha=a*nu;
  txt('Msida',1044,352,{fam:DISP,w:700,size:58,track:-1.6,col:C.fg});
  ctx.restore();

  /* band strip */
  const bu=eOut(T(t,6.42,6.92)), b=BANDS[2];
  if(bu>0&&t<8.98){
    ctx.save(); roundRect(ctx,CBX,CBY,CBW*bu,CBH,10); ctx.clip();
    bandFill(ctx,CBX,CBY,CBW,CBH,b,1);
    txt('MODERATE',CBX+26,CBY+CBH/2+12,{fam:DISP,w:700,size:33,track:0.4,col:b.on});
    txt('BAND 3 OF 6',CBX+CBW-26,CBY+CBH/2+6,{fam:MONO,w:600,size:12.5,track:2.2,col:b.on,align:'right',a:0.95});
    ctx.restore();
  }
  /* leading pollutant */
  const lu=eOut(T(t,6.92,7.35));
  ctx.save(); ctx.globalAlpha=a*lu;
  txt('LEADING POLLUTANT',1044,492,{fam:MONO,w:500,size:12,track:3.0,a:0.6,col:C.mute});
  const n=Math.round(lerp(0,58,eOut(T(t,7.0,7.62))));
  txt(String(n).padStart(2,'0'),1044,556,{fam:MONO,w:600,size:66,track:-1,col:BANDS[2].col});
  const nwd=mw(String(n).padStart(2,'0'),{fam:MONO,w:600,size:66,track:-1});
  txt('µg/m³',1044+nwd+18,556,{fam:MONO,w:400,size:22,a:0.62,col:C.mute});
  txt('PM10 · HOURLY MEAN',1044+nwd+18,524,{fam:MONO,w:500,size:12,track:2.2,a:0.55,col:C.mute});
  ctx.restore();
  ctx.globalAlpha=a*lu*0.5; ctx.strokeStyle=C.faint; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(1044,590); ctx.lineTo(1804,590); ctx.stroke();
  ctx.globalAlpha=a;

  /* pollutant rows */
  READ.forEach((r,i)=>{
    const t0=7.28+i*0.13, ru=eOut(T(t,t0,t0+0.5)), bu2=eOut4(T(t,t0+0.08,t0+0.75));
    if(ru<=0.004) return;
    const y=632+i*46, bb=BANDS[r.band-1];
    ctx.save(); ctx.globalAlpha=a*ru;
    txt(r.k,1044,y,{fam:MONO,w:500,size:15,track:0.6,col:C.fg,a:0.88});
    const bx=1156,bw=506;
    ctx.fillStyle='rgba(232,237,242,0.08)'; roundRect(ctx,bx,y-11,bw,9,4.5); ctx.fill();
    const fw=bw*(r.v/r.scale)*bu2;
    ctx.fillStyle=bb.col; roundRect(ctx,bx,y-11,Math.max(fw,1),9,4.5); ctx.fill();
    if(PAT[bb.pat]&&fw>6){ctx.save();roundRect(ctx,bx,y-11,fw,9,4.5);ctx.clip();
      ctx.fillStyle=ctx.createPattern(PAT[bb.pat],'repeat');ctx.fillRect(bx,y-11,fw,9);ctx.restore();}
    const vv=Math.round(r.v*bu2);
    txt(String(vv),1804,y,{fam:MONO,w:600,size:15,col:C.fg,align:'right'});
    txt(bb.name.toUpperCase(),1696,y,{fam:MONO,w:400,size:10.5,track:1.4,col:bb.col,align:'right',a:0.8});
    ctx.restore();
  });
  txt('ILLUSTRATIVE VALUES — NOT A LIVE READING',1044,820,
      {fam:MONO,w:500,size:11,track:2.4,a:eOut(T(t,7.9,8.3))*0.5,col:'#f0e641'});
  ctx.restore(); ctx.restore();
}

/* ================= beat 4 — the scale, then the series ================= */
const RX=170,RW=1580,RY=452,RH=214,SEGW=RW/6;
const GX=282,GY=346,GW=1330,GH=404,VMAX=140;
const yv=v=>GY+GH-cl(v/VMAX)*GH;
function segRect(i){return [RX+i*SEGW,RY,SEGW,RH];}
function stripeRect(i){
  const [lo,hi]=PM10[i];
  const top=yv(Math.min(hi,VMAX)), bot=yv(Math.max(lo-1,0));
  return [GX,top,GW,Math.max(bot-top,0)];
}
function beat4(t){
  const morph=eInOut(T(t,10.98,11.5));
  const out=1-T(t,11.98,12.3);
  if(out<=0.004) return;
  /* segments / stripes */
  for(let i=0;i<6;i++){
    const b=BANDS[i];
    let r0;
    if(i===2){ const u=eInOut(T(t,8.98,9.78));
      r0=[lerp(CBX,RX+2*SEGW,u),lerp(CBY,RY,u),lerp(CBW,SEGW,u),lerp(CBH,RH,u)];
      if(u<=0) continue;
    } else {
      const t0=9.58+Math.abs(i-2)*0.10, u=eOut(T(t,t0,t0+0.52));
      if(u<=0) continue;
      const c0=RX+2.5*SEGW;
      r0=[lerp(c0,RX+i*SEGW,u),RY,lerp(0,SEGW,u),RH];
    }
    const s1=stripeRect(i);
    const rr=[lerp(r0[0],s1[0],morph),lerp(r0[1],s1[1],morph),lerp(r0[2],s1[2],morph),lerp(r0[3],s1[3],morph)];
    let a=out*lerp(1,0.13,morph);
    if(i>=4) a*=lerp(1,0,T(t,11.0,11.35));
    if(rr[3]<=0.4||a<=0.004) continue;
    ctx.save(); ctx.globalAlpha=1;
    bandFill(ctx,rr[0],rr[1],rr[2],rr[3],b,a,1-morph*0.85);
    ctx.restore();
    /* names under the rail */
    const la=out*(1-morph)*eOut(T(t,9.95,10.45));
    if(la>0.01&&morph<0.98){
      const cxm=rr[0]+rr[2]/2;
      txt(b.name,cxm,RY+RH+40,{fam:DISP,w:600,size:b.name.length>9?18:21,track:-0.3,a:la,col:C.fg,align:'center'});
      txt(i===5?PM10[i][0]+'+':PM10[i][0]+'–'+PM10[i][1],cxm,RY+RH+62,
          {fam:MONO,w:400,size:11.5,track:1.4,a:la*0.55,col:C.mute,align:'center'});
    }
  }
  /* rail header + needle */
  const ha=out*(1-morph);
  if(ha>0.01){
    txt('THE EUROPEAN AIR QUALITY SCALE',RX,RY-104,{fam:MONO,w:500,size:12.5,track:3.2,a:ha*eOut(T(t,9.5,10.0))*0.8,col:C.glass});
    txt('PM10 · µg/m³ · HOURLY',RX+RW,RY-104,{fam:MONO,w:400,size:11.5,track:2.2,a:ha*eOut(T(t,9.6,10.1))*0.5,col:C.mute,align:'right'});
    const nu=eInOut(T(t,10.22,11.0));
    if(nu>0){
      const nx=lerp(RX+6,RX+2.5*SEGW,nu);
      ctx.save(); ctx.globalAlpha=ha;
      ctx.strokeStyle=C.fg; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(nx,RY-20); ctx.lineTo(nx,RY+RH+20); ctx.stroke();
      const lbl='MSIDA · PM10 58', wdt=mw(lbl,{fam:MONO,w:600,size:13,track:2})+30;
      roundRect(ctx,nx-wdt/2,RY-58,wdt,28,14); ctx.fillStyle=C.fg; ctx.fill();
      txt(lbl,nx,RY-39,{fam:MONO,w:600,size:13,track:2,col:'#0b1015',align:'center'});
      ctx.restore();
    }
  }
  /* the series */
  const ca=out*eOut(T(t,11.32,11.62));
  if(ca<=0.004) return;
  ctx.save(); ctx.globalAlpha=ca;
  /* band boundaries + names, so the stripes read as an axis and not as decoration */
  for(let i=0;i<6;i++){
    const [lo,hi]=PM10[i], top=yv(Math.min(hi,VMAX)), bot=yv(Math.max(lo-1,0));
    if(bot-top<20) continue;
    const b=BANDS[i];
    ctx.globalAlpha=ca*0.40; ctx.strokeStyle=b.col; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(GX,top); ctx.lineTo(GX+GW,top); ctx.stroke();
    txt(b.name.toUpperCase(),GX+GW+16,(top+bot)/2+4,{fam:MONO,w:500,size:10.5,track:1.6,a:ca*0.62,col:b.col});
  }
  ctx.globalAlpha=ca;
  [0,50,100].forEach(v=>{
    txt(String(v),GX-16,yv(v)+4,{fam:MONO,w:400,size:11,track:1.2,a:ca*0.45,col:C.mute,align:'right'});
  });
  txt('µg/m³',GX-16,yv(VMAX)-14,{fam:MONO,w:400,size:10.5,track:1.4,a:ca*0.4,col:C.mute,align:'right'});
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
  ctx.strokeStyle=C.glass; ctx.lineWidth=2.6; ctx.stroke();
  ctx.restore();
  /* head dot */
  const hp=pts[Math.min(47,Math.floor(wipe*47))];
  if(wipe>0.02){ctx.fillStyle=C.fg;ctx.beginPath();ctx.arc(hp[0],hp[1],4,0,7);ctx.fill();}
  /* forecast */
  const fw=eOut(T(t,11.62,12.02));
  if(fw>0.01){
    const fx=j=>SPLIT+(j+1)/5*(GX+GW-SPLIT);
    const fp=FCST.map((v,j)=>[fx(j),yv(v)]);
    const start=[SPLIT,yv(HIST[47])];
    ctx.save(); ctx.beginPath(); ctx.rect(SPLIT-2,GY-40,(GX+GW-SPLIT+6)*fw,GH+80); ctx.clip();
    ctx.beginPath(); ctx.moveTo(start[0],yv(HIST[47]-4));
    fp.forEach((p,j)=>ctx.lineTo(p[0],yv(FCST[j]-9-j*2.6)));
    for(let j=fp.length-1;j>=0;j--) ctx.lineTo(fp[j][0],yv(FCST[j]+9+j*2.6));
    ctx.closePath(); ctx.fillStyle='rgba(143,180,255,0.17)'; ctx.fill();
    ctx.strokeStyle='rgba(143,180,255,0.24)'; ctx.lineWidth=1; ctx.stroke();
    ctx.setLineDash([9,7]);
    ctx.beginPath(); ctx.moveTo(start[0],start[1]); fp.forEach(p=>ctx.lineTo(p[0],p[1]));
    ctx.strokeStyle=C.cobalt; ctx.lineWidth=2.2; ctx.stroke(); ctx.setLineDash([]);
    fp.forEach(p=>{ctx.fillStyle=C.cobalt;ctx.beginPath();ctx.arc(p[0],p[1],3.4,0,7);ctx.fill();});
    ctx.restore();
    ctx.globalAlpha=ca*0.35; ctx.setLineDash([3,6]); ctx.strokeStyle=C.fg; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(SPLIT,GY-24); ctx.lineTo(SPLIT,GY+GH); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha=ca;
  }
  txt('48 HOURS OBSERVED',GX,GY-26,{fam:MONO,w:500,size:12,track:2.6,a:ca*0.72,col:C.glass});
  txt('5-DAY MODELLED OUTLOOK',SPLIT+14,GY-26,{fam:MONO,w:500,size:12,track:2.6,a:ca*fw*0.72,col:C.cobalt});
  txt('ILLUSTRATIVE SERIES — NOT A LIVE FORECAST',GX,GY+GH+34,{fam:MONO,w:500,size:11,track:2.4,a:ca*0.42,col:'#f0e641'});
  ctx.restore();
}

/* ================= particles ================= */
function reform(t){
  const a=T(t,11.98,12.24)*(1-T(t,13.10,13.58));
  if(a<=0.004) return;
  ctx.save();
  for(let i=0;i<NP;i++){
    const p=P[i];
    const s0x=lerp(GX-20,GX+GW+20,h(i,31.7)), s0y=lerp(GY-40,GY+GH+40,h(i,37.1));
    const burst=eOut(T(t,11.98,12.62));
    const bx=s0x+(s0x-960)*0.26*burst+Math.sin(t*2.1+p.ph)*12;
    const by=s0y+(s0y-570)*0.34*burst+Math.cos(t*2.1+p.ph)*12;
    const st=p.st*0.34;
    const m=eExpo(T(t,12.16+st,13.06+st));
    const wp=WORD[i%WORD.length];
    const tx=960+(wp[0]-700)*0.74, ty=630+(wp[1]-146)*0.74;
    const x=lerp(bx,tx,m), y=lerp(by,ty,m);
    ctx.globalAlpha=a*(0.3+p.r5*0.7)*lerp(0.7,1,m);
    ctx.fillStyle=m>0.6?'#dfe8ef':(p.r4>0.6?C.glass:'#8fa6b6');
    const s=p.sz*lerp(1,1.35,m);
    ctx.fillRect(x,y,s,s);
  }
  ctx.restore();
}

/* ================= beat 5 — lockup ================= */
function endcard(t){
  const wa=T(t,13.04,13.46);
  if(wa>0.004){
    ctx.save(); ctx.globalAlpha=wa;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.letterSpacing='-2.96px'; ctx.font='700 148px "Space Grotesk"';
    ctx.fillStyle=C.fg; ctx.fillText('maqua.app',960,630);
    ctx.letterSpacing='0px'; ctx.restore();
  }
  const ta=eOut(T(t,13.34,13.78));
  if(ta>0.004){
    ctx.save();
    ctx.globalAlpha=ta*0.6; ctx.strokeStyle=C.hair; ctx.lineWidth=1;
    const hw=lerp(0,300,eOut(T(t,13.34,13.9)));
    ctx.beginPath(); ctx.moveTo(960-hw,718); ctx.lineTo(960+hw,718); ctx.stroke();
    ctx.restore();
    txt('Live readings, forecasts and context for Malta and Gozo.',960,766,
        {fam:SANS,w:400,size:26,a:ta*0.82,col:C.mute,align:'center'});
  }
  const ca=eOut(T(t,13.62,14.06));
  if(ca>0.004){
    txt('OFFICIAL EEA DATA · FIVE ERA STATIONS · NEXT.JS 16 · REACT 19 · TYPESCRIPT · MIT',
        960,816,{fam:MONO,w:500,size:12.5,track:2.6,a:ca*0.5,col:C.glass,align:'center'});
    txt('COASTLINE DERIVED FROM OPENSTREETMAP · © OPENSTREETMAP CONTRIBUTORS, ODbL',
        960,844,{fam:MONO,w:400,size:10.5,track:2.0,a:ca*0.3,col:C.mute,align:'center'});
  }
}

/* ================= beat 1 ground title ================= */
function ghostTitle(t){
  const a=T(t,0.55,1.35)*(1-T(t,2.1,2.7));
  if(a<=0.004) return;
  const sc=lerp(0.94,1.04,eOut(T(t,0.55,2.7)));
  ctx.save();
  ctx.translate(960,560); ctx.scale(sc,sc);
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.letterSpacing='-10px'; ctx.font='700 330px "Space Grotesk"';
  ctx.globalAlpha=a*0.05; ctx.fillStyle=C.fg; ctx.fillText('MALTA',0,0);
  ctx.globalAlpha=a*0.30; ctx.lineWidth=1.6; ctx.strokeStyle='rgba(111,211,172,0.9)';
  ctx.strokeText('MALTA',0,0);
  ctx.letterSpacing='0px'; ctx.restore();
}
function beat1Text(t){
  const a=T(t,0.7,1.1)*(1-T(t,2.3,2.72));
  if(a<=0.004) return;
  typeOn('PM2.5 · PM10 · NO₂ · O₃ · SO₂',68,H-160,
    {fam:MONO,w:500,size:26,track:3.2,a:a,col:C.glass},T(t,0.78,1.62));
  txt('WHAT THE AIR OVER MALTA IS MADE OF',68,H-200,
    {fam:MONO,w:400,size:12,track:2.8,a:a*eOut(T(t,1.5,2.0))*0.5,col:C.mute});
}

/* ================= scanline sweep ================= */

/* ================= main ================= */
function render(t,fi){
  ctx.setTransform(1,0,0,1,0,0);
  const bgg=ctx.createRadialGradient(760,520,120,760,520,1500);
  bgg.addColorStop(0,'#101a23'); bgg.addColorStop(1,C.bgDeep);
  ctx.fillStyle=bgg; ctx.fillRect(0,0,W,H);

  const c=camAt(t);
  const mapA=(1-T(t,8.95,9.7));
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
  logo(t,960,418,104);
  endcard(t);
  sweep(t);
  vignette();
  hud(t);
  grain(fi);
  /* opening fade-up and a whisper of a closing settle */
  const fin=1-T(t,0,0.26);
  if(fin>0){ ctx.fillStyle='#000'; ctx.globalAlpha=fin; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1; }
}


/* ---------- scene ---------- */
function sceneInit(){
  const mp=proj(MSIDA.lon,MSIDA.lat);
  CAM3=cam(mp[0],mp[1],528,596,4750);
  CAM4=cam(mp[0],mp[1],470,470,3150);
}
window.__boot();
