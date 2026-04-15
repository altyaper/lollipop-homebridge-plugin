'use strict';

const { LollipopCameraAccessory } = require('./cameraAccessory');
const { login, fetchCameras } = require('./lollipopApi');

const PLUGIN_NAME = 'homebridge-lollipop-monitor';
const PLATFORM_NAME = 'LollipopCamera';

class LollipopPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = new Map(); // uuid → PlatformAccessory

    if (!config?.email || !config?.password) {
      this.log.warn('Lollipop: email and password are required in config.');
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  async discoverDevices() {
    try {
      this.log.info('Logging in to Lollipop API...');
      const sessionToken = await login(this.config.email, this.config.password);

      this.log.info('Fetching cameras...');
      const cameras = await fetchCameras(sessionToken, this.log.debug.bind(this.log));

      if (cameras.length === 0) {
        this.log.warn('No cameras found in your Lollipop account.');
        return;
      }

      this.log.info(`Found ${cameras.length} camera(s).`);

      for (const cameraConfig of cameras) {
        const uuid = this.api.hap.uuid.generate(`lollipop-${cameraConfig.cameraId}`);
        const existing = this.accessories.get(uuid);

        if (existing) {
          this.log.info(`Restoring: ${cameraConfig.name}`);
          new LollipopCameraAccessory(this, existing, cameraConfig);
        } else {
          this.log.info(`Adding: ${cameraConfig.name}`);
          const accessory = new this.api.platformAccessory(
            cameraConfig.name, uuid, this.api.hap.Categories.IP_CAMERA,
          );
          this.log.info('HAP keys: ' + Object.keys(this.api.hap).filter(k => k.includes('Camera') || k.includes('H264') || k.includes('SRTP') || k.includes('Audio')).join(', '));
          new LollipopCameraAccessory(this, accessory, cameraConfig);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.accessories.set(uuid, accessory);
        }
      }

      // Remove accessories no longer in account
      for (const [uuid, accessory] of this.accessories) {
        const stillExists = cameras.some(c =>
          this.api.hap.uuid.generate(`lollipop-${c.cameraId}`) === uuid,
        );
        if (!stillExists) {
          this.log.info(`Removing stale accessory: ${accessory.displayName}`);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.accessories.delete(uuid);
        }
      }
    } catch (err) {
      this.log.error('Failed to discover Lollipop cameras:', err.message);
      this.log.error(err.stack);
    }
  }
}

module.exports = { LollipopPlatform };
