/**
 * Transport for the Chazy Control command line interface.
 *
 * The device exposes a telnet CLI: one text command per line, answered either
 * by a `[SUCCESS]`/`[ERROR]` acknowledgement or by a block of status text
 * delimited by rows of `=` characters. There is no request/response tagging, so
 * commands must be issued one at a time and matched to whatever comes back
 * next. This class owns that serialisation; it holds no device state.
 */

import { EventEmitter } from 'events'
import { InstanceStatus, TelnetHelper } from '@companion-module/base'

import { isAck, isError } from './parser.js'

export type ReplyKind = 'ack' | 'block'

export interface ChazyClientOptions {
	host: string
	port: number
	/** How long to wait for a reply before giving up, in ms. */
	commandTimeout?: number
	/** Silence after the first reply line that ends a block, in ms. */
	blockIdleTimeout?: number
}

export interface ChazyClientEvents {
	connect: []
	disconnect: []
	status: [InstanceStatus, string | undefined]
	error: [Error]
	/** Every received line, for debug logging. */
	line: [string]
	/** Lines that arrived with no command outstanding. */
	unsolicited: [string]
}

interface QueuedCommand {
	command: string
	kind: ReplyKind
	priority: number
	sequence: number
	resolve: (lines: string[]) => void
	reject: (error: Error) => void
}

/** Priority levels; lower runs first. */
export const PRIORITY_ACTION = 0
export const PRIORITY_POLL = 10

const DELIMITER = /^={4,}$/

export class ChazyClient extends EventEmitter<ChazyClientEvents> {
	readonly #options: Required<ChazyClientOptions>

	#socket: TelnetHelper | undefined
	#queue: QueuedCommand[] = []
	#sequence = 0

	#active: QueuedCommand | undefined
	#activeLines: string[] = []
	#activeTimer: NodeJS.Timeout | undefined
	#idleTimer: NodeJS.Timeout | undefined
	/** Set once a block's opening delimiter has been seen. */
	#inBlock = false

	#receiveBuffer = ''
	#destroyed = false

	constructor(options: ChazyClientOptions) {
		super()
		this.#options = {
			commandTimeout: 5000,
			blockIdleTimeout: 500,
			...options,
		}
	}

	get isConnected(): boolean {
		return this.#socket?.isConnected ?? false
	}

	connect(): void {
		if (this.#destroyed) return
		this.#teardownSocket()

		const socket = new TelnetHelper(this.#options.host, this.#options.port, {
			reconnect: true,
			reconnect_interval: 5000,
		})
		this.#socket = socket

		socket.on('connect', () => {
			this.#receiveBuffer = ''
			this.emit('connect')
		})

		socket.on('end', () => {
			this.#failAll(new Error('Connection closed'))
			this.emit('disconnect')
		})

		socket.on('error', (error: Error) => {
			this.#failAll(error)
			this.emit('error', error)
		})

		socket.on('status_change', (status, message) => {
			this.emit('status', status, message ?? undefined)
		})

		socket.on('data', (chunk: Buffer) => {
			this.#onData(chunk)
		})
	}

	destroy(): void {
		this.#destroyed = true
		this.#failAll(new Error('Module is shutting down'))
		this.#teardownSocket()
		this.removeAllListeners()
	}

	/**
	 * Queue a command and resolve with the reply lines.
	 *
	 * @param kind `ack` for commands answered by `[SUCCESS]`/`[ERROR]`,
	 *             `block` for `GET`-style commands answered by a status block.
	 */
	async send(command: string, kind: ReplyKind = 'ack', priority: number = PRIORITY_ACTION): Promise<string[]> {
		if (this.#destroyed) throw new Error('Client has been destroyed')

		return new Promise<string[]>((resolve, reject) => {
			const job: QueuedCommand = {
				command,
				kind,
				priority,
				sequence: this.#sequence++,
				resolve,
				reject,
			}

			// Stable insert: keep FIFO order within a priority level.
			const index = this.#queue.findIndex((queued) => queued.priority > priority)
			if (index === -1) this.#queue.push(job)
			else this.#queue.splice(index, 0, job)

			this.#pump()
		})
	}

	/** Drop any queued polls, e.g. when the connection drops. */
	dropQueued(priority: number): void {
		const kept: QueuedCommand[] = []
		for (const job of this.#queue) {
			if (job.priority >= priority) job.reject(new Error('Command discarded'))
			else kept.push(job)
		}
		this.#queue = kept
	}

	#pump(): void {
		if (this.#active || this.#queue.length === 0) return
		if (!this.isConnected) return

		const job = this.#queue.shift()
		if (!job) return

		this.#active = job
		this.#activeLines = []
		this.#inBlock = false

		this.#activeTimer = setTimeout(() => {
			this.#settle(new Error(`Timed out waiting for a reply to "${job.command}"`))
		}, this.#options.commandTimeout)

		try {
			this.#socket?.send(`${job.command}\r\n`)
		} catch (error) {
			this.#settle(error instanceof Error ? error : new Error(String(error)))
		}
	}

	#onData(chunk: Buffer): void {
		this.#receiveBuffer += chunk.toString('latin1')

		const parts = this.#receiveBuffer.split(/\r\n|\r|\n/)
		// The final element is an incomplete line; keep it for the next chunk.
		this.#receiveBuffer = parts.pop() ?? ''

		for (const part of parts) {
			this.#onLine(part)
		}

		// A device that answers without a trailing newline would otherwise stall
		// the queue; treat a quiet tail as the end of the reply.
		if (this.#active && this.#receiveBuffer.trim()) {
			this.#restartIdleTimer()
		}
	}

	#onLine(rawLine: string): void {
		const line = rawLine.replace(/\s+$/, '')
		this.emit('line', line)

		const job = this.#active
		if (!job) {
			if (line.trim()) this.emit('unsolicited', line)
			return
		}

		// Devices commonly echo the command; do not treat it as the reply.
		if (line.trim().toUpperCase() === job.command.trim().toUpperCase()) return

		this.#activeLines.push(line)

		if (job.kind === 'ack') {
			if (isAck(line)) {
				this.#settle(undefined)
				return
			}
			// Some commands answer with a block even though we expected an ack;
			// fall through to the idle timer rather than hanging.
			this.#restartIdleTimer()
			return
		}

		if (DELIMITER.test(line.trim())) {
			if (!this.#inBlock) {
				this.#inBlock = true
			} else {
				this.#settle(undefined)
				return
			}
		} else if (isError(line) && !this.#inBlock) {
			// e.g. "GET DEC 999 STATUS" on a device that does not exist.
			this.#settle(undefined)
			return
		}

		this.#restartIdleTimer()
	}

	#restartIdleTimer(): void {
		if (this.#idleTimer) clearTimeout(this.#idleTimer)
		this.#idleTimer = setTimeout(() => {
			if (this.#active) this.#settle(undefined)
		}, this.#options.blockIdleTimeout)
	}

	#settle(error: Error | undefined): void {
		const job = this.#active
		if (!job) return

		this.#active = undefined
		if (this.#activeTimer) clearTimeout(this.#activeTimer)
		if (this.#idleTimer) clearTimeout(this.#idleTimer)
		this.#activeTimer = undefined
		this.#idleTimer = undefined

		const lines = this.#activeLines
		this.#activeLines = []
		this.#inBlock = false

		if (error) job.reject(error)
		else job.resolve(lines)

		// Keep draining on a later tick so a rejected promise cannot recurse here.
		setImmediate(() => this.#pump())
	}

	#failAll(error: Error): void {
		if (this.#active) this.#settle(error)
		const queued = this.#queue
		this.#queue = []
		for (const job of queued) job.reject(error)
	}

	#teardownSocket(): void {
		if (!this.#socket) return
		this.#socket.removeAllListeners()
		this.#socket.destroy()
		this.#socket = undefined
	}

	/** Start pumping again once the socket reports it is ready. */
	notifyReady(): void {
		this.#pump()
	}
}
