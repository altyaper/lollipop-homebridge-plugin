'use strict';

class SoundMachine {
  constructor(log, hap, accessory, mqttClient, pairingID) {
    this.log = log;
    this.hap = hap;
    this.accessory = accessory;
    this.mqtt = mqttClient;
    this.pairingID = pairingID;
    this.countdownTimer = 86400; // 24 hours default

    const service = accessory.getService('Sound Machine') ||
      accessory.addService(hap.Service.Switch, 'Sound Machine', 'soundmachine');

    service.getCharacteristic(hap.Characteristic.On)
      .onSet(on => this.setPlayback(on))
      .onGet(() => this.playing);

    this.service = service;
    this.playing = false;

    // Query current state
    this.mqtt.publish(`${pairingID}/musicStatus`, JSON.stringify({ method: 'musicStatus', id: 1 }));
  }

  setPlayback(on) {
    this.playing = on;
    const playStatus = on ? 'play' : 'stop';
    this.log.info(`[SoundMachine] ${playStatus}`);
    this.mqtt.publish(`${this.pairingID}/controlMusic`, JSON.stringify({
      method: 'controlMusic',
      params: { playStatus, countdownTimer: this.countdownTimer },
      id: 17,
    }));
  }

  handleStatus(payload) {
    try {
      const data = Array.isArray(payload) ? payload[1] : payload;
      const status = data?.result?.playStatus;
      if (!status) return;
      this.playing = status === 'play';
      this.service.getCharacteristic(this.hap.Characteristic.On).updateValue(this.playing);
    } catch (_) {}
  }
}

module.exports = { SoundMachine };
