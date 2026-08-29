# Changelog

## 0.1.0 — unreleased

First working version. Written against the published Chazy Control API reference and tested against a device simulator; not yet validated on hardware.

- Telnet transport with a serialised command queue, automatic reconnection, and tolerance of login banners and command echo.
- A 5 second connection timeout, so an unreachable address reports "Connection failure" rather than sitting on "Connecting" until the operating system gives up (75 seconds on macOS).
- Encoder names are read from `GET ENC STATUS`, the only command that reports them — the encoder table in `GET STATUS` has no name column.
- Polled state: routing (per signal type), output enable/mute, decoder mode, resolution, rotation, and device presence.
- 19 actions covering routing, per-signal route locking, decoder output control, video wall preset recall, CEC/IR pass-through, GPIO, relays, reboots, and a raw custom command.
- 7 boolean feedbacks for routing, route locks, output state, video wall mode and device presence.
- Variables for controller state plus per-encoder and per-decoder detail.
- Salvos: one source to many decoders, and an arbitrary decoder:encoder list that reports bad entries rather than aborting.
- CEC display control with standard commands (on, standby, volume, mute) and a custom hex escape hatch.
- Learn support on the routing, output, resolution, rotation and mode actions.
- Video wall preset feedback, from the `CfgSel` column of `GET WALL STATUS`. Walls are probed once on connect so only the ones that exist are polled.
- Dante device discovery and audio/video channel subscription. Send-only: the controller does not report existing subscriptions, so Dante routing has no feedback.
- Generated presets covering every area: routing grid, output/mute/mode toggles, CEC display on/off, per-decoder status tiles, video wall recall, encoder signal indicators and system buttons.
