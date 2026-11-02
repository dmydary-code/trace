import {reviewPrompt, changeSections, compactFileTree} from './core.mjs';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let saved = {}; try { saved = JSON.parse(localStorage.getItem('trace-v3') || '{}'); } catch {}
const state = {theme: 'dark', mode: 'files', reviews: {}, ...saved};
const local = document.documentElement.dataset.traceLocal === 'true';
let session = null, query = '', activePath = '', editor = null, editId = null, jobTimer = null, submitted = false, activeReview = null, replyTimer = null;
const emptyReview = {comments: [], done: [], drafts: {}, instruction: ''};
const key = () => session ? `${session.repositoryId}:${session.verifying && activeReview ? activeReview.revision : session.revision}` : 'disconnected';
const review = () => state.reviews[key()] ??= structuredClone(emptyReview);
const files = () => session?.files || [];
function persist() { try { localStorage.setItem('trace-v3', JSON.stringify(state)); } catch { toast('Could not save locally. Export your review.'); } }
function sidebarWidth(value) { return Math.max(180, Math.min(Number(value) || 266, 640, window.innerWidth - 320)); }
function applySidebarWidth() {
 const width = sidebarWidth(state.sidebarWidth);
 document.documentElement.style.setProperty('--sidebar-width', width + 'px');
 $('#sidebar-resizer').setAttribute('aria-valuenow', Math.round(width));
 $('#sidebar-resizer').setAttribute('aria-valuemax', Math.max(180, Math.min(640, window.innerWidth - 320)));
}
const resizer = $('#sidebar-resizer');
resizer.onpointerdown = event => {
 if (event.button !== 0) return;
 event.preventDefault(); resizer.setPointerCapture(event.pointerId); document.body.classList.add('resizing-sidebar');
};
resizer.onpointermove = event => {
 if (!resizer.hasPointerCapture(event.pointerId)) return;
 state.sidebarWidth = sidebarWidth(event.clientX); applySidebarWidth();
};
function finishResize(event) {
 if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
 document.body.classList.remove('resizing-sidebar'); persist();
}
resizer.onpointerup = finishResize; resizer.onpointercancel = finishResize;
resizer.onlostpointercapture = () => document.body.classList.remove('resizing-sidebar');
resizer.onkeydown = event => {
 if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
 event.preventDefault();
 state.sidebarWidth = event.key === 'Home' ? 180 : event.key === 'End' ? 640 : sidebarWidth(state.sidebarWidth) + (event.key === 'ArrowRight' ? 20 : -20);
 applySidebarWidth(); persist();
};
resizer.ondblclick = () => { state.sidebarWidth = 266; applySidebarWidth(); persist(); };
window.addEventListener('resize', applySidebarWidth);
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').style.display = 'none', 4000); }
function applyTheme() { document.documentElement.dataset.theme = state.theme; $('#theme').textContent = state.theme === 'dark' ? '☀' : '☾'; $('#theme').setAttribute('aria-label', state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'); }
const icons = {
 file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
 contract: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>',
 data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
 state: '<path d="M5 4v16M12 4v16M19 4v16M2 8h6M9 16h6M16 10h6"/>',
 component: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 page: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M7 2h10M3 10h18"/>',
 test: '<path d="M9 3h6M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3M8 15h8"/>',
 code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
 flow: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 7v10M7 5h2c6 0 2 7 8 7"/>',
 screen: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>'
};
const icon = name => `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
function layerIcon(layer) {
  if (/Tests/.test(layer)) return 'test';
  if (/contracts?|Contract|Domain|Models/.test(layer)) return 'contract';
  if (/Data|API|repositories|infrastructure|Transport/.test(layer)) return 'data';
  if (/state|stores|Composables|Hooks/.test(layer)) return 'state';
  if (/Components/.test(layer)) return 'component';
  if (/Screens/.test(layer)) return 'screen';
  if (/Pages|Entry/.test(layer)) return 'page';
  if (/Consumers|Producers|Actions/.test(layer)) return 'flow';
  if (/Implementation|Use cases/.test(layer)) return 'code';
  return 'file';
}
const lineKey = (path, index) => `${path}:${index}`;
function tree() {
  const fileLink = (f, label) => `<button class="file-link ${f.path === activePath ? 'active' : ''}" data-file="${esc(f.id)}" title="${esc(f.path)}">${icon('file')}<span class="name">${esc(label)}</span><span class="status">${review().done.includes(f.path) ? '✓' : esc(f.status || 'M')}</span></button>`;
  $('#sidebar-heading').textContent = state.mode === 'route' ? 'Change route' : 'Changed files';
  if (state.mode === 'route') {
    const sections = changeSections(files(), query), groups = new Set(sections.map(s => s.group)); let lastGroup;
    $('#tree').innerHTML = sections.map(section => {
      const groupLabel = groups.size > 1 && section.group !== lastGroup ? `<div class="route-package">${esc(section.group)}</div>` : '';
      lastGroup = section.group;
      return groupLabel + `<div class="route-group"><a class="route-stage ${section.files.some(f => f.path === activePath) ? 'active' : ''}" href="#${section.id}">${icon(layerIcon(section.layer))}<span>${esc(section.layer)}</span><small>${section.files.length}</small></a><div class="route-files">${section.files.map(f => fileLink(f, f.path)).join('')}</div></div>`;
    }).join('') || '<p>No matching files</p>';
  } else {
    const root = compactFileTree(files().filter(f => f.path.toLowerCase().includes(query)));
    const branch = nodes => nodes.map(node => node.children ? `<details open><summary title="${esc(node.name)}">${esc(node.name)}</summary><div>${branch(node.children)}</div></details>` : fileLink(node.file, node.name)).join('');
    $('#tree').innerHTML = branch(root) || '<p>No matching files</p>';
  }
  $('#file-count').textContent = files().length;
}
const replyLabels = {addressed: 'Addressed', needs_input: 'Needs input', not_changed: 'Not changed', note: 'Note'};
function replies(id) {
  return (activeReview?.replies || []).filter(r => r.commentId === id).map(r => `<div class="agent-reply"><div class="thread-head"><span class="comment-author"><span class="avatar agent-avatar" aria-hidden="true">${esc(r.author.name.slice(0, 1))}</span><span class="author-name">${esc(r.author.name)}</span></span><span class="reply-status">${esc(replyLabels[r.status] || 'Reply')}</span><time datetime="${esc(r.createdAt)}">${esc(new Date(r.createdAt).toLocaleString())}</time></div><p>${esc(r.body)}</p></div>`).join('');
}
function thread(c) {
  const name = session?.author?.name || 'Git author not configured';
  const words = session?.author?.name?.trim().split(/\s+/u) || [];
  const initials = words.length ? [words[0], ...(words.length > 1 ? [words.at(-1)] : [])].map(word => Array.from(word)[0]).join('').toLocaleUpperCase() : '?';
  return `<div class="thread ${c.resolved ? 'resolved' : ''}"><div class="thread-head"><span class="comment-author"><span class="avatar" aria-hidden="true">${esc(initials)}</span><span class="author-name">${esc(name)}</span></span><span>${c.side === 'old' ? 'Deleted line' : 'Line'} ${c.line} · ${c.resolved ? 'Resolved' : 'Comment'}</span><span class="spacer"></span>${submitted ? '' : `<button data-edit="${esc(c.id)}">Edit</button>`}<button data-resolve="${esc(c.id)}">${c.resolved ? 'Reopen' : 'Resolve ✓'}</button>${submitted ? '' : `<button data-delete="${esc(c.id)}" aria-label="Delete comment">×</button>`}</div><p>${esc(c.body)}</p><div data-replies="${esc(c.id)}" aria-live="polite">${replies(c.id)}</div></div>`;
}
function syncSubmitted(data) {
  activeReview = data; submitted = true; editor = null; editId = null;
  const previous = new Map(review().comments.map(c => [c.id, c]));
  const sentIds = new Set(data.comments.map(c => c.id));
  review().comments = [...data.comments.map(c => ({...c, resolved: previous.get(c.id)?.resolved || false})), ...review().comments.filter(c => !sentIds.has(c.id))];
  persist();
  $('#instruction').disabled = true;
  $('#refresh').hidden = true;
  $('#review-status').hidden = false;
  $('#review-status-text').textContent = data.completion || data.outcome === 'approved' ? 'Review approved. Original comments and agent replies are saved below.' : data.outcome === 'changes_requested' ? 'Review submitted. Follow agent replies here, then review the latest changes and approve.' : 'Review cancelled.';
  $('#reply-connection').textContent = data.completion || data.outcome === 'approved' ? 'Approval saved locally. It does not merge or commit changes.' : data.outcome === 'cancelled' ? 'No approval was recorded.' : 'Agent replies update automatically.';
  $('#general-thread').hidden = !data.instruction;
  $('#general-instruction').textContent = data.instruction;
  $('#general-replies').innerHTML = replies('review');
  completionButtons(); startReplies();
}
function startReplies() {
  clearInterval(replyTimer);
  if (!activeReview || activeReview.outcome !== 'changes_requested' || activeReview.completion) return;
  replyTimer = setInterval(async () => {
    try {
      const response = await fetch('/api/reviews/' + activeReview.id);
      if (!response.ok) throw new Error('Viewer unavailable');
      const data = await response.json();
      if (data.completion && !activeReview.completion) { syncSubmitted(data); render(); return; }
      if (JSON.stringify(data.replies) !== JSON.stringify(activeReview.replies)) {
        activeReview = data;
        for (const node of document.querySelectorAll('[data-replies]')) node.innerHTML = replies(node.dataset.replies);
      }
      $('#reply-connection').textContent = 'Agent replies update automatically. Statuses are reported by the agent; resolve threads after checking the fix.';
    } catch {
      $('#reply-connection').textContent = `Viewer disconnected. Reopen saved threads: trace-review open --review ${activeReview.id}`;
    }
  }, 1500);
}
function composer(f, index) { const l = f.lines[index]; return `<form class="composer" data-editor-file="${esc(f.id)}" data-index="${index}"><label for="comment-body">${esc(f.path)} · ${l.kind === 'del' ? 'deleted line' : 'line'} ${l.new ?? l.old}</label><textarea id="comment-body" required maxlength="10000" placeholder="Describe what should change…">${esc(review().drafts[lineKey(f.path, index)] || '')}</textarea><div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${editId ? 'Save' : 'Add to review'}</button></div></form>`; }
function fileCard(f) {
  const r = review(), adds = f.lines.filter(l => l.kind === 'add').length, dels = f.lines.filter(l => l.kind === 'del').length;
  return `<article class="file-card" id="${esc(f.id)}"><div class="file-header"><span class="path">⌘ ${esc(f.path)}</span><span class="stats"><span class="plus">+${adds}</span> <span class="minus">−${dels}</span></span><div class="spacer"></div>${state.mode === 'route' ? `<span class="footnote" title="${esc(f.route.evidence)}">${esc(f.route.layer)}</span>` : ''}<label><input type="checkbox" data-viewed="${esc(f.id)}" ${r.done.includes(f.path) ? 'checked' : ''}>Viewed</label></div>${f.oldPath ? `<div class="hunk">Renamed from ${esc(f.oldPath)}</div>` : ''}${f.note ? `<div class="hunk">${esc(f.note)}</div>` : ''}<div class="diff">${f.lines.map((l, i) => l.kind === 'hunk' ? `<div class="hunk">${esc(l.text)}</div>` : `<div class="line ${l.kind}" id="${esc(f.id)}-line-${i}"><button class="comment-trigger" ${submitted ? 'disabled' : ''} data-comment="${esc(f.id)}" data-index="${i}" aria-label="Comment on ${esc(f.path)} ${l.kind === 'del' ? 'old' : 'new'} line ${l.new ?? l.old}">+</button><span class="ln">${l.old ?? ''}</span><span class="ln">${l.new ?? ''}</span><span class="sign">${l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span><code>${esc(l.text)}</code></div>${r.comments.filter(c => !session?.verifying && c.path === f.path && c.index === i).map(thread).join('')}${editor === lineKey(f.path, i) ? composer(f, i) : ''}`).join('')}</div></article>`;
}
function renderFeed() {
  const sections = changeSections(files(), query), groups = new Set(sections.map(s => s.group));
  const list = state.mode === 'route' ? sections.flatMap(s => s.files) : files().filter(f => f.path.toLowerCase().includes(query)).sort((a,b) => a.path.localeCompare(b.path));
  const label = section => (groups.size > 1 ? section.group + ' / ' : '') + section.layer;
  const cards = state.mode === 'route' ? sections.map((section, i) => `<section class="route-section" id="${section.id}" aria-labelledby="${section.id}-title"><div class="layer-heading"><b>${i+1}</b><h2 id="${section.id}-title">${esc(label(section))}</h2><span>${section.files.length} ${section.files.length === 1 ? 'file' : 'files'}</span></div>${section.files.map(fileCard).join('')}</section>`).join('') : list.map(fileCard).join('');
  $('#feed').innerHTML = cards || `<div class="empty">${session ? 'No changes to display' : local ? 'Connecting to your repository…' : 'Run <code>trace-review</code> inside your Git repository to open a local review.'}</div>`;
  $('#route-links').innerHTML = sections.map(section => `<a href="#${section.id}">${esc(label(section))}</a>`).join('<span>→</span>');
  $('#route-explanation').textContent = list.some(f => f.route.layer !== 'Other changes') ? 'The same diff, grouped by package and responsibility. Follow the stages below; files inside each stage stay in path order. Roles are inferred from manifests, imports and naming conventions, not a call graph.' : 'No supported framework or file role was identified in these changes. All files stay visible under Other changes, in path order. Change route will look similar to Files for this diff.';
  $('#summary').textContent = `${list.length} files · +${list.flatMap(f => f.lines).filter(l => l.kind === 'add').length} −${list.flatMap(f => f.lines).filter(l => l.kind === 'del').length}`;
}
function counts() { $('#review-count').textContent = review().comments.filter(c => !c.resolved).length; $('#progress').textContent = `Viewed ${review().done.length} of ${files().length} files`; $('#progress-bar').style.width = (files().length ? review().done.length / files().length * 100 : 0) + '%'; }
function render() { applyTheme(); applySidebarWidth(); $('#files-mode').setAttribute('aria-pressed', state.mode === 'files'); $('#route-mode').setAttribute('aria-pressed', state.mode === 'route'); $('#route-info').hidden = state.mode !== 'route'; $('#review').disabled = !session || submitted; tree(); renderFeed(); counts(); completionButtons(); }
function jump(id) { const f = files().find(f => f.id === id); if (!f) return; activePath = f.path; tree(); document.getElementById(id)?.scrollIntoView({behavior: 'smooth', block: 'start'}); }
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.file) jump(b.dataset.file);
  if (b.dataset.comment) { const f = files().find(f => f.id === b.dataset.comment); editor = lineKey(f.path, +b.dataset.index); editId = null; renderFeed(); $('#comment-body').focus(); }
  if (b.hasAttribute('data-cancel')) { editor = null; editId = null; renderFeed(); }
  if (b.dataset.resolve) { const c = review().comments.find(c => c.id === b.dataset.resolve); c.resolved = !c.resolved; persist(); renderFeed(); counts(); }
  if (b.dataset.delete) { review().comments = review().comments.filter(c => c.id !== b.dataset.delete); persist(); renderFeed(); counts(); }
  if (b.dataset.edit) { const c = review().comments.find(c => c.id === b.dataset.edit); editor = lineKey(c.path, c.index); editId = c.id; review().drafts[editor] = c.body; renderFeed(); $('#comment-body').focus(); }
});
document.addEventListener('input', e => { if (e.target.id === 'comment-body') { review().drafts[editor] = e.target.value; persist(); } });
document.addEventListener('submit', e => {
  const form = e.target.closest('.composer'); if (!form) return; e.preventDefault(); const body = $('#comment-body').value.trim(); if (!body) return;
  const f = files().find(f => f.id === form.dataset.editorFile), index = +form.dataset.index, l = f.lines[index];
  if (editId) review().comments.find(c => c.id === editId).body = body;
  else review().comments.push({id: crypto.randomUUID(), path: f.path, index, line: l.new ?? l.old, side: l.kind === 'del' ? 'old' : 'new', code: l.text, body, resolved: false});
  delete review().drafts[editor]; editor = null; editId = null; persist(); renderFeed(); counts(); toast('Comment added to review');
});
document.addEventListener('change', e => { if (e.target.dataset.viewed) { const path = files().find(f => f.id === e.target.dataset.viewed).path; review().done = review().done.filter(p => p !== path); if (e.target.checked) review().done.push(path); persist(); tree(); counts(); } });
$('#theme').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; persist(); applyTheme(); };
$('#search').oninput = e => { query = e.target.value.toLowerCase(); tree(); renderFeed(); };
for (const mode of ['files', 'route']) $('#' + mode + '-mode').onclick = () => { state.mode = mode; persist(); render(); };
function packet(outcome = 'changes_requested') { return {schemaVersion: 2, repo: session.repo, revision: session.revision, outcome, comments: review().comments.filter(c => !c.resolved), instruction: review().instruction || ''}; }
function prompt() { const p = packet(); return reviewPrompt(p) + (p.instruction ? `\n\nAdditional instructions:\n${p.instruction}` : ''); }
function dialogButtons() { const hasFeedback = !!(packet().comments.length || review().instruction.trim()); $('#send').disabled = !hasFeedback || !!jobTimer || submitted; $('#approve').disabled = hasFeedback || !!jobTimer || submitted; $('#cancel-review').disabled = hasFeedback || !!jobTimer || submitted; $('#copy-prompt').disabled = !hasFeedback; $('#download').disabled = !hasFeedback; }
function openReview() {
  const p = packet();
  $('#agent-info').textContent = session.agent ? 'Codex will run locally in this repository and apply the requested changes.' : session.handoff === 'waiting-agent' ? 'Your feedback will return to the agent that opened this review.' : 'Feedback is saved locally. Your agent can retrieve it with trace-review feedback --json.';
  $('#handoff-help').textContent = 'Only open comments from this revision are sent. If the code changes, refresh the diff before submitting.';
  $('#review-list').innerHTML = p.comments.map(c => `<div class="review-item"><code>${esc(c.path)}:${c.line} · ${c.side === 'old' ? 'old' : 'new'} version</code><p>${esc(c.body)}</p></div>`).join('') || '<p>Add line comments or describe your requested changes below.</p>';
  $('#instruction').value = review().instruction; $('#send').hidden = false; $('#approve').hidden = false; $('#cancel-review').hidden = false;
  $('#send').textContent = session.agent ? 'Send to Codex ↗' : 'Send to agent ↗'; dialogButtons(); $('#handoff').showModal();
};
$('#review').onclick = openReview;
$('#instruction').oninput = e => { review().instruction = e.target.value; persist(); dialogButtons(); };
$('#close-dialog').onclick = () => $('#handoff').close();
$('#copy-prompt').onclick = async () => { try { await navigator.clipboard.writeText(prompt()); toast('Task copied — paste it into your agent chat'); } catch { toast('Clipboard unavailable. Download the JSON task instead.'); } };
$('#download').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify({...packet(), prompt: prompt()}, null, 2)], {type: 'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'trace-review.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
async function send(outcome) {
  $('#send').disabled = true; $('#approve').disabled = true; $('#cancel-review').disabled = true; $('#job-state').textContent = 'Submitting review…';
  try {
    const response = await fetch('/api/reviews', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Trace-Token': session.token}, body: JSON.stringify(packet(outcome))});
    const job = await response.json(); if (!response.ok) throw new Error(job.error);
    syncSubmitted({...job.review, replies: []}); render();
    if (job.status === 'submitted') { $('#job-state').textContent = outcome === 'cancelled' ? 'Review cancelled.' : outcome === 'approved' ? 'Review approved. You can close this dialog.' : session.handoff === 'waiting-agent' ? 'Review delivered. Close this dialog to follow agent replies in your comment threads.' : 'Review saved. Your agent can read it with trace-review feedback --json and reply to each thread.'; dialogButtons(); return; }
    $('#job-state').textContent = 'Codex is working…';
    jobTimer = setInterval(async () => { try {
      const res = await fetch('/api/jobs/' + job.id); if (!res.ok) throw new Error('Could not retrieve job status'); const j = await res.json();
      $('#job-state').textContent = j.status === 'running' ? 'Codex is working…' : (j.status === 'succeeded' ? 'Done. Start a new review to inspect the changes.\n\n' : 'The agent task failed.\n') + j.output;
      if (j.status !== 'running') { clearInterval(jobTimer); jobTimer = null; }
    } catch (err) { clearInterval(jobTimer); jobTimer = null; $('#job-state').textContent = err.message; } }, 1500);
  } catch (err) { $('#job-state').textContent = err.message; dialogButtons(); }
}
$('#send').onclick = () => send('changes_requested'); $('#approve').onclick = () => send('approved'); $('#cancel-review').onclick = () => send('cancelled');
async function loadSession() {
  try {
    const res = await fetch('/api/session'); if (!res.ok) { const error = await res.json(); throw new Error(error.error || 'Local server unavailable'); }
    const next = await res.json(); if (next.sessionId !== session?.sessionId) submitted = false; session = next;
    $('#repo').textContent = session.repo; $('#source-badge').textContent = 'LOCAL'; $('#branch').textContent = `${session.branch} → ${session.base} · ${session.comparison}`; $('#title').textContent = 'Changes in ' + session.repo;
    $('#detected').textContent = [...new Set(files().map(f => f.route.group).filter(g => g !== 'Other changes'))].join(' · ') || 'Automatic route';
    clearInterval(replyTimer); activeReview = null; submitted = false; $('#instruction').disabled = false; $('#review-status').hidden = true; $('#general-thread').hidden = true;
    $('#refresh').hidden = false; editor = null;
    if (next.submittedReview) syncSubmitted(next.submittedReview);
    render();
  } catch (err) { $('#feed').innerHTML = `<div class="empty">${esc(err.message)}. Start <code>trace-review</code> in your repository and open the printed URL.</div>`; toast(err.message); }
}
$('#refresh').onclick = () => loadSession();
render(); if (local) loadSession();

function completionButtons() {
  const canFinish = activeReview?.outcome === 'changes_requested' && !activeReview.completion;
  for (const selector of ['#approve-top', '#approve-end']) {
    $(selector).disabled = !session || submitted && !canFinish;
    $(selector).textContent = activeReview?.completion || activeReview?.outcome === 'approved' ? 'Approved ✓' : 'Approve';
  }
  $('#verify-latest').hidden = !canFinish;
  $('#verify-latest').textContent = session?.verifying ? 'Refresh latest changes' : 'Review latest changes';
  $('#back-to-threads').hidden = !session?.verifying;
  $('#approve-final').hidden = !canFinish;
}
async function verifyLatest() {
  try {
    const response = await fetch(`/api/reviews/${activeReview.id}/current`);
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    session = data; editor = null; editId = null;
    $('#review-status-text').textContent = 'Latest changes · inspect this diff before approving. Original comment threads are preserved in the previous view.';
    $('#general-thread').hidden = true;
    $('#branch').textContent = `${session.branch} → ${session.base} · ${session.comparison}`;
    render(); document.querySelector('main').scrollIntoView({block: 'start'});
  } catch (error) { toast(error.message); }
}
async function approveReview() {
  if (!submitted) { openReview(); return; }
  if (!activeReview || activeReview.completion || activeReview.outcome !== 'changes_requested') return;
  if (!session.verifying) { await verifyLatest(); toast('Inspect the latest diff, then click Approve to finish.'); return; }
  $('#approve-final').disabled = true;
  try {
    const response = await fetch(`/api/reviews/${activeReview.id}/approve`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Trace-Token': session.token}, body: JSON.stringify({revision: session.revision})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    activeReview = data.review; clearInterval(replyTimer);
    $('#review-status-text').textContent = 'Review approved · this is the version you approved. Original comment threads remain saved.';
    $('#reply-connection').textContent = 'Approval saved locally. It does not merge or commit changes.';
    render(); toast('Review approved');
  } catch (error) { toast(error.message); }
  finally { $('#approve-final').disabled = false; }
}
$('#verify-latest').onclick = verifyLatest;
$('#back-to-threads').onclick = loadSession;
$('#approve-top').onclick = approveReview;
$('#approve-end').onclick = approveReview;
$('#approve-final').onclick = approveReview;
