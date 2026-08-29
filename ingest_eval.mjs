import postgres from 'postgres';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL="?([^"\n]+)"?/m)[1];
const sql = postgres(url, { max:1, prepare:false });
const rows = await sql`SELECT workspace_id, session_id, honcho_message_id, peer_id, text, timezone, created_at FROM "CortexOutbox" ORDER BY created_at ASC`;
console.log(`replaying ${rows.length} real delivered turns`);
let ok=0, fail=0, extracted=0;
const summary=[];
for (const r of rows) {
  try {
    const res = await fetch('http://127.0.0.1:8010/v1/events/turn', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        workspace_id: r.workspace_id, session_id: r.session_id,
        honcho_message_id: r.honcho_message_id, peer_id: r.peer_id,
        text: r.text, now: r.created_at.toISOString(), timezone: r.timezone || 'Europe/London',
      }),
    });
    const j = await res.json();
    if (res.ok) { ok++; const n=j.candidates_extracted ?? 0; extracted+=n;
      if (n>0) summary.push(`${r.created_at.toISOString().slice(5,16)} +${n} ${r.text.slice(0,60).replace(/\n/g,' ')}`);
    } else { fail++; console.log('FAIL', res.status, r.honcho_message_id, JSON.stringify(j).slice(0,150)); }
  } catch(e){ fail++; console.log('ERR', String(e).slice(0,120)); }
}
console.log(`ok=${ok} fail=${fail} candidates_extracted=${extracted}`);
console.log(summary.join('\n'));
await sql.end();
