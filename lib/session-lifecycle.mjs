import {readFile} from 'node:fs/promises';
export function watchSession(lease, close, interval = 500) {
  let checking=false, stopped=false;
  const timer=setInterval(async()=>{
    if(checking || stopped)return; checking=true;
    try {
      if(lease.path && JSON.parse(await readFile(lease.path,'utf8')).token!==lease.token)throw Error('Session replaced');
      if(lease.ownerPid)process.kill(lease.ownerPid,0);
    } catch(error) { if(error.code!=='EPERM'){stop();await close();} }
    finally {checking=false;}
  },interval);
  function stop(){stopped=true;clearInterval(timer);}
  return stop;
}

// Fallback ownership when no trusted agent session hook is available. This is an
// inactivity lease refreshed by the browser, not a fixed post-submission lifetime.
export function browserPresence(close,{timeout=120000,interval=1000,now=Date.now}={}){
 let lastSeen=now(),timer=null,closed=false;
 const touch=()=>{lastSeen=now();};
 const stop=()=>{clearInterval(timer);timer=null;};
 const start=()=>{if(timer||closed)return;touch();timer=setInterval(async()=>{if(now()-lastSeen<timeout||closed)return;closed=true;stop();await close();},interval);};
 return {touch,start,stop};
}
