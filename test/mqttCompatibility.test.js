'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const mqttPackage = require('mqtt/package.json');

test('ships the MQTT 4 compatibility line used by the working reference plugin', () => {
  assert.match(mqttPackage.version, /^4\./);
});
