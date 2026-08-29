import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	/** Status poll interval in ms; 0 disables polling. */
	pollInterval: number
	/** Poll the full system status every Nth decoder poll. */
	systemPollRatio: number
	/** Log every line exchanged with the device. */
	verbose: boolean
}

export const CONFIG_DEFAULTS: ModuleConfig = {
	host: '',
	port: 23,
	pollInterval: 2000,
	systemPollRatio: 5,
	verbose: false,
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Chazy Control',
			width: 12,
			value:
				'Controls a Turtle AV Chazy Control / Control Pro via its telnet command interface (default port 23). ' +
				'Make sure Telnet is enabled on the unit — check the Telnet column of <code>GET STATUS</code>, or the network page of the web GUI.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Device IP / hostname',
			width: 8,
			regex: Regex.HOSTNAME,
			default: CONFIG_DEFAULTS.host,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Telnet port',
			width: 4,
			min: 1,
			max: 65535,
			default: CONFIG_DEFAULTS.port,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Poll interval (ms)',
			tooltip: 'How often to refresh routing and device state. Set to 0 to disable polling.',
			width: 4,
			min: 0,
			max: 60000,
			step: 250,
			default: CONFIG_DEFAULTS.pollInterval,
		},
		{
			type: 'number',
			id: 'systemPollRatio',
			label: 'Full status every N polls',
			tooltip: 'Encoder and controller details change rarely, so they are refreshed less often than decoder routing.',
			width: 4,
			min: 1,
			max: 60,
			default: CONFIG_DEFAULTS.systemPollRatio,
		},
		{
			type: 'checkbox',
			id: 'verbose',
			label: 'Log all device traffic',
			tooltip: 'Writes every line sent and received to the debug log. Useful when adapting to a new firmware.',
			width: 12,
			default: CONFIG_DEFAULTS.verbose,
		},
	]
}
