/**
 * Shared option field builders.
 *
 * Device pickers are dropdowns populated from whatever the controller has
 * reported, with `allowCustom` so a button can still target a device that is
 * offline at edit time (or be driven by a variable).
 */

import type { DropdownChoice } from '@companion-module/base'

import type { ChazyState } from './state.js'
import { SIGNAL_LABEL, SIGNAL_TYPES, type SignalType } from './types.js'

/** Option values from a device picker arrive as a number, or a string when custom. */
export type DeviceOption = string | number

/** On/Off/Toggle selector value. */
export type ToggleOption = 'on' | 'off' | 'toggle'

export const TOGGLE_CHOICES: DropdownChoice[] = [
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
	{ id: 'toggle', label: 'Toggle' },
]

export const MUTE_CHOICES: DropdownChoice[] = [
	{ id: 'on', label: 'Muted' },
	{ id: 'off', label: 'Unmuted' },
	{ id: 'toggle', label: 'Toggle' },
]

export const SIGNAL_CHOICES: DropdownChoice[] = SIGNAL_TYPES.map((signal) => ({
	id: signal,
	label: SIGNAL_LABEL[signal],
}))

/**
 * Coerce a device picker value to a numeric ID.
 * Returns undefined when the value cannot be understood, so the caller can
 * skip the command rather than send a malformed one.
 */
export function asDeviceId(value: DeviceOption | undefined): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : undefined
	if (typeof value !== 'string') return undefined

	const trimmed = value.trim()
	if (!trimmed) return undefined

	const parsed = Number.parseInt(trimmed, 10)
	return Number.isFinite(parsed) ? parsed : undefined
}

export function decoderChoices(state: ChazyState, options?: { includeAll?: boolean }): DropdownChoice[] {
	const choices: DropdownChoice[] = []
	if (options?.includeAll) choices.push({ id: 0, label: 'All decoders' })

	for (const decoder of state.decoders) {
		choices.push({ id: decoder.id, label: labelFor(decoder.id, decoder.name) })
	}

	if (choices.length === (options?.includeAll ? 1 : 0)) {
		choices.push({ id: 1, label: 'Decoder 001 (not yet discovered)' })
	}
	return choices
}

export function encoderChoices(state: ChazyState, options?: { includeNone?: boolean }): DropdownChoice[] {
	const choices: DropdownChoice[] = []
	if (options?.includeNone) choices.push({ id: 0, label: 'None (disconnect)' })

	for (const encoder of state.encoders) {
		choices.push({ id: encoder.id, label: labelFor(encoder.id, encoder.name) })
	}

	if (choices.length === (options?.includeNone ? 1 : 0)) {
		choices.push({ id: 1, label: 'Encoder 001 (not yet discovered)' })
	}
	return choices
}

function labelFor(id: number, name: string): string {
	const padded = String(id).padStart(3, '0')
	return name && name !== `Decoder ${padded}` && name !== `Encoder ${padded}` ? `${padded} — ${name}` : padded
}

/** Resolve an On/Off/Toggle selection against the current state. */
export function resolveToggle(mode: ToggleOption, current: boolean | undefined): boolean {
	if (mode === 'on') return true
	if (mode === 'off') return false
	return !(current ?? false)
}

export function isSignalType(value: unknown): value is SignalType {
	return typeof value === 'string' && (SIGNAL_TYPES as readonly string[]).includes(value)
}

export interface SalvoRoute {
	decoder: number
	encoder: number
}

export interface SalvoParseResult {
	routes: SalvoRoute[]
	/** Entries that could not be understood, kept so the user can be told which. */
	invalid: string[]
}

/**
 * Parse a salvo written as `decoder:encoder` pairs, e.g. `1:13, 2:14, 3:13`.
 *
 * Separators are deliberately loose (commas, semicolons, newlines) because
 * these lists get pasted from spreadsheets and run sheets. A bad entry is
 * reported rather than aborting the salvo, so one typo cannot silently drop
 * every other route in a show-critical button press.
 */
export function parseSalvoList(input: string): SalvoParseResult {
	const result: SalvoParseResult = { routes: [], invalid: [] }

	for (const rawEntry of input.split(/[,;\n\r]+/)) {
		const entry = rawEntry.trim()
		if (!entry) continue

		const match = entry.match(/^(\d{1,3})\s*[:>=-]\s*(\d{1,3})$/)
		if (!match) {
			result.invalid.push(entry)
			continue
		}

		const decoder = parseInt(match[1], 10)
		const encoder = parseInt(match[2], 10)
		if (!Number.isFinite(decoder) || !Number.isFinite(encoder)) {
			result.invalid.push(entry)
			continue
		}

		result.routes.push({ decoder, encoder })
	}

	return result
}

/** Coerce a multidropdown value into a list of device IDs. */
export function asDeviceIdList(value: unknown): number[] {
	if (!Array.isArray(value)) return []
	const ids: number[] = []
	for (const item of value) {
		const id = asDeviceId(item as DeviceOption)
		if (id !== undefined && !ids.includes(id)) ids.push(id)
	}
	return ids
}
