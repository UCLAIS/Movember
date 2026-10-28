import http from 'node:http';
import worker from '../worker/index.js';
import {mkdirSync} from 'node:fs';
import {localD1} from './local-d1.mjs';
mkdirSync(new URL('../.local/',import.meta.url),{recursive:true});
const env={DB:localD1(new URL('../.local/leaderboard.sqlite',import.meta.url).pathname)};
const portFlag=process.argv.indexOf('--port');
const port=Number(portFlag>=0?process.argv[portFlag+1]:(process.env.PORT||3000));
http.createServer(async(incoming,outgoing)=>{
 try{
  // Local previews do not trust caller-supplied platform identity headers.
  const headers=new Headers(incoming.headers);
  for(const name of [...headers.keys()])if(name.startsWith('oai-authenticated-'))headers.delete(name);
  const body=['GET','HEAD'].includes(incoming.method)?undefined:await Array.fromAsync(incoming).then(parts=>Buffer.concat(parts));
  const request=new Request('http://'+(incoming.headers.host||'localhost')+incoming.url,{method:incoming.method,headers,body});
  const response=await worker.fetch(request,env);
  outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
 }catch{outgoing.writeHead(500,{'content-type':'text/plain'});outgoing.end('Request failed.');}
}).listen(port,'0.0.0.0',()=>console.log('Fundraising reader listening on '+port));
