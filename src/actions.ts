import { Regex } from '@companion-module/base'

import type ModuleInstance from './main.js'
import { Commands } from './commands.js'
import {
	asDeviceId,
	decoderChoices,
	encoderChoices,
	isSignalType,
	MUTE_CHOICES,
	SIGNAL_CHOICES,
	TOGGLE_CHOICES,
	type DeviceOption,
	type ToggleOption,
} from './options.js'
import { RESOLUTION_CHOICES, ROTATE_CHOICES, SIGNAL_LABEL, type SignalType } from './types.js'

export type ActionsSchema = {
	route_all: { options: { dec: DeviceOption; enc: DeviceOption } }
	route_signal: { options: { dec: DeviceOption; enc: DeviceOption; signal: string } }
	output_enable: { options: { dec: DeviceOption; state: string } }
	output_mute: { options: { dec: DeviceOption; state: string } }
	output_resolution: { options: { dec: DeviceOption; resolution: string } }
	output_rotate: { options: { dec: DeviceOption; rotate: string } }
	output_flip: { options: { dec: DeviceOption; flip: string } }
	output_osd: { options: { dec: DeviceOption; state: string } }
	decoder_mode: { options: { dec: DeviceOption; mode: string } }
	wall_preset: { options: { wall: number; preset: number } }
	send_cec: { options: { target: string; id: DeviceOption; hex: string } }
	send_ir: { options: { target: string; id: DeviceOption; hex: string } }
	encoder_audio_input: { options: { enc: DeviceOption; source: string } }
	encoder_led: { options: { enc: DeviceOption; state: string } }
	gpio_level: { options: { gpio: number; level: string } }
	relay: { options: { target: string; id: DeviceOption; state: string } }
	reboot_device: { options: { target: string; id: DeviceOption } }
	reboot_controller: { options: Record<string, never> }
	custom_command: { options: { command: string; expectBlock: boolean } }
}

const TARGET_CHOICES = [
	{ id: 'DEC', label: 'Decoder (RX)' },
	{ id: 'ENC', label: 'Encoder (TX)' },
]

export function UpdateActions(self: ModuleInstance): void {
	const decoders = decoderChoices(self.state, { includeAll: true })
	const decodersNoAll = decoderChoices(self.state)
	const encoders = encoderChoices(self.state, { includeNone: true })
	const encodersNoNone = encoderChoices(self.state)

	/** Device picker field used across most actions. */
	const devicePicker = <TKey extends string>(
		id: TKey,
		label: string,
		choices: { id: string | number; label: string }[],
	) =>
		({
			id,
			type: 'dropdown' as const,
			label,
			choices,
			default: choices[0]?.id ?? 1,
			allowCustom: true,
			regex: Regex.NUMBER,
			tooltip: 'Pick a device, or enter an ID directly to target one that has not been discovered yet.',
		}) as const

	self.setActionDefinitions({
		route_all: {
			name: 'Route: decoder from encoder (all signals)',
			description: 'Switches video, audio, IR, RS-232, USB and CEC together.',
			options: [devicePicker('dec', 'Decoder (RX)', decoders), devicePicker('enc', 'Encoder (TX)', encoders)],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				const enc = asDeviceId(event.options.enc)
				if (dec === undefined || enc === undefined) return self.warnBadOption('route_all')
				await self.sendCommand(Commands.routeAll(dec, enc))
			},
		},

		route_signal: {
			name: 'Route: lock a single signal type',
			description:
				'Locks one signal type of a decoder to a specific encoder, independently of the others. Choosing "None" unlocks it again.',
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{
					id: 'signal',
					type: 'dropdown',
					label: 'Signal',
					choices: SIGNAL_CHOICES,
					default: 'video',
				},
				devicePicker('enc', 'Encoder (TX)', encoders),
			],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				const enc = asDeviceId(event.options.enc)
				const signal = event.options.signal
				if (dec === undefined || enc === undefined || !isSignalType(signal)) {
					return self.warnBadOption('route_signal')
				}
				await self.sendCommand(Commands.routeSignal(dec, enc, signal))
			},
		},

		output_enable: {
			name: 'Output: enable / disable',
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{ id: 'state', type: 'dropdown', label: 'State', choices: TOGGLE_CHOICES, default: 'on' },
			],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				if (dec === undefined) return self.warnBadOption('output_enable')
				const target = self.resolveDecoderToggle(dec, event.options.state as ToggleOption, (d) => d.outputOn)
				await self.sendCommand(Commands.outputEnable(dec, target))
			},
		},

		output_mute: {
			name: 'Output: mute',
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{ id: 'state', type: 'dropdown', label: 'State', choices: MUTE_CHOICES, default: 'on' },
			],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				if (dec === undefined) return self.warnBadOption('output_mute')
				const target = self.resolveDecoderToggle(dec, event.options.state as ToggleOption, (d) => d.muted)
				await self.sendCommand(Commands.outputMute(dec, target))
			},
		},

		output_resolution: {
			name: 'Output: resolution',
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{
					id: 'resolution',
					type: 'dropdown',
					label: 'Resolution',
					choices: RESOLUTION_CHOICES,
					default: '0',
				},
			],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				if (dec === undefined) return self.warnBadOption('output_resolution')
				await self.sendCommand(Commands.outputResolution(dec, String(event.options.resolution)))
			},
		},

		output_rotate: {
			name: 'Output: rotate',
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{ id: 'rotate', type: 'dropdown', label: 'Rotation', choices: ROTATE_CHOICES, default: '0' },
			],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				if (dec === undefined) return self.warnBadOption('output_rotate')
				await self.sendCommand(Commands.outputRotate(dec, String(event.options.rotate)))
			},
		},

		output_flip: {
			name: 'Output: flip',
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{
					id: 'flip',
					type: 'dropdown',
					label: 'Flip',
					choices: [
						{ id: 'OFF', label: 'Off' },
						{ id: 'HOR', label: 'Horizontal' },
						{ id: 'VER', label: 'Vertical' },
					],
					default: 'OFF',
				},
			],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				if (dec === undefined) return self.warnBadOption('output_flip')
				const flip = event.options.flip
				if (flip !== 'OFF' && flip !== 'HOR' && flip !== 'VER') return self.warnBadOption('output_flip')
				await self.sendCommand(Commands.outputFlip(dec, flip))
			},
		},

		output_osd: {
			name: 'Output: on-screen display',
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					choices: TOGGLE_CHOICES.filter((choice) => choice.id !== 'toggle'),
					default: 'on',
				},
			],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				if (dec === undefined) return self.warnBadOption('output_osd')
				await self.sendCommand(Commands.outputOsd(dec, event.options.state === 'on'))
			},
		},

		decoder_mode: {
			name: 'Decoder: matrix / video wall mode',
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					choices: [
						{ id: 'MX', label: 'Matrix (MX)' },
						{ id: 'VW', label: 'Video wall (VW)' },
					],
					default: 'MX',
				},
			],
			callback: async (event) => {
				const dec = asDeviceId(event.options.dec)
				if (dec === undefined) return self.warnBadOption('decoder_mode')
				const mode = event.options.mode
				if (mode !== 'MX' && mode !== 'VW') return self.warnBadOption('decoder_mode')
				await self.sendCommand(Commands.decoderMode(dec, mode))
			},
		},

		wall_preset: {
			name: 'Video wall: apply preset',
			options: [
				{ id: 'wall', type: 'number', label: 'Video wall', min: 1, max: 9, default: 1 },
				{ id: 'preset', type: 'number', label: 'Preset', min: 1, max: 9, default: 1 },
			],
			callback: async (event) => {
				await self.sendCommand(Commands.applyWallPreset(Number(event.options.wall), Number(event.options.preset)))
			},
		},

		send_cec: {
			name: 'Send: CEC command',
			description: 'Sends raw CEC bytes out of a device, e.g. to power a display on or off.',
			options: [
				{ id: 'target', type: 'dropdown', label: 'Device type', choices: TARGET_CHOICES, default: 'DEC' },
				devicePicker('id', 'Device', decodersNoAll),
				{
					id: 'hex',
					type: 'textinput',
					label: 'CEC bytes (hex)',
					default: '40 04',
					useVariables: true,
					tooltip: 'Space separated hex bytes, e.g. "40 04" to wake a display.',
				},
			],
			callback: async (event) => {
				const id = asDeviceId(event.options.id)
				const target = event.options.target
				if (id === undefined || (target !== 'DEC' && target !== 'ENC')) return self.warnBadOption('send_cec')
				await self.sendCommand(Commands.sendCec(target, id, String(event.options.hex ?? '')))
			},
		},

		send_ir: {
			name: 'Send: IR command',
			options: [
				{ id: 'target', type: 'dropdown', label: 'Device type', choices: TARGET_CHOICES, default: 'DEC' },
				devicePicker('id', 'Device', decodersNoAll),
				{
					id: 'hex',
					type: 'textinput',
					label: 'IR bytes (hex)',
					default: '',
					useVariables: true,
					tooltip: 'Space separated hex bytes of the IR payload.',
				},
			],
			callback: async (event) => {
				const id = asDeviceId(event.options.id)
				const target = event.options.target
				if (id === undefined || (target !== 'DEC' && target !== 'ENC')) return self.warnBadOption('send_ir')
				await self.sendCommand(Commands.sendIr(target, id, String(event.options.hex ?? '')))
			},
		},

		encoder_audio_input: {
			name: 'Encoder: audio input source',
			options: [
				devicePicker('enc', 'Encoder (TX)', encodersNoNone),
				{
					id: 'source',
					type: 'dropdown',
					label: 'Source',
					choices: [
						{ id: 'HDMI', label: 'HDMI (embedded)' },
						{ id: 'ANA', label: 'Analogue' },
					],
					default: 'HDMI',
				},
			],
			callback: async (event) => {
				const enc = asDeviceId(event.options.enc)
				const source = event.options.source
				if (enc === undefined || (source !== 'HDMI' && source !== 'ANA')) {
					return self.warnBadOption('encoder_audio_input')
				}
				await self.sendCommand(Commands.encoderAudioInput(enc, source))
			},
		},

		encoder_led: {
			name: 'Encoder: front panel LED',
			options: [
				devicePicker('enc', 'Encoder (TX)', encodersNoNone),
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					choices: TOGGLE_CHOICES.filter((choice) => choice.id !== 'toggle'),
					default: 'on',
				},
			],
			callback: async (event) => {
				const enc = asDeviceId(event.options.enc)
				if (enc === undefined) return self.warnBadOption('encoder_led')
				await self.sendCommand(Commands.encoderLed(enc, event.options.state === 'on'))
			},
		},

		gpio_level: {
			name: 'Controller: GPIO output level',
			description: 'The GPIO pin must already be configured as an output on the controller.',
			options: [
				{ id: 'gpio', type: 'number', label: 'GPIO', min: 1, max: 4, default: 1 },
				{
					id: 'level',
					type: 'dropdown',
					label: 'Level',
					choices: [
						{ id: 'High', label: 'High' },
						{ id: 'Low', label: 'Low' },
					],
					default: 'High',
				},
			],
			callback: async (event) => {
				const level = event.options.level
				if (level !== 'High' && level !== 'Low') return self.warnBadOption('gpio_level')
				await self.sendCommand(Commands.gpioLevel(Number(event.options.gpio), level))
			},
		},

		relay: {
			name: 'Device: relay',
			options: [
				{ id: 'target', type: 'dropdown', label: 'Device type', choices: TARGET_CHOICES, default: 'DEC' },
				devicePicker('id', 'Device', decodersNoAll),
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					choices: [
						{ id: 'CLOSE', label: 'Close' },
						{ id: 'OPEN', label: 'Open' },
					],
					default: 'CLOSE',
				},
			],
			callback: async (event) => {
				const id = asDeviceId(event.options.id)
				const target = event.options.target
				const state = event.options.state
				if (id === undefined || (target !== 'DEC' && target !== 'ENC')) return self.warnBadOption('relay')
				if (state !== 'OPEN' && state !== 'CLOSE') return self.warnBadOption('relay')
				await self.sendCommand(Commands.relay(target, id, state))
			},
		},

		reboot_device: {
			name: 'Device: reboot encoder / decoder',
			options: [
				{ id: 'target', type: 'dropdown', label: 'Device type', choices: TARGET_CHOICES, default: 'DEC' },
				devicePicker('id', 'Device', decodersNoAll),
			],
			callback: async (event) => {
				const id = asDeviceId(event.options.id)
				const target = event.options.target
				if (id === undefined || (target !== 'DEC' && target !== 'ENC')) return self.warnBadOption('reboot_device')
				await self.sendCommand(Commands.rebootDevice(target, id))
			},
		},

		reboot_controller: {
			name: 'Controller: reboot',
			description: 'Reboots the Chazy Control unit itself. All routing is interrupted while it restarts.',
			options: [],
			callback: async () => {
				await self.sendCommand(Commands.reboot())
			},
		},

		custom_command: {
			name: 'Custom command',
			description:
				'Sends a raw API command. Use this for anything the module does not cover yet — see the Chazy Control API reference.',
			options: [
				{
					id: 'command',
					type: 'textinput',
					label: 'Command',
					default: '',
					useVariables: true,
				},
				{
					id: 'expectBlock',
					type: 'checkbox',
					label: 'Reply is a status block (GET commands)',
					default: false,
				},
			],
			callback: async (event) => {
				const command = String(event.options.command ?? '').trim()
				if (!command) return
				await self.sendCommand(command, event.options.expectBlock ? 'block' : 'ack')
			},
		},
	})
}

/** Label used by presets and logs. */
export function signalLabel(signal: SignalType): string {
	return SIGNAL_LABEL[signal]
}
