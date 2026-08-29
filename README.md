# companion-module-turtleav-chazy-control

A [Bitfocus Companion](https://bitfocus.io/companion) module for the **Turtle AV Chazy Control / Control Pro**, the central management box for the Chazy 4K Dante AV-A AV-over-IP range.

See [companion/HELP.md](companion/HELP.md) for the user-facing documentation, and [CHANGELOG.md](CHANGELOG.md) for release notes.

## Status

**it has not yet been validated against physical hardware.**

## How it talks to the device

The Chazy Control exposes a plain-text CLI over telnet (port 23 by default; SSH and RS-232 offer the same command set). Commands are single lines answered either by a `[SUCCESS]` / `[ERROR]` acknowledgement or by a block of status text delimited by rows of `=`.

There is no request/response tagging and no push channel, which shapes the design:

- **`src/chazy.ts`** owns the socket and a serialised command queue. Only one command is in flight at a time, replies are matched to whatever was sent last, and user actions are queued ahead of background polls. Echoed commands and login banners are tolerated.
- **`src/parser.ts`** turns the status blocks into data. The device emits human-formatted fixed-width tables, so the parser keys off header rows and distinctive token shapes rather than column offsets, and reports anything it could not understand instead of dropping it silently.
- **`src/state.ts`** merges each polled snapshot into the running state and reports what actually changed, so only the affected feedbacks and variables are refreshed.
- **`src/commands.ts`** builds the wire strings, kept separate so the syntax can be checked against the API reference in one place.

## Development

### Testing without hardware

`yarn simulator` starts a stand-in device that speaks enough of the CLI to exercise the module: it answers `GET STATUS` and `GET DEC ... STATUS` with realistic blocks and mutates its own routing state in response to `SET` commands. Add a connection pointing at `127.0.0.1:2323` and the module will populate its dropdowns, presets and feedbacks as if a real unit were attached.

The test suite uses the same simulator to cover block framing, acknowledgement matching, echo tolerance and queue serialisation, alongside parser tests built from the samples in the API reference.

## Licence

MIT
