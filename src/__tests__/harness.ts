/**
 * A minimal stand-in for the module instance, so action and feedback callbacks
 * can be exercised without a running Companion.
 *
 * Only the surface the definitions actually touch is implemented; everything
 * else is deliberately absent so an accidental new dependency shows up as a
 * loud failure rather than silently passing.
 */

import type ModuleInstance from '../main.js'
import type { ActionsSchema } from '../actions.js'
import type { FeedbacksSchema } from '../feedbacks.js'
import { UpdateActions } from '../actions.js'
import { UpdateFeedbacks } from '../feedbacks.js'
import { UpdatePresets } from '../presets.js'
import { ChazyState } from '../state.js'
import { parseDecoderStatus, parseEncoderStatus, parseSystemStatus } from '../parser.js'
import { ChazySimulator } from './simulator.js'
import type { DecoderState } from '../types.js'
import { resolveToggle, type ToggleOption } from '../options.js'

export interface PresetGroup {
	id: string
	name: string
	type: string
	presets?: string[]
}

export interface PresetSection {
	id: string
	name: string
	definitions: PresetGroup[] | string[]
}

export interface PresetDefinition {
	type: string
	name: string
	style: { text?: string }
	steps: { down: { actionId: string }[]; up: unknown[] }[]
	feedbacks: { feedbackId: string }[]
}

type AnyDefinition = {
	name: string
	options: unknown[]
	callback: (event: unknown, context: unknown) => unknown
	learn?: (event: unknown, context: unknown) => unknown
}

export class ActionHarness {
	readonly state = new ChazyState()
	/** Commands the action layer tried to send, in order. */
	readonly sent: string[] = []
	readonly logs: { level: string; message: string }[] = []

	#actions: Record<string, AnyDefinition> = {}
	#feedbacks: Record<string, AnyDefinition> = {}
	#presetSections: unknown[] = []
	#presets: Record<string, unknown> = {}

	/** Populate state from the simulator's documented-format blocks. */
	loadSimulatorState(simulator = new ChazySimulator()): void {
		this.state.applySystemStatus(parseSystemStatus(simulator.systemStatusBlock()))
		this.state.applyEncoderStatus(parseEncoderStatus(simulator.encoderStatusBlock(0)))
		this.state.applyDecoderStatus(parseDecoderStatus(simulator.decoderStatusBlock(0)))
	}

	build(): void {
		UpdateActions(this as unknown as ModuleInstance)
		UpdateFeedbacks(this as unknown as ModuleInstance)
		UpdatePresets(this as unknown as ModuleInstance)
	}

	setPresetDefinitions(sections: unknown[], presets: Record<string, unknown>): void {
		this.#presetSections = sections
		this.#presets = presets
	}

	get presetSections(): PresetSection[] {
		return this.#presetSections as PresetSection[]
	}

	get presets(): Record<string, PresetDefinition> {
		return this.#presets as Record<string, PresetDefinition>
	}

	// -- surface used by the definitions ------------------------------------

	setActionDefinitions(definitions: Record<string, unknown>): void {
		this.#actions = definitions as Record<string, AnyDefinition>
	}

	setFeedbackDefinitions(definitions: Record<string, unknown>): void {
		this.#feedbacks = definitions as Record<string, AnyDefinition>
	}

	async sendCommand(command: string): Promise<string[]> {
		this.sent.push(command)
		return []
	}

	log(level: string, message: string): void {
		this.logs.push({ level, message })
	}

	warnBadOption(actionId: string): void {
		this.logs.push({ level: 'warn', message: `bad option: ${actionId}` })
	}

	resolveDecoderToggle(dec: number, mode: ToggleOption, read: (decoder: DecoderState) => boolean): boolean {
		if (mode !== 'toggle') return mode === 'on'
		if (dec === 0) return !this.state.decoders.some((decoder) => read(decoder))
		const decoder = this.state.getDecoder(dec)
		return decoder ? resolveToggle(mode, read(decoder)) : true
	}

	// -- test helpers -------------------------------------------------------

	actionIds(): string[] {
		return Object.keys(this.#actions)
	}

	feedbackIds(): string[] {
		return Object.keys(this.#feedbacks)
	}

	action(id: keyof ActionsSchema): AnyDefinition {
		const definition = this.#actions[id as string]
		if (!definition) throw new Error(`No such action: ${String(id)}`)
		return definition
	}

	feedback(id: keyof FeedbacksSchema): AnyDefinition {
		const definition = this.#feedbacks[id as string]
		if (!definition) throw new Error(`No such feedback: ${String(id)}`)
		return definition
	}

	/** Run an action's callback and return the commands it produced. */
	async run(id: keyof ActionsSchema, options: Record<string, unknown>): Promise<string[]> {
		const before = this.sent.length
		await this.action(id).callback({ options, id: 'test', controlId: 'test', actionId: id }, {})
		return this.sent.slice(before)
	}

	/** Run an action's learn callback. */
	async learn(id: keyof ActionsSchema, options: Record<string, unknown>): Promise<unknown> {
		const definition = this.action(id)
		if (!definition.learn) throw new Error(`Action ${String(id)} has no learn callback`)
		return definition.learn({ options, id: 'test', controlId: 'test', actionId: id }, {})
	}

	/** Evaluate a boolean feedback. */
	check(id: keyof FeedbacksSchema, options: Record<string, unknown>): unknown {
		return this.feedback(id).callback({ options, id: 'test', controlId: 'test', feedbackId: id, type: 'boolean' }, {})
	}
}

/** A harness preloaded with the simulator's device roster. */
export function loadedHarness(): ActionHarness {
	const harness = new ActionHarness()
	harness.loadSimulatorState()
	harness.build()
	return harness
}
