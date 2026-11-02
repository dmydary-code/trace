import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGitRunner} from '../lib/git-command.mjs';

test('Xcode-blocked Git uses a working fallback and keeps literal arguments', async t => {
 const dir=await mkdtemp(join(tmpdir(),'trace-git-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 const bad=join(dir,'blocked'), good=join(dir,'working');
 await writeFile(bad,'#!/bin/sh\necho "You have not agreed to the Xcode license agreement" >&2\nexit 69\n',{mode:0o755});
 await writeFile(good,'#!/bin/sh\nprintf "%s\\n" "$@"\n',{mode:0o755});
 const run=createGitRunner({primary:bad,fallbacks:[good]});
 const args=['--literal-pathspecs','-C','/a repo','diff','--','[literal];file'];
 assert.equal(await run(args),args.join('\n')+'\n');
 await rm(bad); assert.equal(await run(['--version']),'--version\n');
});

test('blocked Git reports an actionable error and ordinary Git failures stay intact', async t => {
 const dir=await mkdtemp(join(tmpdir(),'trace-git-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 const bad=join(dir,'git');
 await writeFile(bad,'#!/bin/sh\necho "You have not agreed to the Xcode license agreement" >&2\nexit 69\n',{mode:0o755});
 await assert.rejects(createGitRunner({primary:bad,fallbacks:[]})(['status']),error=>/brew install git/.test(error.message)&&/comments remain/.test(error.message)&&!/Command failed/.test(error.message));
 await writeFile(bad,'#!/bin/sh\necho "fatal: not a git repository" >&2\nexit 128\n',{mode:0o755});
 await assert.rejects(createGitRunner({primary:bad,fallbacks:[]})(['status']),/not a git repository/);
});
