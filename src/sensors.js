'use strict';

const RESET_TIMES = {
  movement: 30000,
  crying: 60000,
  crossing: 60000,
  noise: 60000,
};

class SensorManager {
  constructor(log, hap, accessory, config) {
    this.log = log;
    this.hap = hap;
    this.accessory = accessory;
    this.config = config;
    this.timers = {};
    this.services = {};

    const ServiceType = config.contactSensors
      ? hap.Service.ContactSensor
      : hap.Service.MotionSensor;

    const DetectedChar = config.contactSensors
      ? hap.Characteristic.ContactSensorState
      : hap.Characteristic.MotionDetected;

    const falseValue = config.contactSensors
      ? hap.Characteristic.ContactSensorState.CONTACT_DETECTED
      : false;

    const trueValue = config.contactSensors
      ? hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : true;

    const sensors = [];

    if ((config.movementSensitivity || 10) > 0) {
      sensors.push({ key: 'movement', name: 'Movement Sensor' });
    }
    if (config.enableCryingDetectionSensor) {
      sensors.push({ key: 'crying', name: 'Crying Detection Sensor' });
    }
    if (config.enableCrossingDetectionSensor) {
      sensors.push({ key: 'crossing', name: 'Crossing Detection Sensor' });
    }
    if (config.enableNoiseSensor) {
      sensors.push({ key: 'noise', name: 'Noise Sensor' });
    }

    for (const { key, name } of sensors) {
      const service = accessory.getService(name) ||
        accessory.addService(ServiceType, name, key);
      service.setCharacteristic(hap.Characteristic.Name, name);
      service.getCharacteristic(DetectedChar).setValue(falseValue);
      this.services[key] = { service, DetectedChar, falseValue, trueValue };
    }

    // HKSV motion sensor — always MotionSensor
    if (config.hksv) {
      const hksvService = accessory.getService('HKSV Sensor') ||
        accessory.addService(hap.Service.MotionSensor, 'HKSV Sensor', 'hksv');
      hksvService.getCharacteristic(hap.Characteristic.MotionDetected).setValue(false);
      this.services['hksv'] = {
        service: hksvService,
        DetectedChar: hap.Characteristic.MotionDetected,
        falseValue: false,
        trueValue: true,
      };
    }
  }

  trigger(key, resetMs) {
    const sensor = this.services[key];
    if (!sensor) return;

    this.log.info(`[Sensor] ${key} triggered`);
    sensor.service.getCharacteristic(sensor.DetectedChar).setValue(sensor.trueValue);

    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(() => {
      sensor.service.getCharacteristic(sensor.DetectedChar).setValue(sensor.falseValue);
    }, resetMs || RESET_TIMES[key] || 30000);

    // Always trigger HKSV sensor too
    if (key !== 'hksv') {
      this.trigger('hksv', resetMs || RESET_TIMES[key]);
    }
  }

  triggerMovement(motionLevel) {
    const threshold = this.config.movementSensitivity ?? 10;
    if (threshold === 0) return;
    if (motionLevel >= threshold) {
      this.trigger('movement', RESET_TIMES.movement);
    }
  }

  triggerEvent(eventType) {
    const map = { 1: 'crying', 2: 'crossing', 3: 'noise' };
    const key = map[eventType];
    if (key) this.trigger(key, RESET_TIMES[key]);
  }

  cleanup() {
    for (const timer of Object.values(this.timers)) clearTimeout(timer);
  }
}

module.exports = { SensorManager };
