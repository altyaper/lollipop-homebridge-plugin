const https = require("https");
const http = require("http");
const crypto = require("crypto");
const url = require("url");
const fs = require("fs");
const path = require("path");

// Configure via environment variables or replace these placeholders:
//   CAMERA_HOST  — e.g. YOUR_CAMERA_HOST
//   CAMERA_IP    — e.g. 192.168.4.24  (direct IP, avoids DNS issues)
//   CAMERA_PORT  — default 445
//   DIGEST_USERNAME — your camera_id from the Lollipop API (baby.camera_id)
//   DIGEST_PASSWORD — md5(camera_id)  e.g. node -e "console.log(require('crypto').createHash('md5').update('YOUR_CAMERA_ID').digest('hex'))"
const CAMERA_HOST = process.env.CAMERA_HOST || "YOUR_CAMERA_HOST";
const CAMERA_PORT = parseInt(process.env.CAMERA_PORT || "445", 10);

const DIGEST_USERNAME = process.env.DIGEST_USERNAME || "YOUR_CAMERA_ID";
const DIGEST_PASSWORD = process.env.DIGEST_PASSWORD || "YOUR_DIGEST_PASSWORD";

const BASE_HEADERS = {
  Host: `${CAMERA_HOST}:${CAMERA_PORT}`,
  Connection: "keep-alive",
  "X-Playback-Session-Id": "9CFEB2F4-F988-4FC6-9013-91236DA9FDA8",
  Accept: "*/*",
  "User-Agent":
    "AppleCoreMedia/1.0.0.23F5043k (iPhone; U; CPU OS 26_5 like Mac OS X; en_us)",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
};

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

// Shared Digest session state
let digestState = null; // { realm, nonce, nc }

function buildDigestHeader(method, uri, realm, nonce, nc) {
  const ncHex = nc.toString(16).padStart(8, "0");
  const cnonce = crypto.randomBytes(8).toString("hex");
  const HA1 = md5(`${DIGEST_USERNAME}:${realm}:${DIGEST_PASSWORD}`);
  const HA2 = md5(`${method}:${uri}`);
  const response = md5(`${HA1}:${nonce}:${ncHex}:${cnonce}:auth:${HA2}`);
  return `Digest username="${DIGEST_USERNAME}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm="MD5", cnonce="${cnonce}", nc=${ncHex}, qop="auth"`;
}

function cameraRequest(method, path, extraHeaders, callback) {
  const options = {
    hostname: CAMERA_HOST,
    port: CAMERA_PORT,
    path,
    method,
    headers: { ...BASE_HEADERS, ...extraHeaders },
    rejectUnauthorized: false,
  };

  const req = https.request(options, callback);
  req.on("error", (err) => callback(null, err));
  req.end();
}

function proxyWithDigest(path, res) {
  // Step 1: try without auth (or with stale nonce) to get challenge
  const doAuth = (state) => {
    const authHeader = buildDigestHeader(
      "GET",
      path,
      state.realm,
      state.nonce,
      state.nc,
    );
    state.nc++;

    cameraRequest("GET", path, { Authorization: authHeader }, (camRes, err) => {
      if (err) {
        console.error("Camera error:", err.message);
        res.writeHead(502);
        res.end("Camera error: " + err.message);
        return;
      }

      console.log("[auth] Camera response for", path, ":", camRes.statusCode);
      if (camRes.statusCode === 401) {
        camRes.resume();
        console.log(
          "[auth] 401 received — nonce may be expired, refreshing...",
        );
        fetchNonce(path, (newState) => {
          if (!newState) {
            res.writeHead(502);
            res.end("Auth failed");
            return;
          }
          digestState = newState;
          const retryAuth = buildDigestHeader(
            "GET",
            path,
            newState.realm,
            newState.nonce,
            newState.nc,
          );
          newState.nc++;
          cameraRequest(
            "GET",
            path,
            { Authorization: retryAuth },
            (camRes2, err2) => {
              if (err2 || !camRes2) {
                res.writeHead(502);
                res.end("Retry failed");
                return;
              }
              pipeResponse(camRes2, res, path);
            },
          );
        });
        return;
      }

      pipeResponse(camRes, res, path);
    });
  };

  if (!digestState) {
    console.log("[auth] No session, fetching nonce for", path);
    fetchNonce(path, (state) => {
      if (!state) {
        console.error("[auth] Failed to get Digest challenge from camera");
        res.writeHead(502);
        res.end("Could not get Digest challenge");
        return;
      }
      console.log("[auth] Got nonce:", state.nonce);
      digestState = state;
      doAuth(digestState);
    });
  } else {
    doAuth(digestState);
  }
}

function fetchNonce(path, callback) {
  cameraRequest("GET", path, {}, (camRes, err) => {
    if (err) {
      callback(null);
      return;
    }

    // Drain the body
    camRes.resume();

    if (camRes.statusCode !== 401) {
      callback(null);
      return;
    }

    const wwwAuth = camRes.headers["www-authenticate"] || "";
    const realm = (wwwAuth.match(/realm="([^"]+)"/) || [])[1];
    const nonce = (wwwAuth.match(/nonce="([^"]+)"/) || [])[1];

    if (!realm || !nonce) {
      callback(null);
      return;
    }
    console.log("Got fresh nonce:", nonce);
    callback({ realm, nonce, nc: 1 });
  });
}

function pipeResponse(camRes, res, path) {
  const ct =
    camRes.headers["content-type"] ||
    (path.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/MP2T");
  res.writeHead(camRes.statusCode, {
    "Content-Type": ct,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  });
  camRes.pipe(res);
}

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url);

  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    return;
  }

  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log("Proxying:", pathname);
  proxyWithDigest(pathname, res);
});

const PORT = 8000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
