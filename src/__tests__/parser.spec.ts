import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseDecoderStatus, parseSignalOrder, parseSystemStatus } from '../parser.js'

/**
 * Fixtures transcribed from the Chazy Control API Reference (sections 2.2 and
 * 3.45). Replace/extend these with real captures from hardware — the layout is
 * expected to vary between firmware versions.
 */

const SYSTEM_STATUS = `
================================================================
              CHAZY CONTROL Status Info
              FW Version: 1.00.17

Power   IR      Baud
On      On      57600

ENC     Type    EDID    IP               NET/Sig
013     Gen 2   DF000   169.254.010.013  On /On

DEC     Type    From    IP               NET/HDMI  Res  Mode
001     Gen 2   013     169.254.020.001  On /Off   00   MX
002     Gen 2   013     169.254.020.002  On /Off   00   MX

LAN     DHCP    IP              Gateway         SubnetMask
01_POE  Off     169.254.008.100 169.254.008.001 255.255.000.000
02_CTRL On      192.168.006.100 192.168.006.001 255.255.255.000
        (static:192.168.006.100 192.168.006.001 255.255.255.000)

Telnet  SSH     HTTPS   LAN01 MAC           LAN02 MAC
0023    Off     Off     6C:DF:FB:00:01:2D   6C:DF:FB:00:01:21

Domain Name
controller.local
================================================================
`

const DECODER_STATUS = `
================================================================
              CHAZY CONTROL Decoder Info
              FW Version: 1.00.17

ID    Type   Net    HPD   Ver      Mode   Res   Rotate  Name
001   Gen 2  On     Off   3.01.17  MX      00    0       Decoder 001
    >>Fix    Vid /Aud /IR  /Ser /USB /CEC   MCast Video Mute
             000 /000 /000 /000 /000 /000   On    On    Off
    >>Sel    Vid /Aud /IR  /Ser /USB /CEC
             013 /013 /013 /013 /013 /013
    >>SAC    OSP   SGEn/Br/Bit
      ARC    4     Off /9 /8n1
    >>Pin    IOVOL/IODIR/IODAT IRVOL RLY   PHY
      (1)    12    Out   0     12    Open  Copper
      (2)    12    Out   0           Open
    >>IM     MAC
      Static 6C:DF:FB:01:1A:CE
    >>IP               GW               SM
      169.254.020.001  169.254.001.001  255.255.000.000
================================================================
`

describe('parseSystemStatus', () => {
	const result = parseSystemStatus(SYSTEM_STATUS)

	it('reads the firmware version', () => {
		assert.equal(result.firmware, '1.00.17')
	})

	it('reads the system power state', () => {
		assert.equal(result.power, true)
	})

	it('reads encoder rows, keeping multi-word type names intact', () => {
		assert.equal(result.encoders.length, 1)
		assert.deepEqual(result.encoders[0], {
			id: 13,
			type: 'Gen 2',
			edid: 'DF000',
			ip: '169.254.010.013',
			online: true,
			signal: true,
		})
	})

	it('reads decoder rows including the current source', () => {
		assert.equal(result.decoders.length, 2)
		assert.deepEqual(result.decoders[0], {
			id: 1,
			type: 'Gen 2',
			source: 13,
			ip: '169.254.020.001',
			online: true,
			hpd: false,
			resolutionCode: '00',
			mode: 'MX',
		})
		assert.equal(result.decoders[1].id, 2)
		assert.equal(result.decoders[1].ip, '169.254.020.002')
	})

	it('does not mistake LAN or network rows for devices', () => {
		assert.equal(result.unparsed.length, 0)
	})
})

describe('parseDecoderStatus', () => {
	const result = parseDecoderStatus(DECODER_STATUS)

	it('reads the summary row', () => {
		assert.equal(result.decoders.length, 1)
		const decoder = result.decoders[0]
		assert.equal(decoder.id, 1)
		assert.equal(decoder.name, 'Decoder 001')
		assert.equal(decoder.type, 'Gen 2')
		assert.equal(decoder.online, true)
		assert.equal(decoder.hpd, false)
		assert.equal(decoder.firmware, '3.01.17')
		assert.equal(decoder.mode, 'MX')
		assert.equal(decoder.resolutionCode, '00')
		assert.equal(decoder.rotateCode, 0)
	})

	it('reads the selected source for every signal type', () => {
		assert.deepEqual(result.decoders[0].selected, {
			video: 13,
			audio: 13,
			ir: 13,
			serial: 13,
			usb: 13,
			cec: 13,
		})
	})

	it('treats all-zero fixed routes as unlocked', () => {
		assert.deepEqual(result.decoders[0].locked, {
			video: 0,
			audio: 0,
			ir: 0,
			serial: 0,
			usb: 0,
			cec: 0,
		})
	})

	it('reads the trailing multicast/output/mute flags', () => {
		const decoder = result.decoders[0]
		assert.equal(decoder.multicast, true)
		assert.equal(decoder.outputOn, true)
		assert.equal(decoder.muted, false)
	})

	it('reads the decoder IP from the >>IP group', () => {
		assert.equal(result.decoders[0].ip, '169.254.020.001')
	})

	it('ignores detail groups it does not model', () => {
		assert.deepEqual(result.unparsed, [])
	})
})

describe('parseDecoderStatus with multiple decoders', () => {
	const multi = `
================================================================
              CHAZY CONTROL Decoder Info
              FW Version: 1.00.17

ID    Type   Net    HPD   Ver      Mode   Res   Rotate  Name
001   Gen 2  On     On    3.01.17  MX      02    0       Left Screen
    >>Fix    Vid /Aud /IR  /Ser /USB /CEC   MCast Video Mute
             013 /000 /000 /000 /000 /000   On    On    Off
    >>Sel    Vid /Aud /IR  /Ser /USB /CEC
             013 /014 /013 /013 /013 /013
002   Gen 2  Off    Off   3.01.17  VW      08    1       Right Screen
    >>Fix    Vid /Aud /IR  /Ser /USB /CEC   MCast Video Mute
             000 /000 /000 /000 /000 /000   Off   Off   On
    >>Sel    Vid /Aud /IR  /Ser /USB /CEC
             000 /000 /000 /000 /000 /000
================================================================
`
	const result = parseDecoderStatus(multi)

	it('splits consecutive decoder blocks', () => {
		assert.equal(result.decoders.length, 2)
		assert.equal(result.decoders[0].name, 'Left Screen')
		assert.equal(result.decoders[1].name, 'Right Screen')
	})

	it('reads per-signal routing independently', () => {
		assert.equal(result.decoders[0].selected.video, 13)
		assert.equal(result.decoders[0].selected.audio, 14)
	})

	it('reads a locked video route', () => {
		assert.equal(result.decoders[0].locked.video, 13)
		assert.equal(result.decoders[0].locked.audio, 0)
	})

	it('reads an offline decoder in video wall mode', () => {
		const decoder = result.decoders[1]
		assert.equal(decoder.online, false)
		assert.equal(decoder.mode, 'VW')
		assert.equal(decoder.rotateCode, 1)
		assert.equal(decoder.outputOn, false)
		assert.equal(decoder.muted, true)
		assert.equal(decoder.selected.video, 0)
	})
})

describe('parseSignalOrder', () => {
	it('reads the column order from the header', () => {
		assert.deepEqual(parseSignalOrder('    >>Sel    Vid /Aud /IR  /Ser /USB /CEC'), [
			'video',
			'audio',
			'ir',
			'serial',
			'usb',
			'cec',
		])
	})

	it('honours a reordered header', () => {
		assert.deepEqual(parseSignalOrder('    >>Sel    Aud /Vid /CEC /USB /Ser /IR'), [
			'audio',
			'video',
			'cec',
			'usb',
			'serial',
			'ir',
		])
	})

	it('falls back to the documented order when the header is unreadable', () => {
		assert.deepEqual(parseSignalOrder('    >>Sel    ??? ???'), ['video', 'audio', 'ir', 'serial', 'usb', 'cec'])
	})

	it('does not mistake the trailing Video column for the Vid column', () => {
		const order = parseSignalOrder('    >>Fix    Vid /Aud /IR  /Ser /USB /CEC   MCast Video Mute')
		assert.deepEqual(order, ['video', 'audio', 'ir', 'serial', 'usb', 'cec'])
	})
})
