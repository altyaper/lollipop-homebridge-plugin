'use strict';

const { LollipopCameraAccessory } = require('./cameraAccessory');

const PLUGIN_NAME = 'homebridge-lollipop-plugin';
const PLATFORM_NAME = 'LollipopCamera';

class LollipopPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = new Map();
    this.debug = config.debug || false;

    if (!config.cameras || config.cameras.length === 0) {
      this.log.warn('No cameras configured. Add at least one camera with an IP address.');
      return;
    }

    this.api.on('didFinishLaunching', () => this.discoverDevices());
  }

  configureAccessory(accessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  discoverDevices() {
    const cameras = this.config.cameras || [];

    for (const cameraConfig of cameras) {
      if (!cameraConfig.ip) {
        this.log.warn(`Camera "${cameraConfig.name}" has no IP address — skipping.`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`lollipop-${cameraConfig.ip}`);
      const existing = this.accessories.get(uuid);

      if (existing) {
        this.log.info(`Restoring: ${cameraConfig.name} (${cameraConfig.ip})`);
        new LollipopCameraAccessory(this, existing, cameraConfig);
      } else {
        this.log.info(`Adding: ${cameraConfig.name} (${cameraConfig.ip})`);
        const accessory = new this.api.platformAccessory(
          cameraConfig.name, uuid, this.api.hap.Categories.IP_CAMERA,
        );
        new LollipopCameraAccessory(this, accessory, cameraConfig);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
    }

    // Remove stale accessories no longer in config
    for (const [uuid, accessory] of this.accessories) {
      const stillExists = cameras.some(c =>
        this.api.hap.uuid.generate(`lollipop-${c.ip}`) === uuid,
      );
      if (!stillExists) {
        this.log.info(`Removing stale accessory: ${accessory.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }
}

module.exports = { LollipopPlatform };
