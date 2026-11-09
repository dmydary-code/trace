import nodeTest from 'node:test';
// Integration subprocess or network regressions must fail instead of hanging CI.
export default function test(name,options,body){
 if(typeof options==='function')return nodeTest(name,{timeout:20000},options);
 return nodeTest(name,{timeout:20000,...options},body);
}
