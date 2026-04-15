'use strict';

const https = require('https');
const crypto = require('crypto');

const PARSE_HOST = 'parse-api.lollipop.camera';
const PARSE_APP_ID = 'WVxA1yrfGc8Jx9xNLyb0dX9005CI7cIThUFPSglD';
const PARSE_REST_KEY = 'bHCcZdPW2ScBdcDNfZXruqhwIvQyLvqc5YPurJkW';

function parseRequest(method, path, sessionToken, body) {
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
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Content-Type': 'application/json',
    };
    if (sessionToken) headers['X-Parse-Session-Token'] = sessionToken;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request({ hostname: PARSE_HOST, port: 443, path, method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from Parse API')); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function login(email, password) {
  const result = await parseRequest('POST', '/parse/functions/loginV2', null, {
    deviceType: 'ios',
    username: email,
    password,
  });
  if (!result.result?.sessionToken) throw new Error('Login failed: ' + (result.error || 'unknown error'));
  return result.result.sessionToken;
}

async function fetchCameras(sessionToken, log) {
  const babyResult = await parseRequest('POST', '/parse/classes/baby', sessionToken, { _method: 'GET' });
  if (log) log(`[lollipopApi] baby response: ${JSON.stringify(babyResult)}`);
  const babies = (babyResult && babyResult.results) ? babyResult.results : [];

  const cameraResult = await parseRequest('POST', '/parse/classes/camera', sessionToken, {
    _method: 'GET',
    include: 'cam_setting',
  });
  if (log) log(`[lollipopApi] camera response: ${JSON.stringify(cameraResult)}`);
  const cameras = (cameraResult && cameraResult.results) ? cameraResult.results : [];

  return cameras.map(cam => {
    const baby = babies.find(b => b.camera_id === cam.objectId);
    const digestPassword = crypto.createHash('md5').update(cam.objectId).digest('hex'); // md5(camera_id)
    const internalIp = cam.internal_live_url || '';
    const cameraHost = `${internalIp.replace(/\./g, '-')}.rtsp.lollipop.camera`;

    return {
      name: baby && baby.baby_name ? `${baby.baby_name}'s Camera` : (cam.name || 'Lollipop Camera'),
      cameraHost,
      cameraIp: internalIp,   // raw IP for direct connection (hostname may not resolve)
      cameraPort: 445,
      cameraId: cam.objectId,
      digestPassword,
      streamPath: '/stream.m3u8',
    };
  });
}

module.exports = { login, fetchCameras };
