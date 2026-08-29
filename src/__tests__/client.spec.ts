import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ChazyClient } from '../chazy.js'
import { Commands } from '../commands.js'
import { parseDecoderStatus, parseSystemStatus } from '../parser.js'
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

	it('sends the documented wire syntax', async () => {
		const before = simulator.received.length
		await client.send(Commands.applyWallPreset(1, 2), 'ack')
		assert.equal(simulator.received[before], 'APPLY WALL 01 PRESET 02')
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
