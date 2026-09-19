<div align="center">
  <img src="assets/logo.png" width="120" alt="Lollipop Camera" />
  <h1>homebridge-lollipop-plugin</h1>
  <p>Expose a Lollipop baby monitor as a HomeKit IP camera with live video and audio.</p>
</div>

## Requirements

- Homebridge 1.6 or later
- Node.js 22 or later
- A Lollipop camera reachable from the Homebridge host on the same LAN
- A HomeKit hub for remote viewing

The package includes Homebridge's static FFmpeg build and falls back to a system `ffmpeg` executable when needed.

## Installation

In Homebridge UI, open **Plugins**, search for `homebridge-lollipop-plugin`, and select **Install**.

## Configuration

Current Lollipop firmware protects its local RTSP stream. Obtain the camera's authenticated internal RTSP URL through a trusted local process and treat it as a camera credential. Do not post it in issues or logs.

```json
{
  "platform": "LollipopCamera",
  "name": "Lollipop",
  "cameras": [
    {
      "name": "Nursery",
      "ip": "192.168.4.24",
      "rtspUrl": "<authenticated RTSP URL>",
      "hksv": false,
      "enableSoundMachine": false,
      "movementSensitivity": 0
    }
  ]
}
```

The settings UI masks `rtspUrl` as a password. The plugin validates that the URL uses RTSP and points to the configured camera IP. It never logs the URL.

### Legacy firmware

If the camera permits unauthenticated local MQTT, `rtspUrl` may be omitted. The plugin discovers the pairing identifier over MQTT and enables supported sensors and sound controls. This path deliberately pins MQTT `4.2.8` and uses the same minimal TLS options as the working `senorshaun/homebridge-lollipop` implementation; newer MQTT clients can fail the handshake with these cameras. If legacy discovery still fails, configure the camera's authenticated `rtspUrl` instead.

### HomeKit Secure Video

Start with `hksv` disabled and verify reliable live video first. HKSV requires a HomeKit hub and a supported iCloud plan. MQTT-backed motion events are unavailable when the camera's authenticated firmware rejects local MQTT connections.

## Privacy and security

- Keep the camera and Homebridge on a trusted LAN or isolated IoT VLAN.
- Do not expose RTSP or MQTT camera ports to the internet.
- Treat the authenticated RTSP URL like a password.
- Keep Homebridge authentication and two-factor authentication enabled.

## License

Apache-2.0