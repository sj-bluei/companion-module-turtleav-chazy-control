/**
 * Command builders for the Chazy Control API.
 *
 * Kept separate from the actions so the exact wire syntax is verifiable in one
 * place against the API reference, and so it can be unit tested without a
 * Companion instance.
 *
 * Device IDs are sent unpadded: the reference shows `SET DEC 1 SWITCH 3 ALL`
 * accepted alongside the padded form used in replies.
 */

import { SIGNAL_KEYWORD, type SignalType } from './types.js'

/** A decoder/encoder target; 0 means "all" for most commands. */
export type DeviceId = number

export const Commands = {
	// -- System ------------------------------------------------------------
	getStatus: (): string => 'GET STATUS',
	getDecoderStatus: (dec: DeviceId = 0): string => `GET DEC ${dec} STATUS`,
	getEncoderStatus: (enc: DeviceId = 0): string => `GET ENC ${enc} STATUS`,
	getWallStatus: (wall: number): string => `GET WALL ${wall} STATUS`,
	reboot: (): string => 'SET REBOOT',

	// -- Routing -----------------------------------------------------------
	/** Route every signal type of a decoder to an encoder. 0 disconnects. */
	routeAll: (dec: DeviceId, enc: DeviceId): string => `SET DEC ${dec} SWITCH ${enc} ALL`,
	/** Lock one signal type of a decoder to an encoder. 0 unlocks. */
	routeSignal: (dec: DeviceId, enc: DeviceId, signal: SignalType): string =>
		`SET DEC ${dec} SWITCH ${enc} ${SIGNAL_KEYWORD[signal]}`,

	// -- Decoder output ----------------------------------------------------
	outputEnable: (dec: DeviceId, on: boolean): string => `SET DEC ${dec} OUTPUT ${on ? 'ON' : 'OFF'}`,
	outputMute: (dec: DeviceId, muted: boolean): string => `SET DEC ${dec} OUTPUT MUTE ${muted ? 'ON' : 'OFF'}`,
	outputResolution: (dec: DeviceId, code: string): string => `SET DEC ${dec} OUTPUT RESOLUTION ${code}`,
	outputRotate: (dec: DeviceId, code: string): string => `SET DEC ${dec} OUTPUT ROTATE ${code}`,
	outputFlip: (dec: DeviceId, mode: 'HOR' | 'VER' | 'OFF'): string => `SET DEC ${dec} OUTPUT FLIP ${mode}`,
	outputOsd: (dec: DeviceId, on: boolean): string => `SET DEC ${dec} OUTPUT OSD ${on ? 'ON' : 'OFF'}`,
	decoderMode: (dec: DeviceId, mode: 'MX' | 'VW'): string => `SET DEC ${dec} MODE ${mode}`,

	// -- Video wall --------------------------------------------------------
	applyWallPreset: (wall: number, preset: number): string => `APPLY WALL ${pad2(wall)} PRESET ${pad2(preset)}`,

	// -- Pass-through ------------------------------------------------------
	sendCec: (target: 'DEC' | 'ENC', id: DeviceId, hex: string): string =>
		`SET ${target} ${id} CEC SEND ${normaliseHex(hex)}`,
	sendIr: (target: 'DEC' | 'ENC', id: DeviceId, hex: string): string =>
		`SET ${target} ${id} IR SEND ${normaliseHex(hex)}`,

	// -- Encoder -----------------------------------------------------------
	encoderAudioInput: (enc: DeviceId, source: 'HDMI' | 'ANA'): string => `SET ENC ${enc} AUDIO INPUT ${source}`,
	encoderLed: (enc: DeviceId, on: boolean): string => `SET ENC ${enc} LED ${on ? 'ON' : 'OFF'}`,

	// -- GPIO / relay ------------------------------------------------------
	gpioLevel: (gpio: number, level: 'Low' | 'High'): string => `SET GPIO ${gpio} LEVEL ${level}`,
	gpioDirection: (gpio: number, direction: 'IN' | 'OUT'): string => `SET GPIO ${gpio} DIR ${direction}`,
	relay: (target: 'DEC' | 'ENC', id: DeviceId, state: 'OPEN' | 'CLOSE'): string =>
		`SET ${target} ${id} RELAY 1 ${state}`,

	// -- Device lifecycle --------------------------------------------------
	rebootDevice: (target: 'DEC' | 'ENC', id: DeviceId): string => `SET ${target} ${id} REBOOT`,
} as const

function pad2(value: number): string {
	return String(value).padStart(2, '0')
}

/**
 * Normalise user-entered hex into the space separated byte form the device
 * expects, accepting `0x` prefixes, commas and colons as separators.
 */
export function normaliseHex(input: string): string {
	const bytes = input.match(/[0-9a-fA-F]{2}/g) ?? []
	return bytes.map((byte) => byte.toUpperCase()).join(' ')
}
