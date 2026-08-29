import {
	combineRgb,
	type CompanionPresetDefinitions,
	type CompanionPresetGroup,
	type CompanionPresetSection,
} from '@companion-module/base'

import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import type { DecoderState, EncoderState } from './types.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 153, 51)
const RED = combineRgb(153, 0, 0)
const AMBER = combineRgb(200, 130, 0)
const BLUE = combineRgb(0, 70, 140)
const SLATE = combineRgb(40, 40, 40)

/**
 * Connection label used when referencing this module's own variables from
 * preset button text. Companion derives the default label from the manifest
 * shortname ("Chazy Control" becomes "Chazy_Control"); if the user renames the
 * connection, Companion rewrites these references when the preset is placed.
 * Keep this in step with `shortname` in companion/manifest.json.
 */
const LABEL = 'Chazy_Control'

function v(variable: string): string {
	return `$(${LABEL}:${variable})`
}

/**
 * Preset budgets.
 *
 * The routing grid is the one place where the combinations are the point, so
 * it gets a generous cap. Everything else is generated per device (linear) or
 * offered as a single starter button the user edits after dropping it, which
 * keeps the browser usable on a large system.
 */
const MAX_ROUTING_PRESETS = 400
const MAX_LINEAR_PRESETS = 200

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const sections: CompanionPresetSection<ModuleSchema>[] = []

	const decoders = self.state.decoders
	const encoders = self.state.encoders

	addRouting(presets, sections, decoders, encoders)
	addOutputs(presets, sections, decoders)
	addDisplayControl(presets, sections, decoders)
	addStatusTiles(presets, sections, decoders)
	addVideoWalls(presets, sections)
	addEncoders(presets, sections, encoders)
	addSystem(presets, sections)

	self.setPresetDefinitions(sections, presets)
}

// -- Routing ----------------------------------------------------------------

function addRouting(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	sections: CompanionPresetSection<ModuleSchema>[],
	decoders: DecoderState[],
	encoders: EncoderState[],
): void {
	const groups: CompanionPresetGroup<ModuleSchema>[] = []

	if (decoders.length > 0 && encoders.length > 0) {
		let generated = 0

		for (const encoder of encoders) {
			const presetIds: string[] = []

			for (const decoder of decoders) {
				if (generated >= MAX_ROUTING_PRESETS) break
				const id = `route_${encoder.id}_${decoder.id}`
				presets[id] = {
					type: 'simple',
					name: `Route ${label(encoder)} to ${label(decoder)}`,
					style: {
						text: `${label(decoder)}\n← ${label(encoder)}`,
						size: 'auto',
						color: WHITE,
						bgcolor: DARK,
						show_topbar: false,
					},
					steps: [{ down: [{ actionId: 'route_all', options: { dec: decoder.id, enc: encoder.id } }], up: [] }],
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
					type: 'simple',
					name: `Source: ${label(encoder)}`,
					description: 'One button per decoder, lit when that decoder is showing this source.',
					presets: presetIds,
				})
			}
			if (generated >= MAX_ROUTING_PRESETS) break
		}
	}

	// Starter buttons for the parameterised routing actions. These are meant to
	// be edited after dropping, so one of each is more useful than a grid.
	const firstDecoder = decoders[0]?.id ?? 1
	const firstEncoder = encoders[0]?.id ?? 1

	presets['route_lock_starter'] = {
		type: 'simple',
		name: 'Lock a single signal type (edit after adding)',
		style: {
			text: 'LOCK\nVIDEO',
			size: 'auto',
			color: BLACK,
			bgcolor: AMBER,
			show_topbar: false,
		},
		steps: [
			{
				down: [{ actionId: 'route_signal', options: { dec: firstDecoder, enc: firstEncoder, signal: 'video' } }],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'route_locked',
				options: { dec: firstDecoder, signal: 'video' },
				style: { bgcolor: RED, color: WHITE },
			},
		],
	}

	presets['route_salvo_starter'] = {
		type: 'simple',
		name: 'Salvo: many decoders from one source (edit after adding)',
		style: {
			text: 'SALVO\nALL → SRC',
			size: 'auto',
			color: WHITE,
			bgcolor: BLUE,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'route_salvo_source',
						options: { enc: firstEncoder, decs: decoders.map((decoder) => decoder.id), signal: 'all' },
					},
				],
				up: [],
			},
		],
		feedbacks: [],
	}

	presets['route_salvo_list_starter'] = {
		type: 'simple',
		name: 'Salvo: decoder:encoder list (edit after adding)',
		style: {
			text: 'SALVO\nLIST',
			size: 'auto',
			color: WHITE,
			bgcolor: BLUE,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'route_salvo_list',
						options: { routes: decoders.map((decoder) => `${decoder.id}:${firstEncoder}`).join(', '), signal: 'all' },
					},
				],
				up: [],
			},
		],
		feedbacks: [],
	}

	groups.push({
		id: 'route_starters',
		type: 'simple',
		name: 'Salvos and locks',
		description: 'Starting points to edit once placed on a button.',
		presets: ['route_salvo_starter', 'route_salvo_list_starter', 'route_lock_starter'],
	})

	sections.push({
		id: 'routing',
		name: 'Routing',
		description: 'Switch a decoder to a source. Buttons light up when the route is active.',
		definitions: groups,
	})
}

// -- Decoder outputs --------------------------------------------------------

function addOutputs(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	sections: CompanionPresetSection<ModuleSchema>[],
	decoders: DecoderState[],
): void {
	if (decoders.length === 0) return

	const outputIds: string[] = []
	const muteIds: string[] = []
	const modeIds: string[] = []

	for (const decoder of decoders.slice(0, MAX_LINEAR_PRESETS)) {
		const name = label(decoder)

		const outputId = `output_${decoder.id}`
		presets[outputId] = {
			type: 'simple',
			name: `${name}: output on/off`,
			style: { text: `${name}\nOUTPUT`, size: 'auto', color: WHITE, bgcolor: DARK, show_topbar: false },
			steps: [{ down: [{ actionId: 'output_enable', options: { dec: decoder.id, state: 'toggle' } }], up: [] }],
			feedbacks: [{ feedbackId: 'output_on', options: { dec: decoder.id }, style: { bgcolor: GREEN, color: WHITE } }],
		}
		outputIds.push(outputId)

		const muteId = `mute_${decoder.id}`
		presets[muteId] = {
			type: 'simple',
			name: `${name}: mute`,
			style: { text: `${name}\nMUTE`, size: 'auto', color: WHITE, bgcolor: DARK, show_topbar: false },
			steps: [{ down: [{ actionId: 'output_mute', options: { dec: decoder.id, state: 'toggle' } }], up: [] }],
			feedbacks: [{ feedbackId: 'output_muted', options: { dec: decoder.id }, style: { bgcolor: RED, color: WHITE } }],
		}
		muteIds.push(muteId)

		const modeId = `mode_${decoder.id}`
		presets[modeId] = {
			type: 'simple',
			name: `${name}: matrix / video wall mode`,
			style: {
				text: `${name}\n${v(`dec_${pad(decoder.id)}_mode`)}`,
				size: 'auto',
				color: WHITE,
				bgcolor: DARK,
				show_topbar: false,
			},
			steps: [
				{ down: [{ actionId: 'decoder_mode', options: { dec: decoder.id, mode: 'VW' } }], up: [] },
				{ down: [{ actionId: 'decoder_mode', options: { dec: decoder.id, mode: 'MX' } }], up: [] },
			],
			feedbacks: [
				{ feedbackId: 'decoder_mode_vw', options: { dec: decoder.id }, style: { bgcolor: AMBER, color: BLACK } },
			],
		}
		modeIds.push(modeId)
	}

	const firstDecoder = decoders[0]?.id ?? 1

	presets['output_resolution_starter'] = {
		type: 'simple',
		name: 'Set output resolution (edit after adding)',
		style: { text: 'RES\n1080p60', size: 'auto', color: WHITE, bgcolor: SLATE, show_topbar: false },
		steps: [{ down: [{ actionId: 'output_resolution', options: { dec: firstDecoder, resolution: '2' } }], up: [] }],
		feedbacks: [],
	}

	presets['output_rotate_starter'] = {
		type: 'simple',
		name: 'Rotate output (edit after adding)',
		style: { text: 'ROTATE\n90°', size: 'auto', color: WHITE, bgcolor: SLATE, show_topbar: false },
		steps: [{ down: [{ actionId: 'output_rotate', options: { dec: firstDecoder, rotate: '1' } }], up: [] }],
		feedbacks: [],
	}

	presets['output_osd_starter'] = {
		type: 'simple',
		name: 'On-screen display on (edit after adding)',
		style: { text: 'OSD\nON', size: 'auto', color: WHITE, bgcolor: SLATE, show_topbar: false },
		steps: [{ down: [{ actionId: 'output_osd', options: { dec: firstDecoder, state: 'on' } }], up: [] }],
		feedbacks: [],
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
			{
				id: 'mode_toggles',
				type: 'simple',
				name: 'Matrix / video wall mode',
				description: 'Two-step button: first press sets video wall mode, second returns to matrix.',
				presets: modeIds,
			},
			{
				id: 'output_starters',
				type: 'simple',
				name: 'Resolution, rotation and OSD',
				description: 'Starting points to edit once placed on a button.',
				presets: ['output_resolution_starter', 'output_rotate_starter', 'output_osd_starter'],
			},
		],
	})
}

// -- Display control (CEC) --------------------------------------------------

function addDisplayControl(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	sections: CompanionPresetSection<ModuleSchema>[],
	decoders: DecoderState[],
): void {
	if (decoders.length === 0) return

	const onIds: string[] = []
	const offIds: string[] = []

	for (const decoder of decoders.slice(0, MAX_LINEAR_PRESETS)) {
		const name = label(decoder)

		const onId = `display_on_${decoder.id}`
		presets[onId] = {
			type: 'simple',
			name: `${name}: display on`,
			style: { text: `${name}\nON`, size: 'auto', color: WHITE, bgcolor: GREEN, show_topbar: false },
			steps: [
				{
					down: [{ actionId: 'send_cec', options: { target: 'DEC', id: decoder.id, command: 'power_on', hex: '' } }],
					up: [],
				},
			],
			feedbacks: [],
		}
		onIds.push(onId)

		const offId = `display_off_${decoder.id}`
		presets[offId] = {
			type: 'simple',
			name: `${name}: display off`,
			style: { text: `${name}\nOFF`, size: 'auto', color: WHITE, bgcolor: RED, show_topbar: false },
			steps: [
				{
					down: [{ actionId: 'send_cec', options: { target: 'DEC', id: decoder.id, command: 'standby', hex: '' } }],
					up: [],
				},
			],
			feedbacks: [],
		}
		offIds.push(offId)
	}

	sections.push({
		id: 'display_control',
		name: 'Display control (CEC)',
		description:
			'Powers displays over CEC through each decoder. Displays vary in what they honour — if one does not respond, edit the action and choose Custom.',
		definitions: [
			{ id: 'display_on', type: 'simple', name: 'Display on', presets: onIds },
			{ id: 'display_off', type: 'simple', name: 'Display off (standby)', presets: offIds },
		],
	})
}

// -- Status tiles -----------------------------------------------------------

function addStatusTiles(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	sections: CompanionPresetSection<ModuleSchema>[],
	decoders: DecoderState[],
): void {
	if (decoders.length === 0) return

	const tileIds: string[] = []

	for (const decoder of decoders.slice(0, MAX_LINEAR_PRESETS)) {
		const id = `status_${decoder.id}`
		const key = pad(decoder.id)

		presets[id] = {
			type: 'simple',
			name: `${label(decoder)}: status tile`,
			style: {
				// The decoder name is known at generation time; the source is live.
				text: `${label(decoder)}\n${v(`dec_${key}_source_name`)}`,
				size: 'auto',
				color: WHITE,
				bgcolor: SLATE,
				show_topbar: false,
			},
			steps: [{ down: [], up: [] }],
			feedbacks: [
				// Ordered so the most serious condition wins: healthy, then no
				// display attached, then the decoder itself being unreachable.
				{ feedbackId: 'decoder_online', options: { dec: decoder.id }, style: { bgcolor: GREEN, color: WHITE } },
				{
					feedbackId: 'decoder_hpd',
					options: { dec: decoder.id },
					isInverted: true,
					style: { bgcolor: AMBER, color: BLACK },
				},
				{
					feedbackId: 'decoder_online',
					options: { dec: decoder.id },
					isInverted: true,
					style: { bgcolor: RED, color: WHITE },
				},
			],
		}
		tileIds.push(id)
	}

	sections.push({
		id: 'status',
		name: 'Status tiles',
		description:
			'One tile per decoder showing its current source. Green when online with a display attached, amber when no display is detected, red when the decoder is offline.',
		definitions: [{ id: 'status_tiles', type: 'simple', name: 'Decoder status', presets: tileIds }],
	})
}

// -- Video walls ------------------------------------------------------------

function addVideoWalls(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	sections: CompanionPresetSection<ModuleSchema>[],
): void {
	const wallIds: string[] = []

	for (let preset = 1; preset <= 9; preset++) {
		const id = `wall_1_preset_${preset}`
		presets[id] = {
			type: 'simple',
			name: `Video wall 1: preset ${preset}`,
			style: { text: `WALL 1\nPRESET ${preset}`, size: 'auto', color: BLACK, bgcolor: AMBER, show_topbar: false },
			steps: [{ down: [{ actionId: 'wall_preset', options: { wall: 1, preset } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'wall_preset_active',
					options: { wall: 1, preset },
					style: { bgcolor: GREEN, color: WHITE },
				},
			],
		}
		wallIds.push(id)
	}

	sections.push({
		id: 'video_walls',
		name: 'Video walls',
		description:
			'Applies a stored video wall preset, lit when that preset is the active one. Edit the wall number on the button for walls other than 1.',
		definitions: [{ id: 'wall_1', type: 'simple', name: 'Video wall 1', presets: wallIds }],
	})
}

// -- Encoders ---------------------------------------------------------------

function addEncoders(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	sections: CompanionPresetSection<ModuleSchema>[],
	encoders: EncoderState[],
): void {
	if (encoders.length === 0) return

	const signalIds: string[] = []

	for (const encoder of encoders.slice(0, MAX_LINEAR_PRESETS)) {
		const id = `enc_signal_${encoder.id}`
		presets[id] = {
			type: 'simple',
			name: `${label(encoder)}: signal present`,
			style: { text: `${label(encoder)}\nSIGNAL`, size: 'auto', color: WHITE, bgcolor: SLATE, show_topbar: false },
			steps: [{ down: [], up: [] }],
			feedbacks: [
				{
					feedbackId: 'encoder_online',
					options: { enc: encoder.id, requireSignal: true },
					style: { bgcolor: GREEN, color: WHITE },
				},
			],
		}
		signalIds.push(id)
	}

	const firstEncoder = encoders[0]?.id ?? 1

	presets['enc_audio_starter'] = {
		type: 'simple',
		name: 'Encoder audio input (edit after adding)',
		style: { text: 'AUDIO\nHDMI', size: 'auto', color: WHITE, bgcolor: SLATE, show_topbar: false },
		steps: [{ down: [{ actionId: 'encoder_audio_input', options: { enc: firstEncoder, source: 'HDMI' } }], up: [] }],
		feedbacks: [],
	}

	presets['enc_led_starter'] = {
		type: 'simple',
		name: 'Encoder front LED (edit after adding)',
		style: { text: 'LED\nON', size: 'auto', color: WHITE, bgcolor: SLATE, show_topbar: false },
		steps: [{ down: [{ actionId: 'encoder_led', options: { enc: firstEncoder, state: 'on' } }], up: [] }],
		feedbacks: [],
	}

	sections.push({
		id: 'encoders',
		name: 'Encoders',
		definitions: [
			{
				id: 'encoder_signal',
				type: 'simple',
				name: 'Input signal present',
				description: 'Lit when the encoder is online and detecting a source.',
				presets: signalIds,
			},
			{
				id: 'encoder_starters',
				type: 'simple',
				name: 'Audio input and LED',
				presets: ['enc_audio_starter', 'enc_led_starter'],
			},
		],
	})
}

// -- System -----------------------------------------------------------------

function addSystem(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	sections: CompanionPresetSection<ModuleSchema>[],
): void {
	presets['system_reboot_controller'] = {
		type: 'simple',
		name: 'Reboot the Chazy Control',
		style: { text: 'REBOOT\nCTRL', size: 'auto', color: WHITE, bgcolor: RED, show_topbar: false },
		steps: [{ down: [{ actionId: 'reboot_controller', options: {} }], up: [] }],
		feedbacks: [],
	}

	presets['system_reboot_device'] = {
		type: 'simple',
		name: 'Reboot a decoder or encoder (edit after adding)',
		style: { text: 'REBOOT\nDEVICE', size: 'auto', color: WHITE, bgcolor: RED, show_topbar: false },
		steps: [{ down: [{ actionId: 'reboot_device', options: { target: 'DEC', id: 1 } }], up: [] }],
		feedbacks: [],
	}

	presets['system_gpio'] = {
		type: 'simple',
		name: 'GPIO output high (edit after adding)',
		style: { text: 'GPIO 1\nHIGH', size: 'auto', color: WHITE, bgcolor: SLATE, show_topbar: false },
		steps: [{ down: [{ actionId: 'gpio_level', options: { gpio: 1, level: 'High' } }], up: [] }],
		feedbacks: [],
	}

	presets['system_relay'] = {
		type: 'simple',
		name: 'Relay close (edit after adding)',
		style: { text: 'RELAY\nCLOSE', size: 'auto', color: WHITE, bgcolor: SLATE, show_topbar: false },
		steps: [{ down: [{ actionId: 'relay', options: { target: 'DEC', id: 1, state: 'CLOSE' } }], up: [] }],
		feedbacks: [],
	}

	presets['system_status'] = {
		type: 'simple',
		name: 'Controller status',
		style: {
			text: `CHAZY\n${v('connection')}\n${v('fw_version')}`,
			size: 'auto',
			color: WHITE,
			bgcolor: SLATE,
			show_topbar: false,
		},
		steps: [{ down: [], up: [] }],
		feedbacks: [],
	}

	sections.push({
		id: 'system',
		name: 'System',
		definitions: [
			{
				id: 'system_info',
				type: 'simple',
				name: 'Controller',
				presets: ['system_status', 'system_reboot_controller'],
			},
			{
				id: 'system_devices',
				type: 'simple',
				name: 'Devices and IO',
				description: 'Starting points to edit once placed on a button.',
				presets: ['system_reboot_device', 'system_gpio', 'system_relay'],
			},
		],
	})
}

// -- helpers ----------------------------------------------------------------

function pad(id: number): string {
	return String(id).padStart(3, '0')
}

/** Button-face name: the device name if it has one, trimmed to fit. */
function label(device: DecoderState | EncoderState): string {
	const padded = pad(device.id)
	if (!device.name) return padded
	return device.name.length > 14 ? device.name.slice(0, 14) : device.name
}
