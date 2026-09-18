'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveRtspUrl, selectRuntimeFeatures } = require('../src/cameraConnection');

test('accepts an authenticated rtsp URL for the configured camera IP', () => {
  const configured = 'rtsp://u:p@192.168.4.24/live/camera/ch00_0';

  assert.equal(resolveRtspUrl({ ip: '192.168.4.24', rtspUrl: configured }), configured);
});

test('rejects a credentialless direct RTSP URL', () => {
  assert.throws(
    () => resolveRtspUrl({
      ip: '192.168.4.24',
      rtspUrl: 'rtsp://192.168.4.24/live/camera/ch00_0',
    }),
    /username and password/i,
  );
});

test('rejects a username-only direct RTSP URL', () => {
  assert.throws(
    () => resolveRtspUrl({
      ip: '192.168.4.24',
      rtspUrl: 'rtsp://u@192.168.4.24/live/camera/ch00_0',
    }),
    /username and password/i,
  );
});

test('accepts an authenticated rtsps URL for the configured camera IP', () => {
  const configured = 'rtsps://u:p@192.168.4.24/live/camera/ch00_0';

  assert.equal(resolveRtspUrl({ ip: '192.168.4.24', rtspUrl: configured }), configured);
});

test('accepts an authenticated rtsp URL for the exact configured IPv6 address', () => {
  const configured = 'rtsp://u:p@[2001:db8::24]/live/camera/ch00_0';

  assert.equal(resolveRtspUrl({ ip: '2001:db8::24', rtspUrl: configured }), configured);
});

test('accepts an authenticated rtsps URL for the exact configured IPv6 address', () => {
  const configured = 'rtsps://u:p@[2001:db8::24]/live/camera/ch00_0';

  assert.equal(resolveRtspUrl({ ip: '2001:db8::24', rtspUrl: configured }), configured);
});

test('rejects an authenticated stream URL for a different IPv6 address', () => {
  assert.throws(
    () => resolveRtspUrl({
      ip: '2001:db8::24',
      rtspUrl: 'rtsp://u:p@[2001:db8::25]/live/camera/ch00_0',
    }),
    /camera IP/i,
  );
});

test('rejects direct mode when the configured camera IP is not an IP address', () => {
  assert.throws(
    () => resolveRtspUrl({
      ip: 'camera.local',
      rtspUrl: 'rtsp://u:p@camera.local/live/camera/ch00_0',
    }),
    /valid IP address/i,
  );
});

test('rejects configured stream URLs that are not RTSP', () => {
  assert.throws(
    () => resolveRtspUrl({ ip: '192.168.4.24', rtspUrl: 'https://example.test/video' }),
    /RTSP URL/i,
  );
});

test('rejects an authenticated stream URL for a different host', () => {
  assert.throws(
    () => resolveRtspUrl({
      ip: '192.168.4.24',
      rtspUrl: 'rtsp://u:p@example.test/live/camera/ch00_0',
    }),
    /camera IP/i,
  );
});

test('preserves the senorshaun-style password-free pairing ID fallback', () => {
  assert.equal(
    resolveRtspUrl({ ip: '192.168.4.24' }, 'pairing-id'),
    'rtsp://192.168.4.24:554/live/c9206501e603f9fbc5f72cc2cb1f6e9f/ch00_0',
  );
});

test('requires either a configured RTSP URL or a pairing ID', () => {
  assert.throws(
    () => resolveRtspUrl({ ip: '192.168.4.24' }),
    /pairing ID/i,
  );
});

test('disables MQTT-backed accessories when only an authenticated stream is available', () => {
  assert.deepEqual(
    selectRuntimeFeatures({ enableSoundMachine: true }, false),
    { sensors: false, soundMachine: false },
  );
});

test('keeps configured MQTT-backed accessories when MQTT is available', () => {
  assert.deepEqual(
    selectRuntimeFeatures({ enableSoundMachine: true }, true),
    { sensors: true, soundMachine: true },
  );
});