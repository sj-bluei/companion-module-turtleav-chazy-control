import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { loadedHarness, type PresetGroup } from './harness.js'

/**
 * Structural checks on the generated preset library. Section-to-preset
 * references are plain strings and are not type-checked, so a typo there would
 * otherwise only show up as a preset group that silently renders empty.
 */

function groupsOf(section: { definitions: PresetGroup[] | string[] }): PresetGroup[] {
	return section.definitions.filter((entry): entry is PresetGroup => typeof entry !== 'string')
}

describe('preset library', () => {
	const harness = loadedHarness()

	it('publishes a section per functional area', () => {
		const ids = harness.presetSections.map((section) => section.id)
		assert.deepEqual(ids, ['routing', 'outputs', 'display_control', 'status', 'video_walls', 'encoders', 'system'])
	})

	it('every preset referenced by a group actually exists', () => {
		const missing: string[] = []
		for (const section of harness.presetSections) {
			for (const group of groupsOf(section)) {
				for (const presetId of group.presets ?? []) {
					if (!harness.presets[presetId]) missing.push(`${section.id}/${group.id}/${presetId}`)
				}
			}
		}
		assert.deepEqual(missing, [], 'these groups reference presets that were never defined')
	})

	it('every defined preset is referenced by some group', () => {
		const referenced = new Set<string>()
		for (const section of harness.presetSections) {
			for (const group of groupsOf(section)) {
				for (const presetId of group.presets ?? []) referenced.add(presetId)
			}
		}
		const orphans = Object.keys(harness.presets).filter((id) => !referenced.has(id))
		assert.deepEqual(orphans, [], 'these presets would never be visible in the browser')
	})

	it('every action referenced by a preset is a real action', () => {
		const actionIds = new Set(harness.actionIds())
		const bad: string[] = []
		for (const [id, preset] of Object.entries(harness.presets)) {
			for (const step of preset.steps) {
				for (const action of step.down) {
					if (!actionIds.has(action.actionId)) bad.push(`${id} -> ${action.actionId}`)
				}
			}
		}
		assert.deepEqual(bad, [])
	})

	it('every feedback referenced by a preset is a real feedback', () => {
		const feedbackIds = new Set(harness.feedbackIds())
		const bad: string[] = []
		for (const [id, preset] of Object.entries(harness.presets)) {
			for (const feedback of preset.feedbacks) {
				if (!feedbackIds.has(feedback.feedbackId)) bad.push(`${id} -> ${feedback.feedbackId}`)
			}
		}
		assert.deepEqual(bad, [])
	})

	it('builds a routing grid covering every source and destination', () => {
		const routing = harness.presetSections.find((section) => section.id === 'routing')
		assert.ok(routing)
		const sourceGroups = groupsOf(routing).filter((group) => group.id.startsWith('route_from_'))
		// Two encoders in the simulator roster, each with a button per decoder.
		assert.equal(sourceGroups.length, 2)
		assert.equal(sourceGroups[0].presets?.length, 2)
	})

	it('names routing buttons with device names rather than placeholders', () => {
		const preset = harness.presets['route_13_1']
		assert.ok(preset, 'expected a preset routing encoder 13 to decoder 1')
		assert.match(preset.style.text ?? '', /Left Screen/)
		assert.match(preset.style.text ?? '', /Stage Camera/)
	})

	it('gives status tiles a live source variable and health colouring', () => {
		const tile = harness.presets['status_1']
		assert.ok(tile)
		assert.match(tile.style.text ?? '', /\$\(Chazy_Control:dec_001_source_name\)/)
		assert.deepEqual(
			tile.feedbacks.map((feedback) => feedback.feedbackId),
			['decoder_online', 'decoder_hpd', 'decoder_online'],
		)
	})

	it('wires wall preset buttons to the active-preset feedback', () => {
		const preset = harness.presets['wall_1_preset_1']
		assert.ok(preset)
		assert.deepEqual(
			preset.feedbacks.map((feedback) => feedback.feedbackId),
			['wall_preset_active'],
		)
	})

	it('uses real newlines in button text rather than a literal backslash-n', () => {
		for (const [id, preset] of Object.entries(harness.presets)) {
			assert.ok(!(preset.style.text ?? '').includes('\\n'), `${id} contains a literal \\n`)
		}
	})
})
