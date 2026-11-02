import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const licenseBlocked = error => /(?:xcode|apple).*licen[cs]e|licen[cs]e.*(?:xcode|apple)/is.test(error.stderr || error.message || '');
async function invoke(command, args) {
  const pending = exec(command, args, {maxBuffer: 32 * 1024 * 1024});
  pending.child.stdin?.end();
  return (await pending).stdout;
}
export function createGitRunner({primary = 'git', fallbacks = ['/opt/homebrew/bin/git', '/usr/local/bin/git']} = {}) {
 let selected;
 return async function gitOutput(args) {
  const explicit = process.env.TRACE_GIT_BIN;
  try { return await invoke(explicit || selected || primary, args); }
  catch (error) {
    if (!licenseBlocked(error)) throw error;
    if (!explicit) {
      for (const command of fallbacks) {
        if (command === selected) continue;
        try {
          await invoke(command, ['--version']);
          const output = await invoke(command, args); selected = command; return output;
        } catch (fallbackError) {
          if (fallbackError.code !== 'ENOENT' && !licenseBlocked(fallbackError)) throw fallbackError;
        }
      }
    }
    throw new Error('Git is blocked by the Xcode license agreement. Install Homebrew Git with brew install git and restart Trace, or review and accept the Xcode license yourself in Xcode. If you were submitting a review, your comments remain in this browser; retry after fixing Git.', {cause:error});
  }
}

}
export const gitOutput = createGitRunner();
