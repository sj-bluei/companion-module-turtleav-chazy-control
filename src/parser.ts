/**
 * Parsers for the Chazy Control status output.
 *
 * The device returns human-formatted, fixed-width tables rather than machine
 * readable data, and the layout is expected to drift between firmware versions.
 * Everything here is therefore driven off the header rows and off tokens with
 * distinctive shapes (IDs, IP addresses, On/Off), never off column offsets.
 * Anything that cannot be understood is collected in `unparsed` so the caller
 * can log it instead of silently losing state.
 */

import { SIGNAL_TYPES, emptySignalMap, type SignalMap, type SignalType } from './types.js'

/** A line of `=` characters delimits the start and end of a status block. */
const DELIMITER = /^={4,}$/

const IP = String.raw`\d{1,3}(?:\.\d{1,3}){3}`

/** Abbreviations used in the `>>Fix` / `>>Sel` column headers. */
const SIGNAL_ABBREVIATIONS: Record<string, SignalType> = {
	vid: 'video',
	aud: 'audio',
	ir: 'ir',
	ser: 'serial',
	usb: 'usb',
	cec: 'cec',
}

export function splitLines(text: string): string[] {
	return text.split(/\r\n|\r|\n/).map((line) => line.replace(/\s+$/, ''))
}

function isDelimiter(line: string): boolean {
	return DELIMITER.test(line.trim())
}

function onOff(value: string | undefined): boolean {
	return value?.trim().toLowerCase() === 'on'
}

/**
 * Determine the order of the signal columns from a `>>Fix` / `>>Sel` header.
 * Falls back to the documented order if the header cannot be understood.
 */
export function parseSignalOrder(headerLine: string): SignalType[] {
	const order: SignalType[] = []
	for (const rawToken of headerLine.split(/[\s/]+/)) {
		const signal = SIGNAL_ABBREVIATIONS[rawToken.trim().toLowerCase()]
		if (signal && !order.includes(signal)) order.push(signal)
		if (order.length === SIGNAL_TYPES.length) break
	}
	return order.length === SIGNAL_TYPES.length ? order : [...SIGNAL_TYPES]
}

/**
 * Pull the six slash-separated device IDs out of a `>>Fix` / `>>Sel` value row,
 * plus any trailing On/Off flag columns.
 */
function parseSignalRow(line: string, order: SignalType[]): { map: SignalMap; flags: boolean[] } | undefined {
	const match = line.match(/(\d{1,3})(?:\s*\/\s*(\d{1,3})){5}/)
	if (!match) return undefined

	const ids = (match[0].match(/\d{1,3}/g) ?? []).map((value) => parseInt(value, 10))
	if (ids.length < SIGNAL_TYPES.length) return undefined

	const map = emptySignalMap()
	order.forEach((signal, index) => {
		map[signal] = ids[index] ?? 0
	})

	const trailing = line.slice((match.index ?? 0) + match[0].length)
	const flags = (trailing.match(/\b(?:On|Off)\b/gi) ?? []).map((value) => onOff(value))

	return { map, flags }
}

/**
 * An encoder row from the `GET STATUS` table.
 * Note there is no name column here — names come from `GET ENC ... STATUS`.
 */
export interface ParsedEncoderRow {
	id: number
	type: string
	edid: string
	ip: string
	online: boolean
	signal: boolean
}

export interface ParsedDecoderSummary {
	id: number
	type: string
	/** Encoder currently feeding this decoder, per the `From` column. 0 = none. */
	source: number
	ip: string
	online: boolean
	hpd: boolean
	resolutionCode: string
	mode: 'MX' | 'VW' | 'unknown'
}

export interface ParsedSystemStatus {
	firmware: string
	power: boolean | undefined
	encoders: ParsedEncoderRow[]
	decoders: ParsedDecoderSummary[]
	unparsed: string[]
}

type Section = 'none' | 'power' | 'encoders' | 'decoders' | 'lan' | 'network' | 'domain'

function classifyHeader(line: string): Section | undefined {
	const tokens = line.trim().split(/\s+/)
	const first = tokens[0]?.toLowerCase()
	const upper = line.toUpperCase()

	if (first === 'power' && upper.includes('BAUD')) return 'power'
	if (first === 'enc' && upper.includes('TYPE')) return 'encoders'
	if (first === 'dec' && upper.includes('TYPE')) return 'decoders'
	if (first === 'lan' && upper.includes('DHCP')) return 'lan'
	if (first === 'telnet') return 'network'
	if (first === 'domain') return 'domain'
	return undefined
}

/**
 * Parse the output of `GET STATUS`: controller info plus a summary row for
 * every encoder and decoder known to the system.
 */
export function parseSystemStatus(text: string): ParsedSystemStatus {
	const result: ParsedSystemStatus = {
		firmware: '',
		power: undefined,
		encoders: [],
		decoders: [],
		unparsed: [],
	}

	const encoderRow = new RegExp(String.raw`^(\d{1,3})\s+(.+?)\s+(\S+)\s+(${IP})\s+(On|Off)\s*/\s*(On|Off)\b`, 'i')
	const decoderRow = new RegExp(
		String.raw`^(\d{1,3})\s+(.+?)\s+(\d{1,3})\s+(${IP})\s+(On|Off)\s*/\s*(On|Off)\s+(\d+)\s+(MX|VW)\b`,
		'i',
	)

	let section: Section = 'none'

	for (const line of splitLines(text)) {
		const trimmed = line.trim()
		if (!trimmed || isDelimiter(line)) {
			// A blank line ends the current table but keeps us inside the block.
			if (!trimmed) section = 'none'
			continue
		}

		const firmware = trimmed.match(/FW Version:\s*(\S+)/i)
		if (firmware) {
			result.firmware = firmware[1]
			continue
		}

		const header = classifyHeader(line)
		if (header) {
			section = header
			continue
		}

		switch (section) {
			case 'power': {
				// e.g. "On      On      57600"
				const tokens = trimmed.split(/\s+/)
				result.power = onOff(tokens[0])
				break
			}
			case 'encoders': {
				const match = line.match(encoderRow)
				if (match) {
					result.encoders.push({
						id: parseInt(match[1], 10),
						type: match[2].trim(),
						edid: match[3].trim(),
						ip: match[4],
						online: onOff(match[5]),
						signal: onOff(match[6]),
					})
				} else {
					result.unparsed.push(line)
				}
				break
			}
			case 'decoders': {
				const match = line.match(decoderRow)
				if (match) {
					const mode = match[8].toUpperCase()
					result.decoders.push({
						id: parseInt(match[1], 10),
						type: match[2].trim(),
						source: parseInt(match[3], 10),
						ip: match[4],
						online: onOff(match[5]),
						hpd: onOff(match[6]),
						resolutionCode: match[7],
						mode: mode === 'MX' || mode === 'VW' ? mode : 'unknown',
					})
				} else {
					result.unparsed.push(line)
				}
				break
			}
			default:
				// LAN / network / domain sections carry no state we surface.
				break
		}
	}

	return result
}

export interface ParsedDecoderDetail {
	id: number
	name: string
	type: string
	online: boolean
	hpd: boolean
	firmware: string
	mode: 'MX' | 'VW' | 'unknown'
	resolutionCode: string
	rotateCode: number
	selected: SignalMap
	locked: SignalMap
	outputOn: boolean
	muted: boolean
	multicast: boolean
	ip: string
}

export interface ParsedDecoderStatus {
	firmware: string
	decoders: ParsedDecoderDetail[]
	unparsed: string[]
}

/**
 * Parse the output of `GET DEC [n] STATUS`, which repeats a multi-line block
 * per decoder: a summary row followed by indented `>>`-prefixed detail rows.
 */
export function parseDecoderStatus(text: string): ParsedDecoderStatus {
	const result: ParsedDecoderStatus = { firmware: '', decoders: [], unparsed: [] }

	const summaryRow = new RegExp(
		String.raw`^(\d{1,3})\s+(.+?)\s+(On|Off)\s+(On|Off)\s+(\S+)\s+(MX|VW)\s+(\d+)\s+(\d+)\s*(.*)$`,
		'i',
	)

	const lines = splitLines(text)
	let current: ParsedDecoderDetail | undefined
	/** Which detail row the next value line belongs to. */
	let pending: 'fix' | 'sel' | 'ip' | 'skip' | undefined
	let pendingOrder: SignalType[] = [...SIGNAL_TYPES]

	const flush = () => {
		if (current) result.decoders.push(current)
		current = undefined
		pending = undefined
	}

	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed) continue

		if (isDelimiter(line)) {
			flush()
			continue
		}

		// Block banner, e.g. "CHAZY CONTROL Decoder Info".
		if (/CHAZY\s+CONTROL/i.test(trimmed)) continue

		const firmware = trimmed.match(/FW Version:\s*(\S+)/i)
		if (firmware) {
			result.firmware = firmware[1]
			continue
		}

		// Header row of the summary table.
		if (/^ID\b/i.test(trimmed) && /\bName\b/i.test(trimmed)) {
			flush()
			continue
		}

		// A `>>` row starts a detail group; its values arrive on the next line.
		const detail = trimmed.match(/^>>\s*(\w+)/)
		if (detail) {
			const kind = detail[1].toLowerCase()
			if (kind === 'fix') {
				pending = 'fix'
				pendingOrder = parseSignalOrder(trimmed)
			} else if (kind === 'sel') {
				pending = 'sel'
				pendingOrder = parseSignalOrder(trimmed)
			} else if (kind === 'ip') {
				pending = 'ip'
			} else {
				// A detail group we do not model (SAC, Pin, IM, ...). Its value
				// row follows on the next line and should not be treated as data.
				pending = 'skip'
			}
			continue
		}

		if (current && pending === 'skip') {
			pending = undefined
			continue
		}

		if (current && pending === 'fix') {
			const parsed = parseSignalRow(trimmed, pendingOrder)
			if (parsed) {
				current.locked = parsed.map
				// Trailing flag columns are MCast, Video (output enabled), Mute.
				const [multicast, outputOn, muted] = parsed.flags
				if (multicast !== undefined) current.multicast = multicast
				if (outputOn !== undefined) current.outputOn = outputOn
				if (muted !== undefined) current.muted = muted
			} else {
				result.unparsed.push(line)
			}
			pending = undefined
			continue
		}

		if (current && pending === 'sel') {
			const parsed = parseSignalRow(trimmed, pendingOrder)
			if (parsed) {
				current.selected = parsed.map
			} else {
				result.unparsed.push(line)
			}
			pending = undefined
			continue
		}

		if (current && pending === 'ip') {
			const ip = trimmed.match(new RegExp(IP))
			if (ip) current.ip = ip[0]
			pending = undefined
			continue
		}

		// Otherwise this should be the summary row that opens a new decoder block.
		const match = line.match(summaryRow)
		if (match) {
			flush()
			const mode = match[6].toUpperCase()
			current = {
				id: parseInt(match[1], 10),
				name: match[9].trim(),
				type: match[2].trim(),
				online: onOff(match[3]),
				hpd: onOff(match[4]),
				firmware: match[5].trim(),
				mode: mode === 'MX' || mode === 'VW' ? mode : 'unknown',
				resolutionCode: match[7],
				rotateCode: parseInt(match[8], 10),
				selected: emptySignalMap(),
				locked: emptySignalMap(),
				outputOn: false,
				muted: false,
				multicast: false,
				ip: '',
			}
			pending = undefined
			continue
		}

		// Rows we do not model (SAC, Pin, IM, ...) land here; keep them for debug
		// logging but do not treat them as an error.
		if (!/^\(?\d\)?\s/.test(trimmed) && !/^(Static|DHCP|AUTOIP)\b/i.test(trimmed)) {
			result.unparsed.push(line)
		}
	}

	flush()
	return result
}

export interface ParsedEncoderDetail {
	id: number
	name: string
	type: string
	online: boolean
	signal: boolean
	firmware: string
	edid: string
	audioInput: string
	multicast: boolean
	ip: string
}

export interface ParsedEncoderStatus {
	firmware: string
	encoders: ParsedEncoderDetail[]
	unparsed: string[]
}

/**
 * Parse the output of `GET ENC [n] STATUS`.
 *
 * This is the only place the controller reports encoder names — the encoder
 * table in `GET STATUS` has no name column — so it is worth polling even
 * though the rest of the detail changes rarely.
 */
export function parseEncoderStatus(text: string): ParsedEncoderStatus {
	const result: ParsedEncoderStatus = { firmware: '', encoders: [], unparsed: [] }

	const summaryRow = new RegExp(
		String.raw`^(\d{1,3})\s+(.+?)\s+(On|Off)\s+(On|Off)\s+(\S+)\s+(\S+)\s+(\S+)\s+(On|Off)\s*(.*)$`,
		'i',
	)

	let current: ParsedEncoderDetail | undefined
	let pending: 'ip' | 'skip' | undefined

	const flush = () => {
		if (current) result.encoders.push(current)
		current = undefined
		pending = undefined
	}

	for (const line of splitLines(text)) {
		const trimmed = line.trim()
		if (!trimmed) continue

		if (isDelimiter(line)) {
			flush()
			continue
		}

		if (/CHAZY\s+CONTROL/i.test(trimmed)) continue

		const firmware = trimmed.match(/FW Version:\s*(\S+)/i)
		if (firmware) {
			result.firmware = firmware[1]
			continue
		}

		if (/^ID\b/i.test(trimmed) && /\bName\b/i.test(trimmed)) {
			flush()
			continue
		}

		const detail = trimmed.match(/^>>\s*(\w+)/)
		if (detail) {
			pending = detail[1].toLowerCase() === 'ip' ? 'ip' : 'skip'
			continue
		}

		if (current && pending === 'ip') {
			const ip = trimmed.match(new RegExp(IP))
			if (ip) current.ip = ip[0]
			pending = undefined
			continue
		}

		if (current && pending === 'skip') {
			pending = undefined
			continue
		}

		const match = line.match(summaryRow)
		if (match) {
			flush()
			current = {
				id: parseInt(match[1], 10),
				type: match[2].trim(),
				online: onOff(match[3]),
				signal: onOff(match[4]),
				firmware: match[5].trim(),
				edid: match[6].trim(),
				audioInput: match[7].trim(),
				multicast: onOff(match[8]),
				name: match[9].trim(),
				ip: '',
			}
			pending = undefined
			continue
		}

		if (!/^\(?\d\)?\s/.test(trimmed) && !/^(Static|DHCP|AUTOIP|ARC)\b/i.test(trimmed)) {
			result.unparsed.push(line)
		}
	}

	flush()
	return result
}

/** True if a line is a command acknowledgement. */
export function isAck(line: string): boolean {
	return /^\[(SUCCESS|ERROR)\]/i.test(line.trim())
}

/** True if a line is an error acknowledgement. */
export function isError(line: string): boolean {
	return /^\[ERROR\]/i.test(line.trim())
}
