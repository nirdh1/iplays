// Test-only stand-in for Supabase's REST API (a small PostgREST subset) over a
// local Postgres, so the Club OS screens run against the real schema, RPCs and
// RLS in Playwright. Never used outside local tests.
const { Pool } = require('pg');
const pool = new Pool({ host: '/var/tmp/pg', port: 5544, user: 'postgres', database: process.env.PGDB || 'stg' });
const q = (s) => '"' + s.replace(/"/g, '""') + '"';
let fkCache = null;
async function fks(c) {
  if (fkCache) return fkCache;
  const r = await c.query(`select cl.relname src, a.attname src_col, cf.relname dst, af.attname dst_col
    from pg_constraint k join pg_class cl on cl.oid=k.conrelid join pg_class cf on cf.oid=k.confrelid
    join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
    join pg_attribute af on af.attrelid=k.confrelid and af.attnum=k.confkey[1]
    where k.contype='f' and cl.relnamespace='public'::regnamespace and cf.relnamespace='public'::regnamespace and array_length(k.conkey,1)=1`);
  fkCache = r.rows; return fkCache;
}
function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
async function selectList(c, table, alias, sel) {
  const parts = splitTop(sel || '*'); const cols = [];
  for (const p of parts) {
    const m = p.match(/^([a-z_0-9]+)(?:!inner)?\s*\((.*)\)$/s);
    if (!m) { cols.push(p === '*' ? `${alias}.*` : `${alias}.${q(p)}`); continue; }
    const rel = m[1], inner = m[2], f = await fks(c), sub = 'e' + Math.random().toString(36).slice(2, 7);
    const fwd = f.find((x) => x.src === table && x.dst === rel);
    const rev = f.find((x) => x.src === rel && x.dst === table);
    const innerCols = await selectList(c, rel, sub, inner);
    if (fwd) cols.push(`(select row_to_json(z) from (select ${innerCols} from public.${q(rel)} ${sub} where ${sub}.${q(fwd.dst_col)} = ${alias}.${q(fwd.src_col)}) z) as ${q(rel)}`);
    else if (rev) cols.push(`coalesce((select json_agg(z) from (select ${innerCols} from public.${q(rel)} ${sub} where ${sub}.${q(rev.src_col)} = ${alias}.${q(rev.dst_col)}) z), '[]') as ${q(rel)}`);
    else throw new Error('no fk ' + table + '->' + rel);
  }
  return cols.join(', ');
}
function where(params, alias, vals) {
  const w = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = v.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|is|in|like|ilike)\.(.*)$/s); if (!m) continue;
    const [, not, op, raw] = m; const col = `${alias}.${q(k)}`; let e;
    if (op === 'is') e = `${col} is ${raw === 'null' ? 'null' : raw === 'true' ? 'true' : 'false'}`;
    else if (op === 'in') { const items = raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')); vals.push(items); e = `${col}::text = any($${vals.length})`; }
    else { vals.push(raw.replace(/\*/g, '%')); const o = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }[op]; e = `${col}::text ${o} $${vals.length}::text`;
      if (['gt', 'gte', 'lt', 'lte'].includes(op)) e = `${col} ${o} ($${vals.length}::text)::${'' + 'unknown'}`.replace('::unknown', ''), e = `${col} ${o} cast($${vals.length} as ${'text'})`; }
    w.push(not ? `not (${e})` : e);
  }
  return w;
}
async function colTypes(c, table) { const r = await c.query(`select attname, format_type(atttypid, atttypmod) t from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped`, ['public.' + table]); return Object.fromEntries(r.rows.map((x) => [x.attname, x.t])); }
async function handle(method, url, headers, body, uid) {
  const u = new URL(url); const path = u.pathname.replace(/^\/rest\/v1\//, '');
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [uid, JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    let result;
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4); const args = body ? JSON.parse(body) : {};
      const keys = Object.keys(args);
      const meta = await c.query(`select proretset, format_type(prorettype, null) rt from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1`, [fn]);
      const call = `public.${q(fn)}(${keys.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')})`;
      const at = await c.query(`select n, t from pg_proc p, unnest(p.proargnames, p.proargtypes::regtype[]::text[]) as x(n, t) where proname = $1 and pronamespace = 'public'::regnamespace`, [fn]);
      const typeOf = Object.fromEntries(at.rows.map((r) => [r.n, r.t]));
      // like PostgREST: a JSON array goes to a SQL array parameter as an array, to json/jsonb as JSON
      const vals = keys.map((k) => (Array.isArray(args[k]) && /\[\]$/.test(typeOf[k] || '') ? args[k] : args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      if (meta.rows[0]?.proretset) result = (await c.query(`select * from ${call}`, vals)).rows;
      else result = (await c.query(`select ${call} as v`, vals)).rows[0]?.v ?? null;
    } else {
      const table = path; const p = [...u.searchParams.entries()]; const vals = [];
      const w = where(p, 't', vals); const wsql = w.length ? ' where ' + w.join(' and ') : '';
      const sel = u.searchParams.get('select');
      // typed comparisons for range filters: recast
      if (method === 'GET' || method === 'HEAD') {
        const types = await colTypes(c, table);
        const fixed = wsql.replace(/t\."([a-z_0-9]+)" (>=|<=|>|<) cast\(\$(\d+) as text\)/g, (m0, col, op, n) => `t."${col}" ${op} cast($${n} as ${types[col] || 'text'})`);
        let sql = `select ${await selectList(c, table, 't', sel)} from public.${q(table)} t${fixed}`;
        const order = u.searchParams.get('order');
        if (order) sql += ' order by ' + order.split(',').map((o) => { const [col, dir, nulls] = o.split('.'); return `t.${q(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`; }).join(', ');
        if (u.searchParams.get('limit')) sql += ' limit ' + parseInt(u.searchParams.get('limit'));
        result = (await c.query(sql, vals)).rows;
      } else if (method === 'POST') {
        const rows = [].concat(JSON.parse(body)); const out = [];
        for (const r of rows) { const ks = Object.keys(r); const v = ks.map((k) => (r[k] !== null && typeof r[k] === 'object' && !Array.isArray(r[k]) ? JSON.stringify(r[k]) : r[k]));
          const res = await c.query(`insert into public.${q(table)} (${ks.map(q).join(',')}) values (${ks.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, v); out.push(...res.rows); }
        result = out;
      } else if (method === 'PATCH') {
        const r = JSON.parse(body); const ks = Object.keys(r); const off = vals.length;
        const sets = ks.map((k, i) => `${q(k)} = $${off + i + 1}`).join(', ');
        const types = await colTypes(c, table);
        const fixed = wsql.replace(/t\."([a-z_0-9]+)" (>=|<=|>|<) cast\(\$(\d+) as text\)/g, (m0, col, op, n) => `t."${col}" ${op} cast($${n} as ${types[col] || 'text'})`);
        result = (await c.query(`update public.${q(table)} t set ${sets}${fixed} returning t.*`, [...vals, ...ks.map((k) => r[k])])).rows;
      } else if (method === 'DELETE') {
        const types = await colTypes(c, table);
        const fixed = wsql.replace(/t\."([a-z_0-9]+)" (>=|<=|>|<) cast\(\$(\d+) as text\)/g, (m0, col, op, n) => `t."${col}" ${op} cast($${n} as ${types[col] || 'text'})`);
        result = (await c.query(`delete from public.${q(table)} t${fixed} returning t.*`, vals)).rows;
      }
      if (sel && method !== 'GET' && Array.isArray(result)) { const keep = splitTop(sel).filter((x) => !x.includes('(')); if (!keep.includes('*')) result = result.map((r) => Object.fromEntries(keep.map((k) => [k, r[k]]))); }
    }
    await c.query('commit');
    const single = (headers['accept'] || '').includes('vnd.pgrst.object');
    if (single) { if (!Array.isArray(result)) return { status: 200, body: result }; if (result.length === 0 && method === 'GET') return { status: 406, body: { code: 'PGRST116', message: 'no rows' } }; return { status: 200, body: result[0] ?? null }; }
    return { status: method === 'POST' && !path.startsWith('rpc/') ? 201 : 200, body: result };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { status: 400, body: { code: e.code || 'XX000', message: e.message, details: e.detail || null, hint: e.hint || null } };
  } finally { c.release(); }
}
module.exports = { handle, pool };
