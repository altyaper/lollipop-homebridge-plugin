'use strict';

const { spawn } = require('child_process');
const { DigestProxy } = require('./digestProxy');

class LollipopCameraAccessory {
  constructor(platform, accessory, cameraConfig) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = cameraConfig;
    this.log = platform.log;
    this.hap = platform.api.hap;
    this.proxy = new DigestProxy(this.log, cameraConfig);
    this.proxyPort = null;
    this.activeSessions = new Map();

    this.setupAccessoryInfo();
    this.setupCameraService();
  }

  setupAccessoryInfo() {
    this.accessory.getService(this.hap.Service.AccessoryInformation)
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'Lollipop')
      .setCharacteristic(this.hap.Characteristic.Model, 'Lollipop Pro')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, this.config.cameraId);
  }

  setupCameraService() {
    const hap = this.hap;
    const streamingOptions = {
      supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
      video: {
        resolutions: [
          [1920, 1080, 30],
          [1280, 720, 30],
          [640, 480, 30],
          [640, 360, 30],
          [480, 270, 30],
          [320, 240, 15],
        ],
        codec: {
          profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
          levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
        },
      },
      audio: {
        codecs: [
          {
            type: hap.AudioStreamingCodecType.OPUS,
            samplerate: hap.AudioStreamingSamplerate.KHZ_24,
          },
          {
            type: hap.AudioStreamingCodecType.OPUS,
            samplerate: hap.AudioStreamingSamplerate.KHZ_16,
          },
        ],
      },
    };

    this.log.info(`[${this.config.name}] streamingOptions: ${JSON.stringify(streamingOptions)}`);

    const streamController = new hap.CameraController({
      cameraStreamCount: 2,
      delegate: this,
      streamingOptions,
    });

    this.accessory.configureController(streamController);
  }

  async ensureProxy() {
    if (!this.proxyPort) {
      this.proxyPort = await this.proxy.start();
    }
    return this.proxyPort;
  }

  // --- CameraStreamingDelegate ---

  async handleSnapshotRequest(request, callback) {
    try {
      const port = await this.ensureProxy();
      const streamPath = this.config.streamPath || '/stream.m3u8';
      const http = require('http');

      // Get snapshot via FFmpeg from the proxy stream
      const ffmpegArgs = [
        '-re', '-i', `http://127.0.0.1:${port}${streamPath}`,
        '-vframes', '1',
        '-f', 'image2',
        '-vcodec', 'mjpeg',
        '-s', `${request.width}x${request.height}`,
        'pipe:1',
      ];

      const chunks = [];
      let ffmpegErr = '';
      const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      ffmpeg.stdout.on('data', chunk => chunks.push(chunk));
      ffmpeg.stderr.on('data', d => { ffmpegErr += d.toString(); });

      ffmpeg.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          callback(undefined, Buffer.concat(chunks));
        } else {
          this.log.error(`[${this.config.name}] Snapshot FFmpeg exited with code ${code}`);
          this.log.error(`[${this.config.name}] FFmpeg stderr: ${ffmpegErr.slice(-500)}`);
          callback(new Error('Snapshot failed'));
        }
      });
    } catch (err) {
      this.log.error(`[${this.config.name}] Snapshot error:`, err.message);
      callback(err);
    }
  }

  async prepareStream(request, callback) {
    const sessionId = request.sessionID;
    const streamPath = this.config.streamPath || '/stream.m3u8';

    try {
      const port = await this.ensureProxy();

      const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
      const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

      const videoInfo = request.video;
      const audioInfo = request.audio;

      const sessionInfo = {
        address: request.targetAddress,
        videoPort: videoInfo.port,
        videoSSRC,
        videoCryptoSuite: videoInfo.srtpCryptoSuite,
        videoSRTP: Buffer.concat([videoInfo.srtp_key, videoInfo.srtp_salt]),
        audioPort: audioInfo.port,
        audioSSRC,
        audioCryptoSuite: audioInfo.srtpCryptoSuite,
        audioSRTP: Buffer.concat([audioInfo.srtp_key, audioInfo.srtp_salt]),
        proxyPort: port,
        streamPath,
      };

      this.activeSessions.set(sessionId, sessionInfo);

      callback(undefined, {
        video: {
          port: videoInfo.port,
          ssrc: videoSSRC,
          srtp_key: videoInfo.srtp_key,
          srtp_salt: videoInfo.srtp_salt,
        },
        audio: {
          port: audioInfo.port,
          ssrc: audioSSRC,
          srtp_key: audioInfo.srtp_key,
          srtp_salt: audioInfo.srtp_salt,
        },
      });
    } catch (err) {
      this.log.error(`[${this.config.name}] prepareStream error:`, err.message);
      callback(err);
    }
  }

  async handleStreamRequest(request, callback) {
    const sessionId = request.sessionID;

    if (request.type === 'start') {
      const sessionInfo = this.activeSessions.get(sessionId);
      if (!sessionInfo) { callback(new Error('No session info')); return; }

      const { width, height, fps, max_bit_rate } = request.video;
      this.log.info(`[${this.config.name}] Audio request: codec=${request.audio.codec} sampleRate=${request.audio.sample_rate} channel=${request.audio.channel}`);

      const videoSrtpParams = sessionInfo.videoSRTP.toString('base64');
      const audioSrtpParams = sessionInfo.audioSRTP.toString('base64');
      this.log.info(`[${this.config.name}] SRTP key bytes: video=${sessionInfo.videoSRTP.length} audio=${sessionInfo.audioSRTP.length}`);
      const audioSampleRate = request.audio.sample_rate || 24;
      const audioCodec = request.audio.codec === 'AAC-eld' ? 'aac' : 'libopus';

      const ffmpegArgs = [
        '-re',
        '-i', `http://127.0.0.1:${sessionInfo.proxyPort}${sessionInfo.streamPath}`,
        // Video output — map video stream, no audio, HLS AVCC→Annex B
        '-map', '0:v:0',
        '-an',
        '-vcodec', 'copy',
        '-bsf:v', 'h264_mp4toannexb',
        '-payload_type', '99',
        '-ssrc', String(sessionInfo.videoSSRC),
        '-f', 'rtp',
        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params', videoSrtpParams,
        `srtp://${sessionInfo.address}:${sessionInfo.videoPort}?rtcpport=${sessionInfo.videoPort}&pkt_size=1316`,
        // Audio output — map audio stream, no video
        '-map', '0:a:0',
        '-vn',
        '-acodec', audioCodec,
        '-ac', '1',
        '-ar', `${audioSampleRate}000`,
        '-b:a', '24k',
        '-payload_type', '110',
        '-ssrc', String(sessionInfo.audioSSRC),
        '-f', 'rtp',
        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params', audioSrtpParams,
        `srtp://${sessionInfo.address}:${sessionInfo.audioPort}?rtcpport=${sessionInfo.audioPort}&pkt_size=188`,
      ];

      this.log.info(`[${this.config.name}] Starting stream FFmpeg: ffmpeg ${ffmpegArgs.join(' ')}`);

      let streamErr = '';
      const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      ffmpeg.stderr.on('data', data => { streamErr += data.toString(); });

      ffmpeg.on('close', (code) => {
        if (code !== 0) this.log.error(`[${this.config.name}] FFmpeg stream stderr: ${streamErr.slice(-800)}`);
        this.log.info(`[${this.config.name}] FFmpeg stream ended (code ${code})`);
        this.activeSessions.delete(sessionId);
      });

      sessionInfo.ffmpeg = ffmpeg;
      callback();

    } else if (request.type === 'stop' || request.type === 'reconfigure') {
      const sessionInfo = this.activeSessions.get(sessionId);
      if (sessionInfo?.ffmpeg) {
        sessionInfo.ffmpeg.kill('SIGTERM');
      }
      this.activeSessions.delete(sessionId);
      callback();
    } else {
      callback();
    }
  }
}

module.exports = { LollipopCameraAccessory };
