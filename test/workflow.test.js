'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'publish.yml');

function workflow() {
  return fs.readFileSync(workflowPath, 'utf8');
}

test('workflow tests pull requests and main pushes with concurrency protection', () => {
  const source = workflow();

  assert.match(source, /pull_request:/);
  assert.match(source, /branches:\s*\[main\]/);
  assert.match(source, /concurrency:/);
  assert.match(source, /group:/);
});

test('workflow publishes only a committed version tag and never versions after publication', () => {
  const source = workflow();

  assert.match(source, /tags:\s*\['v\*'\]/);
  assert.match(source, /Verify tag matches package version/);
  assert.match(source, /npm publish/);
  assert.ok(source.indexOf('Verify tag matches package version') < source.indexOf('npm publish'));
  assert.doesNotMatch(source, /npm version|git commit|git push/);
});

test('workflow pins third-party actions to immutable commit SHAs', () => {
  const source = workflow();

  assert.match(source, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(source, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
});
