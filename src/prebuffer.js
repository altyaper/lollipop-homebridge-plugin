'use strict';

const { spawn } = require('child_process');
const { createServer } = require('net');

const BUFFER_DURATION_MS = 15000;

class Prebuffer {
  constructor(log, rtspUrl) {
    this.log = log;
    this.rtspUrl = rtspUrl;
    this.buffer = []; // { data: Buffer, time: number }
    this.ffmpeg = null;
    this.ftyp = null;
    this.moov = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;

    const args = [
      '-rtsp_transport', 'tcp',
      '-re', '-i', this.rtspUrl,
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-acodec', 'aac',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1',
    ];

    this.ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.ffmpeg.stderr.on('data', () => {});

    let partial = Buffer.alloc(0);

    this.ffmpeg.stdout.on('data', chunk => {
      partial = Buffer.concat([partial, chunk]);
      let offset = 0;

      while (offset + 8 <= partial.length) {
        const size = partial.readUInt32BE(offset);
        if (size < 8 || offset + size > partial.length) break;

        const box = partial.slice(offset, offset + size);
        const type = box.slice(4, 8).toString('ascii');
        offset += size;

        if (type === 'ftyp') { this.ftyp = box; continue; }
        if (type === 'moov') { this.moov = box; continue; }

        // Keep moof+mdat in rolling buffer
        this.buffer.push({ data: box, time: Date.now() });
        const cutoff = Date.now() - BUFFER_DURATION_MS;
        while (this.buffer.length > 0 && this.buffer[0].time < cutoff) {
          this.buffer.shift();
        }
      }

      partial = partial.slice(offset);
    });

    this.ffmpeg.on('close', () => {
      this.running = false;
      if (this.shouldRestart) setTimeout(() => this.start(), 2000);
    });

    this.shouldRestart = true;
    this.log.debug('[Prebuffer] Started');
  }

  stop() {
    this.shouldRestart = false;
    this.ffmpeg?.kill('SIGTERM');
    this.running = false;
  }

  getBuffer() {
    const chunks = [];
    if (this.ftyp) chunks.push(this.ftyp);
    if (this.moov) chunks.push(this.moov);
    for (const { data } of this.buffer) chunks.push(data);
    return Buffer.concat(chunks);
  }
}

module.exports = { Prebuffer };
