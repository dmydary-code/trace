import {pinCodexSource} from './pin-codex-source.mjs';
import {realpath,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {isTraceBrewMigration,stableTraceRoot} from './install-source.mjs';

const sourceOf=item=>item?.marketplaceSource?.source || item?.path || item?.installLocation || item?.root;
export async function installAgents({target,root,version,execute,log=console.log,canonical=realpath,read=readFile,pin=pinCodexSource}) {
 const source=stableTraceRoot(root), results=[];
 for(const agent of target==='all'?['codex','claude']:[target]){
  try {
   const invoke=(args)=>execute(agent,args);
   const json=async args=>JSON.parse(await invoke(args));
   let catalogs;
   try {catalogs=await json(['plugin','marketplace','list','--json']);}
   catch(error){
    const broken=error.message.match(/`trace-tools` at ([^\n]+): marketplace root does not contain a supported manifest/);
    if(!broken || !isTraceBrewMigration(broken[1],source))throw error;
    catalogs={marketplaces:[{name:'trace-tools',root:broken[1]}]};
   }
   const entries=Array.isArray(catalogs)?catalogs:catalogs.marketplaces;
   if(!Array.isArray(entries))throw new Error('Unsupported marketplace status format');
   const previous=entries.find(item=>item.name==='trace-tools');
   const oldSource=sourceOf(previous);
   if(previous && !oldSource)throw new Error('Cannot verify the existing trace-tools source');
   if(oldSource && oldSource!==source){
    const oldReal=await canonical(oldSource).catch(()=>resolve(oldSource));
    const nextReal=await canonical(source);
    if(oldReal!==nextReal && !isTraceBrewMigration(oldSource,source))throw new Error(`trace-tools points to ${oldSource}; refusing to replace an unrelated source`);
    log(`${agent}: replacing old source ${oldSource} with ${source}`);
    await invoke(['plugin','marketplace','remove','trace-tools']);
   }
   if(!previous || oldSource!==source)await invoke(['plugin','marketplace','add',source]);
   else await invoke(['plugin','marketplace',agent==='codex'?'upgrade':'update','trace-tools']);
   let operation='add';
   if(agent==='claude'){
    const installed=await json(['plugin','list','--json']);
    if(!Array.isArray(installed))throw new Error('Unsupported Claude plugin status format');
    operation=installed.some(p=>p.id==='trace@trace-tools')?'update':'install';
   }
   await invoke(['plugin',operation,'trace@trace-tools']);
   const status=await json(agent==='codex'?['plugin','list','--marketplace','trace-tools','--json']:['plugin','list','--json']);
   const plugins=Array.isArray(status)?status:status.installed;
   const plugin=plugins?.find(p=>(p.id||p.pluginId)==='trace@trace-tools');
   if(!plugin)throw new Error('Trace is missing from the installed plugin list');
   if(plugin.version!==version)throw new Error(`Plugin version ${plugin.version||'unknown'} does not match CLI ${version}`);
   if(plugin.enabled!==true)throw new Error('Trace is installed but not enabled');
   if(agent==='codex' && isTraceBrewMigration(source,source))await pin(source,canonical);
   const refreshed=await json(['plugin','marketplace','list','--json']);
   const registered=(Array.isArray(refreshed)?refreshed:refreshed.marketplaces)?.find(p=>p.name==='trace-tools');
   const registeredSource=sourceOf(registered);
   if(registeredSource!==source && !(agent==='codex' && registeredSource===await canonical(source)))throw new Error(`Source is ${registeredSource||'unknown'}, expected stable path ${source}`);
   const manifestPath=plugin.installPath ? join(plugin.installPath,agent==='claude'?'.claude-plugin/plugin.json':'.codex-plugin/plugin.json') : join(source,'plugins','trace','.codex-plugin/plugin.json');
   const manifest=JSON.parse(await read(manifestPath,'utf8'));
   if(manifest.version!==version)throw new Error(`Installed manifest ${manifest.version} does not match CLI ${version}`);
   const result={agent,ok:true,version:plugin.version,source,enabled:true};results.push(result);
   log(`${agent}: verified Trace ${version}; enabled; source ${source}. Restart the app/start a new session to load the skill.`);
  }catch(error){results.push({agent,ok:false,error:error.message});log(`${agent}: FAILED — ${error.message}`);}
 }
 return results;
}
