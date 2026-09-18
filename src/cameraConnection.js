'use strict';

const crypto = require('crypto');
const net = require('net');

function resolveRtspUrl(config, pairingID) {
  if (!net.isIP(config.ip)) {
    throw new Error('Configured camera IP must be a valid IP address.');
  }

  if (config.rtspUrl) {
    let parsed;
    try {
      parsed = new URL(config.rtspUrl);
    } catch (_) {
      throw new Error('Configured stream must be a valid RTSP URL.');
    }

    if (!['rtsp:', 'rtsps:'].includes(parsed.protocol)) {
      throw new Error('Configured stream must be an RTSP URL.');
    }

    if (!parsed.username || !parsed.password) {
      throw new Error('Configured RTSP URL must include a username and password.');
    }

    const hostname = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
    if (hostname !== config.ip) {
      throw new Error('Configured RTSP URL must use the configured camera IP.');
    }

    return config.rtspUrl;
  }

  if (!pairingID) {
    throw new Error('A pairing ID is required when no RTSP URL is configured.');
  }

  const hash = crypto.createHash('md5').update(pairingID).digest('hex');
  return `rtsp://${config.ip}:554/live/${hash}/ch00_0`;
}

function selectRuntimeFeatures(config, mqttAvailable) {
  return {
    sensors: mqttAvailable,
    soundMachine: mqttAvailable && config.enableSoundMachine !== false,
  };
}

module.exports = { resolveRtspUrl, selectRuntimeFeatures };