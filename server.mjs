import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {parseDiff,reviewPrompt} from './dist/core.mjs';
const exec=promisify(execFile),root=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]};
const repo=resolve(option('--repo',process.cwd())),port=Number(option('--port','4173')),base=option('--base','HEAD'),agent=option('--agent',null);
if(agent&&agent!=='codex')throw new Error('Supported agent: --agent codex');
const git=(...a)=>exec('git',['-C',repo,...a],{maxBuffer:10*1024*1024}).then(r=>r.stdout);
await git('rev-parse','--show-toplevel');
const ref=(await git('rev-parse','--verify',`${base}^{commit}`)).trim();
const token=randomBytes(24).toString('hex'),jobs=new Map();let running=false;
const gitDir=(await git('rev-parse','--absolute-git-dir')).trim();
async function snapshot(){const diff=await git('-c','core.quotePath=false','diff','--no-ext-diff','--no-textconv','--no-color','--unified=4',ref,'--');const head=(await git('rev-parse','HEAD')).trim();return {repo:basename(repo),branch:(await git('branch','--show-current')).trim()||head.slice(0,7),base,revision:createHash('sha256').update(head+'\n'+diff).digest('hex'),files:parseDiff(diff),agent,token}}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>200000)throw new Error('Review is too large')}return JSON.parse(data)}
const server=http.createServer(async(req,res)=>{try{
 const expectedHost=`127.0.0.1:${port}`;
 if(req.headers.host!==expectedHost&&req.headers.host!==`localhost:${port}`)return json(res,403,{error:'Invalid Host'});
 const url=new URL(req.url,`http://${expectedHost}`);
 if(req.method==='GET'&&url.pathname==='/api/session')return json(res,200,await snapshot());
 if(req.method==='GET'&&url.pathname.startsWith('/api/jobs/')){const job=jobs.get(url.pathname.split('/').at(-1));return json(res,job?200:404,job||{error:'Job not found'})}
 if(req.method==='POST'&&url.pathname==='/api/reviews'){
  if(req.headers['x-trace-token']!==token||req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Open the review on the local server'});
  if(!agent)return json(res,409,{error:'Start the server with --agent codex'});
  if(running)return json(res,409,{error:'Wait for the running job'});
  const input=await body(req),current=await snapshot();
  if(input.revision!==current.revision)return json(res,409,{error:'Code has changed. Refresh the diff and review your comments.'});
  if(!Array.isArray(input.comments)||!input.comments.length||input.comments.length>100)return json(res,400,{error:'Line comments are required'});
  const comments=input.comments.map(c=>{const f=current.files.find(f=>f.path===c.path),l=f?.lines[c.index];if(!l||l.kind==='hunk'||c.line!==(l.new??l.old)||c.side!==(l.kind==='del'?'old':'new')||typeof c.body!=='string'||!c.body.trim()||c.body.length>10000)throw new Error('Invalid comment anchor');return {path:f.path,line:l.new??l.old,side:l.kind==='del'?'old':'new',code:l.text,body:c.body}});
  if(input.instruction&&typeof input.instruction!=='string')throw new Error('Invalid instructions');
  const review={schemaVersion:1,revision:current.revision,repo,comments,instruction:(input.instruction||'').slice(0,10000)},id=randomUUID(),dir=join(gitDir,'trace',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'review.json'),JSON.stringify(review,null,2));
  const job={id,status:'running',output:''};jobs.set(id,job);running=true;
  const child=spawn('codex',['exec','--sandbox','workspace-write','-C',repo,'--color','never','-o',join(dir,'result.txt'),'-'],{stdio:['pipe','ignore','pipe']});
  child.stdin.on('error',()=>{});child.stdin.end(reviewPrompt(review)+'\n\nAdditional instructions:\n'+review.instruction);
  child.stderr.on('data',c=>job.output=(job.output+c.toString()).slice(-16000));
  child.on('error',err=>{job.status='failed';job.output=err.message;running=false});
  child.on('close',async code=>{if(job.status==='failed')return;job.status=code===0?'succeeded':'failed';try{job.output=await readFile(join(dir,'result.txt'),'utf8')}catch{}running=false});
  return json(res,202,{id});
 }
 if(req.method!=='GET')return json(res,405,{error:'Method not supported'});
 const allowed={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/core.mjs':'core.mjs','/demo.mjs':'demo.mjs'};const file=allowed[url.pathname];if(!file)return json(res,404,{error:'Not found'});
 const content=await readFile(join(root,'dist',file));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
 }catch(err){json(res,400,{error:err.message})}});
server.listen(port,'127.0.0.1',()=>console.log(`Trace: http://127.0.0.1:${port}\nRepository: ${repo}\nAgent: ${agent||'export only'}`));
