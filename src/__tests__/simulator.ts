/**
 * A minimal stand-in for a Chazy Control unit.
 *
 * It speaks enough of the CLI to exercise the client, parser and state layers
 * without hardware: it accepts telnet connections, answers `GET` commands with
 * status blocks in the documented layout, and mutates its own routing state in
 * response to `SET` commands.
 *
 * This is a development aid, not a specification. Once real captures exist,
 * the fixtures here should be replaced with them.
 */

import net from 'net'

export interface SimulatorOptions {
	/** Emit a login banner on connect, as some firmwares do. */
	banner?: boolean
	/** Echo received commands back, as a telnet server with echo on would. */
	echo?: boolean
	firmware?: string
}

interface SimDecoder {
	id: number
	name: string
	source: number
	outputOn: boolean
	muted: boolean
	mode: 'MX' | 'VW'
	online: boolean
	resolution: string
	rotate: number
	locked: number[]
}

interface SimEncoder {
	id: number
	name: string
	online: boolean
	signal: boolean
}

const DELIMITER = '='.repeat(64)

export class ChazySimulator {
	readonly #server: net.Server
	readonly #options: Required<SimulatorOptions>
	readonly #sockets = new Set<net.Socket>()

	decoders: SimDecoder[] = [
		{
			id: 1,
			name: 'Left Screen',
			source: 13,
			outputOn: true,
			muted: false,
			mode: 'MX',
			online: true,
			resolution: '00',
			rotate: 0,
			locked: [0, 0, 0, 0, 0, 0],
		},
		{
			id: 2,
			name: 'Right Screen',
			source: 13,
			outputOn: true,
			muted: false,
			mode: 'MX',
			online: true,
			resolution: '02',
			rotate: 0,
			locked: [0, 0, 0, 0, 0, 0],
		},
	]

	encoders: SimEncoder[] = [
		{ id: 13, name: 'Stage Camera', online: true, signal: true },
		{ id: 14, name: 'Playback PC', online: true, signal: false },
	]

	/** Commands received, in order. Useful for asserting wire syntax. */
	readonly received: string[] = []

	constructor(options: SimulatorOptions = {}) {
		this.#options = {
			banner: options.banner ?? false,
			echo: options.echo ?? false,
			firmware: options.firmware ?? '1.00.17',
		}

		this.#server = net.createServer((socket) => {
			this.#sockets.add(socket)
			socket.on('close', () => this.#sockets.delete(socket))
			socket.on('error', () => this.#sockets.delete(socket))

			if (this.#options.banner) {
				socket.write('Welcome to CHAZY CONTROL\r\n')
			}

			let buffer = ''
			socket.on('data', (chunk) => {
				buffer += chunk.toString('latin1')
				const lines = buffer.split(/\r\n|\r|\n/)
				buffer = lines.pop() ?? ''
				for (const line of lines) {
					const command = line.trim()
					if (!command) continue
					this.received.push(command)
					if (this.#options.echo) socket.write(`${command}\r\n`)
					socket.write(this.#respond(command))
				}
			})
		})
	}

	async listen(port = 0): Promise<number> {
		await new Promise<void>((resolve) => this.#server.listen(port, '127.0.0.1', resolve))
		const address = this.#server.address()
		if (typeof address === 'string' || address === null) throw new Error('Simulator failed to bind')
		return address.port
	}

	async close(): Promise<void> {
		for (const socket of this.#sockets) socket.destroy()
		this.#sockets.clear()
		await new Promise<void>((resolve) => this.#server.close(() => resolve()))
	}

	#respond(command: string): string {
		const upper = command.toUpperCase()

		if (upper === 'GET STATUS') return this.systemStatusBlock()
		if (/^GET DEC(\s+\d+)?\s+STATUS$/.test(upper)) {
			const match = upper.match(/^GET DEC\s+(\d+)\s+STATUS$/)
			const id = match ? parseInt(match[1], 10) : 0
			return this.decoderStatusBlock(id)
		}

		let match = command.match(/^SET DEC\s+(\d+)\s+SWITCH\s+(\d+)\s+ALL$/i)
		if (match) {
			const [, decRaw, encRaw] = match
			const enc = parseInt(encRaw, 10)
			const targets = this.#targets(parseInt(decRaw, 10))
			if (targets.length === 0) return err(`Decoder ${pad3(decRaw)} does not exist.`)
			for (const decoder of targets) decoder.source = enc
			return enc === 0
				? ok(`Set decoder ${pad3(decRaw)} VARSUC unselect encoder.`)
				: ok(`Set decoder ${pad3(decRaw)} from encoder ${pad3(encRaw)}.`)
		}

		match = command.match(/^SET DEC\s+(\d+)\s+OUTPUT\s+(ON|OFF)$/i)
		if (match) {
			const targets = this.#targets(parseInt(match[1], 10))
			if (targets.length === 0) return err(`Decoder ${pad3(match[1])} does not exist.`)
			const on = match[2].toUpperCase() === 'ON'
			for (const decoder of targets) decoder.outputOn = on
			return ok(`Set decoder ${pad3(match[1])} output ${on ? 'on' : 'off'}.`)
		}

		match = command.match(/^SET DEC\s+(\d+)\s+OUTPUT MUTE\s+(ON|OFF)$/i)
		if (match) {
			const targets = this.#targets(parseInt(match[1], 10))
			if (targets.length === 0) return err(`Decoder ${pad3(match[1])} does not exist.`)
			const muted = match[2].toUpperCase() === 'ON'
			for (const decoder of targets) decoder.muted = muted
			return ok(`Set decoder ${pad3(match[1])} mute ${muted ? 'on' : 'off'}.`)
		}

		match = command.match(/^SET DEC\s+(\d+)\s+MODE\s+(MX|VW)$/i)
		if (match) {
			const targets = this.#targets(parseInt(match[1], 10))
			if (targets.length === 0) return err(`Decoder ${pad3(match[1])} does not exist.`)
			const mode = match[2].toUpperCase() as 'MX' | 'VW'
			for (const decoder of targets) decoder.mode = mode
			return ok(`Set decoder ${pad3(match[1])} mode ${mode}.`)
		}

		match = command.match(/^APPLY WALL\s+(\d+)\s+PRESET\s+(\d+)$/i)
		if (match) return ok(`Apply preset: Preset ${parseInt(match[2], 10)}.`)

		return err('Unknown command.')
	}

	#targets(id: number): SimDecoder[] {
		if (id === 0) return this.decoders
		const decoder = this.decoders.find((candidate) => candidate.id === id)
		return decoder ? [decoder] : []
	}

	systemStatusBlock(): string {
		const lines = [
			DELIMITER,
			'              CHAZY CONTROL Status Info',
			`              FW Version: ${this.#options.firmware}`,
			'',
			'Power   IR      Baud',
			'On      On      57600',
			'',
			'ENC     Type    EDID    IP               NET/Sig',
			...this.encoders.map(
				(encoder) =>
					`${pad3(encoder.id)}     Gen 2   DF000   169.254.010.${pad3(encoder.id)}  ` +
					`${encoder.online ? 'On ' : 'Off'} /${encoder.signal ? 'On' : 'Off'}`,
			),
			'',
			'DEC     Type    From    IP               NET/HDMI  Res  Mode',
			...this.decoders.map(
				(decoder) =>
					`${pad3(decoder.id)}     Gen 2   ${pad3(decoder.source)}     169.254.020.${pad3(decoder.id)}  ` +
					`${decoder.online ? 'On ' : 'Off'} /Off   ${decoder.resolution}   ${decoder.mode}`,
			),
			'',
			'LAN     DHCP    IP              Gateway         SubnetMask',
			'01_POE  Off     169.254.008.100 169.254.008.001 255.255.000.000',
			'02_CTRL On      192.168.006.100 192.168.006.001 255.255.255.000',
			'',
			'Telnet  SSH     HTTPS   LAN01 MAC           LAN02 MAC',
			'0023    Off     Off     6C:DF:FB:00:01:2D   6C:DF:FB:00:01:21',
			'',
			'Domain Name',
			'controller.local',
			DELIMITER,
		]
		return `${lines.join('\r\n')}\r\n`
	}

	decoderStatusBlock(id = 0): string {
		const targets = id === 0 ? this.decoders : this.decoders.filter((decoder) => decoder.id === id)
		if (targets.length === 0) return err(`Decoder ${pad3(id)} does not exist.`)

		const lines = [
			DELIMITER,
			'              CHAZY CONTROL Decoder Info',
			`              FW Version: ${this.#options.firmware}`,
			'',
			'ID    Type   Net    HPD   Ver      Mode   Res   Rotate  Name',
		]

		for (const decoder of targets) {
			lines.push(
				`${pad3(decoder.id)}   Gen 2  ${decoder.online ? 'On ' : 'Off'}    On    3.01.17  ` +
					`${decoder.mode}      ${decoder.resolution}    ${decoder.rotate}       ${decoder.name}`,
				'    >>Fix    Vid /Aud /IR  /Ser /USB /CEC   MCast Video Mute',
				`             ${decoder.locked.map(pad3).join(' /')}   On    ` +
					`${decoder.outputOn ? 'On ' : 'Off'}   ${decoder.muted ? 'On ' : 'Off'}`,
				'    >>Sel    Vid /Aud /IR  /Ser /USB /CEC',
				`             ${Array(6).fill(pad3(decoder.source)).join(' /')}`,
				'    >>IP               GW               SM',
				`      169.254.020.${pad3(decoder.id)}  169.254.001.001  255.255.000.000`,
			)
		}

		lines.push(DELIMITER)
		return `${lines.join('\r\n')}\r\n`
	}
}

function pad3(value: number | string): string {
	return String(value).padStart(3, '0')
}

function ok(message: string): string {
	return `[SUCCESS]${message}\r\n`
}

function err(message: string): string {
	return `[ERROR]${message}\r\n`
}
