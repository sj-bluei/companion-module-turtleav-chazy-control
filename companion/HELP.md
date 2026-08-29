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

- **Send: CEC command** / **Send: IR command** — sends raw hex bytes out of a decoder or encoder. Commonly used to power displays on and off. Enter space-separated hex bytes, e.g. `40 04`.
- **Encoder: audio input source** — embedded HDMI audio or the analogue input.
- **Encoder: front panel LED**
- **Controller: GPIO output level** — the pin must already be configured as an output on the controller.
- **Device: relay** — opens or closes the relay on an encoder or decoder.
- **Device: reboot encoder / decoder** and **Controller: reboot**.

### Custom command

**Custom command** sends a raw API string to the device, for anything not covered above — the Chazy Control API reference lists the full command set. Tick _Reply is a status block_ for `GET`-style commands, which answer with a block of text rather than a `[SUCCESS]` line.

## Feedbacks

| Feedback                       | Use it for                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| Decoder is routed from encoder | Lighting up the active source on a routing grid. Pick the signal type — Video is the usual choice. |
| Decoder route is locked        | Showing that a signal type is pinned to a source.                                                  |
| Decoder output is enabled      | Output on/off state.                                                                               |
| Decoder output is muted        | Mute state.                                                                                        |
| Decoder is in video wall mode  | Distinguishing wall members from standalone screens.                                               |
| Decoder is online              | Decoder network presence.                                                                          |
| Encoder is online              | Encoder network presence, optionally also requiring an input signal.                               |

## Variables

Alongside `connection`, `fw_version`, `decoder_count` and `encoder_count`, the module creates variables per discovered device — for example `dec_001_source_name` (the name of the encoder currently feeding decoder 1), `dec_001_output`, `dec_001_muted`, `dec_001_resolution`, and `enc_013_signal`. These are handy for putting the current source name on a button.

## Presets

Presets are generated from the devices the controller reports, so they appear once the connection is up:

- **Routing** — a group per source containing one button per decoder, lit when that decoder is showing that source. Drop a group onto a page to get an instant routing grid.
- **Decoder outputs** — output and mute toggles with state feedback.
- **Video walls** — preset recall buttons for wall 1; edit the wall number on the button for other walls.

## Troubleshooting

**Status stays on "Connecting" / "Waiting for status"** — the socket opened but no status block could be read. Check that telnet (not just SSH or HTTPS) is enabled on the unit, and that nothing else holds the session.

**Feedbacks and variables never update** — check the poll interval is not `0`.

**Actions work but state looks wrong** — the module reads the unit's text status tables, and their layout can change between firmware versions. Enable _Log all device traffic_, reproduce the problem, and open an issue with the log: the raw `GET STATUS` and `GET DEC 0 STATUS` output is exactly what is needed to fix it.

**Buttons feel slow to light up** — feedback follows the poll, so it updates within one poll interval. The module also polls immediately after a successful command, so a button press should reflect almost at once.
