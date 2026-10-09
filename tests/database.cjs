// Execute the schema in real embedded PostgreSQL (PGlite).
// Auth fixture emulates auth.uid(); this does NOT verify Supabase JWT/API configuration.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();await db.waitReady;
 await db.exec(`create role anon;create role authenticated;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as
 $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;
 insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
 const schema=fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8');
 await db.exec(schema);await db.exec(schema);
 console.log('PASS schema executes and re-runs in PostgreSQL');
 const claim=async(id,role='authenticated')=>db.exec(`reset role;set role ${role};set request.jwt.claim.sub='${id||''}';`);
 const uid1='00000000-0000-0000-0000-000000000001',uid2='00000000-0000-0000-0000-000000000002';
 const save=async(version,state={notes:{0:'test'}})=>(await db.query('select public.save_tracker_progress($1::jsonb,$2::bigint) as version',[JSON.stringify(state),version])).rows[0].version;
 await claim(uid1);assert.equal(await save(0),1);assert.equal(await save(1),2);assert.equal(await save(1),null);assert.equal(await save(0),null);
 console.log('PASS create/update versions; stale create/update rejected');
 assert.equal((await db.query('select * from public.tracker_progress')).rows.length,1);
 await assert.rejects(()=>db.query("update public.tracker_progress set state='{}'"),/permission denied/);
 await assert.rejects(()=>db.query("insert into public.tracker_progress(user_id) values($1)",[uid2]),/permission denied/);
 console.log('PASS authenticated direct writes denied');
 await claim(uid2);assert.equal((await db.query('select * from public.tracker_progress')).rows.length,0);
 assert.equal(await save(2),null);assert.equal(await save(0,{user_id:uid1,notes:{0:'second user'}}),1);
 assert.equal((await db.query('select * from public.tracker_progress where user_id=$1',[uid1])).rows.length,0);
 const own=(await db.query('select user_id from public.tracker_progress')).rows;assert.deepEqual(own,[{user_id:uid2}]);
 await claim(uid1);assert.equal((await db.query('select state from public.tracker_progress')).rows[0].state.notes[0],'test');
 console.log('PASS RLS isolation and RPC cannot target another user');
 await claim(null,'anon');await assert.rejects(()=>db.query('select * from public.tracker_progress'),/permission denied/);await assert.rejects(()=>save(0),/permission denied/);
 await claim(null);await assert.rejects(()=>save(0),/Authentication required/);
 console.log('PASS anonymous reads/RPC denied; absent identity denied');
 await claim(uid1);await assert.rejects(()=>save(-1),/Invalid expected version/);await assert.rejects(()=>save(2,[]),/State must/);
 console.log('PASS invalid expected version/state denied');
 await db.exec('reset role');assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.tracker_progress'::regclass")).rows[0].relrowsecurity,true);
 console.log('PASS RLS remains enabled');await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
