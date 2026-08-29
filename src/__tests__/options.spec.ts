import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { asDeviceId, asDeviceIdList, parseSalvoList } from '../options.js'
import { cecBytes, CEC_CUSTOM } from '../types.js'

describe('parseSalvoList', () => {
	it('reads a comma separated list', () => {
		const { routes, invalid } = parseSalvoList('1:13, 2:14, 3:13')
		assert.deepEqual(routes, [
			{ decoder: 1, encoder: 13 },
			{ decoder: 2, encoder: 14 },
			{ decoder: 3, encoder: 13 },
		])
		assert.deepEqual(invalid, [])
	})

	it('accepts newlines and semicolons, as pasted from a run sheet', () => {
		const { routes } = parseSalvoList('1:13\n2:14;3:13')
		assert.equal(routes.length, 3)
	})

	it('accepts alternative separators between the pair', () => {
		const { routes } = parseSalvoList('1>13, 2=14, 3-13')
		assert.deepEqual(
			routes.map((route) => route.encoder),
			[13, 14, 13],
		)
	})

	it('keeps good routes and reports bad ones rather than aborting', () => {
		const { routes, invalid } = parseSalvoList('1:13, banana, 3:13')
		assert.equal(routes.length, 2)
		assert.deepEqual(invalid, ['banana'])
	})

	it('treats encoder 0 as a disconnect rather than an error', () => {
		const { routes, invalid } = parseSalvoList('4:0')
		assert.deepEqual(routes, [{ decoder: 4, encoder: 0 }])
		assert.deepEqual(invalid, [])
	})

	it('ignores empty entries and stray whitespace', () => {
		const { routes, invalid } = parseSalvoList('  1:13 , , \n  2:14  ')
		assert.equal(routes.length, 2)
		assert.deepEqual(invalid, [])
	})

	it('returns nothing for an empty list', () => {
		assert.deepEqual(parseSalvoList('   '), { routes: [], invalid: [] })
	})
})

describe('asDeviceId', () => {
	it('accepts numbers and numeric strings', () => {
		assert.equal(asDeviceId(13), 13)
		assert.equal(asDeviceId('013'), 13)
		assert.equal(asDeviceId(' 7 '), 7)
	})

	it('rejects values it cannot understand', () => {
		assert.equal(asDeviceId(''), undefined)
		assert.equal(asDeviceId('abc'), undefined)
		assert.equal(asDeviceId(undefined), undefined)
	})
})

describe('asDeviceIdList', () => {
	it('coerces a multidropdown selection and drops duplicates', () => {
		assert.deepEqual(asDeviceIdList([1, '2', 1, 'x']), [1, 2])
	})

	it('returns empty for a non-array', () => {
		assert.deepEqual(asDeviceIdList('1,2'), [])
	})
})

describe('cecBytes', () => {
	it('maps the standard commands to bytes', () => {
		assert.equal(cecBytes('power_on'), '40 04')
		assert.equal(cecBytes('standby'), '4F 36')
		assert.equal(cecBytes('volume_up'), '40 44 41')
	})

	it('returns undefined for custom, so the hex field is used instead', () => {
		assert.equal(cecBytes(CEC_CUSTOM), undefined)
	})

	it('returns undefined for an unknown id', () => {
		assert.equal(cecBytes('nonsense'), undefined)
	})
})
