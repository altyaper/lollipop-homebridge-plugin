'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const schema = require('../config.schema.json');

test('camera settings expose the authenticated RTSP URL as a password field', () => {
  const rtspUrl = schema.schema.properties.cameras.items.properties.rtspUrl;

  assert.equal(rtspUrl.type, 'string');
  assert.equal(rtspUrl.format, 'password');
  assert.match(rtspUrl.description, /authenticated RTSP/i);
});
