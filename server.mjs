import http from 'node:http';
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID, randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {openRepository} from './lib/git.mjs';
import {detectRoutes} from './lib/detect.mjs';
import {reviewPrompt} from './dist/core.mjs';

const root = dirname(fileURLToPath(import.meta.url));
function json(res, status, data) {
  res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200000) throw new Error('Review exceeds 200 KB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function createTraceServer(options = {}) {
  if (options.agent && options.agent !== 'codex') throw new Error('Supported child agent: codex');
  const repository = await openRepository(options.repo || process.cwd(), options);
  const token = randomBytes(24).toString('hex'), events = new EventEmitter(), jobs = new Map();
  const sessionId = randomUUID();
  let running = false, submitted = false, origin;
  async function snapshot() {
    const data = await repository.snapshot();
    const routes = await detectRoutes(repository.repo, data.files, {base: options.base, staged: options.staged});
    return {...data, files: data.files.map((f, i) => ({...f, route: routes[i]})), token, sessionId, handoff: options.wait ? 'waiting-agent' : 'inbox', agent: options.agent || null};
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) return json(res, 403, {error: 'Invalid Host'});
      const url = new URL(req.url, origin);
      const navigation = req.method === 'GET' && ['/', '/index.html'].includes(url.pathname) && req.headers['sec-fetch-mode'] === 'navigate';
      if (req.headers['sec-fetch-site'] === 'cross-site' && !navigation) return json(res, 403, {error: 'Cross-site requests are not allowed'});
      if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, await snapshot());
      if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const job = jobs.get(url.pathname.split('/').at(-1));
        return json(res, job ? 200 : 404, job || {error: 'Job not found'});
      }
      if (req.method === 'POST' && url.pathname === '/api/reviews') {
        if (req.headers['x-trace-token'] !== token || req.headers.origin !== origin) return json(res, 403, {error: 'Open the review on the local server'});
        if (running || submitted) return json(res, 409, {error: 'This review has already been submitted. Start a new review.'});
        // Lock before asynchronous validation to prevent concurrent duplicate submissions.
        running = true;
        try {
          const input = await body(req), current = await snapshot();
          if (input.revision !== current.revision) { running = false; return json(res, 409, {error: 'Code has changed. Refresh the diff and review your comments.'}); }
          const outcome = input.outcome || 'changes_requested';
          if (!['changes_requested', 'approved', 'cancelled'].includes(outcome)) throw new Error('Invalid review outcome');
          if (!Array.isArray(input.comments) || input.comments.length > 100) throw new Error('Invalid comments');
          const instruction = input.instruction || '';
          if (typeof instruction !== 'string' || instruction.length > 10000) throw new Error('Invalid instructions');
          if (outcome === 'changes_requested' && !input.comments.length && !instruction.trim()) throw new Error('Add a line comment or review instructions');
          if (outcome !== 'changes_requested' && (input.comments.length || instruction.trim())) throw new Error('Submit your feedback with Request changes');
          const comments = input.comments.map(c => {
            const f = current.files.find(f => f.path === c.path), l = f?.lines[c.index];
            if (!Number.isInteger(c.index) || !l || l.kind === 'hunk' || c.line !== (l.new ?? l.old) || c.side !== (l.kind === 'del' ? 'old' : 'new') || typeof c.body !== 'string' || !c.body.trim() || c.body.length > 10000) throw new Error('Invalid comment anchor');
            return {path: f.path, index: c.index, line: l.new ?? l.old, side: l.kind === 'del' ? 'old' : 'new', code: l.text, body: c.body.trim()};
          });
          const id = randomUUID(), dir = join(repository.gitDir, 'trace', 'reviews', id);
          const review = {schemaVersion: 1, id, sessionId, outcome, createdAt: new Date().toISOString(), repo: repository.repo, revision: current.revision, base: current.base, comparison: current.comparison, comments, instruction};
          const prompt = outcome === 'changes_requested' ? reviewPrompt(review) + (instruction ? '\n\nAdditional instructions:\n' + instruction : '') : outcome === 'approved' ? 'The user finished this review without requesting changes. This does not authorize committing, merging, or publishing.' : 'The user cancelled this review. Do not infer approval.';
          const result = {...review, prompt, reviewPath: join(dir, 'review.json')};
          await mkdir(dir, {recursive: true, mode: 0o700});
          await writeFile(result.reviewPath, JSON.stringify(result, null, 2) + '\n', {mode: 0o600});
          await writeFile(join(dir, 'prompt.md'), prompt + '\n', {mode: 0o600});
          const latest = join(repository.gitDir, 'trace', 'latest.json');
          await writeFile(latest + '.' + id, JSON.stringify(result, null, 2) + '\n', {mode: 0o600});
          await rename(latest + '.' + id, latest);
          submitted = true;
          if (options.agent && outcome === 'changes_requested') {
            const job = {id, status: 'running', output: ''}; jobs.set(id, job);
            const child = spawn('codex', ['exec', '--sandbox', 'workspace-write', '-C', repository.repo, '--color', 'never', '-o', join(dir, 'result.txt'), '-'], {stdio: ['pipe', 'ignore', 'pipe']});
            child.stdin.on('error', () => {}); child.stdin.end(prompt);
            child.stderr.on('data', c => { job.output = (job.output + c).slice(-16000); });
            child.on('error', err => { job.status = 'failed'; job.output = err.message; running = false; });
            child.on('close', async code => { if (job.status === 'failed') return; job.status = code === 0 ? 'succeeded' : 'failed'; try { job.output = await readFile(join(dir, 'result.txt'), 'utf8'); } catch {} running = false; });
            return json(res, 202, {id, status: 'running'});
          }
          running = false;
          res.once('finish', () => events.emit('review', result));
          return json(res, 201, {id, status: 'submitted', outcome, reviewPath: result.reviewPath});
        } catch (err) { running = false; throw err; }
      }
      if (req.method !== 'GET') return json(res, 405, {error: 'Method not supported'});
      const allowed = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/core.mjs': 'core.mjs'};
      const file = allowed[url.pathname]; if (!file) return json(res, 404, {error: 'Not found'});
      let content = await readFile(join(root, 'dist', file));
      if (file === 'index.html') content = content.toString().replace('<html lang="en">', '<html lang="en" data-trace-local="true">');
      res.writeHead(200, {'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      res.end(content);
    } catch (err) { json(res, 400, {error: err.message}); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(options.port ?? 0, '127.0.0.1', ok); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {url: origin, repository, events, server, sessionId, close: () => new Promise((ok, fail) => { server.close(err => err ? fail(err) : ok()); server.closeIdleConnections(); })};
}

// Backwards-compatible entry point; the installed command lives in bin/trace.mjs.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const app = await createTraceServer({repo: value('--repo', process.cwd()), base: value('--base', 'HEAD'), port: Number(value('--port', 4173)), agent: value('--agent', null)});
  console.log(`Trace: ${app.url}\nRepository: ${app.repository.repo}`);
  process.once('SIGINT', () => app.close()); process.once('SIGTERM', () => app.close());
}
