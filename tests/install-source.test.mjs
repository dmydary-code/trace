import test from 'node:test';
import assert from 'node:assert/strict';
import {isTraceBrewMigration} from '../lib/install-source.mjs';

test('agent source migration accepts renamed Homebrew releases but rejects unrelated sources', () => {
 assert.equal(isTraceBrewMigration('/opt/homebrew/Cellar/trace/0.2.3/libexec','/opt/homebrew/Cellar/trace-review/0.2.4/libexec'),true);
 assert.equal(isTraceBrewMigration('/opt/homebrew/opt/trace/libexec','/opt/homebrew/Cellar/trace-review/0.2.4/libexec'),true);
 assert.equal(isTraceBrewMigration('/usr/local/Cellar/trace-review/0.2.4/libexec','/usr/local/Cellar/trace-review/0.2.5/libexec'),true);
 for(const previous of ['/tmp/trace/libexec','/opt/homebrew/Cellar/unrelated/1/libexec','/usr/local/Cellar/trace/0.2.3/libexec','/opt/homebrew/Cellar/trace/0.2.3/libexec/plugins']) {
  assert.equal(isTraceBrewMigration(previous,'/opt/homebrew/Cellar/trace-review/0.2.4/libexec'),false);
 }
});
