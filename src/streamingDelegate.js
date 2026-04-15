'use strict';

const { spawn } = require('child_process');

class StreamingDelegate {
  constructor(log, hap, rtspUrl) {
    this.log = log;
    this.hap = hap;
    this.rtspUrl = rtspUrl;
    this.sessions = new Map();
  }

  async handleSnapshotRequest(request, callback) {
    const args = [
      '-rtsp_transport', 'tcp',
      '-i', this.rtspUrl,
      '-frames:v', '1',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-s', `${request.width}x${request.height}`,
      'pipe:1',
    ];

    let data = Buffer.alloc(0);
    let errOut = '';
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.stdout.on('data', chunk => { data = Buffer.concat([data, chunk]); });
    ff.stderr.on('data', d => { errOut += d; });
    ff.on('close', code => {
      if (code === 0 && data.length > 0) {
        callback(undefined, data);
      } else {
        this.log.error('Snapshot failed (code %d): %s', code, errOut.slice(-300));
        callback(new Error('Snapshot failed'));
      }
    });
  }

  async prepareStream(request, callback) {
    const sessionId = request.sessionID;
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    this.sessions.set(sessionId, {
      address: request.targetAddress,
      videoPort: request.video.port,
      videoSSRC,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      audioPort: request.audio.port,
      audioSSRC,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      sampleRate: request.audio.sample_rate || 16,
    });

    callback(undefined, {
      video: { port: request.video.port, ssrc: videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
      audio: { port: request.audio.port, ssrc: audioSSRC, srtp_key: request.audio.srtp_key, srtp_salt: request.audio.srtp_salt },
    });
  }

  async handleStreamRequest(request, callback) {
    const sessionId = request.sessionID;

    if (request.type === 'start') {
      const s = this.sessions.get(sessionId);
      if (!s) { callback(new Error('No session')); return; }

      const { width, height, fps, max_bit_rate } = request.video;
      const vSrtp = s.videoSRTP.toString('base64');
      const aSrtp = s.audioSRTP.toString('base64');
      const audioCodec = request.audio.codec === 'AAC-eld' ? 'aac' : 'libopus';

      const args = [
        '-rtsp_transport', 'tcp',
        '-re', '-i', this.rtspUrl,
        // Video
        '-map', '0:v:0', '-an',
        '-vcodec', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-color_range', 'mpeg',
        '-r', String(fps),
        '-vf', `scale=${width}:${height}`,
        '-b:v', `${max_bit_rate}k`,
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-payload_type', '99',
        '-ssrc', String(s.videoSSRC),
        '-f', 'rtp',
        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params', vSrtp,
        `srtp://${s.address}:${s.videoPort}?rtcpport=${s.videoPort}&pkt_size=1316`,
        // Audio
        '-map', '0:a:0', '-vn',
        '-acodec', audioCodec,
        '-ac', '1',
        '-ar', `${s.sampleRate}000`,
        '-b:a', '24k',
        '-payload_type', '110',
        '-ssrc', String(s.audioSSRC),
        '-f', 'rtp',
        '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
        '-srtp_out_params', aSrtp,
        `srtp://${s.address}:${s.audioPort}?rtcpport=${s.audioPort}&pkt_size=188`,
      ];

      this.log.info('[Stream] Starting FFmpeg for session %s', sessionId);
      let errOut = '';
      const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      ff.stderr.on('data', d => { errOut += d; });
      ff.on('close', code => {
        if (code !== 0 && code !== 255) {
          this.log.error('[Stream] FFmpeg exited %d: %s', code, errOut.slice(-400));
        }
        this.sessions.delete(sessionId);
      });

      s.ffmpeg = ff;
      callback();

    } else if (request.type === 'stop' || request.type === 'reconfigure') {
      const s = this.sessions.get(sessionId);
      s?.ffmpeg?.kill('SIGTERM');
      this.sessions.delete(sessionId);
      callback();
    } else {
      callback();
    }
  }
}

module.exports = { StreamingDelegate };
