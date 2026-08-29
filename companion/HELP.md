# Turtle AV Chazy Control

Controls a **Turtle AV Chazy Control** or **Chazy Control Pro** — the central management box for the Chazy 4K Dante AV-A AV-over-IP range. The module talks to the unit's telnet command interface, so it can switch routes, drive decoder outputs, recall video wall presets and pass CEC/IR commands through to displays.

> This module targets the Chazy **Control** management box. It is not for the Chazy Multiview, which uses a different interface.

## Setting up

1. Make sure **Telnet is enabled** on the Chazy Control. You can check from the unit's web GUI, or by looking at the `Telnet` column of a `GET STATUS` response — it shows the active port (`0023` by default).
2. In Companion, add the connection and set:
   - **Device IP / hostname** — the control LAN address of the unit.
   - **Telnet port** — `23` unless it has been changed on the device.
   - **Poll interval** — how often routing and device state are refreshed. `2000` ms suits most systems; lower it for snappier feedback, raise it on large installations. Set it to `0` to stop polling entirely (actions still work, but feedbacks and variables will not update).
   - **Full status every N polls** — encoder and controller details change rarely, so they are refreshed less often than decoder routing. The default of `5` is fine.
   - **Log all device traffic** — turn this on temporarily if something is not working; it writes every line sent and received to the debug log.

Once connected, the module reads the device roster and populates the encoder/decoder dropdowns with the names configured on the unit. Devices that have not been discovered yet can still be targeted by typing an ID into any device dropdown.

## Terminology

The device API calls sources **encoders** (ENC/TX) and displays **decoders** (DEC/RX). The module uses the same words, so what you see here matches the Chazy documentation and web GUI.

## Actions

### Routing

- **Route: decoder from encoder (all signals)** — the everyday switch. Moves video, audio, IR, RS-232, USB and CEC together. Choosing _None (disconnect)_ as the encoder clears the route; choosing _All decoders_ sends the same source everywhere.
- **Route: lock a single signal type** — locks one signal type to a specific encoder, independently of the rest. This is what you want for KVM-style setups where, say, USB should follow one source while video follows another. Selecting _None_ unlocks that signal type again.
- **Route: salvo — many decoders from one encoder** — switches a whole set of decoders to the same source in one press. Pick the source, tick the decoders.
- **Route: salvo — list of decoder:encoder pairs** — an arbitrary salvo written as `1:13, 2:14, 3:13`, where each destination can take a different source. Separate pairs with commas, semicolons or new lines, and use encoder `0` to disconnect. If one entry is malformed the rest are still applied and the bad one is named in the log, so a typo cannot silently drop a show-critical press.

Several actions support Companion's **Learn** button: set the routing, output state, resolution, rotation or mode by hand, press Learn, and the action captures what the device is currently doing.

### Decoder outputs

- **Output: enable / disable** — turns the HDMI output on or off. Supports Toggle.
- **Output: mute** — mutes output audio. Supports Toggle.
- **Output: resolution** — sets a fixed output resolution, or _Bypass_ to pass the source through.
- **Output: rotate** — 0°, 90°, 180° or 270°.
- **Output: flip** — horizontal, vertical or off.
- **Output: on-screen display** — shows or hides the decoder OSD.
- **Decoder: matrix / video wall mode** — switches a decoder between standalone (MX) and video wall (VW) behaviour.

When an action targets _All decoders_, a Toggle turns everything **off** if any decoder is currently on, so a single press always gives a predictable result.

### Video wall

- **Video wall: apply preset** — recalls a stored preset on one of the nine walls. Walls and presets must already be configured on the unit; this module recalls them rather than building them.

### Pass-through and device control

- **Send: CEC command** — powers displays on and off, and adjusts volume, through the decoder. Pick a standard command (Display on, Display off, Volume up/down, Mute) or choose **Custom…** to enter raw hex bytes. The standard commands are addressed from a playback device as the API reference describes; displays vary in what they honour, so if yours does not respond, switch to Custom.
- **Send: IR command** — sends raw IR hex bytes out of a decoder or encoder.
- **Encoder: audio input source** — embedded HDMI audio or the analogue input.
- **Encoder: front panel LED**
- **Controller: GPIO output level** — the pin must already be configured as an output on the controller.
- **Device: relay** — opens or closes the relay on an encoder or decoder.
- **Device: reboot encoder / decoder** and **Controller: reboot**.

### Dante

The Chazy Control has an embedded Dante controller, and these actions drive it:

- **Dante: subscribe a receive channel to a source** — points one Dante receive channel at a transmit channel. Devices are addressed by name; use **Dante: rescan for devices** if the picker is empty or out of date.
- **Dante: set sample rate** and **Dante: set latency**.

> **Dante routing is send-only.** The controller reports Dante device configuration but not existing channel subscriptions, so the module cannot show which subscription is currently active and there are no Dante feedbacks. Channel numbering also depends on the device, which the controller does not report, so channels are entered as plain numbers.

### Custom command

**Custom command** sends a raw API string to the device, for anything not covered above — the Chazy Control API reference lists the full command set. Tick _Reply is a status block_ for `GET`-style commands, which answer with a block of text rather than a `[SUCCESS]` line.

## Feedbacks

| Feedback                              | Use it for                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Decoder is routed from encoder        | Lighting up the active source on a routing grid. Pick the signal type — Video is the usual choice. |
| Decoder route is locked               | Showing that a signal type is pinned to a source.                                                  |
| Decoder output is enabled             | Output on/off state.                                                                               |
| Decoder output is muted               | Mute state.                                                                                        |
| Decoder is in video wall mode         | Distinguishing wall members from standalone screens.                                               |
| Decoder has a display connected (HPD) | Spotting a screen that is unplugged or in standby.                                                 |
| Decoder is online                     | Decoder network presence.                                                                          |
| Encoder is online                     | Encoder network presence, optionally also requiring an input signal.                               |
| Video wall preset is active           | Lighting the preset currently applied to a video wall.                                             |

## Variables

Alongside `connection`, `fw_version`, `decoder_count`, `encoder_count` and `dante_device_count`, the module creates variables per discovered device:

- **Per decoder** — `dec_001_name`, `dec_001_online`, `dec_001_hpd`, `dec_001_output`, `dec_001_muted`, `dec_001_resolution`, `dec_001_rotate`, `dec_001_mode`, and the current source both as `dec_001_source` / `dec_001_source_name` (video) and per signal type, e.g. `dec_001_source_usb_name`.
- **Per encoder** — `enc_013_name`, `enc_013_online`, `enc_013_signal`.
- **Per video wall** — `wall_1_name`, `wall_1_preset`.
- **Per Dante device** — `dante_001_name`, `dante_001_ip`.

These are handy for putting the current source name on a button.

## Presets

Presets are generated from the devices the controller reports, so they appear once the connection is up:

- **Routing** — a group per source containing one button per decoder, lit when that decoder is showing that source. Drop a group onto a page to get an instant routing grid. Also holds starter buttons for salvos and signal locks.
- **Decoder outputs** — output, mute and matrix/video-wall toggles with state feedback, plus starters for resolution, rotation and OSD.
- **Display control (CEC)** — display on and off per decoder.
- **Status tiles** — one tile per decoder showing its name and live source, green when online with a display attached, amber when no display is detected, red when the decoder is offline. Fill a page with these for a system overview.
- **Video walls** — preset recall for wall 1, lit when that preset is the active one; edit the wall number on the button for other walls.
- **Encoders** — input-signal indicators, plus audio input and LED starters.
- **System** — controller status and reboot, device reboot, GPIO and relay starters.

Buttons that say _edit after adding_ are deliberately single starters rather than full grids: they take a parameter that would otherwise multiply into hundreds of near-identical presets. Drop one and change the value.

## Troubleshooting

**"Connection failure — No response from …"** — nothing accepted a connection within 5 seconds. Usually a wrong address, the wrong port, or a device on another VLAN. The module keeps retrying every 5 seconds, so fixing the address is enough; there is no need to disable and re-enable the connection.

**"Connection failure — … ECONNREFUSED"** — the address is reachable but nothing is listening on that port. Check the port, and that telnet is enabled on the unit rather than only SSH or HTTPS.

**Status stays on "Connecting" / "Waiting for status"** — the socket opened but no status block came back. Check that nothing else is holding the telnet session, and turn on _Log all device traffic_ to see what the unit is actually sending.

**Feedbacks and variables never update** — check the poll interval is not `0`.

**Actions work but state looks wrong** — the module reads the unit's text status tables, and their layout can change between firmware versions. Enable _Log all device traffic_, reproduce the problem, and open an issue with the log: the raw `GET STATUS` and `GET DEC 0 STATUS` output is exactly what is needed to fix it.

**Buttons feel slow to light up** — feedback follows the poll, so it updates within one poll interval. The module also polls immediately after a successful command, so a button press should reflect almost at once.
