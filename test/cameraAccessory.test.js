'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { LollipopCameraAccessory } = require('../src/cameraAccessory');

function createCachedAccessory(serviceTypes, cachedServices) {
  const information = { subtype: 'accessory-information' };
  const services = [information, ...cachedServices];
  const removed = [];

  return {
    information,
    services,
    removed,
    getService(type) {
      return type === serviceTypes.AccessoryInformation ? information : undefined;
    },
    getServiceById(type, subtype) {
      return services.find(service => service.type === type && service.subtype === subtype);
    },
    removeService(service) {
      removed.push(service);
      services.splice(services.indexOf(service), 1);
    },
  };
}

test('authenticated RTSP configuration initializes streaming without MQTT discovery or secret logging', async () => {
  const configured = 'rtsp://u:p@192.168.4.24/live/camera/ch00_0';
  const logLines = [];
  const camera = Object.create(LollipopCameraAccessory.prototype);
  Object.assign(camera, {
    config: { name: "Andrea's Room", ip: '192.168.4.24', rtspUrl: configured },
    log: {
      info: message => logLines.push(String(message)),
      warn: message => logLines.push(String(message)),
      error: message => logLines.push(String(message)),
    },
    rtspUrl: null,
  });

  let discoveryCalls = 0;
  let mqttCalls = 0;
  let homeKitCalls = 0;
  camera.discoverPairingID = async () => { discoveryCalls += 1; };
  camera.setupMQTT = async () => { mqttCalls += 1; };
  camera.removeMqttServices = () => {};
  camera.setupHomeKit = () => { homeKitCalls += 1; };

  await camera.initialize();

  assert.equal(camera.rtspUrl, configured);
  assert.equal(discoveryCalls, 0);
  assert.equal(mqttCalls, 0);
  assert.equal(homeKitCalls, 1);
  assert.equal(logLines.join('\n').includes('u:p'), false);
});

test('authenticated direct mode removes cached MQTT-only services without removing core services', async () => {
  const Service = {
    AccessoryInformation: Symbol('AccessoryInformation'),
    MotionSensor: Symbol('MotionSensor'),
    ContactSensor: Symbol('ContactSensor'),
    Switch: Symbol('Switch'),
  };
  const cachedServices = [
    { type: Service.MotionSensor, subtype: 'movement' },
    { type: Service.ContactSensor, subtype: 'crying' },
    { type: Service.MotionSensor, subtype: 'crossing' },
    { type: Service.ContactSensor, subtype: 'noise' },
    { type: Service.MotionSensor, subtype: 'hksv' },
    { type: Service.Switch, subtype: 'soundmachine' },
  ];
  const accessory = createCachedAccessory(Service, cachedServices);
  const camera = Object.create(LollipopCameraAccessory.prototype);
  Object.assign(camera, {
    accessory,
    hap: { Service },
    config: {
      name: 'Restored Camera',
      ip: '192.168.4.24',
      rtspUrl: 'rtsp://u:p@192.168.4.24/live/camera/ch00_0',
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  let configuredController = false;
  camera.setupHomeKit = () => { configuredController = true; };

  await camera.initialize();

  assert.deepEqual(accessory.removed, cachedServices);
  assert.deepEqual(accessory.services, [accessory.information]);
  assert.equal(configuredController, true);
});

test('authenticated direct mode tolerates a new accessory with no cached MQTT-only services', async () => {
  const Service = {
    AccessoryInformation: Symbol('AccessoryInformation'),
    MotionSensor: Symbol('MotionSensor'),
    ContactSensor: Symbol('ContactSensor'),
    Switch: Symbol('Switch'),
  };
  const accessory = createCachedAccessory(Service, []);
  const camera = Object.create(LollipopCameraAccessory.prototype);
  Object.assign(camera, {
    accessory,
    hap: { Service },
    config: {
      name: 'New Camera',
      ip: '192.168.4.24',
      rtspUrl: 'rtsp://u:p@192.168.4.24/live/camera/ch00_0',
    },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  let configuredController = false;
  camera.setupHomeKit = () => { configuredController = true; };

  await camera.initialize();

  assert.deepEqual(accessory.removed, []);
  assert.deepEqual(accessory.services, [accessory.information]);
  assert.equal(configuredController, true);
});

test('legacy mode discovers an anonymous MQTT pairing ID before deriving its password-free stream', async () => {
  const camera = Object.create(LollipopCameraAccessory.prototype);
  Object.assign(camera, {
    config: { name: 'Legacy Camera', ip: '192.168.4.24' },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    pairingID: null,
    rtspUrl: null,
  });

  const calls = [];
  camera.discoverPairingID = async () => {
    calls.push('discover');
    camera.pairingID = 'pairing-id';
  };
  camera.setupMQTT = async () => { calls.push('mqtt'); };
  camera.setupHomeKit = mqttAvailable => { calls.push(`homekit:${mqttAvailable}`); };

  await camera.initialize();

  assert.deepEqual(calls, ['discover', 'mqtt', 'homekit:true']);
  assert.equal(
    camera.rtspUrl,
    'rtsp://192.168.4.24:554/live/c9206501e603f9fbc5f72cc2cb1f6e9f/ch00_0',
  );
});
