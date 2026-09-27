import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=new URL('.',import.meta.url).pathname;
const MT={'.html':'text/html','.js':'text/javascript','.json':'application/json','.ttf':'font/ttf'};
export function serve(){return new Promise(res=>{
  const s=http.createServer((rq,rp)=>{
    const f=path.join(ROOT,decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/,''));
    if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rp.writeHead(404).end();return;}
    rp.writeHead(200,{'content-type':MT[path.extname(f)]||'application/octet-stream'});
    fs.createReadStream(f).pipe(rp);
  });
  s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));
});}
