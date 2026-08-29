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
	/**
	 * How long to wait for the TCP connection to be accepted, in ms.
	 *
	 * Without this the attempt runs until the operating system gives up, which
	 * is 75 seconds on macOS when the address simply swallows the packets — long
	 * enough that a mistyped address looks like a hang rather than a mistake.
	 */
	connectTimeout?: number
	/** How long to wait before retrying a failed connection, in ms. */
	reconnectInterval?: number
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

/**
 * Remove a shell-style prompt that the device left in front of a reply.
 *
 * A prompt has no trailing newline, so it sits in the receive buffer until the
 * next reply arrives and ends up glued to that reply's first line. Only strip
 * it when what follows is recognisably the start of a reply, so ordinary
 * status text is never mangled.
 */
export function stripPromptPrefix(line: string): string {
	const ack = line.search(/\[(?:SUCCESS|ERROR)]/i)
	if (ack > 0) return line.slice(ack)

	const delimiter = line.match(/^[^=]{1,32}?(={4,}\s*)$/)
	if (delimiter) return delimiter[1]

	return line
}

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

	#connectTimer: NodeJS.Timeout | undefined
	#retryTimer: NodeJS.Timeout | undefined

	constructor(options: ChazyClientOptions) {
		super()
		this.#options = {
			commandTimeout: 5000,
			blockIdleTimeout: 500,
			connectTimeout: 5000,
			reconnectInterval: 5000,
			...options,
		}
	}

	get isConnected(): boolean {
		return this.#socket?.isConnected ?? false
	}

	connect(): void {
		if (this.#destroyed) return

		this.#clearRetryTimer()
		this.#teardownSocket()

		const { host, port, connectTimeout } = this.#options
		this.emit('status', InstanceStatus.Connecting, `Connecting to ${host}:${port}`)

		// Reconnection is handled here rather than by the helper, so that a
		// connection attempt can be abandoned on our own schedule instead of
		// waiting out the operating system's TCP timeout.
		const socket = new TelnetHelper(host, port, { reconnect: false })
		this.#socket = socket

		this.#connectTimer = setTimeout(() => {
			this.#connectTimer = undefined
			this.#teardownSocket()
			this.#failAll(new Error('Connection timed out'))
			this.emit(
				'status',
				InstanceStatus.ConnectionFailure,
				`No response from ${host}:${port} after ${Math.round(connectTimeout / 1000)}s`,
			)
			this.#scheduleRetry()
		}, connectTimeout)

		socket.on('connect', () => {
			this.#clearConnectTimer()
			this.#receiveBuffer = ''
			this.emit('connect')
		})

		socket.on('end', () => {
			this.#clearConnectTimer()
			this.#failAll(new Error('Connection closed'))
			this.emit('disconnect')
			this.emit('status', InstanceStatus.Disconnected, `${host}:${port} closed the connection`)
			this.#scheduleRetry()
		})

		socket.on('error', (error: Error) => {
			this.#clearConnectTimer()
			this.#failAll(error)
			this.emit('error', error)
			this.emit('status', InstanceStatus.ConnectionFailure, `${host}:${port}: ${error.message}`)
			this.#scheduleRetry()
		})

		socket.on('data', (chunk: Buffer) => {
			this.#onData(chunk)
		})
	}

	destroy(): void {
		this.#destroyed = true
		this.#clearConnectTimer()
		this.#clearRetryTimer()
		this.#failAll(new Error('Module is shutting down'))
		this.#teardownSocket()
		this.removeAllListeners()
	}

	#scheduleRetry(): void {
		if (this.#destroyed || this.#retryTimer) return
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined
			this.connect()
		}, this.#options.reconnectInterval)
	}

	#clearConnectTimer(): void {
		if (this.#connectTimer) clearTimeout(this.#connectTimer)
		this.#connectTimer = undefined
	}

	#clearRetryTimer(): void {
		if (this.#retryTimer) clearTimeout(this.#retryTimer)
		this.#retryTimer = undefined
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

		// Discard anything left over from the previous reply. Telnet CLIs often
		// leave a prompt with no trailing newline sitting in the buffer, which
		// would otherwise be glued onto the front of this command's first line.
		if (this.#receiveBuffer) {
			if (this.#receiveBuffer.trim()) this.emit('line', this.#receiveBuffer)
			this.#receiveBuffer = ''
		}

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
		const line = stripPromptPrefix(rawLine.replace(/\s+$/, ''))
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
