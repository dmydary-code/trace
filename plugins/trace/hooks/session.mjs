import {mkdir, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const sessionDirectory = () => join(process.env.TRACE_SESSION_DIRECTORY || join(tmpdir(), 'trace-review-sessions-' + (process.getuid?.() ?? 'local')));
export const sessionPath = id => join(sessionDirectory(), createHash('sha256').update(id).digest('hex') + '.json');
export function agentOwner() {
  let pid = process.ppid;
  for (let i = 0; pid > 1 && i < 32; i++) {
    try {
      const row = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'comm='], {encoding:'utf8'}).trim();
      const [, parent, command] = row.match(/^(\d+)\s+(.+)$/) || [];
      if (!parent) break;
      if (/(?:^|\/)(?:codex|claude)(?:\s|$)/i.test(command)) return pid;
      pid = Number(parent);
    } catch { break; }
  }
  return null;
}
export async function sessionLease(id) {
  if (!id) return null;
  const path = sessionPath(id);
  const record = JSON.parse(await readFile(path, 'utf8'));
  return {path, token:record.token, ownerPid:record.ownerPid};
}
export async function handleSession(input) {
  if (!input.session_id) return;
  const path = sessionPath(input.session_id);
  if (input.hook_event_name === 'SessionEnd') { await rm(path, {force:true}); return; }
  if (input.hook_event_name !== 'SessionStart') return;
  await mkdir(sessionDirectory(), {recursive:true, mode:0o700});
  const ownerPid=agentOwner();
  // CLI /clear may start a new session ID without ending the old one first.
  // Only invalidate sessions owned by that exact CLI process, never other chats.
  if(input.source==='clear' && ownerPid){
    for(const name of await readdir(sessionDirectory())){
      if(!name.endsWith('.json'))continue;
      const oldPath=join(sessionDirectory(),name);
      const old=await readFile(oldPath,'utf8').then(JSON.parse,()=>null);
      if(old?.ownerPid===ownerPid)await rm(oldPath,{force:true});
    }
  }
  let record;
  if (input.source !== 'clear') record = await readFile(path, 'utf8').then(JSON.parse, () => null);
  if (!record) await writeFile(path, JSON.stringify({token:randomUUID(), ownerPid}), {mode:0o600});
  console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart', additionalContext:`When opening Trace in this session, pass --session-id ${JSON.stringify(input.session_id)}. This binds its local server to this session's lifecycle.`}}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { let body=''; for await (const part of process.stdin) { body+=part; if(body.length>1024*1024)throw Error('Hook input too large'); } await handleSession(JSON.parse(body)); }
  catch(error) { console.error('Trace session hook: '+error.message); process.exitCode=1; }
}
