<div align="center">
  <img src="assets/logo.png" width="120" alt="Lollipop Camera" />
  <h1>homebridge-lollipop-monitor</h1>
  <p>Homebridge plugin for Lollipop baby monitor cameras. Automatically discovers cameras from your Lollipop account and exposes them as native HomeKit IP cameras with live video and audio streaming.</p>
</div>

---

## Requirements

- [Homebridge](https://homebridge.io) ≥ 1.6.0
- Node.js ≥ 20
- FFmpeg installed on the Homebridge host (`sudo apt install ffmpeg` on Raspberry Pi)
- A HomeKit Hub (Apple TV, HomePod, or iPad) for remote access

## Installation

### Via Homebridge UI (recommended)

1. Go to **Plugins** and search for `homebridge-lollipop-monitor`
2. Click **Install**
3. Click **Settings** and enter your Lollipop account email and password
4. Restart Homebridge — your cameras will appear automatically in HomeKit

### Via terminal

```bash
# On the Homebridge host
cd /var/lib/homebridge
npm install homebridge-lollipop-monitor
```

Then restart Homebridge and add the platform config (see below).

## Configuration

Add the following to your Homebridge `config.json` under `platforms`:

```json
{
  "platform": "LollipopCamera",
  "name": "Lollipop",
  "email": "your@email.com",
  "password": "your_lollipop_password"
}
```

| Field      | Required | Description                    |
|------------|----------|--------------------------------|
| `name`     | Yes      | Platform display name          |
| `email`    | Yes      | Your Lollipop account email    |
| `password` | Yes      | Your Lollipop account password |

## How It Works

1. On startup the plugin logs in to the Lollipop API using your credentials
2. It fetches all cameras associated with your account
3. Each camera is registered as a HomeKit IP camera accessory
4. An embedded HTTP proxy handles the camera's Digest authentication transparently
5. FFmpeg pulls the HLS stream from the proxy and transcodes it to SRTP for HomeKit

## Remote Access

To view your camera away from home, you need a **HomeKit Hub** — an Apple TV (4th gen+), HomePod, or iPad — left at home and signed into the same Apple ID. The hub acts as a relay for the video stream.

## Web Viewer

The repo also includes a standalone Node.js web viewer (`server.js` + `index.html`) for watching the stream in any browser on your local network:

```bash
node server.js
```

Then open `http://localhost:8000`.

## License

Apache-2.0
