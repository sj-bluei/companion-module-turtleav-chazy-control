/**
 * Runs the Chazy Control simulator so a real Companion instance can be pointed
 * at it while no hardware is available.
 *
 *   yarn simulator            # listens on 127.0.0.1:2323
 *   yarn simulator 5000       # listens on 127.0.0.1:5000
 */

import { ChazySimulator } from './simulator.js'

const port = Number.parseInt(process.argv[2] ?? '2323', 10)
const simulator = new ChazySimulator({ banner: true })

const bound = await simulator.listen(port)
console.log(`Chazy Control simulator listening on 127.0.0.1:${bound}`)
console.log('Configure the module with that address and port, then press Ctrl+C to stop.')

const shutdown = () => {
	console.log('\nStopping simulator')
	// Closing the server releases the last handle, so the process exits on its own.
	void simulator.close()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
