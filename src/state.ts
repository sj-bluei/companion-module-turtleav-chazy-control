/**
 * Device state store.
 *
 * Status output is polled rather than pushed, so every poll produces a full
 * snapshot. This module merges snapshots into the running state and reports
 * what actually changed, so the module only refreshes the feedbacks and
 * variables that need it.
 */

import type { ParsedDecoderStatus, ParsedEncoderStatus, ParsedSystemStatus, ParsedWallStatus } from './parser.js'
import {
	emptyDeviceState,
	emptySignalMap,
	SIGNAL_TYPES,
	type DecoderState,
	type DeviceState,
	type EncoderState,
	type WallState,
} from './types.js'

export interface StateChanges {
	/** Any decoder or encoder field changed. */
	devices: boolean
	/** The set of known device IDs changed, so dropdown choices need rebuilding. */
	roster: boolean
	/** Routing (selected or locked sources) changed. */
	routing: boolean
	/** Output enable/mute changed. */
	output: boolean
	/** Online/signal state changed. */
	presence: boolean
	/** Controller-level info changed. */
	system: boolean
	/** Video wall state changed. */
	walls: boolean
}

export function noChanges(): StateChanges {
	return { devices: false, roster: false, routing: false, output: false, presence: false, system: false, walls: false }
}

export function hasAnyChange(changes: StateChanges): boolean {
	return Object.values(changes).some(Boolean)
}

function newDecoder(id: number): DecoderState {
	return {
		id,
		name: `Decoder ${String(id).padStart(3, '0')}`,
		type: '',
		online: false,
		hpd: false,
		firmware: '',
		mode: 'unknown',
		resolutionCode: '0',
		rotateCode: 0,
		selected: emptySignalMap(),
		locked: emptySignalMap(),
		outputOn: false,
		muted: false,
		multicast: false,
		ip: '',
	}
}

function newEncoder(id: number): EncoderState {
	return {
		id,
		name: `Encoder ${String(id).padStart(3, '0')}`,
		type: '',
		online: false,
		signal: false,
		edid: '',
		ip: '',
		firmware: '',
		audioInput: '',
		multicast: false,
	}
}

export class ChazyState {
	#state: DeviceState = emptyDeviceState()

	get current(): DeviceState {
		return this.#state
	}

	get decoders(): DecoderState[] {
		return [...this.#state.decoders.values()].sort((a, b) => a.id - b.id)
	}

	get encoders(): EncoderState[] {
		return [...this.#state.encoders.values()].sort((a, b) => a.id - b.id)
	}

	get walls(): WallState[] {
		return [...this.#state.walls.values()].sort((a, b) => a.id - b.id)
	}

	getWall(id: number): WallState | undefined {
		return this.#state.walls.get(id)
	}

	/** Merge a `GET WALL [n] STATUS` snapshot. */
	applyWallStatus(parsed: ParsedWallStatus): StateChanges {
		const changes = noChanges()
		const existing = this.#state.walls.get(parsed.id)

		if (
			!existing ||
			existing.activePreset !== parsed.activePreset ||
			existing.name !== parsed.name ||
			existing.columns !== parsed.columns ||
			existing.rows !== parsed.rows
		) {
			this.#state.walls.set(parsed.id, {
				id: parsed.id,
				name: parsed.name,
				columns: parsed.columns,
				rows: parsed.rows,
				activePreset: parsed.activePreset,
				presetNames: parsed.presetNames,
			})
			changes.walls = true
			if (!existing) changes.roster = true
		}

		return changes
	}

	getDecoder(id: number): DecoderState | undefined {
		return this.#state.decoders.get(id)
	}

	getEncoder(id: number): EncoderState | undefined {
		return this.#state.encoders.get(id)
	}

	/** Drop all knowledge of the device, e.g. after a disconnect. */
	clear(): void {
		this.#state = emptyDeviceState()
	}

	/** Merge a `GET STATUS` snapshot. */
	applySystemStatus(parsed: ParsedSystemStatus): StateChanges {
		const changes = noChanges()

		if (parsed.firmware && parsed.firmware !== this.#state.firmware) {
			this.#state.firmware = parsed.firmware
			changes.system = true
		}
		if (parsed.power !== undefined && parsed.power !== this.#state.power) {
			this.#state.power = parsed.power
			changes.system = true
		}

		for (const row of parsed.encoders) {
			let encoder = this.#state.encoders.get(row.id)
			if (!encoder) {
				encoder = newEncoder(row.id)
				this.#state.encoders.set(row.id, encoder)
				changes.roster = true
				changes.devices = true
			}
			if (encoder.online !== row.online || encoder.signal !== row.signal) {
				encoder.online = row.online
				encoder.signal = row.signal
				changes.presence = true
				changes.devices = true
			}
			if (encoder.type !== row.type || encoder.edid !== row.edid || encoder.ip !== row.ip) {
				encoder.type = row.type
				encoder.edid = row.edid
				encoder.ip = row.ip
				changes.devices = true
			}
		}

		for (const row of parsed.decoders) {
			let decoder = this.#state.decoders.get(row.id)
			if (!decoder) {
				decoder = newDecoder(row.id)
				this.#state.decoders.set(row.id, decoder)
				changes.roster = true
				changes.devices = true
			}
			if (decoder.online !== row.online || decoder.hpd !== row.hpd) {
				decoder.online = row.online
				decoder.hpd = row.hpd
				changes.presence = true
				changes.devices = true
			}
			if (decoder.mode !== row.mode || decoder.resolutionCode !== row.resolutionCode) {
				decoder.mode = row.mode
				decoder.resolutionCode = row.resolutionCode
				changes.devices = true
			}
			if (decoder.type !== row.type || decoder.ip !== row.ip) {
				decoder.type = row.type
				decoder.ip = row.ip
				changes.devices = true
			}
			// GET STATUS only reports a single "From" column. Detailed per-signal
			// routing comes from GET DEC STATUS, so only fill in the video route
			// here and let the detailed poll refine it.
			if (row.source !== decoder.selected.video) {
				decoder.selected.video = row.source
				changes.routing = true
				changes.devices = true
			}
		}

		return changes
	}

	/**
	 * Merge a `GET ENC [n] STATUS` snapshot.
	 * This is the only source of encoder names.
	 */
	applyEncoderStatus(parsed: ParsedEncoderStatus): StateChanges {
		const changes = noChanges()

		if (parsed.firmware && parsed.firmware !== this.#state.firmware) {
			this.#state.firmware = parsed.firmware
			changes.system = true
		}

		for (const row of parsed.encoders) {
			let encoder = this.#state.encoders.get(row.id)
			if (!encoder) {
				encoder = newEncoder(row.id)
				this.#state.encoders.set(row.id, encoder)
				changes.roster = true
				changes.devices = true
			}

			if (row.name && encoder.name !== row.name) {
				encoder.name = row.name
				changes.roster = true
				changes.devices = true
			}
			if (encoder.online !== row.online || encoder.signal !== row.signal) {
				encoder.online = row.online
				encoder.signal = row.signal
				changes.presence = true
				changes.devices = true
			}
			if (
				encoder.type !== row.type ||
				encoder.edid !== row.edid ||
				encoder.firmware !== row.firmware ||
				encoder.audioInput !== row.audioInput ||
				encoder.multicast !== row.multicast ||
				(row.ip && encoder.ip !== row.ip)
			) {
				encoder.type = row.type
				encoder.edid = row.edid
				encoder.firmware = row.firmware
				encoder.audioInput = row.audioInput
				encoder.multicast = row.multicast
				if (row.ip) encoder.ip = row.ip
				changes.devices = true
			}
		}

		return changes
	}

	/** Merge a `GET DEC [n] STATUS` snapshot. */
	applyDecoderStatus(parsed: ParsedDecoderStatus): StateChanges {
		const changes = noChanges()

		if (parsed.firmware && parsed.firmware !== this.#state.firmware) {
			this.#state.firmware = parsed.firmware
			changes.system = true
		}

		for (const row of parsed.decoders) {
			let decoder = this.#state.decoders.get(row.id)
			if (!decoder) {
				decoder = newDecoder(row.id)
				this.#state.decoders.set(row.id, decoder)
				changes.roster = true
				changes.devices = true
			}

			if (row.name && decoder.name !== row.name) {
				decoder.name = row.name
				changes.roster = true
				changes.devices = true
			}
			if (decoder.online !== row.online || decoder.hpd !== row.hpd) {
				decoder.online = row.online
				decoder.hpd = row.hpd
				changes.presence = true
				changes.devices = true
			}
			if (decoder.outputOn !== row.outputOn || decoder.muted !== row.muted) {
				decoder.outputOn = row.outputOn
				decoder.muted = row.muted
				changes.output = true
				changes.devices = true
			}
			if (
				decoder.mode !== row.mode ||
				decoder.resolutionCode !== row.resolutionCode ||
				decoder.rotateCode !== row.rotateCode ||
				decoder.multicast !== row.multicast ||
				decoder.type !== row.type ||
				decoder.firmware !== row.firmware ||
				(row.ip && decoder.ip !== row.ip)
			) {
				decoder.mode = row.mode
				decoder.resolutionCode = row.resolutionCode
				decoder.rotateCode = row.rotateCode
				decoder.multicast = row.multicast
				decoder.type = row.type
				decoder.firmware = row.firmware
				if (row.ip) decoder.ip = row.ip
				changes.devices = true
			}

			for (const signal of SIGNAL_TYPES) {
				if (decoder.selected[signal] !== row.selected[signal]) {
					decoder.selected[signal] = row.selected[signal]
					changes.routing = true
					changes.devices = true
				}
				if (decoder.locked[signal] !== row.locked[signal]) {
					decoder.locked[signal] = row.locked[signal]
					changes.routing = true
					changes.devices = true
				}
			}
		}

		return changes
	}

	/**
	 * Encoder IDs referenced by decoders but never reported in an encoder table.
	 * Used to keep source dropdowns useful when only decoders have been polled.
	 */
	ensureReferencedEncoders(): boolean {
		let added = false
		for (const decoder of this.#state.decoders.values()) {
			for (const signal of SIGNAL_TYPES) {
				const id = decoder.selected[signal]
				if (id > 0 && !this.#state.encoders.has(id)) {
					this.#state.encoders.set(id, newEncoder(id))
					added = true
				}
			}
		}
		return added
	}
}
