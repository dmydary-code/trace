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
