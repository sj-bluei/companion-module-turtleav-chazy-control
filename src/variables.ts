import type { CompanionVariableDefinitions, CompanionVariableValue } from '@companion-module/base'

import type ModuleInstance from './main.js'
import type { ChazyState } from './state.js'
import { resolutionLabel, rotateDegrees, SIGNAL_LABEL, SIGNAL_TYPES } from './types.js'

/**
 * The per-device variables are generated from whatever the controller reports,
 * so the schema carries an index signature alongside the fixed entries.
 */
export type VariablesSchema = {
	connection: string
	fw_version: string
	decoder_count: number
	encoder_count: number
	[variableId: string]: CompanionVariableValue
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		connection: { name: 'Connection state' },
		fw_version: { name: 'Controller firmware version' },
		decoder_count: { name: 'Number of known decoders' },
		encoder_count: { name: 'Number of known encoders' },
	}

	for (const decoder of self.state.decoders) {
		const id = String(decoder.id).padStart(3, '0')
		definitions[`dec_${id}_name`] = { name: `Decoder ${id}: name` }
		definitions[`dec_${id}_online`] = { name: `Decoder ${id}: online` }
		definitions[`dec_${id}_hpd`] = { name: `Decoder ${id}: display connected` }
		definitions[`dec_${id}_source`] = { name: `Decoder ${id}: video source ID` }
		definitions[`dec_${id}_source_name`] = { name: `Decoder ${id}: video source name` }

		for (const signal of SIGNAL_TYPES) {
			definitions[`dec_${id}_source_${signal}`] = {
				name: `Decoder ${id}: ${SIGNAL_LABEL[signal]} source ID`,
			}
			definitions[`dec_${id}_source_${signal}_name`] = {
				name: `Decoder ${id}: ${SIGNAL_LABEL[signal]} source name`,
			}
		}
		definitions[`dec_${id}_mode`] = { name: `Decoder ${id}: matrix/video wall mode` }
		definitions[`dec_${id}_output`] = { name: `Decoder ${id}: output enabled` }
		definitions[`dec_${id}_muted`] = { name: `Decoder ${id}: output muted` }
		definitions[`dec_${id}_resolution`] = { name: `Decoder ${id}: output resolution` }
		definitions[`dec_${id}_rotate`] = { name: `Decoder ${id}: output rotation` }
	}

	for (const encoder of self.state.encoders) {
		const id = String(encoder.id).padStart(3, '0')
		definitions[`enc_${id}_name`] = { name: `Encoder ${id}: name` }
		definitions[`enc_${id}_online`] = { name: `Encoder ${id}: online` }
		definitions[`enc_${id}_signal`] = { name: `Encoder ${id}: input signal present` }
	}

	definitions['dante_device_count'] = { name: 'Number of Dante devices found' }
	for (const device of self.state.danteDevices) {
		const key = String(device.index).padStart(3, '0')
		definitions[`dante_${key}_name`] = { name: `Dante ${key}: name` }
		definitions[`dante_${key}_ip`] = { name: `Dante ${key}: IP address` }
	}

	for (const wall of self.state.walls) {
		definitions[`wall_${wall.id}_name`] = { name: `Video wall ${wall.id}: name` }
		definitions[`wall_${wall.id}_preset`] = { name: `Video wall ${wall.id}: active preset` }
	}

	self.setVariableDefinitions(definitions)
}

export function UpdateVariableValues(self: ModuleInstance): void {
	const state = self.state
	const values: Record<string, CompanionVariableValue> = {
		fw_version: state.current.firmware,
		decoder_count: state.decoders.length,
		encoder_count: state.encoders.length,
	}

	for (const decoder of state.decoders) {
		const id = String(decoder.id).padStart(3, '0')
		const sourceId = decoder.selected.video

		values[`dec_${id}_name`] = decoder.name
		values[`dec_${id}_online`] = decoder.online ? 'online' : 'offline'
		values[`dec_${id}_hpd`] = decoder.hpd ? 'connected' : 'disconnected'
		values[`dec_${id}_source`] = sourceId
		values[`dec_${id}_source_name`] = sourceName(state, sourceId)

		for (const signal of SIGNAL_TYPES) {
			const signalSource = decoder.selected[signal]
			values[`dec_${id}_source_${signal}`] = signalSource
			values[`dec_${id}_source_${signal}_name`] = sourceName(state, signalSource)
		}
		values[`dec_${id}_mode`] = decoder.mode
		values[`dec_${id}_output`] = decoder.outputOn ? 'on' : 'off'
		values[`dec_${id}_muted`] = decoder.muted ? 'muted' : 'unmuted'
		values[`dec_${id}_resolution`] = resolutionLabel(decoder.resolutionCode)
		values[`dec_${id}_rotate`] = `${rotateDegrees(decoder.rotateCode)}°`
	}

	for (const encoder of state.encoders) {
		const id = String(encoder.id).padStart(3, '0')
		values[`enc_${id}_name`] = encoder.name
		values[`enc_${id}_online`] = encoder.online ? 'online' : 'offline'
		values[`enc_${id}_signal`] = encoder.signal ? 'signal' : 'no signal'
	}

	values['dante_device_count'] = state.danteDevices.length
	for (const device of state.danteDevices) {
		const key = String(device.index).padStart(3, '0')
		values[`dante_${key}_name`] = device.name
		values[`dante_${key}_ip`] = device.ip
	}

	for (const wall of state.walls) {
		values[`wall_${wall.id}_name`] = wall.name
		values[`wall_${wall.id}_preset`] = wall.activePreset
	}

	self.setVariableValues(values)
}

/** Friendly name for a source encoder, or "None" when unrouted. */
function sourceName(state: ChazyState, id: number): string {
	if (id === 0) return 'None'
	return state.getEncoder(id)?.name ?? String(id).padStart(3, '0')
}

/** Variable names that a preset can reference for a given decoder. */
export function decoderVariable(id: number, suffix: string): string {
	return `dec_${String(id).padStart(3, '0')}_${suffix}`
}

export { SIGNAL_TYPES }
