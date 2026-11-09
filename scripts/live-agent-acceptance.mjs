// Human-assisted acceptance with an actual host. No model calls or plugin/config mutations.
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {writeFile,readFile,readdir,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fixture,eventually,freePort} from '../tests/support/harness.mjs';
import {projects} from '../tests/support/projects.mjs';
const [language,agent]=process.argv.slice(2);
if(!projects.some(p=>p.id===language)||!['codex','claude'].includes(agent))throw Error('Usage: npm run test:live -- javascript|typescript|java|kotlin|go|python|rust|csharp|swift|cpp codex|claude');
const f=await fixture(language),rl=createInterface({input:stdin,output:stdout});const deadline=10*60*1000;
try{
 console.log('LIVE acceptance: '+language+' / '+agent+'\nRepository: '+f.repo+'\nOpen a new '+agent+' session in this repository, enable the Trace hooks, and invoke the real Trace review skill. Do not reuse an unrelated user project.');
 const hostVersion=await rl.question('Actual host version: '),url=(await rl.question('Paste the exact viewer URL printed by that agent: ')).trim();
 if(!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url))throw Error('Expected the exact loopback viewer URL');
 const remote=await(await fetch(url+'/api/session')).json();if(remote.repositoryPath!==f.repo)throw Error('Viewer belongs to another repository');
 console.log('Add a comment on an added line and a deleted line. Request inclusion of the shipping parameter instead of + 1. Send the review; let the agent apply the correction and reply to both threads.');
 const gitDir=await f.git('rev-parse','--absolute-git-dir');
 const getReview=async()=>{
  const data=JSON.parse(await readFile(join(gitDir,'trace','latest.json'),'utf8'));const dir=join(gitDir,'trace','reviews',data.id,'replies');const files=await readdir(dir);data.replies=await Promise.all(files.filter(p=>p.endsWith('.json')).map(p=>readFile(join(dir,p),'utf8').then(JSON.parse)));return data;
 };
 const review=await eventually(async()=>{const r=await getReview();return r.comments.length>=2&&r.comments.some(c=>c.side==='old')&&r.comments.some(c=>c.side==='new')&&r.comments.every(c=>r.replies.some(a=>a.commentId===c.id&&a.author.name===(agent==='codex'?'Codex':'Claude')))&&await f.read(f.project.path)===f.project.fixed?r:null;},'No complete live edit/reply cycle',deadline);
 console.log('Inspect latest changes and Approve in the viewer.');
 await eventually(()=>readFile(join(gitDir,'trace','reviews',review.id,'completion.json'),'utf8').then(JSON.parse),'Approval not recorded',deadline);
 console.log('Now invoke /clear in that agent. The old viewer must stop.');
 await eventually(()=>fetch(url).then(()=>false,()=>true),'Viewer still reachable after clear',deadline);await freePort(url);
 const result={language,agent,hostVersion,reviewId:review.id,status:'passed',checks:['real skill launch','two-sided comments','exact requested patch','actual agent replies','approval','clear closes viewer and port'],notChecked:['normal exit','owner crash','picker autocomplete','physical pinch']};
 const dest=resolve('test-results/live-'+language+'-'+agent+'.json');await mkdir(resolve('test-results'),{recursive:true});await writeFile(dest,JSON.stringify(result,null,2)+'\n');console.log('Live acceptance saved: '+dest);
}finally{rl.close();await f.dispose();}
