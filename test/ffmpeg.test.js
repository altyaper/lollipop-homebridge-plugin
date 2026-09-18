'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { selectFfmpegPath } = require('../src/ffmpeg');

test('selects an explicit FFMPEG_PATH only when it is executable', () => {
  const selected = selectFfmpegPath({
    explicitPath: '/configured/ffmpeg',
    bundledPath: '/bundled/ffmpeg',
    pathValue: '/system/bin',
    isExecutable: candidate => candidate === '/configured/ffmpeg',
  });

  assert.equal(selected, '/configured/ffmpeg');
});

test('skips unusable configured and bundled paths and selects an executable from PATH', () => {
  const checked = [];
  const selected = selectFfmpegPath({
    explicitPath: '/configured/missing',
    bundledPath: '/bundled/missing',
    pathValue: '/first/bin:/system/bin',
    isExecutable: candidate => {
      checked.push(candidate);
      return candidate === '/system/bin/ffmpeg';
    },
  });

  assert.equal(selected, '/system/bin/ffmpeg');
  assert.deepEqual(checked, [
    '/configured/missing',
    '/bundled/missing',
    '/first/bin/ffmpeg',
    '/system/bin/ffmpeg',
  ]);
});

test('fails with a sanitized actionable error when no usable FFmpeg exists', () => {
  assert.throws(
    () => selectFfmpegPath({
      explicitPath: '/secret/location/ffmpeg',
      bundledPath: '/broken/bundled/ffmpeg',
      pathValue: '/empty/bin',
      isExecutable: () => false,
    }),
    error => {
      assert.match(error.message, /install FFmpeg or set FFMPEG_PATH/i);
      assert.doesNotMatch(error.message, /secret|broken|empty/i);
      return true;
    },
  );
});

test('rejects an executable directory as an FFmpeg binary', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lollipop-ffmpeg-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.chmodSync(directory, 0o755);

  assert.throws(
    () => selectFfmpegPath({
      explicitPath: directory,
      bundledPath: undefined,
      pathValue: '',
    }),
    /No usable FFmpeg executable found/i,
  );
});

test('accepts an executable regular file as an FFmpeg binary', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lollipop-ffmpeg-'));
  const executable = path.join(directory, 'ffmpeg');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(executable, '#!/bin/sh\n');
  fs.chmodSync(executable, 0o755);

  assert.equal(selectFfmpegPath({
    explicitPath: executable,
    bundledPath: undefined,
    pathValue: '',
  }), executable);
});
