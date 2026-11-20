import {sourceLanguage, tokenHtml, sourceHtml} from './syntax.mjs';
import {diffTokenLines, findDiffUsages, primaryDiffDeclaration} from './usages.mjs';
import {stableGraphLayout, revealGraphPath, fileCommentCount, routeGraphEdges, graphZoom} from './graph-layout.mjs';
import {reviewPrompt, compactFileTree, fileTreeOrder, isGraphSource} from './core.mjs';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let saved = {}; try { saved = JSON.parse(localStorage.getItem('trace-v3') || '{}'); } catch {}
const state = {theme: 'dark', mode: 'files', reviews: {}, newYear: true, ...saved};
if (state.mode === 'route') state.mode = 'graph';
const local = document.documentElement.dataset.traceLocal === 'true';
let loadGeneration = 0;
let timelineRequest = 0, viewMarkVersion = 0;
const pendingViewMarks = new Map();
let lastCommit = null;
const isCommitScope = scope => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(scope || '');
let viewParams = new URLSearchParams(location.search);
let replyTarget = null;
const scopeOf = () => session?.scope || session?.submittedReview?.scope || 'changes';
const requestUrl = (path, params = viewParams) => path + (params.size ? '?' + params : '');
let activeCommentId=null, clientHeartbeat=null;
let diffLoading=false, graphLoading=null, graphError=null;
let approvalQueued = false, approvingReview = false, viewerFinished = false, diffLoadFailed = false;
let usageSelection=null, sendingCommentIds=new Set(), sendingReview=false;
let session = null, query = '', activePath = '', editor = null, editId = null, jobTimer = null, submitted = false, activeReview = null, replyTimer = null;
const emptyReview = {comments: [], done: [], drafts: {}, instruction: ''};
const key = () => session ? `${session.repositoryId}:${scopeOf()}:${session.submittedReview?.id || ('draft-' + (session.rounds?.at(-1) || 'first'))}:${session.verifying && activeReview ? activeReview.revision : session.revision}` : 'disconnected';
const review = () => state.reviews[key()] ??= structuredClone(emptyReview);
const files = () => session?.files || [];
let graphAvailable = false;
function inGraphMode() {
  return graphAvailable && state.mode === 'graph';
}
function updateGraphAvailability(changedFiles) {
  graphAvailable = changedFiles.some(file => isGraphSource(file.path) || isGraphSource(file.oldPath));
  $('#route-mode').hidden = !graphAvailable;
  $('.graph-help').hidden = !graphAvailable;
}
function persist() { try { localStorage.setItem('trace-v3', JSON.stringify(state)); } catch { toast('Could not save locally. Copy your review before leaving.'); } }
const compactCommits = matchMedia('(max-width:1000px)');
function fileDrawerMode() { return !$('#timeline').hidden && compactCommits.matches; }
function setFileDrawer(open, restoreFocus = false) {
  document.body.classList.toggle('commit-files-open', open);
  syncFileToggle();
  if (open) $('#search').focus({preventScroll:true});
  else if (restoreFocus) $('#toggle-sidebar').focus({preventScroll:true});
}
function syncFileToggle() {
  const expanded = fileDrawerMode() ? document.body.classList.contains('commit-files-open') : !state.sidebarCollapsed;
  $('#toggle-sidebar').setAttribute('aria-expanded', String(expanded));
}
function maxSidebarWidth() {
  const timelineWidth = $('#timeline').getBoundingClientRect().width;
  return Math.max(180, Math.min(640, window.innerWidth - timelineWidth - 320));
}
function sidebarWidth(value) { return Math.max(180, Math.min(Number(value) || 266, maxSidebarWidth())); }
function applySidebarWidth() {
 const width = state.sidebarCollapsed ? 0 : sidebarWidth(state.sidebarWidth);
 document.body.classList.toggle('sidebar-collapsed', !!state.sidebarCollapsed);
 document.documentElement.style.setProperty('--sidebar-width', width + 'px');
 $('#sidebar-resizer').setAttribute('aria-valuenow', Math.round(width));
 $('#sidebar-resizer').setAttribute('aria-valuemax', maxSidebarWidth());
 syncFileToggle();
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
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.toggleAttribute('data-new-year', state.newYear === true);
  $('#color-scheme').value = state.theme;
  $('#new-year').checked = state.newYear === true;
}
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
  $('#sidebar-heading').textContent = 'Changed files';
  {
    const root = compactFileTree(files().filter(f => f.path.toLowerCase().includes(query)));
    const branch = nodes => nodes.map(node => node.children ? `<details open><summary title="${esc(node.name)}">${esc(node.name)}</summary><div>${branch(node.children)}</div></details>` : fileLink(node.file, node.name)).join('');
    $('#tree').innerHTML = branch(root) || '<p>No matching files</p>';
  }
  $('#file-count').textContent = files().length;
}
const replyLabels = {addressed: 'Addressed', needs_input: 'Needs input', not_changed: 'Not changed', note: 'Note'};
function messageBody(body) {
  // Only inline code and bold text are formatted. All user text is escaped.
  return body.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (index % 2 === 0) return esc(part);
    return part.startsWith('`') ? `<code>${esc(part.slice(1,-1))}</code>` : `<strong>${esc(part.slice(2,-2))}</strong>`;
  }).join('');
}
function messageCard({author, kind, body, createdAt, status}, context = '', controls = '') {
  const agent = kind === 'agent';
  const time = createdAt ? `<time datetime="${esc(createdAt)}">${esc(new Date(createdAt).toLocaleString())}</time>` : '';
  return `<article class="comment-bubble ${agent ? 'agent-reply' : 'reviewer-message'}">
    <div class="thread-head"><strong class="author-name">${esc(author)}</strong>${context}
      ${status ? `<span class="reply-status">${esc(replyLabels[status] || 'Reply')}</span>` : ''}
      ${time}<span class="spacer"></span>${controls}</div><p>${messageBody(body)}</p></article>`;
}
function lineLabel(c) {
  return c ? `<span>${c.side === 'old' ? 'Deleted line' : 'Line'} ${esc(c.line)}</span>` : '';
}
function laterMessage(message) {
  return message.createdAt && message.createdAt > activeReview.createdAt;
}
function replies(id) {
  const c = activeReview?.comments.find(c => c.id === id);
  const messages = (activeReview?.replies || []).filter(r => r.commentId === id).map(r => ({...r, author:r.author.name, kind:'agent'}));
  if (activeReview?.replyTo && (c || id === 'review' && activeReview.instruction)) {
    messages.push(...activeReview.thread.filter(laterMessage));
    messages.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  }
  return messages.map(m => messageCard(m, lineLabel(c))).join('');
}
function replyControls(id) {
  if (!submitted || activeReview.outcome !== 'changes_requested' || activeReview.completion) return '';
  if (replyTarget?.reviewId !== activeReview.id || replyTarget.commentId !== id) {
    return `<button data-followup="${esc(id)}">Reply</button>`;
  }
  return `<form class="inline-reply" aria-label="Reply in thread"><label>Reply<textarea required maxlength="10000" ${sendingReview ? 'readonly' : ''}>${esc(review().drafts['reply:' + id] || '')}</textarea></label>
    <p class="reply-error" role="status"></p><div class="actions"><button type="button" data-close-reply>Cancel</button><button class="primary" type="submit" ${sendingReview ? 'disabled' : ''}>Send reply</button></div></form>`;
}
function thread(c) {
  const name = activeReview?.author?.name || session?.author?.name || 'Git author not configured';
  const id = esc(c.id);
  const actions = `${submitted ? '' : `<button data-edit="${id}">Edit</button><button data-delete="${id}">Delete</button>`}
    <button data-resolve="${id}">${c.resolved ? 'Reopen' : 'Resolve'}</button>`;
  const context = lineLabel(c) + `<span class="comment-pending" data-pending="${id}" ${commentPending(c.id)?'':'hidden'}>Awaiting agent reply</span>`;
  return `<div data-comment-id="${id}" tabindex="-1" class="thread ${activeCommentId===c.id?'comment-current':''} ${c.resolved ? 'resolved' : ''}">
    <div class="thread-history">${submitted ? priorMessages(c) : ''}</div>
    ${messageCard({author:name, body:c.body}, context, actions)}
    <div data-replies="${id}" aria-live="polite">${replies(c.id)}</div>${replyControls(c.id)}</div>`;
}
function renderGeneralThread() {
  const r = activeReview;
  const section = $('#general-thread');
  section.hidden = !r?.instruction;
  section.innerHTML = r?.instruction ? `<div class="thread-history">${priorMessages()}</div>
    ${messageCard({author:r.author?.name || 'Reviewer', body:r.instruction})}
    <div data-replies="review" aria-live="polite">${replies('review')}</div>${replyControls('review')}` : '';
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
  $('#review-status-text').textContent = data.outcome === 'approved' ? 'Review approved.' : data.outcome === 'cancelled' ? 'Review cancelled.' : 'Review submitted. You can reply here or start another message.';
  $('#reply-connection').textContent = 'Agent replies update automatically.';
  renderGeneralThread();
  completionButtons(); startReplies();

}
function startReplies() {
  clearInterval(replyTimer);
  if (!activeReview || activeReview.outcome !== 'changes_requested' || activeReview.completion) return;
  replyTimer = setInterval(async () => {
    try {
      const watching = activeReview;
      const response = await fetch('/api/reviews/' + watching.id);
      if (!response.ok) throw new Error('Viewer unavailable');
      const data = await response.json();
      if (activeReview?.id !== data.id) return;
      if (data.completion && !activeReview.completion) { syncSubmitted(data); render(); return; }
      if (JSON.stringify(data.replies) !== JSON.stringify(activeReview.replies) || JSON.stringify(data.thread) !== JSON.stringify(activeReview.thread)) {
        activeReview = data;
        for (const node of document.querySelectorAll('[data-replies]')) node.innerHTML = replies(node.dataset.replies);
        for (const node of document.querySelectorAll('.thread-history')) {
          const id = node.closest('.thread').dataset.commentId;
          node.innerHTML = priorMessages(data.comments.find(c => c.id === id));
        }
        updatePendingComments();
        if ($('#comment-menu').matches(':popover-open')) renderCommentList();
      }
      $('#reply-connection').textContent = 'Agent replies update automatically. Statuses are reported by the agent; resolve threads after checking the fix.';
    } catch {
      $('#reply-connection').textContent = `Viewer disconnected. Reopen saved threads: trace-review open --review ${activeReview?.id || ''}`;
    }
  }, 1500);
}
function composer(f, index) { const l = f.lines[index]; return `<form class="composer" data-editor-file="${esc(f.id)}" data-index="${index}"><label for="comment-body">${esc(f.path)} · ${l.kind === 'del' ? 'deleted line' : 'line'} ${l.new ?? l.old}</label><textarea id="comment-body" required maxlength="10000" placeholder="Describe what should change…">${esc(review().drafts[lineKey(f.path, index)] || '')}</textarea><p class="footnote">Enter to add · Shift+Enter for a new line</p><div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${editId ? 'Save' : 'Add to review'}</button></div></form>`; }
// Snapshot files are immutable. Reopening a thread should not re-tokenize its diff.
const highlightedDiffs = new WeakMap();
function diffCode(file) {
  if (!highlightedDiffs.has(file)) {
    const oldPath = file.oldPath || file.path;
    const before = diffTokenLines(file.lines, 'old', oldPath);
    const after = diffTokenLines(file.lines, 'new', file.path);
    const oldLang = sourceLanguage(oldPath), newLang = sourceLanguage(file.path);
    highlightedDiffs.set(file, file.lines.map((line, i) => line.kind === 'del'
      ? tokenHtml(line.text, before[i], esc, !!oldLang)
      : tokenHtml(line.text, after[i], esc, !!newLang)));
  }
  return highlightedDiffs.get(file);
}
function fileCard(f) {
  const r = review(), id = esc(f.id), code = diffCode(f);
  const adds = f.lines.filter(l => l.kind === 'add').length, dels = f.lines.filter(l => l.kind === 'del').length;
  const fileComments = r.comments.filter(c => c.path === f.path);
  const viewed = r.done.includes(f.path);
  const collapsed = !inGraphMode() && viewed && !fileComments.some(c => c.id === activeCommentId);
  const commentsByLine = new Map();
  if (!session.verifying || activeReview?.revision === session.revision) {
    for (const c of fileComments) {
      commentsByLine.set(c.index, (commentsByLine.get(c.index) || '') + thread(c));
    }
  }
  const rows = f.lines.map((line, i) => {
    if (line.kind === 'hunk') return `<div class="hunk">${esc(line.text)}</div>`;
    const side = line.kind === 'del' ? 'old' : 'new';
    const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
    return `<div data-usage-file="${id}" data-usage-index="${i}" data-usage-side="${side}" class="line ${line.kind}" id="${id}-line-${i}">
      <button class="comment-trigger" ${submitted ? 'disabled' : ''} data-comment="${id}" data-index="${i}"
        aria-label="Comment on ${esc(f.path)} ${side} line ${line.new ?? line.old}">+</button>
      <span class="ln">${line.old ?? ''}</span><span class="ln">${line.new ?? ''}</span>
      <span class="sign">${sign}</span><code>${code[i]}</code></div>
      ${commentsByLine.get(i) || ''}${editor === lineKey(f.path, i) ? composer(f, i) : ''}`;
  }).join('');
  return `<article class="file-card ${collapsed ? 'viewed-collapsed' : ''}" id="${id}">
    <div class="file-header"><span class="path">⌘ ${esc(f.path)}</span>
      <span class="stats"><span class="plus">+${adds}</span> <span class="minus">−${dels}</span></span>
      <div class="spacer"></div><label><input type="checkbox" data-viewed="${id}" ${viewed ? 'checked' : ''}>Viewed</label></div>
    ${f.oldPath ? `<div class="hunk">Renamed from ${esc(f.oldPath)}</div>` : ''}
    ${f.note ? `<div class="hunk">${esc(f.note)}</div>` : ''}<div class="diff">${rows}</div></article>`;
}
function renderFeed() {
  if(diffLoading || !session){$('#feed').innerHTML='<div class="empty" role="status" aria-busy="true">Loading diff…</div>';return;}
  if(inGraphMode()) { renderGraph(); return; }
  const list = fileTreeOrder(files(),query);
  $('#feed').innerHTML = list.map(fileCard).join('') || `<div class="empty">${esc(query?'No files match this search.':session?.emptyReason||'No changes to display')}<p>${esc(session?.repositoryPath||'')}</p></div>`;
  applyUsageHighlights();
  $('#summary').textContent = `${list.length} files · +${list.flatMap(f => f.lines).filter(l => l.kind === 'add').length} −${list.flatMap(f => f.lines).filter(l => l.kind === 'del').length}`;
}
function counts() { updateCommentNavigation(); $('#review-count').textContent = review().comments.filter(c => !c.resolved).length; $('#progress').textContent = `Viewed ${review().done.length} of ${files().length} files`; $('#progress-bar').style.width = (files().length ? review().done.length / files().length * 100 : 0) + '%'; }
function render() { applyTheme(); applySidebarWidth(); $('#files-mode').setAttribute('aria-pressed', !inGraphMode()); $('#route-mode').setAttribute('aria-pressed', inGraphMode()); $('#route-info').hidden = true; $('#review').disabled = !session || diffLoading || sendingReview || approvingReview; $('#review').setAttribute('aria-busy',String(sendingReview)); $('#review-label').textContent=sendingReview?'Sending…':submitted?'Review sent':'Send to agent'; $('#review-icon').textContent=submitted?'✓':'↗'; tree(); renderFeed(); counts(); completionButtons(); }
function jump(id) { if(inGraphMode()) { const f=files().find(f=>f.id===id); if(f){selectGraphNode(f.path);} return; } const f = files().find(f => f.id === id); if (!f) return; activePath = f.path; tree(); document.getElementById(id)?.scrollIntoView({behavior: 'smooth', block: 'start'}); }
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.followup || b.hasAttribute('data-close-reply')) {
    if (sendingReview) return;
    const id = b.dataset.followup || replyTarget.commentId;
    replyTarget = b.dataset.followup ? {reviewId:activeReview.id, commentId:id} : null;
    renderFeed(); renderGeneralThread();
    const thread = id === 'review' ? $('#general-thread') : document.querySelector(`[data-comment-id="${CSS.escape(id)}"]`);
    thread?.querySelector(replyTarget ? 'textarea' : '[data-followup]')?.focus();
  }
  if (b.dataset.file) { if (document.body.classList.contains('commit-files-open')) setFileDrawer(false, true); jump(b.dataset.file); }
  if (b.dataset.comment) { const f = files().find(f => f.id === b.dataset.comment); editor = lineKey(f.path, +b.dataset.index); editId = null; renderFeed(); $('#comment-body').focus(); }
  if (b.hasAttribute('data-cancel')) { editor = null; editId = null; renderFeed(); }
  if (b.dataset.resolve) { const c = review().comments.find(c => c.id === b.dataset.resolve); c.resolved = !c.resolved; persist(); renderFeed(); counts(); }
  if (b.dataset.delete) { review().comments = review().comments.filter(c => c.id !== b.dataset.delete); persist(); renderFeed(); counts(); }
  if (b.dataset.edit) { const c = review().comments.find(c => c.id === b.dataset.edit); editor = lineKey(c.path, c.index); editId = c.id; review().drafts[editor] = c.body; renderFeed(); $('#comment-body').focus(); }
});
document.addEventListener('input', e => { if (e.target.id === 'comment-body') { review().drafts[editor] = e.target.value; persist(); } });
document.addEventListener('keydown',e=>{if(e.target.id==='comment-body'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!e.repeat){e.preventDefault();e.target.closest('form').requestSubmit();}});
document.addEventListener('submit', e => {
  const form = e.target.closest('.composer'); if (!form) return; e.preventDefault(); const body = $('#comment-body').value.trim(); if (!body) return;
  const f = files().find(f => f.id === form.dataset.editorFile), index = +form.dataset.index, l = f.lines[index];
  if (editId) review().comments.find(c => c.id === editId).body = body;
  else review().comments.push({id: crypto.randomUUID(), path: f.path, index, line: l.new ?? l.old, side: l.kind === 'del' ? 'old' : 'new', code: l.text, body, resolved: false});
  delete review().drafts[editor]; editor = null; editId = null; persist(); renderFeed(); counts(); toast('Comment added to review');
});
document.addEventListener('change', e => { if (e.target.dataset.viewed) { const path = files().find(f => f.id === e.target.dataset.viewed).path; review().done = review().done.filter(p => p !== path); if (e.target.checked) { review().done.push(path); if (review().comments.some(c => c.id === activeCommentId && c.path === path)) activeCommentId = null; } persist(); tree(); counts(); renderFeed(); } });
$('#color-scheme').onchange = e => { state.theme = e.target.value; persist(); applyTheme(); };
$('#new-year').onchange = e => { state.newYear = e.target.checked; persist(); applyTheme(); };
$('#search').oninput = e => { query = e.target.value.toLowerCase(); tree(); renderFeed(); };
for (const mode of ['files', 'graph']) $('#' + (mode === 'graph' ? 'route' : mode) + '-mode').onclick = () => { state.mode = mode; state.sidebarCollapsed = mode === 'graph'; persist(); render(); };
$('#reset-viewed').onclick=()=>{review().done=[];persist();render();toast('Viewed marks cleared');};
$('#toggle-sidebar').onclick = () => {
  if (fileDrawerMode()) { setFileDrawer(!document.body.classList.contains('commit-files-open')); return; }
  state.sidebarCollapsed = !state.sidebarCollapsed;
  persist(); render();
};
$('#close-file-sidebar').onclick = () => setFileDrawer(false, true);
compactCommits.addEventListener('change', () => setFileDrawer(false));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('commit-files-open')) setFileDrawer(false, true);
});
document.addEventListener('click', e => {
  if (document.body.classList.contains('commit-files-open') && !e.target.closest('#file-sidebar, #toggle-sidebar')) setFileDrawer(false);
});
function packet(outcome = 'changes_requested') { return {schemaVersion: 2, repo: session.repo, commit: session.commit, previousId: session.rounds?.at(-1) || null, revision: session.revision, outcome, comments: review().comments.filter(c => !c.resolved), instruction: review().instruction || ''}; }
function prompt() { const p = packet(); return reviewPrompt(p) + (p.instruction ? `\n\nAdditional instructions:\n${p.instruction}` : ''); }
function dialogButtons() { const hasFeedback = !!(packet().comments.length || review().instruction.trim()); $('#send').disabled = !hasFeedback || !!jobTimer || sendingReview || submitted; $('#cancel-review').disabled = hasFeedback || !!jobTimer || sendingReview || submitted; $('#copy-prompt').disabled = !hasFeedback; }
function openReview() {
  const p = submitted&&activeReview?activeReview:packet();
  $('#handoff h2').textContent = session.commit ? 'Message on ' + session.commit.sha.slice(0, 8) : 'Message to agent';
  $('#agent-info').textContent = session.agent ? 'Codex will run locally in this repository and apply the requested changes.' : session.handoff === 'waiting-agent' ? 'Your feedback will return to the agent that opened this review.' : 'Feedback is saved locally. Your agent can retrieve it with trace-review feedback --json.';
  $('#handoff-help').textContent = 'Only open comments from this revision are sent. If the code changes, refresh the diff before submitting.';
  $('#review-list').innerHTML = p.comments.map(c => `<div class="review-item"><code>${esc(c.path)}:${c.line} · ${c.side === 'old' ? 'old' : 'new'} version</code><p>${esc(c.body)}</p></div>`).join('') || '<p>Add line comments or describe your requested changes below.</p>';
  $('#instruction').value = p.instruction||''; $('#instruction').disabled=submitted; $('#send').hidden = submitted; $('#cancel-review').hidden = submitted; if(submitted)$('#job-state').textContent='✓ Review sent. Agent replies appear in the comment threads.';
  $('#send').textContent = session.agent ? 'Send to Codex ↗' : 'Send to agent ↗'; dialogButtons(); $('#handoff').showModal();
};
$('#review').onclick = openReview;
$('#review-finished').addEventListener('cancel', event => event.preventDefault());
async function approveReview() {
  if (approvingReview || viewerFinished) return;
  if (!session || diffLoading || diffLoadFailed || sendingReview) {
    approvalQueued = true;
    completionButtons();
    toast(sendingReview ? 'Approval queued until your message is saved.' : 'Approval queued while the diff loads.');
    if (!diffLoading && (!session || diffLoadFailed)) void loadSession();
    return;
  }
  approvalQueued = false;
  const draft = review();
  const hasDraft = Object.values(draft.drafts).some(text => text.trim())
    || (!submitted && (draft.comments.some(comment => !comment.resolved) || draft.instruction.trim()));
  if (hasDraft && !confirm('Approve and close this review without sending your draft feedback?')) {
    completionButtons();
    return;
  }
  approvingReview = true;
  render();
  try {
    const response = await fetch(requestUrl('/api/reviews', new URLSearchParams({scope: scopeOf()})), {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Trace-Token': session.token},
      body: JSON.stringify({revision: session.revision, previousId: session.rounds?.at(-1) || null,
        outcome: 'approved', comments: [], closeViewer: true})
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409 && !session.commit) {
        $('#handoff').close();
        await navigate(scopeOf(), {compose: '1'});
      }
      throw new Error(result.error);
    }
    viewerFinished = true;
    clearInterval(replyTimer);
    clearInterval(jobTimer);
    clearInterval(clientHeartbeat);
    $('#handoff').close();
    $('#review-finished').showModal();
  } catch (error) {
    toast(error.message);
    if ($('#handoff').open) $('#job-state').textContent = error.message;

  } finally {
    approvingReview = false;
    if (!viewerFinished) render();
  }
}
if (local) {
  const headerButton = $('#approve-review');
  approvalQueued = $('#approve-help').matches(':popover-open');
  $('#approve-help').hidePopover();
  headerButton.removeAttribute('popovertarget');
  for (const button of document.querySelectorAll('[data-approve-review]')) button.onclick = approveReview;
}
$('#instruction').oninput = e => { review().instruction = e.target.value; persist(); dialogButtons(); };
$('#close-dialog').onclick = () => $('#handoff').close();
$('#copy-prompt').onclick = async () => { try { await navigator.clipboard.writeText(prompt()); toast('Task copied — paste it into your agent chat'); } catch { toast('Clipboard unavailable. Select and copy the review instructions manually.'); } };
function confirmSubmission(job,outcome,replace = true){
 const viewed = [...review().done];
 session.rounds = [...new Set([...(session.rounds || []), job.review.id])];
 session.submittedReview = job.review;
 review().done = viewed;
 setLocation(new URLSearchParams({scope:scopeOf(), round:job.review.id}), replace);
 syncSubmitted({...job.review,replies:job.review.replies||[]});render();$('#handoff').close();toast(outcome === 'cancelled' ? 'Review cancelled' : '✓ Review sent');
 $('#job-state').textContent=outcome==='cancelled'?'Review cancelled':'✓ Review sent. Awaiting agent replies.';
 if(job.status==='submitted')return;
 jobTimer=setInterval(async()=>{try{
  const response=await fetch('/api/jobs/'+job.id);if(!response.ok)throw Error('Could not retrieve job status');const data=await response.json();
  $('#job-state').textContent=data.status==='running'?'Codex is working…':(data.status==='succeeded'?'Done. Review the latest changes.':'The agent task failed.')+'\n'+data.output;
  if(data.status!=='running'){clearInterval(jobTimer);jobTimer=null;dialogButtons();}
 }catch(error){clearInterval(jobTimer);jobTimer=null;$('#job-state').textContent=error.message;dialogButtons();}},1500);
}
function matchesSubmission(review,payload){
 return review&&review.sessionId===session.sessionId&&review.revision===payload.revision&&review.outcome===payload.outcome&&(review.instruction||'')===payload.instruction&&review.comments.length===payload.comments.length&&review.comments.every((c,i)=>c.id===payload.comments[i].id&&c.body===payload.comments[i].body);
}
async function send(outcome) {
 if(sendingReview || submitted || approvingReview || approvalQueued || viewerFinished)return;
 const payload=packet(outcome);let rejected=false;
 sendingReview=true;sendingCommentIds=new Set(payload.comments.map(c=>c.id));
 $('#instruction').disabled=true;render();$('#job-state').textContent='Sending review…';dialogButtons();
 try{
  const response=await fetch(requestUrl('/api/reviews',new URLSearchParams({scope:scopeOf()})),{method:'POST',headers:{'Content-Type':'application/json','X-Trace-Token':session.token},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  rejected=!response.ok;const job=await response.json();if(rejected)throw Error(job.error||'Review could not be submitted');
  confirmSubmission(job,outcome);
 }catch(error){
  let latest=null;
  try{const response=await fetch(requestUrl('/api/session', new URLSearchParams({scope:scopeOf()})),{signal:AbortSignal.timeout(5000)});if(response.ok)latest=await response.json();}catch{}
  if(matchesSubmission(latest?.submittedReview,payload)){
   confirmSubmission({id:latest.submittedReview.id,status:session.agent?'running':'submitted',review:latest.submittedReview},outcome);
  }else{
   const message=rejected||latest&&!latest.submittedReview?'Review was not sent: '+error.message:'Could not confirm delivery. Reconnect or reload to check the saved review before retrying.';
   $('#job-state').textContent=message;toast(message);
  }
 }finally{sendingReview=false;$('#instruction').disabled=submitted;sendingCommentIds.clear();updatePendingComments();render();dialogButtons();}
}
$('#send').onclick = () => send('changes_requested'); $('#cancel-review').onclick = () => send('cancelled');
async function loadSession(params = viewParams) {
  replyTarget = null;
  $('#general-thread').hidden = true;
  const generation = ++loadGeneration;
  diffLoading = true;
  diffLoadFailed = false;
  const previousScope = scopeOf();
  const requested = params.get('scope');
  if (isCommitScope(requested)) {
    if ($('#timeline').hidden) openTimeline(false);
  } else {
    hideTimeline();
  }
  graphError=null;
  updateGraphAvailability([]);
  $('#review').disabled = true;
  $('#commit-approve').disabled = true;
  $('#commit-viewed').disabled = true;
  renderFeed();
  try {
    const res = await fetch(requestUrl('/api/session', params)); if (!res.ok) { const error = await res.json(); throw new Error(error.error || 'Local server unavailable'); }
    const next = await res.json();
    if (generation !== loadGeneration) return;
    if (!requested && next.submittedReview) {
      return loadSession(new URLSearchParams({scope:next.submittedReview.scope || 'changes', round:next.submittedReview.id}));
    }
    viewParams = params;
    if (next.sessionId !== session?.sessionId) submitted = false; session = next;
    updateGraphAvailability(next.files);
    $('#repo').textContent = session.repo;$('#repo').title=session.repositoryPath||session.repo;
    let locationInfo=$('#repository-location');if(!locationInfo){locationInfo=document.createElement('p');locationInfo.id='repository-location';locationInfo.className='footnote';$('.intro').append(locationInfo);}
    locationInfo.textContent=`${session.repositoryPath||session.repo} · ${session.comparison} against ${session.base}${session.isWorktree?' · Git worktree':''}`; $('#source-badge').textContent = 'LOCAL'; $('#branch').textContent = `${session.branch} → ${session.base} · ${session.comparison}`; $('#title').textContent = 'Changes in ' + session.repo;
    if (session.commit) {
      lastCommit = session.commit.sha;
      highlightCommit(lastCommit);
      $('#title').textContent = session.commit.subject;
      $('#branch').textContent = session.commit.sha.slice(0, 10) + ' · ' + session.commit.author;
    } else if (session.scope === 'overall') $('#title').textContent = 'Overall changes';
    $('#commit-body').hidden = !session.commit?.body;
    $('#commit-body').textContent = session.commit?.body || '';
    if (previousScope !== scopeOf()) {
      activePath = ''; query = ''; $('#search').value = ''; activeCommentId = null;
      usageSelection = null; selectedNode = openedNode = null; revealedNodes.clear(); expandedNodes.clear();
    }
    $('#detected').textContent = 'Local dependency graph';
    clearInterval(replyTimer); activeReview = null; submitted = false; $('#instruction').disabled = false; $('#review-status').hidden = true; $('#general-thread').hidden = true;
    $('#refresh').hidden = false; editor = null; editId = null;
    if (next.submittedReview) syncSubmitted(next.submittedReview);
    else if (next.rounds?.length) {
      $('#review-status').hidden = false;
      $('#review-status-text').textContent = 'Add a message on this version or return to earlier threads.';
      $('#reply-connection').textContent = '';
    }
    diffLoading=false;render();
    acknowledgeViewer();clearInterval(clientHeartbeat);clientHeartbeat=setInterval(acknowledgeViewer,session.viewerHeartbeatMs||5000);
  } catch (err) {
    if (generation !== loadGeneration) return;
    diffLoading = false;
    diffLoadFailed = true;
    approvalQueued = false;
    completionButtons();
    $('#feed').innerHTML = `<div class="empty">${esc(err.message)}. Start <code>trace-review</code> in your repository and open the printed URL. If this is Claude Desktop, open this exact URL in your default browser: <code>${esc(location.href)}</code>.</div>`;
    toast(err.message);
  }
}
$('#refresh').onclick = () => {
  if (session?.commit && !$('#timeline').hidden) openTimeline(false);
  loadSession();
};
let selectedNode = null, openedNode = null, revealedNodes = new Set(), expandedNodes = new Set(), graphRevision = null, draggedPositions = new Map(), suppressNodeClickUntil = 0, graphScale = 1;
function selectGraphNode(path) {
  if(performance.now() < suppressNodeClickUntil) return;
  revealedNodes = revealGraphPath(revealedNodes, path, session?.graph?.edges || []);
  expandedNodes.add(path);
  selectedNode = openedNode = path;
  editor = null; editId = null;
  renderGraph();
  const viewport=$('#feed .graph-viewport'), node=[...$('#feed').querySelectorAll('[data-node]')].find(el=>el.dataset.node===path);
  if(node && viewport){const a=node.getBoundingClientRect(),b=viewport.getBoundingClientRect();viewport.scrollTo({left:viewport.scrollLeft+a.left+a.width/2-b.left-viewport.clientWidth/2,top:viewport.scrollTop+a.top+a.height/2-b.top-viewport.clientHeight/2,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  if($('#feed .graph-detail')) $('#feed .graph-detail').scrollTop = 0;
}
function resetGraph() {
  selectedNode = openedNode = null;
  revealedNodes.clear(); expandedNodes.clear(); draggedPositions.clear(); graphScale = 1; editor = null; editId = null;
  query = ''; $('#search').value = '';
  state.sidebarCollapsed = true;
  applySidebarWidth(); tree();
  renderGraph();
  $('#feed .graph-viewport').scrollLeft = $('#feed .graph-viewport').clientWidth/2;
  $('#feed .graph-viewport').scrollTop = $('#feed .graph-viewport').clientHeight/2;
  $('#feed').scrollIntoView({block:'start'});
}
async function loadGraph(){
 const target=session;if(!target||graphLoading===target)return;graphLoading=target;
 try{const response=await fetch(requestUrl('/api/graph',new URLSearchParams([...viewParams, ['revision',target.revision]])));const data=await response.json();if(!response.ok)throw new Error(data.error);if(session===target){target.graph=data.graph;graphError=null;}}
 catch(error){if(session===target)graphError=error.message;}
 finally{if(graphLoading===target)graphLoading=null;if(session===target&&inGraphMode())renderGraph();}
}
function renderGraph() {
 if (!inGraphMode() || diffLoading) return;
 if(!session?.graph){$('#feed').innerHTML=graphError?`<div class="empty">${esc(graphError)} <button id="retry-graph">Retry Graph</button></div>`:'<div class="empty" role="status" aria-busy="true">Building Graph… Your diff is available in Files.</div>';if(graphError)$('#retry-graph').onclick=()=>{graphError=null;loadGraph();renderGraph();};else loadGraph();return;}

  const scrollLeft = $('#feed .graph-viewport')?.scrollLeft || 0;
  const scrollTop = $('#feed .graph-viewport')?.scrollTop || 0;
  const detailScroll = $('#feed .graph-detail')?.scrollTop || 0;
  const graph = session?.graph || {nodes:[], edges:[], sources:{}};
  if(graphRevision !== session?.revision) {
    graphRevision = session?.revision;
    selectedNode = openedNode = null; revealedNodes.clear(); expandedNodes.clear(); draggedPositions.clear(); graphScale = 1;
  }
  // A change confined to a barrel can redirect two otherwise unchanged files.
  const rerouted = new Set(graph.nodes.some(node => node.changed) ? [] :
    graph.edges.filter(edge => edge.change).flatMap(edge => [edge.source, edge.target]));
  const visible = graph.nodes.filter(n => !review().done.includes(n.path) && (n.changed || revealedNodes.has(n.path) || rerouted.has(n.path)) && (!query || n.path.toLowerCase().includes(query)));
  const layout = stableGraphLayout(graph.nodes, graph.edges);
  const {positions, branches} = layout;
  for(const [path, point] of draggedPositions) if(positions.has(path)) positions.set(path, point);
  const width=Math.max(layout.width,...[...positions.values()].map(p=>p.x+160));
  const height=Math.max(layout.height,...[...positions.values()].map(p=>p.y+80));
  const pairs = new Map();
  for(const e of graph.edges) {
    if((!branches.has(JSON.stringify([e.source,e.target])) && !expandedNodes.has(e.source) && !expandedNodes.has(e.target)) || !visible.some(n=>n.path===e.source) || !visible.some(n=>n.path===e.target)) continue;
    const key=JSON.stringify([e.source,e.target]);
    if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(e);
  }
  const routes = routeGraphEdges(graph.edges, positions);
  const displayedEdges = [...pairs.values()].flat();
  const lines = displayedEdges.map((e,index) => {
    const a=positions.get(e.source), b=positions.get(e.target), route=routes.get(e);
    const context=!graph.nodes.find(n=>n.path===e.source)?.changed || !graph.nodes.find(n=>n.path===e.target)?.changed;
    const test=graph.nodes.find(n=>n.path===e.source)?.test || 'code';
    return `<g data-graph-edge="${index}" class="graph-edge ${context?'context':''} ${esc(test)}"><title>${esc(e.kind)}${e.change?' '+esc(e.change):''} · ${esc(e.source)} → ${esc(e.target)}</title><path d="${route.path}" fill="none" stroke="currentColor" stroke-width="1.5" ${e.kind==='Calls'?'stroke-dasharray="7 4"':e.kind==='Uses type'?'stroke-dasharray="2 5"':''}/>${e.change?`<text x="${route.lane+3}" y="${route.ty-7}">${esc(e.change)}</text>`:''}</g>`;
  }).join('');
  const related=graph.edges.filter(e=>e.source===selectedNode || e.target===selectedNode);
  const connections=selectedNode && related.length ? `<details class="graph-connections" open><summary>Connections (${related.length})</summary>${related.map(e=>`<button class="graph-connection" data-select-related="${esc(e.source===selectedNode?e.target:e.source)}"><span>${esc(e.source===selectedNode?'→':'←')} ${esc(e.source===selectedNode?e.target:e.source)}</span><small>${esc(e.kind)} ${esc(e.change||'')}</small></button>`).join('')}</details>` : '';
  const navigationComments = navigableComments();
  const nodes=visible.map(n=>{const p=positions.get(n.path); const commentCount=fileCommentCount(navigationComments,n.path); const status=({'A':'+','?':'+','M':'~','D':'−','R':'→'})[n.status] || '';return `<g role="button" tabindex="0" aria-label="Select ${esc(n.path)}" data-node="${esc(n.path)}" class="graph-node ${esc(n.test)} ${n.changed?'':'context'} ${selectedNode===n.path?'selected':''}" transform="translate(${p.x-115},${p.y-24})"><title>${esc(n.oldPath ? n.oldPath+' → '+n.path : n.path)}</title><rect width="230" height="48" rx="9"/><text x="12" y="20">${esc(n.icon)} ${esc(n.path.split('/').at(-1).slice(0,23))}</text><text class="graph-path" x="12" y="37">${esc(n.path.length>32?'…'+n.path.slice(-31):n.path)}</text><text x="211" y="20">${status}</text>${commentCount?`<g class="graph-comment-badge" aria-label="${commentCount} comments"><title>${commentCount} comments</title><rect x="210" y="29" width="${commentCount>99?34:26}" height="22" rx="11"/><text x="${commentCount>99?227:223}" y="44" text-anchor="middle">${commentCount>99?'99+':commentCount}</text></g>`:''}</g>`;}).join('');
  $('#feed').innerHTML=`<div class="graph-layout"><section class="graph-canvas"><div class="graph-legend"><span class="code">● Code</span><span class="unit">● Unit</span><span class="integration">● Integration</span><span class="e2e">● E2E</span><span>● Unclassified test</span><span>━ Imports</span><span>┄ Calls</span><span>··· Uses type</span></div><p class="footnote">Select a node to reveal connected context. Tree branches group dependencies. All connections, including cycles and shared dependencies, appear below the selected file.</p><div class="graph-selection"><span>${esc(selectedNode || 'Select a file')}</span><div class="graph-controls" role="group" aria-label="Graph controls"><button id="graph-zoom-out" aria-label="Zoom out">−</button><output id="graph-zoom-value" aria-live="polite">${Math.round(graphScale*100)}%</output><button id="graph-zoom-in" aria-label="Zoom in">+</button><button id="reset-graph" title="Return to the initial review graph">Reset graph</button></div></div><div class="graph-viewport" tabindex="0" aria-label="Graph canvas"><div class="graph-stage"><svg class="graph-svg" viewBox="0 0 ${width} ${height}" style="width:${width*graphScale}px;height:${height*graphScale}px;min-width:0" aria-label="File dependency graph">${lines}${nodes}</svg></div></div>${connections}${!visible.length?`<p>${esc(query?'No files match this search.':session?.emptyReason||'No unreviewed changed files. Use Reset Viewed to restore reviewed files.')}</p>`:''}</section>${openedNode?'<div id="graph-detail-resizer" role="separator" tabindex="0" aria-label="Resize file preview" aria-orientation="vertical" aria-controls="graph-file-content" title="Drag to resize file preview"></div><section class="graph-detail"><div class="graph-detail-toolbar"><span id="graph-preview-label" class="graph-preview-label" hidden>Preview · Not part of this diff</span><button id="close-graph-file" aria-label="Close file" title="Close file">×</button></div><div id="graph-file-content"></div></section>':''}</div>`;
  const viewport=$('#feed .graph-viewport'), graphSvg=$('#feed .graph-svg');
  const stage=$('#feed .graph-stage'),padX=viewport.clientWidth/2,padY=viewport.clientHeight/2;
  stage.style.padding=padY+'px '+padX+'px';
  viewport.scrollLeft=scrollLeft || padX; viewport.scrollTop=scrollTop || padY;
  function zoomTo(value,clientX,clientY) {
    const bounds=viewport.getBoundingClientRect();
    const x=clientX===undefined?viewport.clientWidth/2:clientX-bounds.left;
    const y=clientY===undefined?viewport.clientHeight/2:clientY-bounds.top;
    const next=graphZoom(value), ratio=next/graphScale;
    const left=(viewport.scrollLeft-padX+x)*ratio-x+padX, top=(viewport.scrollTop-padY+y)*ratio-y+padY;
    graphScale=next;
    graphSvg.style.width=width*graphScale+'px';graphSvg.style.height=height*graphScale+'px';
    viewport.scrollLeft=left;viewport.scrollTop=top;
    $('#graph-zoom-value').textContent=Math.round(graphScale*100)+'%';
    $('#graph-zoom-in').disabled=graphScale>=3;$('#graph-zoom-out').disabled=graphScale<=.25;
  }
  $('#graph-zoom-in').onclick=()=>zoomTo(graphScale*1.2);
  $('#graph-zoom-out').onclick=()=>zoomTo(graphScale/1.2);
  viewport.addEventListener('wheel',e=>{
    if(!e.ctrlKey)return;
    e.preventDefault();
    zoomTo(graphScale*Math.exp(-e.deltaY*.01),e.clientX,e.clientY);
  },{passive:false});
  let gestureScale=1;
  viewport.addEventListener('gesturestart',e=>{e.preventDefault();gestureScale=graphScale;},{passive:false});
  viewport.addEventListener('gesturechange',e=>{e.preventDefault();zoomTo(gestureScale*e.scale,e.clientX,e.clientY);},{passive:false});
  viewport.addEventListener('gestureend',e=>e.preventDefault(),{passive:false});
  $('#reset-graph').onclick = resetGraph;
  $('#feed').querySelectorAll('[data-node]').forEach(el=>{
    const path=el.dataset.node;
    const badge = el.querySelector('.graph-comment-badge');
    if (badge) {
      badge.setAttribute('role', 'button');
      badge.setAttribute('tabindex', '0');
      const openThread = event => {
        event.stopPropagation();
        const comment = orderedComments().find(c => c.path === path);
        if (comment) showComment(comment.id);
      };
      badge.onclick = openThread;
      badge.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openThread(event); }
      };
    }
    el.onclick=()=>selectGraphNode(path);
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectGraphNode(path);}};
    let drag=null;
    const svg=el.ownerSVGElement;
    const point=e=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    el.onpointerdown=e=>{
      if(e.button!==0 || e.target.closest('.graph-comment-badge'))return;
      drag={start:point(e), original:{...positions.get(path)}, moved:false};
      el.setPointerCapture(e.pointerId);
    };
    el.onpointermove=e=>{
      if(!drag)return;
      const p=point(e),dx=p.x-drag.start.x,dy=p.y-drag.start.y;
      if(!drag.moved && Math.hypot(dx,dy)<4)return;
      drag.moved=true; el.classList.add('dragging');
      const next={x:Math.max(135,drag.original.x+dx),y:Math.max(45,drag.original.y+dy)};
      positions.set(path,next); draggedPositions.set(path,next);
      el.setAttribute('transform',`translate(${next.x-115},${next.y-24})`);
      const updated=routeGraphEdges(graph.edges,positions);
      $('#feed').querySelectorAll('[data-graph-edge]').forEach(group=>{
        const route=updated.get(displayedEdges[+group.dataset.graphEdge]);
        group.querySelector('path').setAttribute('d',route.path);
        const label=group.querySelector('text');
        if(label){label.setAttribute('x',route.lane+3);label.setAttribute('y',route.ty-7);}
      });
    };
    const finish=e=>{
      if(!drag)return;
      const moved=drag.moved;drag=null;
      if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
      if(moved){suppressNodeClickUntil=performance.now()+250;renderGraph();}
    };
    el.onpointerup=finish;el.onpointercancel=finish;
  });
  $('#feed').querySelectorAll('[data-select-related]').forEach(el=>el.onclick=()=>{selectGraphNode(el.dataset.selectRelated);});

  const detailResizer=$('#graph-detail-resizer');
  if(detailResizer){
    const container=$('#feed .graph-layout'), detail=$('#feed .graph-detail');
    function setDetailWidth(value){
      const max=Math.max(240,container.clientWidth-160);
      const next=Math.max(240,Math.min(max,value));
      detail.style.flexBasis=next+'px';
      detailResizer.setAttribute('aria-valuemin','240');
      detailResizer.setAttribute('aria-valuemax',String(Math.round(max)));
      detailResizer.setAttribute('aria-valuenow',String(Math.round(next)));
      return next;
    }
    setDetailWidth(Number(state.graphDetailWidth)||container.clientWidth*.48);
    let resizeStart=null;
    detailResizer.onpointerdown=e=>{
      if(e.button!==0)return;
      e.preventDefault();resizeStart={x:e.clientX,width:detail.getBoundingClientRect().width};
      detailResizer.setPointerCapture(e.pointerId);document.body.classList.add('resizing-graph-detail');
    };
    detailResizer.onpointermove=e=>{
      if(!resizeStart)return;
      state.graphDetailWidth=setDetailWidth(resizeStart.width+resizeStart.x-e.clientX);
    };
    const stopResize=e=>{
      if(!resizeStart)return;resizeStart=null;
      if(detailResizer.hasPointerCapture(e.pointerId))detailResizer.releasePointerCapture(e.pointerId);
      document.body.classList.remove('resizing-graph-detail');persist();
    };
    detailResizer.onpointerup=stopResize;detailResizer.onpointercancel=stopResize;
    detailResizer.onlostpointercapture=()=>{resizeStart=null;document.body.classList.remove('resizing-graph-detail');};
    detailResizer.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();
      state.graphDetailWidth=setDetailWidth(e.key==='Home'?240:e.key==='End'?container.clientWidth:detail.getBoundingClientRect().width+(e.key==='ArrowLeft'?20:-20));persist();
    };
    detailResizer.ondblclick=()=>{state.graphDetailWidth=setDetailWidth(container.clientWidth*.48);persist();};
  }
  if($('#close-graph-file')) $('#close-graph-file').onclick=()=>{openedNode=null;renderGraph();};
  if(openedNode){const f=files().find(f=>f.path===openedNode);$('#graph-preview-label').hidden=!!f;$('#graph-file-content').innerHTML=f && f.status !== 'D'?fileCard(f):`<div class="file-header">${esc(openedNode)}${f?.status === 'D' ? ' · Previous version' : ''}</div><pre class="graph-source"><code>${graph.sources[openedNode] == null ? 'Source preview unavailable (binary, oversized or unreadable file).' : sourceHtml(graph.sources[openedNode], openedNode, esc)}</code></pre>`;}
  if($('#feed .graph-detail')) $('#feed .graph-detail').scrollTop = detailScroll;
  applyUsageHighlights();
  $('#summary').textContent=`${visible.filter(n=>n.changed).length} changed files · ${visible.filter(n=>!n.changed).length} context files`;
}

render(); if (local) loadSession();

function completionButtons() {
  for (const button of document.querySelectorAll('[data-approve-review]')) {
    button.setAttribute('aria-busy', String(approvalQueued || approvingReview));
  }
  if (approvalQueued && session && !diffLoading && !sendingReview) {
    queueMicrotask(() => { if (approvalQueued && !diffLoading && !sendingReview) void approveReview(); });
  }

  const commit = session?.commit;
  const browsing = !$('#timeline').hidden;
  $('#timeline-open').setAttribute('aria-pressed', String(browsing));
  $('#commit-view-label').hidden = !commit;
  const check = commit && rowViewCheckbox(commit.sha);
  $('#commit-viewed').checked = !!check?.checked;
  $('#commit-viewed').disabled = diffLoading || !check || check.disabled;
  $('#commit-approve').hidden = !commit;
  $('#commit-approve').disabled = !commit || diffLoading || commit.approved;
  $('#commit-approve').textContent = commit?.approved ? 'Approved ✓' : 'Approve commit';
  $('#working-scope').textContent = session?.comparison === 'staged' ? 'Staged changes' : 'Working tree';
  $('#working-scope').setAttribute('aria-pressed', String(!browsing && scopeOf() === 'changes'));
  $('#overall-scope').setAttribute('aria-pressed', String(!browsing && scopeOf() === 'overall'));
  const inspectingLatest = viewParams.has('compose') && session?.rounds?.length && !commit;
  $('#verify-latest').hidden = !submitted && !inspectingLatest;
  $('#verify-latest').textContent = commit ? 'New message' : inspectingLatest ? 'Refresh latest changes' : 'Review latest changes';
  $('#back-to-threads').hidden = submitted || !session?.rounds?.length;
  const ids = session?.rounds || [];
  $('#round-picker').hidden = !ids.length;
  $('#rounds').innerHTML = ids.map((id, i) => `<option value="${esc(id)}" ${id === activeReview?.id ? 'selected' : ''}>Message ${i + 1}</option>`).join('') + `<option value="" ${!submitted ? 'selected' : ''}>New message</option>`;
}
function priorMessages(c) {
  return (activeReview?.thread || []).filter(m => !laterMessage(m)).map(message => messageCard(message, lineLabel(c))).join('');
}
function setLocation(params, replace = false) {
  viewParams = params;
  history[replace ? 'replaceState' : 'pushState'](null, '', '?' + params);
}
async function navigate(scope, details = {}) {
  if (sendingReview) return;
  approvalQueued = false;
  const params = new URLSearchParams({scope, ...details});
  setLocation(params);
  await loadSession(params);
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', () => {
  approvalQueued = false;
  loadSession(new URLSearchParams(location.search));
});
$('#working-scope').onclick = () => navigate('changes');
$('#overall-scope').onclick = () => navigate('overall');
$('#verify-latest').onclick = async () => {
  const previous = session;
  const refreshing = viewParams.has('compose');
  await navigate(scopeOf(), {compose:'1'});
  if (session === previous || session.commit) return;
  toast(refreshing && previous.revision === session.revision ? 'No new changes on disk.' : 'Showing latest changes.');
};
$('#back-to-threads').onclick = () => navigate(scopeOf());
$('#rounds').onchange = e => navigate(scopeOf(), e.target.value ? {round:e.target.value} : {compose:'1'});
function hideTimeline() {
  if ($('#timeline').hidden) return;
  ++timelineRequest;
  $('#timeline').hidden = true;
  $('#commit-list').replaceChildren();
  document.body.classList.remove('commit-browsing', 'commit-files-open');
  applySidebarWidth();
  completionButtons();
}
function highlightCommit(sha) {
  const list = $('#commit-list');
  const current = list.querySelector('[aria-current]');
  const next = list.querySelector(`[data-sha="${CSS.escape(sha)}"]`);
  if (current === next) return;
  current?.removeAttribute('aria-current');
  if (!next) return;
  next.setAttribute('aria-current', 'page');
  keepCommitInView(list, next);
}
function keepCommitInView(list, link) {
  const row = link.getBoundingClientRect(), viewport = list.getBoundingClientRect();
  if (row.top < viewport.top) list.scrollTop += row.top - viewport.top;
  else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom;
}
new ResizeObserver(([{target:list}]) => {
  const selected = list.querySelector('[aria-current]');
  if (selected) keepCommitInView(list, selected);
}).observe($('#commit-list'));
function timelineRow(commit) {
  const sha = esc(commit.sha);
  const pending = pendingViewMarks.get(commit.sha);
  const label = esc('Viewed: ' + (commit.subject || '(no subject)') + ' (' + commit.sha.slice(0, 8) + ')');
  return `<li><label class="timeline-view" title="${label}"><input type="checkbox" data-view-commit="${sha}" aria-label="${label}" ${(pending ?? commit.viewed) ? 'checked' : ''} ${pending !== undefined ? 'disabled' : ''}></label><a href="?scope=${sha}" data-sha="${sha}" title="${sha} · ${esc(commit.author)} · ${esc(new Date(commit.date).toLocaleDateString())}">
    <span class="commit-subject">${esc(commit.subject || '(no subject)')}</span>
    <span class="commit-meta"><code>${sha.slice(0, 8)}</code><span class="commit-mark" ${commit.approved ? '' : 'hidden'}>Approved</span></span>
  </a></li>`;
}
async function openTimeline(selectCommit) {
  const id = ++timelineRequest, markVersion = viewMarkVersion;
  const panel = $('#timeline'), list = $('#commit-list');
  panel.hidden = false;
  document.body.classList.add('commit-browsing');
  applySidebarWidth();
  completionButtons();
  $('#timeline-range').textContent = 'Loading commits…';
  $('#timeline-count').textContent = '';
  try {
    const response = await fetch('/api/timeline');
    const data = await response.json();
    if (id !== timelineRequest) return;
    if (!response.ok) throw Error(data.error);
    if (markVersion !== viewMarkVersion) return openTimeline(selectCommit);
    list.innerHTML = data.commits.map(timelineRow).join('');
    completionButtons();
    $('#timeline-count').textContent = String(data.commits.length);
    $('#timeline-range').textContent = data.commits.length ? `Since ${data.label} · oldest first` : 'No commits in this range.';
    if (!data.commits.length) return;
    if (selectCommit) {
      const sha = data.commits.find(commit => commit.sha === lastCommit)?.sha || data.commits[0].sha;
      await navigate(sha);
    } else {
      highlightCommit(viewParams.get('scope') || '');
    }
  } catch (error) {
    if (id !== timelineRequest) return;
    list.replaceChildren();
    $('#timeline-range').textContent = error.message;
  }
}
$('#timeline-open').onclick = () => {
  if (sendingReview) return;
  if ($('#timeline').hidden || !$('#commit-list').childElementCount) openTimeline(true);
  else $('#commit-list [aria-current]')?.focus();
};
$('#commit-list').onclick = event => {
  const link = event.target.closest('a[data-sha]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (scopeOf() !== link.dataset.sha || diffLoading) navigate(link.dataset.sha);
};
function rowViewCheckbox(sha) {
  return $('#commit-list input[data-view-commit="' + CSS.escape(sha) + '"]');
}
function showViewMark(sha, viewed) {
  const check = rowViewCheckbox(sha);
  if (check) {
    check.checked = viewed;
    check.disabled = pendingViewMarks.has(sha);
  }
  completionButtons();
}
async function setCommitViewed(sha, viewed) {
  if (!session) { showViewMark(sha, !viewed); return; }
  if (pendingViewMarks.has(sha)) return;
  pendingViewMarks.set(sha, viewed);
  showViewMark(sha, viewed);
  let saved = false;
  try {
    const response = await fetch('/api/commits/' + sha + '/viewed', {
      method:'POST', headers:{'X-Trace-Token':session.token, 'Content-Type':'application/json'}, body:JSON.stringify({viewed})
    });
    if (!response.ok) throw Error('Could not save viewed mark. Try again.');
    saved = true;
  } catch (error) { toast(error.message); }
  finally {
    pendingViewMarks.delete(sha);
    ++viewMarkVersion;
    showViewMark(sha, saved ? viewed : !viewed);
  }
}
$('#commit-list').onchange = event => {
  const check = event.target.closest('input[data-view-commit]');
  if (check) setCommitViewed(check.dataset.viewCommit, check.checked);
};
$('#commit-viewed').onchange = event => setCommitViewed(session.commit.sha, event.target.checked);
$('#commit-approve').onclick = async () => {
  const current = session;
  $('#commit-approve').disabled = true;
  try {
    const response = await fetch('/api/commits/' + current.commit.sha + '/approve', {method:'POST', headers:{'X-Trace-Token':current.token}});
    if (!response.ok) throw Error((await response.json()).error);
    current.commit.approved = true;
    const mark = $('#commit-list').querySelector(`[data-sha="${CSS.escape(current.commit.sha)}"] .commit-mark`);
    if (mark) mark.hidden = false;
  } catch (error) { toast(error.message); }
  finally { completionButtons(); }
};
document.addEventListener('input', event => {
  if (!event.target.matches('.inline-reply textarea')) return;
  review().drafts['reply:' + replyTarget.commentId] = event.target.value;
  persist();
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.matches('.inline-reply')) return;
  event.preventDefault();
  const message = form.querySelector('textarea').value.trim();
  if (!message || sendingReview || approvingReview || approvalQueued || viewerFinished || !replyTarget) return;
  const target = replyTarget, draft = review(), generation = loadGeneration;
  const anchor = activeReview.comments.find(c => c.id === target.commentId);
  const payload = {...packet(), replyTo:target, instruction:anchor ? '' : message,
    comments:anchor ? [{...anchor, id:crypto.randomUUID(), body:message}] : []};
  const params = new URLSearchParams({scope:scopeOf()});
  sendingReview = true;
  form.querySelector('textarea').readOnly = true;
  form.querySelector('[type=submit]').disabled = true;
  let result;
  try {
    const response = await fetch(requestUrl('/api/reviews', params), {method:'POST',
      headers:{'Content-Type':'application/json','X-Trace-Token':session.token},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    result = await response.json();
    if (!response.ok) throw Error(result.error);
  } catch (error) {
    let latest;
    try {
      latest = (await (await fetch(requestUrl('/api/session', params), {signal:AbortSignal.timeout(5000)})).json()).submittedReview;
    } catch {}
    if (latest?.replyTo?.reviewId === target.reviewId && latest.replyTo.commentId === target.commentId && matchesSubmission(latest,payload)) {
      result = {id:latest.id, review:latest, status:session.agent ? 'running' : 'submitted'};
    } else {
      form.querySelector('.reply-error').textContent = error.message;
      result = null;
    }
  }
  sendingReview = false;
  if (result) { delete draft.drafts['reply:' + target.commentId]; persist(); }
  if (generation !== loadGeneration) { render(); return; }
  if (!result) {
    form.querySelector('textarea').readOnly = false;
    form.querySelector('[type=submit]').disabled = false;
    completionButtons();
    return;
  }
  replyTarget = null;
  confirmSubmission(result, payload.outcome, false);
  if (anchor) await showComment(result.review.comments[0].id);
  else $('#general-thread [data-followup]')?.focus();
});

const usagesDialog=document.createElement('section');
usagesDialog.hidden=true;usagesDialog.setAttribute('aria-label','Find Usages in diff');
usagesDialog.id='diff-usages';document.body.append(usagesDialog);
let usageTarget=null;
document.addEventListener('focusin',e=>{if(e.target.matches('.diff-symbol'))usageTarget=e.target;});
document.addEventListener('pointerdown',e=>{const target=e.target.closest('.diff-symbol');if(target)usageTarget=target;});
function openDiffUsages(target){
 const row=target?.closest('[data-usage-file]');if(!row)return;
 const name=target.dataset.symbol,side=row.dataset.usageSide;
 const results=findDiffUsages(files(),name,side);
 const declaration=primaryDiffDeclaration(results,{path:files().find(f=>f.id===row.dataset.usageFile)?.path,index:+row.dataset.usageIndex});
 const usageButton=(r,i)=>`<button data-usage-result="${i}"><strong>${esc(r.path)}:${r.line??''}</strong><code>${sourceHtml(r.text.trim(), r.path, esc)}</code></button>`;
 usageSelection={name,side};applyUsageHighlights();
 usagesDialog.innerHTML=`<div class="dialog-head"><h2>Find Usages: ${esc(name)}</h2><button data-close-usages aria-label="Close usages">×</button></div><p class="footnote">${results.length} ${results.length===1?'match':'matches'} in the ${side==='old'?'previous':'current'} side of this diff. Matches use identifier spelling, not resolved symbol identity.</p><section class="usage-declaration" aria-label="Declaration in diff"><h3>Declaration</h3>${declaration?usageButton(declaration,results.indexOf(declaration)):'<p>No declaration found in this diff.</p>'}</section><h3>Usages in diff</h3><div class="usage-results">${results.map((r,i)=>r===declaration?'':usageButton(r,i)).join('')||'<p>No other matches in this diff.</p>'}</div>`;
 usagesDialog.querySelector('[data-close-usages]').onclick=()=>closeDiffUsages();
 usagesDialog.querySelectorAll('[data-usage-result]').forEach(button=>button.onclick=()=>{
  const result=results[+button.dataset.usageResult];review().done=review().done.filter(p=>p!==result.path);persist();query='';$('#search').value='';
  if(inGraphMode()){selectGraphNode(result.path);}else{renderFeed();jump(result.id);}
  const line=document.getElementById(`${result.id}-line-${result.index}`);
  if(line){line.scrollIntoView({block:'center',behavior:'smooth'});line.classList.add('usage-highlight');const symbol=[...line.querySelectorAll('.diff-symbol')].find(t=>+t.dataset.offset===result.start);symbol?.focus({preventScroll:true});setTimeout(()=>line.classList.remove('usage-highlight'),2500);}
 });
 usagesDialog.hidden=false; document.body.classList.add('usages-open');
}
document.addEventListener('click',e=>{const target=e.target.closest('.diff-symbol');if(target && !window.getSelection()?.toString()){e.preventDefault();openDiffUsages(target);}});
document.addEventListener('keydown',e=>{if(e.altKey&&e.key==='F7'){if(e.target.matches('input,textarea,[contenteditable="true"]'))return;e.preventDefault();if(usageTarget?.isConnected)openDiffUsages(usageTarget);else toast('Click an identifier in the diff, then press Option + F7');}});

function closeDiffUsages(){usageSelection=null;applyUsageHighlights();usagesDialog.hidden=true;document.body.classList.remove('usages-open');}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!usagesDialog.hidden){closeDiffUsages();}if((e.key==='Enter'||e.key===' ')&&e.target.matches('.diff-symbol')){e.preventDefault();openDiffUsages(e.target);}});

const toolbarObserver=new ResizeObserver(entries=>{for(const entry of entries)document.documentElement.style.setProperty('--review-toolbar-height',entry.target.getBoundingClientRect().height+'px');});
toolbarObserver.observe(document.querySelector('main>.toolbar'));

function commentPending(id){
 return sendingCommentIds.has(id) || (activeReview?.outcome==='changes_requested' && !activeReview.completion && activeReview.comments.some(c=>c.id===id) && !(activeReview.replies||[]).some(r=>r.commentId===id));
}
function updatePendingComments(){for(const node of document.querySelectorAll('[data-pending]'))node.hidden=!commentPending(node.dataset.pending);}
function applyUsageHighlights(){
 for(const row of document.querySelectorAll('.usage-match'))row.classList.remove('usage-match');
 for(const token of document.querySelectorAll('.usage-token-match'))token.classList.remove('usage-token-match');
 if(!usageSelection)return;
 for(const result of findDiffUsages(files(),usageSelection.name,usageSelection.side)){
  const row=document.getElementById(`${result.id}-line-${result.index}`);if(!row)continue;
  row.classList.add('usage-match');
  for(const token of row.querySelectorAll('.diff-symbol'))if(+token.dataset.offset===result.start)token.classList.add('usage-token-match');
 }
}

function navigableComments() {
  return [...review().comments, ...(submitted ? [] : session?.previousRound?.comments || [])];
}
function orderedComments(){
 const order=new Map(fileTreeOrder(files()).map((f,i)=>[f.path,i]));
 return navigableComments().sort((a,b)=>(order.get(a.path)??Infinity)-(order.get(b.path)??Infinity)||a.index-b.index);
}
function updateCommentNavigation(){
 const comments=orderedComments(),index=comments.findIndex(c=>c.id===activeCommentId),noun=comments.length===1?'comment':'comments';
 $('#comment-position').textContent=index<0?`${comments.length} ${noun}`:`${index+1} / ${comments.length} ${noun}`;
 $('#comment-position').disabled=$('#previous-comment').disabled=$('#next-comment').disabled=!comments.length;
}
function renderCommentList() {
 const comments = orderedComments();
 $('#comment-links').innerHTML = comments.map(comment => {
   const count = (activeReview?.replies || session?.previousRound?.replies || []).filter(reply => reply.commentId === comment.id).length;
   const status = count ? ` · ${count} ${count === 1 ? 'reply' : 'replies'}` : commentPending(comment.id) ? ' · Awaiting reply' : '';
   return `<button data-thread-link="${esc(comment.id)}"><small>${esc(comment.path)}:${comment.line}${status}</small><span>${esc(comment.body)}</span></button>`;
 }).join('');
}
$('#comment-menu').addEventListener('beforetoggle', event => { if(event.newState==='open')renderCommentList(); });
$('#comment-links').onclick = event => {
 const link = event.target.closest('[data-thread-link]');
 if (link) showComment(link.dataset.threadLink);
};
async function showComment(id) {
 $('#comment-menu').hidePopover();
 if (!submitted && session.previousRound?.comments.some(comment => comment.id === id)) {
   state.mode = 'files';
   await navigate(scopeOf(), {round:session.previousRound.id});
 }
 const target = review().comments.find(comment => comment.id === id);
 if (!target) return;
 activeCommentId = id;
 activePath = target.path;
 query = ''; $('#search').value = ''; editor = null; editId = null;
 if (inGraphMode() && session.graph?.nodes.some(node => node.path === target.path) &&
     files().some(file => file.path === target.path && file.status !== 'D')) selectGraphNode(target.path);
 let element = inGraphMode() && $('#feed').querySelector(`[data-comment-id="${CSS.escape(id)}"]`);
 if (!element || !element.classList.contains('comment-current')) {
   state.mode = 'files';
   render(); persist();
   element = $('#feed').querySelector(`[data-comment-id="${CSS.escape(id)}"]`);
 } else { tree(); counts(); }
 if (element) {
   element.focus({preventScroll:true});
   element.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 } else toast('This line is unavailable in the displayed diff.');
}
function navigateComment(direction) {
 const comments = orderedComments();
 if (!comments.length) return;
 const current = comments.findIndex(c => c.id === activeCommentId);
 const start = direction > 0 ? 0 : comments.length - 1;
 const index = current < 0 ? start : (current + direction + comments.length) % comments.length;
 return showComment(comments[index].id);
}
$('#previous-comment').onclick=()=>navigateComment(-1);
$('#next-comment').onclick=()=>navigateComment(1);
function acknowledgeViewer(){if(session && !viewerFinished)fetch('/api/client-ready',{method:'POST',headers:{'X-Trace-Token':session.token}}).catch(()=>{});}
window.addEventListener('pageshow',acknowledgeViewer);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)acknowledgeViewer();});
