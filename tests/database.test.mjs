import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('SQL migration enforces account isolation, anonymous denial and stale-revision protection',async()=>{
  const db=new PGlite(),alice='11111111-1111-1111-1111-111111111111',bob='22222222-2222-2222-2222-222222222222';
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${alice}'),('${bob}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
    const sql=await readFile(new URL('../supabase/migrations/202611050001_ledger_sync.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
    const payload=JSON.stringify({version:1,accounts:[],transactions:[]});
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false)`);
    let result=await db.query('select * from public.save_ledger_snapshot($1,$2::jsonb)',[0,payload]);assert.equal(Number(result.rows[0].revision),1);
    result=await db.query('select * from public.save_ledger_snapshot($1,$2::jsonb)',[0,payload]);assert.equal(result.rows.length,0);
    result=await db.query('select * from public.save_ledger_snapshot($1,$2::jsonb)',[1,payload]);assert.equal(Number(result.rows[0].revision),2);
    result=await db.query('select * from public.save_ledger_snapshot($1,$2::jsonb)',[1,payload]);assert.equal(result.rows.length,0);
    await db.exec(`select set_config('request.jwt.claim.sub','${bob}',false)`);
    assert.equal((await db.query('select * from public.ledger_snapshots')).rows.length,0);
    await assert.rejects(()=>db.query('insert into public.ledger_snapshots(user_id,revision,payload) values ($1,1,$2::jsonb)',[alice,payload]),/row-level security/);
    assert.equal((await db.query('update public.ledger_snapshots set revision=99 where user_id=$1 returning *',[alice])).rows.length,0);
    await db.query('select * from public.save_ledger_snapshot($1,$2::jsonb)',[0,payload]);assert.equal((await db.query('select * from public.ledger_snapshots')).rows[0].user_id,bob);
    await db.exec('reset role; set role anon');await assert.rejects(()=>db.query('select * from public.ledger_snapshots'),/permission denied/);await assert.rejects(()=>db.query('select * from public.save_ledger_snapshot(0,$1::jsonb)',[payload]),/permission denied/);
  }finally{await db.close();}
});
