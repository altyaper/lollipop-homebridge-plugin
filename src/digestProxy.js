'use strict';

/**
 * A minimal HTTP proxy that sits between FFmpeg and the Lollipop camera.
 * It handles Digest authentication transparently so FFmpeg can pull the
 * HLS stream without needing to deal with Digest auth itself.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

class DigestProxy {
  constructor(log, cameraConfig) {
    this.log = log;
    this.host = cameraConfig.cameraHost;
    this.connectHost = cameraConfig.cameraIp || cameraConfig.cameraHost; // use IP if available
    this.port = cameraConfig.cameraPort || 445;
    this.username = cameraConfig.cameraId;
    this.password = cameraConfig.digestPassword;
    this.streamPath = cameraConfig.streamPath || '/stream.m3u8';
    this.digestState = null;
    this.server = null;
    this.proxyPort = null;

    this.baseHeaders = {
      'Host': `${this.host}:${this.port}`,
      'Connection': 'keep-alive',
      'Accept': '*/*',
      'User-Agent': 'AppleCoreMedia/1.0.0.23F5043k (iPhone; U; CPU OS 26_5 like Mac OS X; en_us)',
      'Accept-Encoding': 'identity',
    };
  }

  buildDigestHeader(method, uri, realm, nonce, nc) {
    const ncHex = nc.toString(16).padStart(8, '0');
    const cnonce = crypto.randomBytes(8).toString('hex');
    const HA1 = md5(`${this.username}:${realm}:${this.password}`);
    const HA2 = md5(`${method}:${uri}`);
    const response = md5(`${HA1}:${nonce}:${ncHex}:${cnonce}:auth:${HA2}`);
    return `Digest username="${this.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", ` +
      `response="${response}", algorithm="MD5", cnonce="${cnonce}", nc=${ncHex}, qop="auth"`;
  }

  cameraRequest(path, extraHeaders) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: this.connectHost,
        port: this.port,
        servername: this.host, // TLS SNI
        path,
        method: 'GET',
        headers: { ...this.baseHeaders, ...extraHeaders },
        rejectUnauthorized: false,
      }, resolve);
      req.on('error', reject);
      req.end();
    });
  }

  async fetchNonce(path) {
    const res = await this.cameraRequest(path, {});
    res.resume();
    if (res.statusCode !== 401) return null;
    const wwwAuth = res.headers['www-authenticate'] || '';
    const realm = (wwwAuth.match(/realm="([^"]+)"/) || [])[1];
    const nonce = (wwwAuth.match(/nonce="([^"]+)"/) || [])[1];
    if (!realm || !nonce) return null;
    this.log.debug(`[DigestProxy] Got nonce: ${nonce}`);
    return { realm, nonce, nc: 1 };
  }

  async proxyPath(path, clientRes) {
    if (!this.digestState) {
      this.digestState = await this.fetchNonce(path);
      if (!this.digestState) {
        clientRes.writeHead(502);
        clientRes.end('Could not get Digest challenge from camera');
        return;
      }
    }

    const auth = this.buildDigestHeader('GET', path, this.digestState.realm,
      this.digestState.nonce, this.digestState.nc);
    this.digestState.nc++;

    let camRes = await this.cameraRequest(path, { 'Authorization': auth });

    if (camRes.statusCode === 401) {
      // Nonce expired — refresh and retry
      camRes.resume();
      this.log.debug('[DigestProxy] Nonce expired, refreshing...');
      this.digestState = await this.fetchNonce(path);
      if (!this.digestState) {
        clientRes.writeHead(502);
        clientRes.end('Auth failed after nonce refresh');
        return;
      }
      const retryAuth = this.buildDigestHeader('GET', path, this.digestState.realm,
        this.digestState.nonce, this.digestState.nc);
      this.digestState.nc++;
      camRes = await this.cameraRequest(path, { 'Authorization': retryAuth });
    }

    const ct = camRes.headers['content-type'] ||
      (path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T');

    clientRes.writeHead(camRes.statusCode, {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    camRes.pipe(clientRes);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const { pathname } = new URL(req.url, 'http://localhost');
        if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        this.log.debug(`[DigestProxy] → ${pathname}`);
        try {
          await this.proxyPath(pathname, res);
        } catch (err) {
          this.log.error('[DigestProxy] Error:', err.message);
          if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
        }
      });

      this.server.listen(0, '127.0.0.1', () => {
        this.proxyPort = this.server.address().port;
        this.log.info(`[DigestProxy] Listening on port ${this.proxyPort}`);
        resolve(this.proxyPort);
      });

      this.server.on('error', reject);
    });
  }

  stop() {
    if (this.server) this.server.close();
  }
}

module.exports = { DigestProxy };
