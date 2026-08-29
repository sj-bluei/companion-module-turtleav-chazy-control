import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { loadedHarness } from './harness.js'

/**
 * Exercises the action and feedback layer against state loaded from the
 * simulator's documented-format blocks: decoders 001 "Left Screen" and 002
 * "Right Screen", both fed from encoder 013 "Stage Camera"; encoder 014 is
 * "Playback PC".
 */

describe('routing actions', () => {
	it('sends the documented switch command', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('route_all', { dec: 1, enc: 14 }), ['SET DEC 1 SWITCH 14 ALL'])
	})

	it('treats encoder 0 as a disconnect', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('route_all', { dec: 1, enc: 0 }), ['SET DEC 1 SWITCH 0 ALL'])
	})

	it('sends the per-signal keyword when locking one signal', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('route_signal', { dec: 2, enc: 13, signal: 'usb' }), ['SET DEC 2 SWITCH 13 USB'])
	})

	it('skips and warns when a device id cannot be understood', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('route_all', { dec: 'nonsense', enc: 13 }), [])
		assert.ok(harness.logs.some((entry) => entry.message.includes('route_all')))
	})
})

describe('salvo actions', () => {
	it('expands one source to many decoders, in order', async () => {
		const harness = loadedHarness()
		const sent = await harness.run('route_salvo_source', { enc: 14, decs: [1, 2], signal: 'all' })
		assert.deepEqual(sent, ['SET DEC 1 SWITCH 14 ALL', 'SET DEC 2 SWITCH 14 ALL'])
	})

	it('applies a single signal type across the salvo', async () => {
		const harness = loadedHarness()
		const sent = await harness.run('route_salvo_source', { enc: 13, decs: [1, 2], signal: 'audio' })
		assert.deepEqual(sent, ['SET DEC 1 SWITCH 13 AUDIO', 'SET DEC 2 SWITCH 13 AUDIO'])
	})

	it('does nothing when no decoders are selected', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('route_salvo_source', { enc: 13, decs: [], signal: 'all' }), [])
	})

	it('expands a decoder:encoder list', async () => {
		const harness = loadedHarness()
		const sent = await harness.run('route_salvo_list', { routes: '1:14, 2:13', signal: 'all' })
		assert.deepEqual(sent, ['SET DEC 1 SWITCH 14 ALL', 'SET DEC 2 SWITCH 13 ALL'])
	})

	it('still applies the good routes when one entry is malformed', async () => {
		const harness = loadedHarness()
		const sent = await harness.run('route_salvo_list', { routes: '1:14, oops, 2:13', signal: 'all' })
		assert.deepEqual(sent, ['SET DEC 1 SWITCH 14 ALL', 'SET DEC 2 SWITCH 13 ALL'])
		assert.ok(
			harness.logs.some((entry) => entry.level === 'warn' && entry.message.includes('oops')),
			'the unreadable entry should be named in a warning',
		)
	})
})

describe('CEC action', () => {
	it('sends the standard bytes for a chosen command', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('send_cec', { target: 'DEC', id: 1, command: 'power_on', hex: '' }), [
			'SET DEC 1 CEC SEND 40 04',
		])
	})

	it('sends broadcast standby for display off', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('send_cec', { target: 'DEC', id: 1, command: 'standby', hex: '' }), [
			'SET DEC 1 CEC SEND 4F 36',
		])
	})

	it('uses the hex field only when Custom is chosen', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('send_cec', { target: 'DEC', id: 2, command: 'custom', hex: '4f 82 10 00' }), [
			'SET DEC 2 CEC SEND 4F 82 10 00',
		])
	})

	it('ignores the hex field when a standard command is chosen', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('send_cec', { target: 'DEC', id: 1, command: 'standby', hex: 'de ad be ef' }), [
			'SET DEC 1 CEC SEND 4F 36',
		])
	})

	it('does nothing when Custom is chosen with no bytes', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.run('send_cec', { target: 'DEC', id: 1, command: 'custom', hex: '' }), [])
	})

	it('offers a custom option so unusual displays are still reachable', () => {
		const harness = loadedHarness()
		const field = harness.action('send_cec').options.find((option) => (option as { id: string }).id === 'command') as {
			choices: { id: string }[]
			disableAutoExpression?: boolean
		}
		assert.ok(field.choices.some((choice) => choice.id === 'custom'))
		// Required for the hex field's isVisibleExpression to reference it.
		assert.equal(field.disableAutoExpression, true)
	})
})

describe('action learn', () => {
	it('learns the current video source', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.learn('route_all', { dec: 1, enc: 999 }), { enc: 13 })
	})

	it('returns only the learned field, so a driven device id survives', async () => {
		const harness = loadedHarness()
		const learned = (await harness.learn('route_all', { dec: 1, enc: 999 })) as Record<string, unknown>
		assert.deepEqual(Object.keys(learned), ['enc'])
	})

	it('learns output state', async () => {
		const harness = loadedHarness()
		assert.deepEqual(await harness.learn('output_enable', { dec: 1, state: 'off' }), { state: 'on' })
	})

	it('learns the current resolution as a command code', async () => {
		const harness = loadedHarness()
		// Decoder 002 reports resolution code "02" in the simulator.
		assert.deepEqual(await harness.learn('output_resolution', { dec: 2, resolution: '0' }), { resolution: '2' })
	})

	it('gives up rather than guessing for an unknown decoder', async () => {
		const harness = loadedHarness()
		assert.equal(await harness.learn('route_all', { dec: 900, enc: 1 }), undefined)
	})
})

describe('feedbacks', () => {
	it('reports the active route', () => {
		const harness = loadedHarness()
		assert.equal(harness.check('routed_from', { dec: 1, enc: 13, signal: 'video' }), true)
		assert.equal(harness.check('routed_from', { dec: 1, enc: 14, signal: 'video' }), false)
	})

	it('reports display connection via HPD', () => {
		const harness = loadedHarness()
		assert.equal(harness.check('decoder_hpd', { dec: 1 }), true)
	})

	it('is false for a decoder that does not exist', () => {
		const harness = loadedHarness()
		assert.equal(harness.check('decoder_hpd', { dec: 900 }), false)
		assert.equal(harness.check('output_on', { dec: 900 }), false)
	})
})

describe('definition coverage', () => {
	it('every action has a name and an executable callback', () => {
		const harness = loadedHarness()
		for (const id of harness.actionIds()) {
			const definition = harness.action(id as never)
			assert.ok(definition.name, `${id} has no name`)
			assert.equal(typeof definition.callback, 'function', `${id} has no callback`)
		}
	})

	it('every feedback has a name and a callback', () => {
		const harness = loadedHarness()
		for (const id of harness.feedbackIds()) {
			const definition = harness.feedback(id as never)
			assert.ok(definition.name, `${id} has no name`)
			assert.equal(typeof definition.callback, 'function', `${id} has no callback`)
		}
	})
})
