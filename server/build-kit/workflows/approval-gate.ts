import { gateOf } from '../../src/session/builds.js';

const POLL_MS = 15_000;
const WAIT_MS = 9 * 60_000;

const slug = process.argv[2] ?? '';
const print = (v: object) => console.log(JSON.stringify(v));

try {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const gate = await gateOf(process.cwd(), slug);
    if (!gate) {
      print({ decision: 'error' });
      break;
    }
    if (gate.decision !== 'wait' || Date.now() >= until) {
      print(gate);
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
} catch {
  print({ decision: 'error' });
}
process.exit(0);
