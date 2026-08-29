# companion-module-turtleav-chazy-control

A [Bitfocus Companion](https://bitfocus.io/companion) module for the **Turtle AV Chazy Control / Control Pro**, the central management box for the Chazy 4K Dante AV-A AV-over-IP range.

See [companion/HELP.md](companion/HELP.md) for the user-facing documentation, and [CHANGELOG.md](CHANGELOG.md) for release notes.

## Status

Early development. The command layer is written against the published Chazy Control API reference and is covered by tests against a device simulator; **it has not yet been validated against physical hardware.** See [Hardware bring-up](#hardware-bring-up) below.

## How it talks to the device

The Chazy Control exposes a plain-text CLI over telnet (port 23 by default; SSH and RS-232 offer the same command set). Commands are single lines answered either by a `[SUCCESS]` / `[ERROR]` acknowledgement or by a block of status text delimited by rows of `=`.

There is no request/response tagging and no push channel, which shapes the design:

- **`src/chazy.ts`** owns the socket and a serialised command queue. Only one command is in flight at a time, replies are matched to whatever was sent last, and user actions are queued ahead of background polls. Echoed commands and login banners are tolerated.
- **`src/parser.ts`** turns the status blocks into data. The device emits human-formatted fixed-width tables, so the parser keys off header rows and distinctive token shapes rather than column offsets, and reports anything it could not understand instead of dropping it silently.
- **`src/state.ts`** merges each polled snapshot into the running state and reports what actually changed, so only the affected feedbacks and variables are refreshed.
- **`src/commands.ts`** builds the wire strings, kept separate so the syntax can be checked against the API reference in one place.

## Development

Requires Node 22 and Yarn 4 (via corepack).

```bash
yarn install
yarn build
```

Then point Companion at the folder containing this repo via the launcher's developer modules setting.

| Command                 | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `yarn build`            | Compile to `dist/`                           |
| `yarn dev`              | Compile in watch mode                        |
| `yarn test`             | Type-check and run the test suite            |
| `yarn lint`             | ESLint + Prettier                            |
| `yarn simulator [port]` | Run a fake Chazy Control on `127.0.0.1:2323` |

### Testing without hardware

`yarn simulator` starts a stand-in device that speaks enough of the CLI to exercise the module: it answers `GET STATUS` and `GET DEC ... STATUS` with realistic blocks and mutates its own routing state in response to `SET` commands. Add a connection pointing at `127.0.0.1:2323` and the module will populate its dropdowns, presets and feedbacks as if a real unit were attached.

The test suite uses the same simulator to cover block framing, acknowledgement matching, echo tolerance and queue serialisation, alongside parser tests built from the samples in the API reference.

## Hardware bring-up

The status-table parsing is the part most likely to need adjustment on real hardware, since the layout may differ between firmware versions. Before trusting the module in production, capture the following from a real unit (with _Log all device traffic_ enabled, or over a manual telnet session) and add them as parser fixtures:

1. The raw connect exchange — banner, prompt, echo behaviour, line endings.
2. `HELP` — the command set the firmware actually supports.
3. `GET STATUS`, `GET DEC 0 STATUS`, `GET ENC 0 STATUS`, `GET WALL 1 STATUS`.
4. The error reply for a command aimed at a device that does not exist.
5. Whether changing a route in the web GUI produces any unsolicited output on an open telnet session.
6. Whether two simultaneous telnet sessions are allowed.
7. Response latency of `GET DEC 0 STATUS` with the full device roster, which sets a realistic poll floor.

## Licence

MIT
