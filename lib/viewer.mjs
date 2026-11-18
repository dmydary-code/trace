// A local HTTP viewer. IPC carries review events back to the caller.
import {watchSession, browserPresence} from './session-lifecycle.mjs';
import {registerListener} from '../plugins/trace/hooks/listeners.mjs';
import {createTraceServer} from '../server.mjs';
let listening = false;
let app, submitted = false, disconnected = false, stopWatching=()=>{},presence;
function close() { return app?.close(); }
function viewerClosed() {
  stopWatching();presence?.stop();
  if(process.connected){if(listening)process.send({event:'closed'});process.disconnect();}
}
process.once('message', async options => {
  try {
    listening = !!options.listen;
    app = await createTraceServer(options);
    app.server.once('close', viewerClosed);
    if (disconnected) { await close(); return; }
    if (listening && options.sessionLease) registerListener(options.sessionLease, app, options.reviewId, close);
    if(options.sessionLease)stopWatching=watchSession(options.sessionLease,close);
    else {presence=browserPresence(close,{timeout:(options.viewerIdleTimeout||120)*1000,interval:Math.min(1000,(options.viewerIdleTimeout||120)*250)});if(options.ownerPid)stopWatching=watchSession({ownerPid:options.ownerPid},close);}
    if (listening && !presence) presence = browserPresence(close, {timeout:(options.viewerIdleTimeout || 120)*1000});
    app.events.on('client-ready',()=>{if (listening) presence?.start();presence?.touch();if(process.connected)process.send?.({event:'client-ready'});});
    app.events.on('review', review => {
      submitted = true;
      presence?.start();
      if (process.connected) process.send({event: 'feedback', ...review});
    });
    process.send?.({event: 'ready', url: app.url, repo: app.repository.repo, sessionId: app.sessionId, viewerPid: process.pid});
  } catch (err) { process.send?.({event: 'error', message: err.message}); process.exitCode = 1; if (app) await close(); else process.disconnect?.(); }
});
process.on('disconnect', () => { disconnected = true; if (!submitted || listening) close(); });
process.once('SIGTERM', close); process.once('SIGINT', close);
