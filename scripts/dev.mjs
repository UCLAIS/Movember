import http from 'node:http';
import worker from '../worker/index.js';
const portFlag=process.argv.indexOf('--port');
const port=Number(portFlag>=0?process.argv[portFlag+1]:(process.env.PORT||3000));
http.createServer(async(incoming,outgoing)=>{
 try{
  const request=new Request('http://'+(incoming.headers.host||'localhost')+incoming.url,{method:incoming.method,headers:incoming.headers});
  const response=await worker.fetch(request);
  outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
 }catch{outgoing.writeHead(500,{'content-type':'text/plain'});outgoing.end('Request failed.');}
}).listen(port,'0.0.0.0',()=>console.log('Fundraising reader listening on '+port));
