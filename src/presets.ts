import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'

import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 153, 51)
const RED = combineRgb(153, 0, 0)
const AMBER = combineRgb(200, 130, 0)

/**
 * Presets are generated from the devices the controller has reported, so they
 * only appear once a connection has been made. The routing grid is capped so a
 * large installation cannot flood the preset browser.
 */
const MAX_ROUTING_PRESETS = 400

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const sections: CompanionPresetSection<ModuleSchema>[] = []

	const decoders = self.state.decoders
	const encoders = self.state.encoders

	// -- Routing grid ------------------------------------------------------
	if (decoders.length > 0 && encoders.length > 0) {
		const groups = []
		let generated = 0

		for (const encoder of encoders) {
			const presetIds: string[] = []

			for (const decoder of decoders) {
				if (generated >= MAX_ROUTING_PRESETS) break
				const id = `route_${encoder.id}_${decoder.id}`
				presets[id] = {
					type: 'simple',
					name: `Route ${shortName(encoder.name, encoder.id)} to ${shortName(decoder.name, decoder.id)}`,
					style: {
						text: `${shortName(decoder.name, decoder.id)}\\n← ${shortName(encoder.name, encoder.id)}`,
						size: 'auto',
						color: WHITE,
						bgcolor: DARK,
						show_topbar: false,
					},
					steps: [
						{
							down: [{ actionId: 'route_all', options: { dec: decoder.id, enc: encoder.id } }],
							up: [],
						},
					],
					feedbacks: [
						{
							feedbackId: 'routed_from',
							options: { dec: decoder.id, enc: encoder.id, signal: 'video' },
							style: { bgcolor: GREEN, color: WHITE },
						},
					],
				}
				presetIds.push(id)
				generated++
			}

			if (presetIds.length > 0) {
				groups.push({
					id: `route_from_${encoder.id}`,
					type: 'simple' as const,
					name: `Source: ${shortName(encoder.name, encoder.id)}`,
					description: 'One button per decoder, lit when that decoder is showing this source.',
					presets: presetIds,
				})
			}
			if (generated >= MAX_ROUTING_PRESETS) break
		}

		if (groups.length > 0) {
			sections.push({
				id: 'routing',
				name: 'Routing',
				description: 'Switch a decoder to a source. Buttons light up when the route is active.',
				definitions: groups,
			})
		}
	}

	// -- Decoder output control -------------------------------------------
	if (decoders.length > 0) {
		const outputIds: string[] = []
		const muteIds: string[] = []

		for (const decoder of decoders) {
			const name = shortName(decoder.name, decoder.id)

			const outputId = `output_${decoder.id}`
			presets[outputId] = {
				type: 'simple',
				name: `${name}: output on/off`,
				style: {
					text: `${name}\\nOUTPUT`,
					size: 'auto',
					color: WHITE,
					bgcolor: DARK,
					show_topbar: false,
				},
				steps: [
					{
						down: [{ actionId: 'output_enable', options: { dec: decoder.id, state: 'toggle' } }],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'output_on',
						options: { dec: decoder.id },
						style: { bgcolor: GREEN, color: WHITE },
					},
				],
			}
			outputIds.push(outputId)

			const muteId = `mute_${decoder.id}`
			presets[muteId] = {
				type: 'simple',
				name: `${name}: mute`,
				style: {
					text: `${name}\\nMUTE`,
					size: 'auto',
					color: WHITE,
					bgcolor: DARK,
					show_topbar: false,
				},
				steps: [
					{
						down: [{ actionId: 'output_mute', options: { dec: decoder.id, state: 'toggle' } }],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'output_muted',
						options: { dec: decoder.id },
						style: { bgcolor: RED, color: WHITE },
					},
				],
			}
			muteIds.push(muteId)
		}

		sections.push({
			id: 'outputs',
			name: 'Decoder outputs',
			definitions: [
				{
					id: 'output_toggles',
					type: 'simple',
					name: 'Output on/off',
					description: 'Toggles the HDMI output, lit while the output is enabled.',
					presets: outputIds,
				},
				{
					id: 'mute_toggles',
					type: 'simple',
					name: 'Audio mute',
					description: 'Toggles output mute, lit while muted.',
					presets: muteIds,
				},
			],
		})
	}

	// -- Video wall presets ------------------------------------------------
	const wallIds: string[] = []
	for (let preset = 1; preset <= 9; preset++) {
		const id = `wall_1_preset_${preset}`
		presets[id] = {
			type: 'simple',
			name: `Video wall 1: preset ${preset}`,
			style: {
				text: `WALL 1\\nPRESET ${preset}`,
				size: 'auto',
				color: BLACK,
				bgcolor: AMBER,
				show_topbar: false,
			},
			steps: [
				{
					down: [{ actionId: 'wall_preset', options: { wall: 1, preset } }],
					up: [],
				},
			],
			feedbacks: [],
		}
		wallIds.push(id)
	}

	sections.push({
		id: 'video_walls',
		name: 'Video walls',
		description: 'Applies a stored video wall preset. Edit the wall number on the button for other walls.',
		definitions: [
			{
				id: 'wall_1',
				type: 'simple',
				name: 'Video wall 1',
				presets: wallIds,
			},
		],
	})

	self.setPresetDefinitions(sections, presets)
}

function shortName(name: string, id: number): string {
	const padded = String(id).padStart(3, '0')
	if (!name) return padded
	return name.length > 14 ? name.slice(0, 14) : name
}
