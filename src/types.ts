/**
 * Shared types for the Chazy Control module.
 *
 * Terminology follows the device API: an encoder (ENC/TX) is a source, a
 * decoder (DEC/RX) is a display endpoint. Device IDs are 1..762; 0 is used by
 * the API as a wildcard ("all") or as "none" depending on the command.
 */

/** Signal types that can be routed independently on a decoder. */
export const SIGNAL_TYPES = ['video', 'audio', 'ir', 'serial', 'usb', 'cec'] as const
export type SignalType = (typeof SIGNAL_TYPES)[number]

/** Keyword used in the SET DEC ... SWITCH command for each signal type. */
export const SIGNAL_KEYWORD: Record<SignalType, string> = {
	video: 'VIDEO',
	audio: 'AUDIO',
	ir: 'IR',
	serial: 'RS232',
	usb: 'USB',
	cec: 'CEC',
}

export const SIGNAL_LABEL: Record<SignalType, string> = {
	video: 'Video',
	audio: 'Audio',
	ir: 'IR',
	serial: 'RS-232',
	usb: 'USB',
	cec: 'CEC',
}

/** Per-signal map of encoder IDs. 0 means "none" (unrouted / unlocked). */
export type SignalMap = Record<SignalType, number>

export function emptySignalMap(): SignalMap {
	return { video: 0, audio: 0, ir: 0, serial: 0, usb: 0, cec: 0 }
}

export interface DecoderState {
	id: number
	name: string
	/** Device type string as reported, e.g. "Gen 2". */
	type: string
	/** Network link up. */
	online: boolean
	/** HDMI hot-plug detect on the display output. */
	hpd: boolean
	firmware: string
	mode: 'MX' | 'VW' | 'unknown'
	/** Raw resolution code as reported (e.g. "00"). */
	resolutionCode: string
	/** Rotation code 0-3 as reported by the device. */
	rotateCode: number
	/** Currently selected source per signal type. */
	selected: SignalMap
	/** Locked/fixed source per signal type; 0 means not locked. */
	locked: SignalMap
	/** HDMI output enabled. */
	outputOn: boolean
	/** Output audio muted. */
	muted: boolean
	multicast: boolean
	ip: string
}

export interface EncoderState {
	id: number
	name: string
	type: string
	/** Network link up. */
	online: boolean
	/** Input signal detected. */
	signal: boolean
	/** EDID code as reported. */
	edid: string
	ip: string
	firmware: string
	/** Audio input source as reported, e.g. "HDMI" or "ANA". */
	audioInput: string
	multicast: boolean
}

export interface DeviceState {
	firmware: string
	/** Controller front-panel/system power state, as shown by GET STATUS. */
	power: boolean
	decoders: Map<number, DecoderState>
	encoders: Map<number, EncoderState>
}

export function emptyDeviceState(): DeviceState {
	return {
		firmware: '',
		power: false,
		decoders: new Map(),
		encoders: new Map(),
	}
}

/**
 * Output resolution codes accepted by `SET DEC [dec] OUTPUT RESOLUTION [res]`.
 * Source: Chazy Control API Reference section 3.14.
 */
export const RESOLUTION_CHOICES: { id: string; label: string }[] = [
	{ id: '0', label: 'Bypass' },
	{ id: '1', label: '1080p@50' },
	{ id: '2', label: '1080p@60' },
	{ id: '3', label: '720p@50' },
	{ id: '4', label: '720p@60' },
	{ id: '5', label: '2160p@24' },
	{ id: '6', label: '2160p@30' },
	{ id: '7', label: '2160p@50' },
	{ id: '8', label: '2160p@60' },
	{ id: '9', label: '1280x1024@60' },
	{ id: '10', label: '1360x768@60' },
	{ id: '11', label: '1440x900@60' },
	{ id: '12', label: '1680x1050@60' },
	{ id: '13', label: '1920x1200@60' },
]

/** Human label for a resolution code as reported in status output. */
export function resolutionLabel(code: string): string {
	const normalised = String(parseInt(code, 10))
	return RESOLUTION_CHOICES.find((c) => c.id === normalised)?.label ?? code
}

export const ROTATE_CHOICES: { id: string; label: string }[] = [
	{ id: '0', label: '0°' },
	{ id: '1', label: '90°' },
	{ id: '2', label: '180°' },
	{ id: '3', label: '270°' },
]

export function rotateDegrees(code: number): number {
	return [0, 90, 180, 270][code] ?? 0
}
