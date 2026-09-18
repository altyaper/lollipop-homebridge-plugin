'use strict';

const { spawn } = require('child_process');
const { getFfmpegPath } = require('./ffmpeg');

const FRAGMENT_LENGTH = 4000;

class RecordingDelegate {
  constructor(log, hap, rtspUrl, prebuffer, dependencies = {}) {
    this.log = log;
    this.hap = hap;
    this.rtspUrl = rtspUrl;
    this.prebuffer = prebuffer;
    this.spawn = dependencies.spawn || spawn;
    this.getFfmpegPath = dependencies.getFfmpegPath || getFfmpegPath;
    this.ffmpeg = null;
    this.recording = false;

    this.recordingOptions = {
      prebufferLength: FRAGMENT_LENGTH,
      overrideEventTriggerOptions: [
        hap.EventTriggerOption.MOTION,
        hap.EventTriggerOption.DOORBELL,
      ],
      mediaContainerConfiguration: [{
        type: hap.MediaContainerType.FRAGMENTED_MP4,
        fragmentLength: FRAGMENT_LENGTH,
      }],
      video: {
        type: hap.VideoCodecType.H264,
        parameters: {
          profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
          levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
        },
        resolutions: [[1920, 1080, 30], [1280, 720, 30], [640, 480, 30]],
      },
      audio: {
        codecs: [{
          type: hap.AudioRecordingCodecType.AAC_LC,
          bitrateMode: 0,
          samplerate: hap.AudioRecordingSamplerate.KHZ_16,
          audioChannels: 1,
        }],
      },
    };
  }

  async *handleRecordingStreamRequest(streamId) {
    this.log.info('[Recording] Starting HKSV recording stream %s', streamId);
    this.recording = true;

    // Start with prebuffer data
    const prebufData = this.prebuffer.getBuffer();
    if (prebufData.length > 0) {
      yield { data: prebufData, isLast: false };
    }

    // Continue with live FFmpeg recording
    const args = [
      '-rtsp_transport', 'tcp',
      '-re', '-i', this.rtspUrl,
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-acodec', 'aac',
      '-profile:a', 'aac_low',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1',
    ];

    const chunks = [];
    let resolve = null;
    let done = false;
    let ff;

    try {
      ff = this.spawn(this.getFfmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (_) {
      this.recording = false;
      this.log.error('[Recording] Unable to start FFmpeg. Verify the FFmpeg installation.');
      return;
    }

    this.ffmpeg = ff;
    ff.stderr.on('data', () => {});

    ff.stdout.on('data', chunk => {
      chunks.push(chunk);
      if (resolve) { resolve(); resolve = null; }
    });

    ff.on('error', () => {
      this.recording = false;
      done = true;
      this.log.error('[Recording] Unable to start FFmpeg. Verify the FFmpeg installation.');
      if (resolve) { resolve(); resolve = null; }
    });

    ff.on('close', () => {
      done = true;
      if (resolve) { resolve(); resolve = null; }
    });

    while (!done || chunks.length > 0) {
      if (chunks.length === 0) {
        await new Promise(r => { resolve = r; });
      }
      if (chunks.length === 0) break;

      const data = Buffer.concat(chunks.splice(0));
      yield { data, isLast: !this.recording && done };

      if (!this.recording) break;
    }

    this.log.info('[Recording] Recording stream %s ended', streamId);
  }

  updateRecordingActive(active) {
    this.log.debug('[Recording] Active: %s', active);
  }

  updateRecordingConfiguration(config) {
    this.log.debug('[Recording] Config updated');
  }

  stopRecording() {
    this.recording = false;
    this.ffmpeg?.kill('SIGTERM');
    this.ffmpeg = null;
  }

  closeRecordingStream(streamId, error) {
    if (error) this.log.error('[Recording] Stream %s closed with an error.', streamId);
    this.stopRecording();
  }

  acknowledgeStream(streamId) {}
}

module.exports = { RecordingDelegate };
