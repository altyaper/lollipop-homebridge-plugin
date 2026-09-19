'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const mqtt = require('mqtt');
const mqttPackage = require('mqtt/package.json');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');
const { LollipopCameraAccessory } = require('../src/cameraAccessory');

test('ships the exact MQTT version locked by the working reference plugin', () => {
  assert.equal(packageJson.dependencies.mqtt, '4.2.8');
  assert.equal(packageLock.packages[''].dependencies.mqtt, '4.2.8');
  assert.equal(mqttPackage.version, '4.2.8');
});

test('uses the reference plugin minimal TLS connection options for pairing discovery', async () => {
  const originalConnect = mqtt.connect;
  let connection;
  mqtt.connect = (url, options) => {
    connection = { url, options };
    const client = new EventEmitter();
    client.subscribe = () => {};
    client.end = () => {};
    process.nextTick(() => client.emit('message', 'pairing-id/status', Buffer.alloc(0)));
    return client;
  };

  try {
    const camera = Object.create(LollipopCameraAccessory.prototype);
    camera.config = { ip: '192.168.4.24' };
    await camera.discoverPairingID();
    assert.deepEqual(connection, {
      url: 'mqtts://192.168.4.24:1883',
      options: { rejectUnauthorized: false },
    });
  } finally {
    mqtt.connect = originalConnect;
  }
});

test('uses the reference plugin minimal TLS options for the operational MQTT connection', async () => {
  const originalConnect = mqtt.connect;
  let connection;
  mqtt.connect = (url, options) => {
    connection = { url, options };
    const client = new EventEmitter();
    client.subscribe = () => {};
    process.nextTick(() => client.emit('connect'));
    return client;
  };

  try {
    const camera = Object.create(LollipopCameraAccessory.prototype);
    Object.assign(camera, {
      config: { ip: '192.168.4.24', name: 'Camera' },
      pairingID: 'pairing-id',
      log: { info: () => {}, debug: () => {} },
    });
    await camera.setupMQTT();
    assert.deepEqual(connection, {
      url: 'mqtts://192.168.4.24:1883',
      options: { rejectUnauthorized: false },
    });
  } finally {
    mqtt.connect = originalConnect;
  }
});
