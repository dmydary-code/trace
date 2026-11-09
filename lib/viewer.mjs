// A local HTTP viewer, not another coding agent. IPC carries one review back to the caller.
import {watchSession, browserPresence} from './session-lifecycle.mjs';
import {createTraceServer} from '../server.mjs';
let app, submitted = false, disconnected = false, closing = false, stopWatching=()=>{},presence;
async function close() {
  stopWatching();presence?.stop();
  if (app && !closing) { closing = true; await app.close(); }
  if(process.connected)process.disconnect();
}
process.once('message', async options => {
  try {
    app = await createTraceServer(options);
    if (disconnected) { await close(); return; }
    if(options.sessionLease)stopWatching=watchSession(options.sessionLease,close);
    else {presence=browserPresence(close,{timeout:(options.viewerIdleTimeout||120)*1000,interval:Math.min(1000,(options.viewerIdleTimeout||120)*250)});if(options.ownerPid)stopWatching=watchSession({ownerPid:options.ownerPid},close);}
    app.events.on('client-ready',()=>{presence?.touch();if(process.connected)process.send?.({event:'client-ready'});});
    app.events.once('review', review => {
      submitted = true;
      presence?.start();
      process.send?.({event: 'feedback', ...review});
    });
    process.send?.({event: 'ready', url: app.url, repo: app.repository.repo, sessionId: app.sessionId, viewerPid: process.pid});
  } catch (err) { process.send?.({event: 'error', message: err.message}); process.exitCode = 1; process.disconnect?.(); }
});
process.on('disconnect', () => { disconnected = true; if (!submitted) close(); });
process.once('SIGTERM', close); process.once('SIGINT', close);
