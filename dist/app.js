import {diffTokens, findDiffUsages, usageLineHtml, primaryDiffDeclaration} from './usages.mjs';
import {stableGraphLayout, revealGraphPath, fileCommentCount, routeGraphEdges, graphZoom} from './graph-layout.mjs';
import {reviewPrompt, compactFileTree, fileTreeOrder} from './core.mjs';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let saved = {}; try { saved = JSON.parse(localStorage.getItem('trace-v3') || '{}'); } catch {}
const state = {theme: 'dark', mode: 'files', reviews: {}, ...saved};
if (state.mode === 'route') state.mode = 'graph';
const local = document.documentElement.dataset.traceLocal === 'true';
let continuingApproval=false;
let activeCommentId=null, clientHeartbeat=null;
let diffLoading=false, graphLoading=null, graphError=null;
let usageSelection=null, sendingCommentIds=new Set(), sendingReview=false;
let session = null, query = '', activePath = '', editor = null, editId = null, jobTimer = null, submitted = false, activeReview = null, replyTimer = null;
const emptyReview = {comments: [], done: [], drafts: {}, instruction: ''};
const key = () => session ? `${session.repositoryId}:${session.verifying && activeReview ? activeReview.revision : session.revision}` : 'disconnected';
const review = () => state.reviews[key()] ??= structuredClone(emptyReview);
const files = () => session?.files || [];
function persist() { try { localStorage.setItem('trace-v3', JSON.stringify(state)); } catch { toast('Could not save locally. Copy your review before leaving.'); } }
function sidebarWidth(value) { return Math.max(180, Math.min(Number(value) || 266, 640, window.innerWidth - 320)); }
function applySidebarWidth() {
 const width = state.sidebarCollapsed ? 0 : sidebarWidth(state.sidebarWidth);
 document.body.classList.toggle('sidebar-collapsed', !!state.sidebarCollapsed);
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
  $('#sidebar-heading').textContent = 'Changed files';
  {
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
  return `<div data-comment-id="${esc(c.id)}" tabindex="-1" class="thread ${activeCommentId===c.id?'comment-current':''} ${c.resolved ? 'resolved' : ''}"><div class="thread-head"><span class="comment-author"><span class="avatar" aria-hidden="true">${esc(initials)}</span><span class="author-name">${esc(name)}</span></span><span>${c.side === 'old' ? 'Deleted line' : 'Line'} ${c.line} · ${c.resolved ? 'Resolved' : 'Comment'}</span><span class="comment-pending" data-pending="${esc(c.id)}" ${commentPending(c.id)?'':'hidden'}>◷ Pending · Awaiting agent reply</span><span class="spacer"></span>${submitted ? '' : `<button data-edit="${esc(c.id)}">Edit</button>`}<button data-resolve="${esc(c.id)}">${c.resolved ? 'Reopen' : 'Resolve ✓'}</button>${submitted ? '' : `<button data-delete="${esc(c.id)}" aria-label="Delete comment">×</button>`}</div><p>${esc(c.body)}</p><div data-replies="${esc(c.id)}" aria-live="polite">${replies(c.id)}</div></div>`;
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
  if(data.completion || data.outcome==='approved') continueAfterApproval(data);
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
        updatePendingComments();
      }
      $('#reply-connection').textContent = 'Agent replies update automatically. Statuses are reported by the agent; resolve threads after checking the fix.';
    } catch {
      $('#reply-connection').textContent = `Viewer disconnected. Reopen saved threads: trace-review open --review ${activeReview.id}`;
    }
  }, 1500);
}
function composer(f, index) { const l = f.lines[index]; return `<form class="composer" data-editor-file="${esc(f.id)}" data-index="${index}"><label for="comment-body">${esc(f.path)} · ${l.kind === 'del' ? 'deleted line' : 'line'} ${l.new ?? l.old}</label><textarea id="comment-body" required maxlength="10000" placeholder="Describe what should change…">${esc(review().drafts[lineKey(f.path, index)] || '')}</textarea><p class="footnote">Enter to add · Shift+Enter for a new line</p><div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${editId ? 'Save' : 'Add to review'}</button></div></form>`; }
function fileCard(f) {
  const tokens={old:diffTokens(f.lines,'old',f.path),new:diffTokens(f.lines,'new',f.path)};
  const r = review(), adds = f.lines.filter(l => l.kind === 'add').length, dels = f.lines.filter(l => l.kind === 'del').length;
  return `<article class="file-card ${state.mode==='files' && r.done.includes(f.path) && !r.comments.some(c=>c.id===activeCommentId&&c.path===f.path)?'viewed-collapsed':''}" id="${esc(f.id)}"><div class="file-header"><span class="path">⌘ ${esc(f.path)}</span><span class="stats"><span class="plus">+${adds}</span> <span class="minus">−${dels}</span></span><div class="spacer"></div><label><input type="checkbox" data-viewed="${esc(f.id)}" ${r.done.includes(f.path) ? 'checked' : ''}>Viewed</label></div>${f.oldPath ? `<div class="hunk">Renamed from ${esc(f.oldPath)}</div>` : ''}${f.note ? `<div class="hunk">${esc(f.note)}</div>` : ''}<div class="diff">${f.lines.map((l, i) => l.kind === 'hunk' ? `<div class="hunk">${esc(l.text)}</div>` : `<div data-usage-file="${esc(f.id)}" data-usage-index="${i}" data-usage-side="${l.kind==='del'?'old':'new'}" class="line ${l.kind}" id="${esc(f.id)}-line-${i}"><button class="comment-trigger" ${submitted ? 'disabled' : ''} data-comment="${esc(f.id)}" data-index="${i}" aria-label="Comment on ${esc(f.path)} ${l.kind === 'del' ? 'old' : 'new'} line ${l.new ?? l.old}">+</button><span class="ln">${l.old ?? ''}</span><span class="ln">${l.new ?? ''}</span><span class="sign">${l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span><code>${usageLineHtml(l.text,tokens[l.kind==='del'?'old':'new'].filter(t=>t.index===i),esc)}</code></div>${r.comments.filter(c => !session?.verifying && c.path === f.path && c.index === i).map(thread).join('')}${editor === lineKey(f.path, i) ? composer(f, i) : ''}`).join('')}</div></article>`;
}
function renderFeed() {
  if(diffLoading || !session){$('#feed').innerHTML='<div class="empty" role="status" aria-busy="true">Loading diff…</div>';return;}
  if(state.mode === 'graph') { renderGraph(); return; }
  const list = fileTreeOrder(files(),query);
  $('#feed').innerHTML = list.map(fileCard).join('') || `<div class="empty">${esc(query?'No files match this search.':session?.emptyReason||'No changes to display')}<p>${esc(session?.repositoryPath||'')}</p></div>`;
  applyUsageHighlights();
  $('#summary').textContent = `${list.length} files · +${list.flatMap(f => f.lines).filter(l => l.kind === 'add').length} −${list.flatMap(f => f.lines).filter(l => l.kind === 'del').length}`;
}
function counts() { updateCommentNavigation(); $('#review-count').textContent = review().comments.filter(c => !c.resolved).length; $('#progress').textContent = `Viewed ${review().done.length} of ${files().length} files`; $('#progress-bar').style.width = (files().length ? review().done.length / files().length * 100 : 0) + '%'; }
function render() { applyTheme(); applySidebarWidth(); $('#files-mode').setAttribute('aria-pressed', state.mode === 'files'); $('#route-mode').setAttribute('aria-pressed', state.mode === 'graph'); $('#route-info').hidden = true; $('#review').disabled = !session || sendingReview; $('#review').setAttribute('aria-busy',String(sendingReview)); $('#review-label').textContent=sendingReview?'Sending…':submitted?'Review sent':'Send to agent'; $('#review-icon').textContent=submitted?'✓':'↗'; tree(); renderFeed(); counts(); completionButtons(); }
function jump(id) { if(state.mode === 'graph') { const f=files().find(f=>f.id===id); if(f){selectGraphNode(f.path);} return; } const f = files().find(f => f.id === id); if (!f) return; activePath = f.path; tree(); document.getElementById(id)?.scrollIntoView({behavior: 'smooth', block: 'start'}); }
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
document.addEventListener('keydown',e=>{if(e.target.id==='comment-body'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!e.repeat){e.preventDefault();e.target.closest('form').requestSubmit();}});
document.addEventListener('submit', e => {
  const form = e.target.closest('.composer'); if (!form) return; e.preventDefault(); const body = $('#comment-body').value.trim(); if (!body) return;
  const f = files().find(f => f.id === form.dataset.editorFile), index = +form.dataset.index, l = f.lines[index];
  if (editId) review().comments.find(c => c.id === editId).body = body;
  else review().comments.push({id: crypto.randomUUID(), path: f.path, index, line: l.new ?? l.old, side: l.kind === 'del' ? 'old' : 'new', code: l.text, body, resolved: false});
  delete review().drafts[editor]; editor = null; editId = null; persist(); renderFeed(); counts(); toast('Comment added to review');
});
document.addEventListener('change', e => { if (e.target.dataset.viewed) { const path = files().find(f => f.id === e.target.dataset.viewed).path; review().done = review().done.filter(p => p !== path); if (e.target.checked) review().done.push(path); persist(); tree(); counts(); renderFeed(); } });
$('#theme').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; persist(); applyTheme(); };
$('#search').oninput = e => { query = e.target.value.toLowerCase(); tree(); renderFeed(); };
for (const mode of ['files', 'graph']) $('#' + (mode === 'graph' ? 'route' : mode) + '-mode').onclick = () => { state.mode = mode; state.sidebarCollapsed = mode === 'graph'; persist(); render(); };
$('#reset-viewed').onclick=()=>{review().done=[];persist();render();toast('Viewed marks cleared');};
$('#toggle-sidebar').onclick = () => { state.sidebarCollapsed = !state.sidebarCollapsed; persist(); render(); };
function packet(outcome = 'changes_requested') { return {schemaVersion: 2, repo: session.repo, revision: session.revision, outcome, comments: review().comments.filter(c => !c.resolved), instruction: review().instruction || ''}; }
function prompt() { const p = packet(); return reviewPrompt(p) + (p.instruction ? `\n\nAdditional instructions:\n${p.instruction}` : ''); }
function dialogButtons() { const hasFeedback = !!(packet().comments.length || review().instruction.trim()); $('#send').disabled = !hasFeedback || !!jobTimer || sendingReview || submitted; $('#approve').disabled = hasFeedback || !!jobTimer || sendingReview || submitted; $('#cancel-review').disabled = hasFeedback || !!jobTimer || sendingReview || submitted; $('#copy-prompt').disabled = !hasFeedback; }
function openReview() {
  const p = submitted&&activeReview?activeReview:packet();
  $('#agent-info').textContent = session.agent ? 'Codex will run locally in this repository and apply the requested changes.' : session.handoff === 'waiting-agent' ? 'Your feedback will return to the agent that opened this review.' : 'Feedback is saved locally. Your agent can retrieve it with trace-review feedback --json.';
  $('#handoff-help').textContent = 'Only open comments from this revision are sent. If the code changes, refresh the diff before submitting.';
  $('#review-list').innerHTML = p.comments.map(c => `<div class="review-item"><code>${esc(c.path)}:${c.line} · ${c.side === 'old' ? 'old' : 'new'} version</code><p>${esc(c.body)}</p></div>`).join('') || '<p>Add line comments or describe your requested changes below.</p>';
  $('#instruction').value = p.instruction||''; $('#instruction').disabled=submitted; $('#send').hidden = submitted; $('#approve').hidden = submitted; $('#cancel-review').hidden = submitted; if(submitted)$('#job-state').textContent='✓ Review sent. Agent replies appear in the comment threads.';
  $('#send').textContent = session.agent ? 'Send to Codex ↗' : 'Send to agent ↗'; dialogButtons(); $('#handoff').showModal();
};
$('#review').onclick = openReview;
$('#instruction').oninput = e => { review().instruction = e.target.value; persist(); dialogButtons(); };
$('#close-dialog').onclick = () => $('#handoff').close();
$('#copy-prompt').onclick = async () => { try { await navigator.clipboard.writeText(prompt()); toast('Task copied — paste it into your agent chat'); } catch { toast('Clipboard unavailable. Select and copy the review instructions manually.'); } };
function confirmSubmission(job,outcome){
 syncSubmitted({...job.review,replies:job.review.replies||[]});render();showReviewSent(outcome);
 $('#job-state').textContent=outcome==='approved'?'✓ Review approved':outcome==='cancelled'?'Review cancelled':'✓ Review sent. Awaiting agent replies.';
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
 if(sendingReview||submitted)return;
 const payload=packet(outcome);let rejected=false;
 sendingReview=true;sendingCommentIds=new Set(payload.comments.map(c=>c.id));
 $('#handoff').close();toast('Sending review…');render();$('#job-state').textContent='Submitting review…';dialogButtons();
 try{
  const response=await fetch('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json','X-Trace-Token':session.token},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  rejected=!response.ok;const job=await response.json();if(rejected)throw Error(job.error||'Review could not be submitted');
  confirmSubmission(job,outcome);
 }catch(error){
  let latest=null;
  try{const response=await fetch('/api/session',{signal:AbortSignal.timeout(5000)});if(response.ok)latest=await response.json();}catch{}
  if(matchesSubmission(latest?.submittedReview,payload)){
   confirmSubmission({id:latest.submittedReview.id,status:session.agent?'running':'submitted',review:latest.submittedReview},outcome);
  }else{
   const message=rejected||latest&&!latest.submittedReview?'Review was not sent: '+error.message:'Could not confirm delivery. Reconnect or reload to check the saved review before retrying.';
   $('#job-state').textContent=message;toast(message);openReview();
  }
 }finally{sendingReview=false;sendingCommentIds.clear();updatePendingComments();render();dialogButtons();}
}
$('#send').onclick = () => send('changes_requested'); $('#approve').onclick = () => send('approved'); $('#cancel-review').onclick = () => send('cancelled');
async function loadSession() {
  diffLoading=true;graphError=null;renderFeed();
  try {
    const res = await fetch('/api/session'); if (!res.ok) { const error = await res.json(); throw new Error(error.error || 'Local server unavailable'); }
    const next = await res.json(); if (next.sessionId !== session?.sessionId) submitted = false; session = next;
    $('#repo').textContent = session.repo;$('#repo').title=session.repositoryPath||session.repo;
    let locationInfo=$('#repository-location');if(!locationInfo){locationInfo=document.createElement('p');locationInfo.id='repository-location';locationInfo.className='footnote';$('.intro').append(locationInfo);}
    locationInfo.textContent=`${session.repositoryPath||session.repo} · ${session.comparison} against ${session.base}${session.isWorktree?' · Git worktree':''}`; $('#source-badge').textContent = 'LOCAL'; $('#branch').textContent = `${session.branch} → ${session.base} · ${session.comparison}`; $('#title').textContent = 'Changes in ' + session.repo;
    $('#detected').textContent = 'Local dependency graph';
    clearInterval(replyTimer); activeReview = null; submitted = false; $('#instruction').disabled = false; $('#review-status').hidden = true; $('#general-thread').hidden = true;
    $('#refresh').hidden = false; editor = null;
    if (next.submittedReview) syncSubmitted(next.submittedReview);
    diffLoading=false;render();
    acknowledgeViewer();clearInterval(clientHeartbeat);clientHeartbeat=setInterval(acknowledgeViewer,session.viewerHeartbeatMs||5000);
  } catch (err) { diffLoading=false;$('#feed').innerHTML = `<div class="empty">${esc(err.message)}. Start <code>trace-review</code> in your repository and open the printed URL. If this is Claude Desktop, open this exact URL in your default browser: <code>${esc(location.href)}</code>.</div>`; toast(err.message); }
}
$('#refresh').onclick = () => loadSession();
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
 try{const response=await fetch('/api/graph?revision='+encodeURIComponent(target.revision));const data=await response.json();if(!response.ok)throw new Error(data.error);if(session===target){target.graph=data.graph;graphError=null;}}
 catch(error){if(session===target)graphError=error.message;}
 finally{if(graphLoading===target)graphLoading=null;if(session===target&&state.mode==='graph')renderGraph();}
}
function renderGraph() {
 if(!session?.graph){$('#feed').innerHTML=graphError?`<div class="empty">${esc(graphError)} <button id="retry-graph">Retry Graph</button></div>`:'<div class="empty" role="status" aria-busy="true">Building Graph… Your diff is available in Files.</div>';if(graphError)$('#retry-graph').onclick=()=>{graphError=null;loadGraph();renderGraph();};else loadGraph();return;}

  const scrollLeft = $('#feed .graph-viewport')?.scrollLeft || 0;
  const scrollTop = $('#feed .graph-viewport')?.scrollTop || 0;
  const detailScroll = $('#feed .graph-detail')?.scrollTop || 0;
  const graph = session?.graph || {nodes:[], edges:[], sources:{}};
  if(graphRevision !== session?.revision) {
    graphRevision = session?.revision;
    selectedNode = openedNode = null; revealedNodes.clear(); expandedNodes.clear(); draggedPositions.clear(); graphScale = 1;
  }
  const visible = graph.nodes.filter(n => !review().done.includes(n.path) && (n.changed || revealedNodes.has(n.path)) && (!query || n.path.toLowerCase().includes(query)));
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
  const nodes=visible.map(n=>{const p=positions.get(n.path); const commentCount=fileCommentCount(review().comments,n.path); const status=({'A':'+','?':'+','M':'~','D':'−','R':'→'})[n.status] || '';return `<g role="button" tabindex="0" aria-label="Select ${esc(n.path)}" data-node="${esc(n.path)}" class="graph-node ${esc(n.test)} ${n.changed?'':'context'} ${selectedNode===n.path?'selected':''}" transform="translate(${p.x-115},${p.y-24})"><title>${esc(n.oldPath ? n.oldPath+' → '+n.path : n.path)}</title><rect width="230" height="48" rx="9"/><text x="12" y="20">${esc(n.icon)} ${esc(n.path.split('/').at(-1).slice(0,23))}</text><text class="graph-path" x="12" y="37">${esc(n.path.length>32?'…'+n.path.slice(-31):n.path)}</text><text x="211" y="20">${status}</text>${commentCount?`<g class="graph-comment-badge" aria-label="${commentCount} comments"><title>${commentCount} comments</title><rect x="210" y="29" width="${commentCount>99?34:26}" height="22" rx="11"/><text x="${commentCount>99?227:223}" y="44" text-anchor="middle">${commentCount>99?'99+':commentCount}</text></g>`:''}</g>`;}).join('');
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
    el.onclick=()=>selectGraphNode(path);
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectGraphNode(path);}};
    let drag=null;
    const svg=el.ownerSVGElement;
    const point=e=>new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    el.onpointerdown=e=>{
      if(e.button!==0)return;
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
  if(openedNode){const f=files().find(f=>f.path===openedNode);$('#graph-preview-label').hidden=!!f;$('#graph-file-content').innerHTML=f && f.status !== 'D'?fileCard(f):`<div class="file-header">${esc(openedNode)}${f?.status === 'D' ? ' · Previous version' : ''}</div><pre class="graph-source"><code>${esc(graph.sources[openedNode] ?? 'Source preview unavailable (binary, oversized or unreadable file).')}</code></pre>`;}
  if($('#feed .graph-detail')) $('#feed .graph-detail').scrollTop = detailScroll;
  applyUsageHighlights();
  $('#summary').textContent=`${visible.filter(n=>n.changed).length} changed files · ${visible.filter(n=>!n.changed).length} context files`;
}

render(); if (local) loadSession();

function completionButtons() {
  const canFinish = activeReview?.outcome === 'changes_requested' && !activeReview.completion;
  for (const selector of ['#approve-top', '#approve-end']) {
    $(selector).disabled = !session || submitted && !canFinish;
    $(selector).textContent = activeReview?.completion || activeReview?.outcome === 'approved' ? 'Approved ✓' : 'Approve';
  }
  $('#verify-latest').hidden = !canFinish;
  $('#verify-latest').textContent = session?.verifying ? 'Refresh latest changes' : 'Review latest changes';
  $('#verify-latest').title = 'Checks the Git diff on disk. If files have not changed, the displayed diff stays the same.';
  $('#back-to-threads').hidden = !session?.verifying;
  $('#approve-final').hidden = !canFinish;
}
async function verifyLatest() {
  const button=$('#verify-latest');
  if(button.disabled)return;
  const previousRevision=session?.revision, wasVerifying=!!session?.verifying;
  button.disabled=true;button.textContent='Checking…';button.setAttribute('aria-busy','true');
  try {
    const response = await fetch(`/api/reviews/${activeReview.id}/current`);
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    session = data; editor = null; editId = null;
    $('#review-status-text').textContent = 'Latest changes · inspect this diff before approving. Original comment threads are preserved in the previous view.';
    $('#general-thread').hidden = true;
    $('#branch').textContent = `${session.branch} → ${session.base} · ${session.comparison}`;
    render();
    if(wasVerifying && data.revision===previousRevision){toast('No new changes — files on disk match the displayed diff.');}
    else {toast(data.revision===previousRevision?'You are viewing the latest changes.':'Latest changes loaded.');document.querySelector('main').scrollIntoView({block:'start'});}
  } catch (error) { toast(error.message); }
  finally {button.disabled=false;button.removeAttribute('aria-busy');completionButtons();}
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
    await continueAfterApproval(data.review);
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
 const usageButton=(r,i)=>`<button data-usage-result="${i}"><strong>${esc(r.path)}:${r.line??''}</strong><code>${esc(r.text.trim())}</code></button>`;
 usageSelection={name,side};applyUsageHighlights();
 usagesDialog.innerHTML=`<div class="dialog-head"><h2>Find Usages: ${esc(name)}</h2><button data-close-usages aria-label="Close usages">×</button></div><p class="footnote">${results.length} ${results.length===1?'match':'matches'} in the ${side==='old'?'previous':'current'} side of this diff. Matches use identifier spelling, not resolved symbol identity.</p><section class="usage-declaration" aria-label="Declaration in diff"><h3>Declaration</h3>${declaration?usageButton(declaration,results.indexOf(declaration)):'<p>No declaration found in this diff.</p>'}</section><h3>Usages in diff</h3><div class="usage-results">${results.map((r,i)=>r===declaration?'':usageButton(r,i)).join('')||'<p>No other matches in this diff.</p>'}</div>`;
 usagesDialog.querySelector('[data-close-usages]').onclick=()=>closeDiffUsages();
 usagesDialog.querySelectorAll('[data-usage-result]').forEach(button=>button.onclick=()=>{
  const result=results[+button.dataset.usageResult];review().done=review().done.filter(p=>p!==result.path);persist();query='';$('#search').value='';
  if(state.mode==='graph'){selectGraphNode(result.path);}else{renderFeed();jump(result.id);}
  const line=document.getElementById(`${result.id}-line-${result.index}`);
  if(line){line.scrollIntoView({block:'center',behavior:'smooth'});line.classList.add('usage-highlight');const symbol=[...line.querySelectorAll('.diff-symbol')].find(t=>+t.dataset.offset===result.start);symbol?.focus({preventScroll:true});setTimeout(()=>line.classList.remove('usage-highlight'),2500);}
 });
 usagesDialog.hidden=false; document.body.classList.add('usages-open');
}
document.addEventListener('click',e=>{const target=e.target.closest('.diff-symbol');if(target && !window.getSelection()?.toString()){e.preventDefault();openDiffUsages(target);}});
document.addEventListener('keydown',e=>{if(e.altKey&&e.key==='F7'){if(e.target.matches('input,textarea,[contenteditable="true"]'))return;e.preventDefault();if(usageTarget?.isConnected)openDiffUsages(usageTarget);else toast('Click an identifier in the diff, then press Option + F7');}});

function closeDiffUsages(){usageSelection=null;applyUsageHighlights();usagesDialog.hidden=true;document.body.classList.remove('usages-open');}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!usagesDialog.hidden){closeDiffUsages();}if((e.key==='Enter'||e.key===' ')&&e.target.matches('.diff-symbol')){e.preventDefault();openDiffUsages(e.target);}});

function showReviewSent(outcome){
 const dialog=$('#handoff');
 const message=outcome==='approved'?'Review approved':outcome==='cancelled'?'Review cancelled':'Review sent';
 if(!dialog.open){toast('✓ '+message);return;}
 $('#job-state').textContent='✓ '+message;
 dialog.classList.add('review-sent');
 setTimeout(()=>{if(!dialog.open){dialog.classList.remove('review-sent');return;}dialog.classList.add('review-closing');setTimeout(()=>{dialog.close();dialog.classList.remove('review-closing','review-sent');toast('✓ '+message);},180);},650);
}


async function continueAfterApproval(approval){
 if(continuingApproval)return;
 continuingApproval=true;
 try{
   const response=await fetch(`/api/reviews/${approval.id}/continue`,{method:'POST',headers:{'X-Trace-Token':session.token,Origin:location.origin}});
   const data=await response.json();if(!response.ok)throw new Error(data.error);
   const done=[...review().done];
   session=data;submitted=false;activeReview=null;clearInterval(replyTimer);
   state.reviews[key()]={comments:[],drafts:{},instruction:'',done};persist();
   $('#instruction').disabled=false;$('#refresh').hidden=false;
   $('#review-status').hidden=false;
   $('#review-status-text').textContent='✓ Approval saved. You can add more feedback and send another review.';
   $('#reply-connection').textContent='Previous review and agent replies remain saved in review history.';
   $('#general-thread').hidden=true;
   render();
 }catch(error){toast('Approval saved. Could not continue: '+error.message);}
 finally{continuingApproval=false;}
}

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

function orderedComments(){
 const order=new Map(fileTreeOrder(files()).map((f,i)=>[f.path,i]));
 return [...review().comments].sort((a,b)=>(order.get(a.path)??Infinity)-(order.get(b.path)??Infinity)||a.index-b.index||a.id.localeCompare(b.id));
}
function updateCommentNavigation(){
 const comments=orderedComments(),index=comments.findIndex(c=>c.id===activeCommentId),noun=comments.length===1?'comment':'comments';
 $('#comment-position').textContent=index<0?`${comments.length} ${noun}`:`${index+1} / ${comments.length} ${noun}`;
 $('#previous-comment').disabled=$('#next-comment').disabled=!comments.length;
}
async function navigateComment(direction){
 const comments=orderedComments();if(!comments.length)return;
 const current=comments.findIndex(c=>c.id===activeCommentId),index=current<0?(direction>0?0:comments.length-1):(current+direction+comments.length)%comments.length;
 const target=comments[index];if(session.verifying)await loadSession();
 activeCommentId=target.id;query='';$('#search').value='';editor=null;editId=null;
 if(state.mode==='graph'){if(!session.graph)await loadGraph();selectGraphNode(target.path);}else renderFeed();
 tree();counts();const element=document.querySelector(`[data-comment-id="${CSS.escape(target.id)}"]`);
 if(element){element.focus({preventScroll:true});element.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
}
$('#previous-comment').onclick=()=>navigateComment(-1);
$('#next-comment').onclick=()=>navigateComment(1);
function acknowledgeViewer(){if(session)fetch('/api/client-ready',{method:'POST',headers:{'X-Trace-Token':session.token}}).catch(()=>{});}
window.addEventListener('pageshow',acknowledgeViewer);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)acknowledgeViewer();});
