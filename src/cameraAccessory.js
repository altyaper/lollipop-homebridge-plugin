'use strict';

const mqtt = require('mqtt');
const { resolveRtspUrl, selectRuntimeFeatures } = require('./cameraConnection');
const { StreamingDelegate } = require('./streamingDelegate');
const { RecordingDelegate } = require('./recordingDelegate');
const { Prebuffer } = require('./prebuffer');
const { SensorManager } = require('./sensors');
const { SoundMachine } = require('./soundMachine');

class LollipopCameraAccessory {
  constructor(platform, accessory, config) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = config;
    this.log = platform.log;
    this.hap = platform.api.hap;
    this.debug = platform.debug;

    this.pairingID = null;
    this.rtspUrl = null;
    this.mqttClient = null;
    this.sensors = null;
    this.soundMachine = null;
    this.prebuffer = null;

    this.accessory.getService(this.hap.Service.AccessoryInformation)
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Lollipop')
      .setCharacteristic(this.hap.Characteristic.Model, 'Lollipop Pro')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, config.ip);

    this.initialize();
  }

  async initialize() {
    try {
      if (this.config.rtspUrl) {
        this.rtspUrl = resolveRtspUrl(this.config);
        this.log.info(`[${this.config.name}] Using configured authenticated RTSP stream`);
        this.removeMqttServices();
        this.setupHomeKit(false);
        return;
      }

      this.log.info(`[${this.config.name}] Discovering pairingID via MQTT...`);
      await this.discoverPairingID();

      this.rtspUrl = resolveRtspUrl(this.config, this.pairingID);

      await this.setupMQTT();
      this.setupHomeKit(true);

    } catch (err) {
      this.log.error(`[${this.config.name}] Initialization failed: ${err.message}`);
    }
  }

  discoverPairingID() {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(`mqtts://${this.config.ip}:1883`, {
        rejectUnauthorized: false,
      });

      const timeout = setTimeout(() => {
        client.end(true);
        reject(new Error('Timed out waiting for MQTT pairingID'));
      }, 15000);

      client.on('connect', () => {
        client.subscribe('#');
      });

      client.on('message', (topic) => {
        const id = topic.split('/')[0];
        if (id) {
          clearTimeout(timeout);
          this.pairingID = id;
          client.end(true);
          resolve(id);
        }
      });

      client.on('error', err => {
        clearTimeout(timeout);
        client.end(true);
        reject(err);
      });
    });
  }

  setupMQTT() {
    return new Promise((resolve) => {
      const client = mqtt.connect(`mqtts://${this.config.ip}:1883`, {
        rejectUnauthorized: false,
      });

      this.mqttClient = client;
      const pid = this.pairingID;

      client.on('connect', () => {
        this.log.info(`[${this.config.name}] MQTT connected`);
        client.subscribe(`${pid}/liveNote`);
        client.subscribe(`${pid}/prenotify`);
        client.subscribe(`${pid}/musicStatus/return`);
        client.subscribe(`${pid}/cameraStatus/return`);
        resolve();
      });

      client.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (topic === `${pid}/liveNote`) {
            const motion = payload?.result?.motion;
            if (motion !== undefined && this.sensors) {
              this.sensors.triggerMovement(motion);
            }
          } else if (topic === `${pid}/prenotify`) {
            const events = payload?.param?.event_params || [];
            for (const e of events) {
              if (this.sensors) this.sensors.triggerEvent(e.event_type);
            }
          } else if (topic === `${pid}/musicStatus/return`) {
            if (this.soundMachine) this.soundMachine.handleStatus(payload);
          } else if (topic === `${pid}/cameraStatus/return`) {
            const fw = (Array.isArray(payload) ? payload[1] : payload)?.result?.firmwareVersion;
            if (fw) {
              this.accessory.getService(this.hap.Service.AccessoryInformation)
                .setCharacteristic(this.hap.Characteristic.FirmwareRevision, fw);
            }
          }
        } catch (_) {}
      });

      client.on('error', err => {
        if (this.debug) this.log.debug(`[${this.config.name}] MQTT error: ${err.message}`);
      });
    });
  }

  removeMqttServices() {
    const { MotionSensor, ContactSensor, Switch } = this.hap.Service;
    const sensorSubtypes = ['movement', 'crying', 'crossing', 'noise'];

    for (const subtype of sensorSubtypes) {
      for (const serviceType of [MotionSensor, ContactSensor]) {
        const service = this.accessory.getServiceById(serviceType, subtype);
        if (service) this.accessory.removeService(service);
      }
    }

    for (const [serviceType, subtype] of [
      [MotionSensor, 'hksv'],
      [Switch, 'soundmachine'],
    ]) {
      const service = this.accessory.getServiceById(serviceType, subtype);
      if (service) this.accessory.removeService(service);
    }
  }

  setupHomeKit(mqttAvailable) {
    const hap = this.hap;
    const config = this.config;
    const features = selectRuntimeFeatures(config, mqttAvailable);

    // Sensors
    if (features.sensors) {
      this.sensors = new SensorManager(this.log, hap, this.accessory, config);
    }

    // Sound machine
    if (features.soundMachine) {
      this.soundMachine = new SoundMachine(this.log, hap, this.accessory, this.mqttClient, this.pairingID);
    }

    // Prebuffer for HKSV
    if (config.hksv !== false) {
      this.prebuffer = new Prebuffer(this.log, this.rtspUrl);
      this.prebuffer.start();
    }

    // Streaming delegate
    const streamingDelegate = new StreamingDelegate(this.log, hap, this.rtspUrl);

    // Recording delegate (HKSV)
    const recordingDelegate = config.hksv !== false
      ? new RecordingDelegate(this.log, hap, this.rtspUrl, this.prebuffer)
      : undefined;

    // Camera controller options
    const controllerOptions = {
      cameraStreamCount: 2,
      delegate: streamingDelegate,
      streamingOptions: {
        supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            [1920, 1080, 30], [1280, 720, 30],
            [640, 480, 30], [640, 360, 30],
            [480, 270, 30], [320, 240, 15],
          ],
          codec: {
            profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
            levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          codecs: [
            { type: hap.AudioStreamingCodecType.OPUS, samplerate: hap.AudioStreamingSamplerate.KHZ_24 },
            { type: hap.AudioStreamingCodecType.OPUS, samplerate: hap.AudioStreamingSamplerate.KHZ_16 },
          ],
        },
      },
    };

    if (recordingDelegate) {
      controllerOptions.recording = {
        options: recordingDelegate.recordingOptions,
        delegate: recordingDelegate,
      };
    }

    const controller = new hap.CameraController(controllerOptions);
    this.accessory.configureController(controller);

    this.log.info(`[${this.config.name}] HomeKit camera ready`);
  }
}

module.exports = { LollipopCameraAccessory };
