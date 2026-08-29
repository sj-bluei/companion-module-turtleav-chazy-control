import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'

import { ChazyClient, PRIORITY_POLL, type ReplyKind } from './chazy.js'
import { Commands } from './commands.js'
import { CONFIG_DEFAULTS, GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { isError, parseDecoderStatus, parseEncoderStatus, parseSystemStatus } from './parser.js'
import { ChazyState, hasAnyChange, noChanges, type StateChanges } from './state.js'
import { resolveToggle, type ToggleOption } from './options.js'
import type { DecoderState } from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config: ModuleConfig = { ...CONFIG_DEFAULTS }
	readonly state = new ChazyState()

	#client: ChazyClient | undefined
	#pollTimer: NodeJS.Timeout | undefined
	#pollCount = 0
	#pollInFlight = false
	/** Set once a status block has been parsed successfully. */
	#everSynced = false

	async init(config: ModuleConfig): Promise<void> {
		this.config = { ...CONFIG_DEFAULTS, ...config }

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()

		this.#connect()
	}

	async destroy(): Promise<void> {
		this.#stopPolling()
		this.#client?.destroy()
		this.#client = undefined
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = { ...CONFIG_DEFAULTS, ...config }
		this.#stopPolling()
		this.#client?.destroy()
		this.#client = undefined
		this.state.clear()
		this.#everSynced = false
		this.#connect()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	// -- Connection ---------------------------------------------------------

	#connect(): void {
		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No device address configured')
			return
		}

		this.updateStatus(InstanceStatus.Connecting)

		const client = new ChazyClient({
			host: this.config.host,
			port: this.config.port,
		})
		this.#client = client

		client.on('connect', () => {
			this.log('debug', `Connected to ${this.config.host}:${this.config.port}`)
			this.setVariableValues({ connection: 'connected' })
			client.notifyReady()
			// Give the device a moment to emit any login banner before polling.
			setTimeout(() => void this.#poll(true), 300)
		})

		client.on('disconnect', () => {
			this.log('debug', 'Connection closed')
			this.setVariableValues({ connection: 'disconnected' })
			this.#everSynced = false
		})

		client.on('status', (status, message) => {
			// The client reports transport state; Ok is only claimed once a
			// status block has actually been parsed, in #onSynced.
			if (status === InstanceStatus.Ok) return
			this.updateStatus(status, message)
		})

		client.on('error', (error) => {
			this.log('error', `Connection error: ${error.message}`)
		})

		client.on('line', (line) => {
			if (this.config.verbose) this.log('debug', `< ${line}`)
		})

		client.on('unsolicited', (line) => {
			if (this.config.verbose) this.log('debug', `< (unsolicited) ${line}`)
		})

		client.connect()
		this.#startPolling()
	}

	// -- Commands -----------------------------------------------------------

	/**
	 * Send a command to the device, logging any error reply.
	 * Returns the reply lines, or undefined if the command could not be sent.
	 */
	async sendCommand(command: string, kind: ReplyKind = 'ack'): Promise<string[] | undefined> {
		const client = this.#client
		if (!client || !client.isConnected) {
			this.log('warn', `Not connected; dropped command "${command}"`)
			return undefined
		}

		if (this.config.verbose) this.log('debug', `> ${command}`)

		try {
			const lines = await client.send(command, kind)
			const failure = lines.find((line) => isError(line))
			if (failure) this.log('warn', `Device rejected "${command}": ${failure.trim()}`)
			// A command almost always changes something; refresh sooner than the
			// next scheduled poll so feedbacks track the button press.
			if (kind === 'ack' && !failure) this.#scheduleImmediatePoll()
			return lines
		} catch (error) {
			this.log('error', `Command "${command}" failed: ${error instanceof Error ? error.message : String(error)}`)
			return undefined
		}
	}

	/** Report an action that could not be executed because its options were invalid. */
	warnBadOption(actionId: string): void {
		this.log('warn', `Action "${actionId}" has an invalid or unresolved option and was skipped`)
	}

	/**
	 * Resolve an On/Off/Toggle option for a decoder.
	 * When targeting all decoders, a toggle turns everything off if any decoder
	 * is currently on, so a single press gives a predictable result.
	 */
	resolveDecoderToggle(dec: number, mode: ToggleOption, read: (decoder: DecoderState) => boolean): boolean {
		if (mode !== 'toggle') return mode === 'on'

		if (dec === 0) {
			const anyOn = this.state.decoders.some((decoder) => read(decoder))
			return !anyOn
		}

		const decoder = this.state.getDecoder(dec)
		if (!decoder) {
			this.log('warn', `Decoder ${dec} is not known yet; toggling to on`)
			return true
		}
		return resolveToggle(mode, read(decoder))
	}

	// -- Polling ------------------------------------------------------------

	#startPolling(): void {
		this.#stopPolling()
		if (this.config.pollInterval <= 0) return
		this.#pollTimer = setTimeout(() => void this.#poll(), this.config.pollInterval)
	}

	#stopPolling(): void {
		if (this.#pollTimer) clearTimeout(this.#pollTimer)
		this.#pollTimer = undefined
	}

	#scheduleImmediatePoll(): void {
		if (this.config.pollInterval <= 0 || this.#pollInFlight) return
		this.#stopPolling()
		this.#pollTimer = setTimeout(() => void this.#poll(), 150)
	}

	async #poll(initial = false): Promise<void> {
		if (this.#pollInFlight) return
		const client = this.#client
		if (!client || !client.isConnected) {
			this.#startPolling()
			return
		}

		this.#pollInFlight = true
		let changes: StateChanges = noChanges()

		try {
			const wantSystem = initial || this.#pollCount % Math.max(1, this.config.systemPollRatio) === 0

			if (wantSystem) {
				const lines = await client.send(Commands.getStatus(), 'block', PRIORITY_POLL)
				changes = this.#merge(changes, this.state.applySystemStatus(parseSystemStatus(lines.join('\n'))))

				// Encoder names live only in GET ENC STATUS; the encoder table in
				// GET STATUS has no name column.
				const encoderLines = await client.send(Commands.getEncoderStatus(0), 'block', PRIORITY_POLL)
				changes = this.#merge(changes, this.state.applyEncoderStatus(parseEncoderStatus(encoderLines.join('\n'))))
			}

			const decoderLines = await client.send(Commands.getDecoderStatus(0), 'block', PRIORITY_POLL)
			const parsed = parseDecoderStatus(decoderLines.join('\n'))
			changes = this.#merge(changes, this.state.applyDecoderStatus(parsed))

			if (parsed.unparsed.length > 0 && this.config.verbose) {
				this.log('debug', `Unrecognised status lines: ${parsed.unparsed.slice(0, 5).join(' | ')}`)
			}

			if (this.state.ensureReferencedEncoders()) changes.roster = true

			this.#pollCount++
			this.#onSynced(changes)
		} catch (error) {
			// A failed poll is not fatal; the socket layer handles reconnection.
			this.log('debug', `Poll failed: ${error instanceof Error ? error.message : String(error)}`)
			if (this.#everSynced) {
				this.updateStatus(InstanceStatus.UnknownWarning, 'Lost contact with the device')
				this.#everSynced = false
			}
		} finally {
			this.#pollInFlight = false
			this.#startPolling()
		}
	}

	#merge(a: StateChanges, b: StateChanges): StateChanges {
		return {
			devices: a.devices || b.devices,
			roster: a.roster || b.roster,
			routing: a.routing || b.routing,
			output: a.output || b.output,
			presence: a.presence || b.presence,
			system: a.system || b.system,
		}
	}

	#onSynced(changes: StateChanges): void {
		if (!this.#everSynced) {
			this.#everSynced = true
			this.updateStatus(InstanceStatus.Ok)
			this.log(
				'info',
				`Synced with Chazy Control ${this.state.current.firmware || '(unknown firmware)'}: ` +
					`${this.state.encoders.length} encoder(s), ${this.state.decoders.length} decoder(s)`,
			)
		}

		if (changes.roster) {
			// New devices appeared, so dropdowns and generated presets are stale.
			this.updateActions()
			this.updateFeedbacks()
			this.updatePresets()
			this.updateVariableDefinitions()
		}

		if (hasAnyChange(changes)) {
			UpdateVariableValues(this)
		}

		if (changes.routing) this.checkFeedbacks('routed_from', 'route_locked')
		if (changes.output) this.checkFeedbacks('output_on', 'output_muted')
		if (changes.presence) this.checkFeedbacks('decoder_online', 'encoder_online')
		if (changes.devices) this.checkFeedbacks('decoder_mode_vw')
	}
}
