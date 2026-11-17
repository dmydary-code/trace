import {readFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {activeListeners} from '../plugins/trace/hooks/listeners.mjs';
import {readReview} from './reviews.mjs';

export async function pendingFeedback(lease, seconds) {
  const deadline = Date.now() + seconds * 1000;
  const handled = new Set();
  do {
    const listeners = activeListeners(lease);
    if (!listeners.length) return {status:'closed', feedback:[]};
    const feedback = [];
    const seen = new Set();
    for (const {journal, repo, gitDir} of listeners) {
      let ids;
      try { ids = await readFile(journal, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const id of ids.trim().split('\n').filter(Boolean)) {
        const key = gitDir + '/' + id;
        if (handled.has(key) || seen.has(key)) continue;
        seen.add(key);
        const review = await readReview(gitDir, id);
        if (review.completion || review.outcome !== 'changes_requested') {
          handled.add(key);
          continue;
        }
        const answered = new Set(review.replies.map(reply => reply.commentId));
        const comments = review.comments.filter(comment => !answered.has(comment.id));
        const instruction = answered.has('review') ? '' : review.instruction;
        if (comments.length || instruction) {
          const {revision, scope, commit, replyTo, thread} = review;
          feedback.push({repo, id, revision, scope, commit, replyTo, thread, comments, instruction});
        } else {
          handled.add(key);
        }
      }
    }
    if (feedback.length) return {status:'feedback', feedback};
    const remaining = deadline - Date.now();
    if (remaining <= 0) return {status:'waiting', feedback:[]};
    await pause(Math.min(1000, remaining));
  } while (true);
}
