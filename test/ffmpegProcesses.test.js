'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { StreamingDelegate } = require('../src/streamingDelegate');
const { RecordingDelegate } = require('../src/recordingDelegate');
const { Prebuffer } = require('../src/prebuffer');

const SECRET_URL = 'rtsp://camera-user:camera-password@192.168.4.24/live';

function fakeChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function fakeLog() {
  const entries = [];
  return {
    entries,
    debug: (...args) => entries.push(args),
    info: (...args) => entries.push(args),
    error: (...args) => entries.push(args),
  };
}

function assertLogsAreSanitized(log) {
  const output = JSON.stringify(log.entries);
  assert.doesNotMatch(output, /camera-user|camera-password|rtsp:\/\//i);
}

test('snapshot spawn errors are handled without logging sensitive diagnostics', async () => {
  const child = fakeChildProcess();
  const log = fakeLog();
  const delegate = new StreamingDelegate(log, {}, SECRET_URL, {
    spawn: () => child,
    getFfmpegPath: () => '/safe/ffmpeg',
  });

  const result = new Promise(resolve => {
    delegate.handleSnapshotRequest({ width: 640, height: 480 }, error => resolve(error));
  });
  const spawnError = new Error(`spawn failed for ${SECRET_URL}`);
  spawnError.spawnargs = ['-i', SECRET_URL];
  child.stderr.emit('data', Buffer.from(SECRET_URL));
  child.emit('error', spawnError);

  assert.match((await result).message, /snapshot failed/i);
  assertLogsAreSanitized(log);
});

test('live stream spawn errors are handled without logging sensitive diagnostics', async () => {
  const child = fakeChildProcess();
  const log = fakeLog();
  const delegate = new StreamingDelegate(log, {}, SECRET_URL, {
    spawn: () => child,
    getFfmpegPath: () => '/safe/ffmpeg',
  });
  delegate.sessions.set('session-1', {
    address: '127.0.0.1',
    videoPort: 5000,
    videoSSRC: 1,
    videoSRTP: Buffer.from('video'),
    audioPort: 5001,
    audioSSRC: 2,
    audioSRTP: Buffer.from('audio'),
    sampleRate: 16,
  });

  let callbackCount = 0;
  await delegate.handleStreamRequest({
    type: 'start',
    sessionID: 'session-1',
    video: { width: 640, height: 480, fps: 30, max_bit_rate: 300 },
    audio: { codec: 'AAC-eld' },
  }, () => { callbackCount += 1; });

  const spawnError = new Error(`spawn failed for ${SECRET_URL}`);
  spawnError.spawnargs = ['-i', SECRET_URL];
  child.emit('error', spawnError);

  assert.equal(callbackCount, 1);
  assert.equal(delegate.sessions.has('session-1'), false);
  assertLogsAreSanitized(log);
});

test('recording spawn errors end the stream without logging sensitive diagnostics', async () => {
  const child = fakeChildProcess();
  const log = fakeLog();
  const hap = {
    EventTriggerOption: { MOTION: 1, DOORBELL: 2 },
    MediaContainerType: { FRAGMENTED_MP4: 1 },
    VideoCodecType: { H264: 1 },
    H264Profile: { BASELINE: 1, MAIN: 2, HIGH: 3 },
    H264Level: { LEVEL3_1: 1, LEVEL3_2: 2, LEVEL4_0: 3 },
    AudioRecordingCodecType: { AAC_LC: 1 },
    AudioRecordingSamplerate: { KHZ_16: 16 },
  };
  const delegate = new RecordingDelegate(log, hap, SECRET_URL, { getBuffer: () => Buffer.alloc(0) }, {
    spawn: () => child,
    getFfmpegPath: () => '/safe/ffmpeg',
  });

  const generator = delegate.handleRecordingStreamRequest('recording-1');
  const result = generator.next();
  setImmediate(() => {
    const spawnError = new Error(`spawn failed for ${SECRET_URL}`);
    spawnError.spawnargs = ['-i', SECRET_URL];
    child.emit('error', spawnError);
  });

  assert.equal((await result).done, true);
  assertLogsAreSanitized(log);
});

test('prebuffer spawn errors stop safely without logging sensitive diagnostics', () => {
  const child = fakeChildProcess();
  const log = fakeLog();
  const prebuffer = new Prebuffer(log, SECRET_URL, {
    spawn: () => child,
    getFfmpegPath: () => '/safe/ffmpeg',
  });

  prebuffer.start();
  const spawnError = new Error(`spawn failed for ${SECRET_URL}`);
  spawnError.spawnargs = ['-i', SECRET_URL];
  child.emit('error', spawnError);

  assert.equal(prebuffer.running, false);
  assertLogsAreSanitized(log);
});
