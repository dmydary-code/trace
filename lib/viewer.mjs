// A local HTTP viewer, not another coding agent. IPC carries one review back to the caller.
import {createTraceServer} from '../server.mjs';
let app, submitted = false, disconnected = false, closing = false, expiry;
async function close() {
  clearTimeout(expiry);
  if (app && !closing) { closing = true; await app.close(); }
}
process.once('message', async options => {
  try {
    app = await createTraceServer(options);
    if (disconnected) { await close(); return; }
    app.events.on('client-ready',()=>{if(process.connected)process.send?.({event:'client-ready'});});
    app.events.once('review', review => {
      submitted = true;
      expiry = setTimeout(close, 60 * 60 * 1000);
      process.send?.({event: 'feedback', ...review});
    });
    process.send?.({event: 'ready', url: app.url, repo: app.repository.repo, sessionId: app.sessionId, viewerPid: process.pid});
  } catch (err) { process.send?.({event: 'error', message: err.message}); process.exitCode = 1; process.disconnect?.(); }
});
process.on('disconnect', () => { disconnected = true; if (!submitted) close(); });
process.once('SIGTERM', close); process.once('SIGINT', close);
