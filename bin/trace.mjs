#!/usr/bin/env node
import {readFile, realpath} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, fork, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createTraceServer} from '../server.mjs';
import {openRepository} from '../lib/git.mjs';
import {gitOutput} from '../lib/git-command.mjs';
import {sessionLease} from '../plugins/trace/hooks/session.mjs';
import {browserFallback} from '../lib/browser-fallback.mjs';
import {installAgents} from '../lib/install-agents.mjs';
import {readReview, readSnapshot, addReply} from '../lib/reviews.mjs';

const root = process.env.TRACE_BUNDLE_HOME || dirname(dirname(fileURLToPath(import.meta.url)));
const {version} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const exec = promisify(execFile);
const usage = `Trace ${version} — local code review for your current agent

Usage: trace-review [review] [options]
       trace-review feedback [--review ID] [--repo path] [--json]
       trace-review reply --review ID --comment ID --agent codex|claude --body-file PATH
       trace-review open --review ID [--repo path] [--no-open]
       trace-review install codex|claude|all
       trace-review doctor [--repo path] [--json]

Review options:
  --repo PATH       Git repository (default: current directory)
  --base REF        Compare against this revision (default: HEAD)
  --merge-base      Compare against the merge base of REF and HEAD
  --staged          Review staged changes only
  --session-id ID   Bind viewer lifetime to an agent session (set by plugin hooks)
  --wait            Return feedback to the calling agent and exit on submission
  --json            Print newline-delimited JSON events
  --no-open         Print URL without opening a browser
  --port NUMBER     Loopback port (default: assigned automatically)
  --timeout SECONDS Waiting limit (default: 1800, 0 disables)
  --agent codex     Start a separate Codex process instead of returning feedback
  --review ID       Saved review ID for feedback, reply, or open
  --comment ID      Comment ID to reply to (or review for general instructions)
  --body-file PATH  Plain-text reply file; use - to read stdin
  --status VALUE    addressed (default), needs_input, not_changed, or note
  --help            Show this help
  --browser-fallback  With --no-open, open default browser if preview does not load
  --version         Print version
`;
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'review';
const options = {repo: process.cwd(), port: 0, timeout: 1800};
let target;
try {
  if (command === 'install') target = args.shift();
  const values = {'--session-id': 'agentSessionId', '--repo': 'repo', '--base': 'base', '--port': 'port', '--timeout': 'timeout', '--agent': 'agent', '--review': 'reviewId', '--comment': 'commentId', '--body-file': 'bodyFile', '--status': 'status'};
  const flags = {'--merge-base': 'mergeBase', '--staged': 'staged', '--wait': 'wait', '--json': 'json', '--no-open': 'noOpen', '--browser-fallback':'browserFallback', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version'};
  for (let i = 0; i < args.length; i++) {
    if (values[args[i]]) { const key = values[args[i]]; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`); options[key] = args[++i]; }
    else if (flags[args[i]]) options[flags[args[i]]] = true;
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  const emit = data => process.stdout.write(JSON.stringify(data) + '\n');
  if (options.version) console.log(version);
  else if (options.help || command === 'help') console.log(usage);
  else if (command === 'install') {
    if (!['codex', 'claude', 'all'].includes(target)) throw new Error('Choose: trace-review install codex|claude|all');
    const results=await installAgents({target,root,version,execute:async(agent,args)=>{
      try {return (await exec(agent,args,{timeout:45000,maxBuffer:4*1024*1024})).stdout;}
      catch(error){throw new Error(error.stderr?.trim() || error.message);}
    }});
    if(results.some(result=>!result.ok))process.exitCode=1;
  } else if (command === 'feedback') {
    const {gitDir} = await openRepository(options.repo);
    const review = await readReview(gitDir, options.reviewId);
    if (options.json) emit(review); else console.log(review.prompt);
  } else if (command === 'reply') {
    if (!options.reviewId || !options.commentId || !options.bodyFile) throw new Error('Reply requires --review, --comment, --agent and --body-file');
    const {gitDir} = await openRepository(options.repo);
    let body;
    if (options.bodyFile === '-') {
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) { size += chunk.length; if (size > 40000) throw new Error('Reply exceeds 10000 characters'); chunks.push(chunk); }
      body = Buffer.concat(chunks).toString('utf8');
    } else body = await readFile(options.bodyFile, 'utf8');
    const reply = await addReply(gitDir, {...options, body});
    if (options.json) emit(reply); else console.log(`Reply saved to comment ${reply.commentId} in review ${reply.reviewId}.`);
  } else if (command === 'doctor') {
    const tools = {};
    for (const name of ['git', 'codex', 'claude']) tools[name] = await (name === 'git' ? gitOutput(['--version']) : exec(name, ['--version'], {timeout:10000}).then(r => r.stdout)).then(value => value.trim(), error => error.message);
    const repository = await openRepository(options.repo).then(r => r.repo, () => null);
    const report = {version, node: process.version, repository, tools};
    if (options.json) emit(report); else console.log(JSON.stringify(report, null, 2));
  } else if (command === 'review' || command === 'open') {
    options.port = Number(options.port); options.timeout = Number(options.timeout);
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Port must be 0–65535');
    if (!Number.isFinite(options.timeout) || options.timeout < 0) throw new Error('Timeout must be a non-negative number');
    if (options.agent && options.wait) throw new Error('--agent and --wait are separate handoff modes');
    if (command === 'open') {
      if (!options.reviewId || options.wait || options.agent) throw new Error('Use open --review ID without --wait or --agent');
      const {gitDir} = await openRepository(options.repo);
      await readSnapshot(gitDir, options.reviewId);
    } else if (options.reviewId) throw new Error('Use trace-review open --review ID to reopen a saved review');
    let cancelBrowserFallback=()=>{};
    const openBrowser = (url,force=false) => {
      if (options.noOpen && !force) return;
      const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {stdio: 'ignore'});
      child.on('error', () => console.error(`Open ${url} in a browser.`));
      child.on('exit', code => { if (code) console.error(`Open ${url} in a browser.`); });
    };
    const showReady = data => {
      if (options.json) emit(data);
      else console.log(`Trace: ${data.url}\nRepository: ${data.repo}\n${options.wait ? 'Waiting for review feedback…' : 'Press Ctrl+C to stop the viewer.'}`);
      openBrowser(data.url);
      if(options.browserFallback && options.noOpen)cancelBrowserFallback=browserFallback(data.url,url=>{console.error('Trace preview did not confirm loading. Opening the same review in your default browser.');openBrowser(url,true);});
    };
    const showFeedback = data => {
      if (options.json) emit(data);
      else console.log(`Review ${data.outcome}: ${data.reviewPath}\n\n${data.prompt}`);
    };
    if (options.wait) {
      const id=options.agentSessionId || process.env.CODEX_THREAD_ID || process.env.CLAUDE_SESSION_ID;
      options.sessionLease=id ? await sessionLease(id).catch(error=>{if(options.agentSessionId)throw error;return null;}) : null;
      if(!options.sessionLease)console.error('Trace: No agent session detected. Viewer will close after feedback; use plugin session hooks to keep replies visible.');
      // Only the HTTP viewer stays alive after feedback; the calling agent resumes normally.
      const viewer = fork(join(root, 'lib/viewer.mjs'), [], {detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
      let timer, finished = false;
      const finish = (code, keepViewer = false) => {
        if (finished) return; finished = true; clearTimeout(timer);cancelBrowserFallback();
        if (viewer.connected) viewer.disconnect();
        if (!keepViewer) viewer.kill();
        viewer.unref(); process.exitCode = code;
      };
      viewer.on('message', data => {
        if (data.event === 'ready') {
          showReady(data);
          if (options.timeout) timer = setTimeout(() => {
            if (options.json) emit({event: 'timeout', sessionId: data.sessionId}); else console.error('Review timed out. No approval was inferred.');
            finish(2);
          }, options.timeout * 1000);
        } else if(data.event==='client-ready'){cancelBrowserFallback();
        } else if (data.event === 'feedback') { showFeedback(data); finish(data.outcome === 'cancelled' ? 3 : 0, true); }
        else if (data.event === 'error') { console.error(`Trace: ${data.message}`); finish(1); }
      });
      viewer.on('error', error => { console.error(`Trace: ${error.message}`); finish(1); });
      viewer.on('exit', () => { if (!finished) { console.error('Trace: Viewer stopped before feedback was submitted'); finish(1); } });
      process.once('SIGINT', () => finish(130)); process.once('SIGTERM', () => finish(143));
      viewer.send(options);
    } else {
      const app = await createTraceServer(options);
      app.events.on('client-ready',()=>cancelBrowserFallback());
      app.events.once('review', review => showFeedback({event: 'feedback', ...review}));
      process.once('SIGINT', () => app.close()); process.once('SIGTERM', () => app.close());
      showReady({event: 'ready', url: app.url, repo: app.repository.repo, sessionId: app.sessionId});
    }
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) { console.error(`Trace: ${error.message}`); process.exitCode = 1; }
