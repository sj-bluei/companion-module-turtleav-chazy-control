import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { InstanceStatus } from '@companion-module/base'

import { ChazyClient } from '../chazy.js'
import { Commands } from '../commands.js'
import { parseDecoderStatus, parseSystemStatus, parseWallStatus } from '../parser.js'
import { ChazyState } from '../state.js'
import { ChazySimulator } from './simulator.js'

/**
 * End-to-end checks of the transport against a simulated device: block
 * framing, acknowledgement matching, echo tolerance and queue serialisation.
 */

async function connected(client: ChazyClient): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Timed out connecting to the simulator')), 4000)
		client.once('connect', () => {
			clearTimeout(timer)
			client.notifyReady()
			resolve()
		})
	})
}

describe('ChazyClient against a simulated device', () => {
	let simulator: ChazySimulator
	let client: ChazyClient
	let port: number

	before(async () => {
		simulator = new ChazySimulator({ banner: true, echo: true })
		port = await simulator.listen()
		client = new ChazyClient({ host: '127.0.0.1', port })
		client.on('error', () => {
			/* surfaced through the failing assertion instead */
		})
		client.connect()
		await connected(client)
	})

	after(async () => {
		client.destroy()
		await simulator.close()
	})

	it('reads a status block and ignores the echoed command', async () => {
		const lines = await client.send(Commands.getStatus(), 'block')
		const text = lines.join('\n')
		assert.match(text, /CHAZY CONTROL Status Info/)
		assert.ok(!lines.some((line) => line.trim() === 'GET STATUS'), 'the echoed command should not appear in the reply')
	})

	it('parses the simulated status into device state', async () => {
		const state = new ChazyState()
		const lines = await client.send(Commands.getStatus(), 'block')
		state.applySystemStatus(parseSystemStatus(lines.join('\n')))

		assert.equal(state.current.firmware, '1.00.17')
		assert.equal(state.encoders.length, 2)
		assert.equal(state.decoders.length, 2)
		assert.equal(state.getDecoder(1)?.selected.video, 13)
	})

	it('settles an ack command on the [SUCCESS] line', async () => {
		const lines = await client.send(Commands.routeAll(1, 14), 'ack')
		assert.equal(lines.length, 1)
		assert.match(lines[0], /^\[SUCCESS]Set decoder 001 from encoder 014\./)
	})

	it('reflects a routing change in the next decoder poll', async () => {
		await client.send(Commands.routeAll(2, 14), 'ack')

		const state = new ChazyState()
		const lines = await client.send(Commands.getDecoderStatus(0), 'block')
		const parsed = parseDecoderStatus(lines.join('\n'))
		state.applyDecoderStatus(parsed)

		assert.equal(parsed.unparsed.length, 0)
		assert.equal(state.getDecoder(2)?.selected.video, 14)
		assert.equal(state.getDecoder(2)?.name, 'Right Screen')
	})

	it('reports an error reply without hanging', async () => {
		const lines = await client.send('SET DEC 999 OUTPUT ON', 'ack')
		assert.match(lines.join('\n'), /^\[ERROR]/)
	})

	it('serialises concurrent commands and keeps replies matched', async () => {
		const before = simulator.received.length

		const [status, route, decoders] = await Promise.all([
			client.send(Commands.getStatus(), 'block'),
			client.send(Commands.routeAll(1, 13), 'ack'),
			client.send(Commands.getDecoderStatus(0), 'block'),
		])

		assert.match(status.join('\n'), /CHAZY CONTROL Status Info/)
		assert.match(route.join('\n'), /^\[SUCCESS]/)
		assert.match(decoders.join('\n'), /CHAZY CONTROL Decoder Info/)
		assert.equal(simulator.received.length - before, 3)
	})

	it('round-trips an output toggle through state', async () => {
		await client.send(Commands.outputEnable(1, false), 'ack')

		const state = new ChazyState()
		const lines = await client.send(Commands.getDecoderStatus(1), 'block')
		state.applyDecoderStatus(parseDecoderStatus(lines.join('\n')))

		assert.equal(state.getDecoder(1)?.outputOn, false)

		await client.send(Commands.outputEnable(1, true), 'ack')
		const after = await client.send(Commands.getDecoderStatus(1), 'block')
		const restored = new ChazyState()
		restored.applyDecoderStatus(parseDecoderStatus(after.join('\n')))
		assert.equal(restored.getDecoder(1)?.outputOn, true)
	})

	it('reads back the active video wall preset after applying one', async () => {
		await client.send(Commands.applyWallPreset(1, 3), 'ack')

		const state = new ChazyState()
		const lines = await client.send(Commands.getWallStatus(1), 'block')
		const parsed = parseWallStatus(lines.join('\n'))
		assert.ok(parsed, 'expected a wall status block')
		state.applyWallStatus(parsed)

		assert.equal(state.getWall(1)?.activePreset, 3)
		assert.equal(state.getWall(1)?.name, 'VW1')
	})

	it('reports an error for a wall that does not exist, so probing can skip it', async () => {
		const lines = await client.send(Commands.getWallStatus(7), 'block')
		assert.equal(parseWallStatus(lines.join('\n')), undefined)
	})

	it('sends the documented wire syntax', async () => {
		const before = simulator.received.length
		await client.send(Commands.applyWallPreset(1, 2), 'ack')
		assert.equal(simulator.received[before], 'APPLY WALL 01 PRESET 02')
	})
})

describe('ChazyClient against a device that emits a prompt', () => {
	let simulator: ChazySimulator
	let client: ChazyClient
	let port: number

	before(async () => {
		// A prompt with no trailing newline stays in the receive buffer, and
		// would be glued onto the first line of the next reply if not dropped.
		simulator = new ChazySimulator({ prompt: 'CHAZY> ' })
		port = await simulator.listen()
		client = new ChazyClient({ host: '127.0.0.1', port, commandTimeout: 4000 })
		client.on('error', () => {
			/* surfaced through the failing assertion instead */
		})
		client.connect()
		await connected(client)
	})

	after(async () => {
		client.destroy()
		await simulator.close()
	})

	it('settles an ack immediately on the command after a prompt', async () => {
		await client.send(Commands.getStatus(), 'block')

		const started = Date.now()
		const lines = await client.send(Commands.routeAll(1, 14), 'ack')
		const elapsed = Date.now() - started

		assert.ok(
			lines.some((line) => /^\[SUCCESS]/.test(line.trim())),
			`expected a clean [SUCCESS] line, got ${JSON.stringify(lines)}`,
		)
		// Without dropping the stale prompt this only settles on the idle timer.
		assert.ok(elapsed < 400, `ack took ${elapsed}ms, suggesting it fell back to the idle timeout`)
	})

	it('still parses a status block cleanly', async () => {
		const lines = await client.send(Commands.getDecoderStatus(0), 'block')
		const parsed = parseDecoderStatus(lines.join('\n'))
		assert.equal(parsed.decoders.length, 2)
	})
})

describe('ChazyClient connection failures', () => {
	it('gives up on an unreachable address instead of waiting for the OS', async () => {
		// 192.0.2.1 is TEST-NET-1: packets are black-holed, so the OS would
		// otherwise take 75s on macOS to report ETIMEDOUT.
		const client = new ChazyClient({
			host: '192.0.2.1',
			port: 23,
			connectTimeout: 700,
			reconnectInterval: 60_000,
		})
		client.on('error', () => {
			/* expected */
		})

		const started = Date.now()
		const status = await new Promise<{ status: InstanceStatus; message: string | undefined }>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('No failure status was reported')), 5000)
			client.on('status', (value, message) => {
				if (value === InstanceStatus.ConnectionFailure) {
					clearTimeout(timer)
					resolve({ status: value, message })
				}
			})
			client.connect()
		})
		const elapsed = Date.now() - started

		assert.equal(status.status, InstanceStatus.ConnectionFailure)
		assert.match(String(status.message), /192\.0\.2\.1:23/)
		assert.ok(elapsed < 4000, `took ${elapsed}ms to report failure`)

		client.destroy()
	})

	it('reports connection refused promptly', async () => {
		// Bind and immediately close, so the port is almost certainly free.
		const probe = new ChazySimulator()
		const port = await probe.listen()
		await probe.close()

		const client = new ChazyClient({ host: '127.0.0.1', port, connectTimeout: 2000, reconnectInterval: 60_000 })
		client.on('error', () => {
			/* expected */
		})

		const message = await new Promise<string | undefined>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('No failure status was reported')), 5000)
			client.on('status', (value, text) => {
				if (value === InstanceStatus.ConnectionFailure) {
					clearTimeout(timer)
					resolve(text)
				}
			})
			client.connect()
		})

		assert.match(String(message), /ECONNREFUSED|refused/i)
		client.destroy()
	})

	it('stops retrying once destroyed', async () => {
		const client = new ChazyClient({
			host: '192.0.2.1',
			port: 23,
			connectTimeout: 300,
			reconnectInterval: 300,
		})
		client.on('error', () => {
			/* expected */
		})

		let failures = 0
		client.on('status', (value) => {
			if (value === InstanceStatus.ConnectionFailure) failures++
		})
		client.connect()

		await new Promise((resolve) => setTimeout(resolve, 800))
		client.destroy()
		const seen = failures

		await new Promise((resolve) => setTimeout(resolve, 900))
		assert.equal(failures, seen, 'no further attempts should happen after destroy')
	})
})

describe('ChazyClient error handling', () => {
	it('rejects queued commands when the device disappears', async () => {
		const simulator = new ChazySimulator()
		const port = await simulator.listen()

		const client = new ChazyClient({ host: '127.0.0.1', port, commandTimeout: 1000 })
		client.on('error', () => {
			/* expected during teardown */
		})
		client.connect()
		await connected(client)

		await simulator.close()

		await assert.rejects(async () => client.send(Commands.getStatus(), 'block'))
		client.destroy()
	})
})
