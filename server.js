'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;

// Lollipop account credentials (used to auto-fetch camera info)
const LOLLIPOP_EMAIL    = process.env.LOLLIPOP_EMAIL    || '';
const LOLLIPOP_PASSWORD = process.env.LOLLIPOP_PASSWORD || '';

// Camera connection (auto-filled after login, or override manually)
let CAMERA_HOST     = process.env.CAMERA_HOST || '';
let CAMERA_IP       = process.env.CAMERA_IP   || '';
let CAMERA_PORT     = parseInt(process.env.CAMERA_PORT || '445', 10);
let DIGEST_USERNAME = process.env.DIGEST_USERNAME || '';
let DIGEST_PASSWORD = process.env.DIGEST_PASSWORD || '';

// --- Lollipop API ---

const PARSE_HOST    = 'parse-api.lollipop.camera';
const PARSE_APP_ID  = 'WVxA1yrfGc8Jx9xNLyb0dX9005CI7cIThUFPSglD';
const PARSE_REST_KEY = 'bHCcZdPW2ScBdcDNfZXruqhwIvQyLvqc5YPurJkW';
const md5 = s => crypto.createHash('md5').update(s).digest('hex');

function parseRequest(method, apiPath, sessionToken, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'Host': PARSE_HOST,
      'X-Parse-Application-Id': PARSE_APP_ID,
      'X-Parse-REST-API-Key': PARSE_REST_KEY,
      'X-Requested-With': 'ios',
      'X-Parse-Installation-Id': '00000000-0000-0000-0000-000000000000',
      'User-Agent': 'Lollipop/503005 CFNetwork/3860.600.2 Darwin/25.5.0',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      'Content-Type': 'application/json',
    };
    if (sessionToken) headers['X-Parse-Session-Token'] = sessionToken;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request({ hostname: PARSE_HOST, port: 443, path: apiPath, method, headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function fetchCameraCredentials() {
  console.log('Logging in to Lollipop API...');
  const loginResult = await parseRequest('POST', '/parse/functions/loginV2', null, {
    deviceType: 'ios',
    username: LOLLIPOP_EMAIL,
    password: LOLLIPOP_PASSWORD,
  });
  if (!loginResult.result?.sessionToken) throw new Error('Login failed: ' + (loginResult.error || 'unknown'));
  const sessionToken = loginResult.result.sessionToken;

  console.log('Fetching camera info...');
  const cameraResult = await parseRequest('POST', '/parse/classes/camera', sessionToken, {
    _method: 'GET', include: 'cam_setting',
  });
  const cam = (cameraResult.results || [])[0];
  if (!cam) throw new Error('No camera found in your Lollipop account');

  const internalIp = cam.internal_live_url || '';
  CAMERA_IP       = internalIp;
  CAMERA_HOST     = `${internalIp.replace(/\./g, '-')}.rtsp.lollipop.camera`;
  DIGEST_USERNAME = cam.objectId;
  DIGEST_PASSWORD = md5(cam.objectId);

  console.log(`Camera: ${cam.name || 'Lollipop'} at ${internalIp}`);
  console.log(`Camera ID: ${DIGEST_USERNAME}`);
}

// --- Digest Proxy ---

let BASE_HEADERS = () => ({
  'Host': `${CAMERA_HOST}:${CAMERA_PORT}`,
  'Connection': 'keep-alive',
  'X-Playback-Session-Id': '9CFEB2F4-F988-4FC6-9013-91236DA9FDA8',
  'Accept': '*/*',
  'User-Agent': 'AppleCoreMedia/1.0.0.23F5043k (iPhone; U; CPU OS 26_5 like Mac OS X; en_us)',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
});

let digestState = null;

function buildDigestHeader(method, uri, realm, nonce, nc) {
  const ncHex = nc.toString(16).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');
  const HA1 = md5(`${DIGEST_USERNAME}:${realm}:${DIGEST_PASSWORD}`);
  const HA2 = md5(`${method}:${uri}`);
  const response = md5(`${HA1}:${nonce}:${ncHex}:${cnonce}:auth:${HA2}`);
  return `Digest username="${DIGEST_USERNAME}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm="MD5", cnonce="${cnonce}", nc=${ncHex}, qop="auth"`;
}

function cameraRequest(method, reqPath, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: CAMERA_IP || CAMERA_HOST,
      port: CAMERA_PORT,
      servername: CAMERA_HOST,
      path: reqPath,
      method,
      headers: { ...BASE_HEADERS(), ...extraHeaders },
      rejectUnauthorized: false,
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

async function fetchNonce(reqPath) {
  const res = await cameraRequest('GET', reqPath, {});
  res.resume();
  if (res.statusCode !== 401) return null;
  const wwwAuth = res.headers['www-authenticate'] || '';
  const realm = (wwwAuth.match(/realm="([^"]+)"/) || [])[1];
  const nonce = (wwwAuth.match(/nonce="([^"]+)"/) || [])[1];
  if (!realm || !nonce) return null;
  console.log('Got fresh nonce:', nonce);
  return { realm, nonce, nc: 1 };
}

async function proxyWithDigest(reqPath, res) {
  try {
    if (!digestState) {
      digestState = await fetchNonce(reqPath);
      if (!digestState) { res.writeHead(502); res.end('Could not get Digest challenge'); return; }
    }

    const auth = buildDigestHeader('GET', reqPath, digestState.realm, digestState.nonce, digestState.nc);
    digestState.nc++;

    let camRes = await cameraRequest('GET', reqPath, { 'Authorization': auth });

    if (camRes.statusCode === 401) {
      camRes.resume();
      digestState = await fetchNonce(reqPath);
      if (!digestState) { res.writeHead(502); res.end('Auth failed'); return; }
      const retryAuth = buildDigestHeader('GET', reqPath, digestState.realm, digestState.nonce, digestState.nc);
      digestState.nc++;
      camRes = await cameraRequest('GET', reqPath, { 'Authorization': retryAuth });
    }

    const ct = camRes.headers['content-type'] ||
      (reqPath.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T');
    res.writeHead(camRes.statusCode, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
    camRes.pipe(res);
  } catch (err) {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
  }
}

// --- HTTP Server ---

const HTML_PATH = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url);
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(HTML_PATH).pipe(res);
    return;
  }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  console.log('Proxying:', pathname);
  proxyWithDigest(pathname, res);
});

// --- Start ---

async function start() {
  if (LOLLIPOP_EMAIL && LOLLIPOP_PASSWORD) {
    await fetchCameraCredentials();
  } else if (!DIGEST_USERNAME || !DIGEST_PASSWORD) {
    console.error('Set LOLLIPOP_EMAIL + LOLLIPOP_PASSWORD (auto-fetch) or DIGEST_USERNAME + DIGEST_PASSWORD (manual).');
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start().catch(err => { console.error(err.message); process.exit(1); });
