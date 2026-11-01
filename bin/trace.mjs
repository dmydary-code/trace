#!/usr/bin/env node
import {readFile, realpath} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createTraceServer} from '../server.mjs';
import {openRepository} from '../lib/git.mjs';

const root = process.env.TRACE_BUNDLE_HOME || dirname(dirname(fileURLToPath(import.meta.url)));
const {version} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const exec = promisify(execFile);
const usage = `Trace ${version} — local code review for your current agent

Usage: trace-review [review] [options]
       trace-review feedback [--repo path] [--json]
       trace-review install codex|claude|all
       trace-review doctor [--repo path] [--json]

Review options:
  --repo PATH       Git repository (default: current directory)
  --base REF        Compare against this revision (default: HEAD)
  --merge-base      Compare against the merge base of REF and HEAD
  --staged          Review staged changes only
  --wait            Return feedback to the calling agent and exit on submission
  --json            Print newline-delimited JSON events
  --no-open         Print URL without opening a browser
  --port NUMBER     Loopback port (default: assigned automatically)
  --timeout SECONDS Waiting limit (default: 1800, 0 disables)
  --agent codex     Start a separate Codex process instead of returning feedback
  --help            Show this help
  --version         Print version
`;
const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'review';
const options = {repo: process.cwd(), port: 0, timeout: 1800};
let target;
try {
  if (command === 'install') target = args.shift();
  const values = {'--repo': 'repo', '--base': 'base', '--port': 'port', '--timeout': 'timeout', '--agent': 'agent'};
  const flags = {'--merge-base': 'mergeBase', '--staged': 'staged', '--wait': 'wait', '--json': 'json', '--no-open': 'noOpen', '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version'};
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
    const run = (exe, argv) => new Promise((ok, fail) => { const child = spawn(exe, argv, {stdio: 'inherit'}); child.on('error', fail); child.on('exit', code => code === 0 ? ok() : fail(new Error(`${exe} exited with ${code}`))); });
    for (const agent of target === 'all' ? ['codex', 'claude'] : [target]) {
      const listing = JSON.parse((await exec(agent, ['plugin', 'marketplace', 'list', '--json'])).stdout);
      const entries = Array.isArray(listing) ? listing : listing.marketplaces || [];
      const existing = entries.find(item => item.name === 'trace-tools');
      if (existing) {
        const location = existing.root || existing.path || existing.source?.path || existing.source?.url;
        const registeredRoot = location ? await realpath(location).catch(() => resolve(location)) : null;
        const currentRoot = await realpath(root);
        if (registeredRoot && registeredRoot !== currentRoot) {
          // Codex canonicalizes Homebrew's opt symlink to a versioned Cellar path.
          // Migrate only this package's prior Homebrew registration on upgrade.
          const oldCellar = registeredRoot.match(/^(.*\/Cellar\/trace)\/[^/]+\/libexec$/);
          const newCellar = currentRoot.match(/^(.*\/Cellar\/trace)\/[^/]+\/libexec$/);
          if (!oldCellar || !newCellar || oldCellar[1] !== newCellar[1]) throw new Error(`trace-tools is already registered at ${location}. Remove that marketplace with ${agent} plugin marketplace remove trace-tools before switching installations.`);
          await run(agent, ['plugin', 'marketplace', 'remove', 'trace-tools']);
          await run(agent, ['plugin', 'marketplace', 'add', root]);
        } else if (agent === 'claude') await run(agent, ['plugin', 'marketplace', 'update', 'trace-tools']);
      } else await run(agent, ['plugin', 'marketplace', 'add', root]);
      let installCommand = agent === 'codex' ? 'add' : 'install';
      if (agent === 'claude') {
        const installed = JSON.parse((await exec(agent, ['plugin', 'list', '--json'])).stdout);
        if (installed.some(item => item.id === 'trace@trace-tools')) installCommand = 'update';
      }
      await run(agent, ['plugin', installCommand, 'trace@trace-tools']);
      console.log(`Trace installed for ${agent}. Restart the agent to discover the review skill.`);
    }
  } else if (command === 'feedback') {
    const {gitDir} = await openRepository(options.repo);
    const review = JSON.parse(await readFile(join(gitDir, 'trace', 'latest.json'), 'utf8').catch(() => { throw new Error('No submitted review in this repository'); }));
    if (options.json) emit(review); else console.log(review.prompt);
  } else if (command === 'doctor') {
    const tools = {};
    for (const name of ['git', 'codex', 'claude']) tools[name] = await exec(name, ['--version'], {timeout: 10000}).then(r => r.stdout.trim(), () => 'unavailable');
    const repository = await openRepository(options.repo).then(r => r.repo, () => null);
    const report = {version, node: process.version, repository, tools};
    if (options.json) emit(report); else console.log(JSON.stringify(report, null, 2));
  } else if (command === 'review') {
    options.port = Number(options.port); options.timeout = Number(options.timeout);
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Port must be 0–65535');
    if (!Number.isFinite(options.timeout) || options.timeout < 0) throw new Error('Timeout must be a non-negative number');
    if (options.agent && options.wait) throw new Error('--agent and --wait are separate handoff modes');
    const app = await createTraceServer(options);
    let timer, closing = false;
    async function finish(code) { if (closing) return; closing = true; clearTimeout(timer); await app.close(); process.exitCode = code; }
    app.events.once('review', async review => {
      if (options.json) emit({event: 'feedback', ...review}); else console.log(`Review ${review.outcome}: ${review.reviewPath}\n\n${review.prompt}`);
      if (options.wait) await finish(review.outcome === 'cancelled' ? 3 : 0);
    });
    process.once('SIGINT', () => finish(130)); process.once('SIGTERM', () => finish(143));
    if (options.json) emit({event: 'ready', url: app.url, repo: app.repository.repo, sessionId: app.sessionId});
    else console.log(`Trace: ${app.url}\nRepository: ${app.repository.repo}\n${options.wait ? 'Waiting for review feedback…' : 'Submit feedback in the browser; retrieve it with trace-review feedback. Press Ctrl+C to stop.'}`);
    if (options.wait && options.timeout) timer = setTimeout(async () => { if (options.json) emit({event: 'timeout', sessionId: app.sessionId}); else console.error('Review timed out without a submission. No approval was inferred.'); await finish(2); }, options.timeout * 1000);
    if (!options.noOpen) {
      const executable = process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(executable, [app.url], {stdio: 'ignore'});
      child.on('error', () => console.error(`Open ${app.url} in a browser.`));
      child.on('exit', code => { if (code) console.error(`Open ${app.url} in a browser.`); });
    }
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) { console.error(`Trace: ${error.message}`); process.exitCode = 1; }
