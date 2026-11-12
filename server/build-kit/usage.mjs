import { query } from '@anthropic-ai/claude-agent-sdk';
const env = { ...process.env };
if (!process.argv.includes('--chat')) delete env.CLAUDE_CONFIG_DIR;
setTimeout(() => { console.log('usage check timed out'); process.exit(1); }, 60000);
async function* never() { await new Promise(() => {}); }
const q = query({ prompt: never(), options: { env } });
const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
const w = u.rate_limits?.seven_day;
console.log(`${process.argv.includes('--chat') ? 'this chat' : 'personal'} weekly ${w?.utilization ?? '?'}%, 5h ${u.rate_limits?.five_hour?.utilization ?? '?'}%`);
process.exit(0);
