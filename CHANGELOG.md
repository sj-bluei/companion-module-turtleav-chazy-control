# Changelog

## 0.1.0 — unreleased

First working version. Written against the published Chazy Control API reference and tested against a device simulator; not yet validated on hardware.

- Telnet transport with a serialised command queue, automatic reconnection, and tolerance of login banners and command echo.
- Polled state: routing (per signal type), output enable/mute, decoder mode, resolution, rotation, and device presence.
- 19 actions covering routing, per-signal route locking, decoder output control, video wall preset recall, CEC/IR pass-through, GPIO, relays, reboots, and a raw custom command.
- 7 boolean feedbacks for routing, route locks, output state, video wall mode and device presence.
- Variables for controller state plus per-encoder and per-decoder detail.
- Generated presets: a routing grid per source, output and mute toggles, and video wall preset recall.
