import { combineRgb, Regex } from '@companion-module/base'

import type ModuleInstance from './main.js'
import {
	asDeviceId,
	decoderChoices,
	encoderChoices,
	isSignalType,
	SIGNAL_CHOICES,
	type DeviceOption,
} from './options.js'

export type FeedbacksSchema = {
	routed_from: { type: 'boolean'; options: { dec: DeviceOption; enc: DeviceOption; signal: string } }
	route_locked: { type: 'boolean'; options: { dec: DeviceOption; signal: string } }
	output_on: { type: 'boolean'; options: { dec: DeviceOption } }
	output_muted: { type: 'boolean'; options: { dec: DeviceOption } }
	decoder_mode_vw: { type: 'boolean'; options: { dec: DeviceOption } }
	decoder_online: { type: 'boolean'; options: { dec: DeviceOption } }
	encoder_online: { type: 'boolean'; options: { enc: DeviceOption; requireSignal: boolean } }
}

const GREEN = combineRgb(0, 153, 51)
const RED = combineRgb(153, 0, 0)
const AMBER = combineRgb(200, 130, 0)
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

export function UpdateFeedbacks(self: ModuleInstance): void {
	const decoders = decoderChoices(self.state)
	const encoders = encoderChoices(self.state)

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
		}) as const

	self.setFeedbackDefinitions({
		routed_from: {
			name: 'Decoder is routed from encoder',
			description: 'True when the decoder is currently taking the selected signal from the chosen encoder.',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				devicePicker('enc', 'Encoder (TX)', encoders),
				{
					id: 'signal',
					type: 'dropdown',
					label: 'Signal',
					choices: SIGNAL_CHOICES,
					default: 'video',
				},
			],
			callback: (feedback) => {
				const dec = asDeviceId(feedback.options.dec)
				const enc = asDeviceId(feedback.options.enc)
				const signal = feedback.options.signal
				if (dec === undefined || enc === undefined || !isSignalType(signal)) return false
				return self.state.getDecoder(dec)?.selected[signal] === enc
			},
		},

		route_locked: {
			name: 'Decoder route is locked',
			description: 'True when the selected signal type is locked to a specific encoder.',
			type: 'boolean',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [
				devicePicker('dec', 'Decoder (RX)', decoders),
				{
					id: 'signal',
					type: 'dropdown',
					label: 'Signal',
					choices: SIGNAL_CHOICES,
					default: 'video',
				},
			],
			callback: (feedback) => {
				const dec = asDeviceId(feedback.options.dec)
				const signal = feedback.options.signal
				if (dec === undefined || !isSignalType(signal)) return false
				return (self.state.getDecoder(dec)?.locked[signal] ?? 0) !== 0
			},
		},

		output_on: {
			name: 'Decoder output is enabled',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [devicePicker('dec', 'Decoder (RX)', decoders)],
			callback: (feedback) => {
				const dec = asDeviceId(feedback.options.dec)
				if (dec === undefined) return false
				return self.state.getDecoder(dec)?.outputOn ?? false
			},
		},

		output_muted: {
			name: 'Decoder output is muted',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [devicePicker('dec', 'Decoder (RX)', decoders)],
			callback: (feedback) => {
				const dec = asDeviceId(feedback.options.dec)
				if (dec === undefined) return false
				return self.state.getDecoder(dec)?.muted ?? false
			},
		},

		decoder_mode_vw: {
			name: 'Decoder is in video wall mode',
			type: 'boolean',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [devicePicker('dec', 'Decoder (RX)', decoders)],
			callback: (feedback) => {
				const dec = asDeviceId(feedback.options.dec)
				if (dec === undefined) return false
				return self.state.getDecoder(dec)?.mode === 'VW'
			},
		},

		decoder_online: {
			name: 'Decoder is online',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [devicePicker('dec', 'Decoder (RX)', decoders)],
			callback: (feedback) => {
				const dec = asDeviceId(feedback.options.dec)
				if (dec === undefined) return false
				return self.state.getDecoder(dec)?.online ?? false
			},
		},

		encoder_online: {
			name: 'Encoder is online',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				devicePicker('enc', 'Encoder (TX)', encoders),
				{
					id: 'requireSignal',
					type: 'checkbox',
					label: 'Also require an input signal',
					default: false,
				},
			],
			callback: (feedback) => {
				const enc = asDeviceId(feedback.options.enc)
				if (enc === undefined) return false
				const encoder = self.state.getEncoder(enc)
				if (!encoder) return false
				return feedback.options.requireSignal ? encoder.online && encoder.signal : encoder.online
			},
		},
	})
}
