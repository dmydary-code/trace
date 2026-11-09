// Run every suite even when an acceptance contract fails. Return a real failure.
import {spawnSync} from 'node:child_process';
let failed=false;
for(const script of ['test','test:browser','test:acceptance','test:browser:acceptance']){
 const result=spawnSync('npm',['run',script],{stdio:'inherit'});
 if(result.error || result.status!==0)failed=true;
}
process.exitCode=failed?1:0;
