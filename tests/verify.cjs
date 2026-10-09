// Node-only functional harness. Uses fake DOM/storage/cloud; not live browser/RLS validation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const inline=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const sync=fs.readFileSync(path.join(root,'cloud-sync.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
class Store {
 constructor(){this.m=new Map()}
 get length(){return this.m.size} key(i){return [...this.m.keys()][i]}
 getItem(k){return this.m.get(k)??null} setItem(k,v){this.m.set(k,String(v))} removeItem(k){this.m.delete(k)}
}
function copyStore(store){const out=new Store();out.m=new Map(store.m);return out}
function env(local=new Store(),session=new Store()){
 const elements=new Map(),events=new Map(),downloads=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',className:'',style:{},classList:{toggle(){},add(){}},listeners:{},addEventListener(t,f){this.listeners[t]=f},click(){},remove(){}});return elements.get(id)};
 const context={console,JSON,Date,Math,Number,String,Object,Array,Error,RegExp,Boolean,Blob,Event,crypto:require('node:crypto').webcrypto,
 localStorage:local,sessionStorage:session,navigator:{onLine:true},location:{origin:'https://test.invalid',pathname:'/enterprise-ai-learning-tracker/'},
 setTimeout:()=>1,clearTimeout(){},confirm:()=>true,alert:m=>context.lastAlert=m,URL:{createObjectURL:b=>{downloads.push(b);return 'blob:test'},revokeObjectURL(){}},
 document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({click(){},remove(){}}),body:{append(){}}},
 window:{TRACKER_CONFIG:{},addEventListener(t,f){events.set(t,f)},dispatchEvent(e){events.get(e.type)?.(e)},scrollTo(){},print(){}},};
 vm.createContext(context);vm.runInContext(inline,context);
 vm.runInContext(sync+`\nthis.testSync={initialize,push,getRemote,setClient:c=>client=c,flags:()=>({dirty,version,ready,conflict,owner}),persist};`,context);
 context.element=element;context.downloads=downloads;context.bridge=context.window.trackerBridge;
 context.edit=state=>{context.bridge.setState(state);context.window.dispatchEvent(new Event('tracker-changed'))};
 return context;
}
const blank=()=>({taskDone:{},notes:{},hours:{},startDate:'',selected:0});
const cloud={rows:new Map(),fail:false,user:'u1'};
const client={from(){return {select(){return this},eq(k,id){this.id=id;return this},async maybeSingle(){if(cloud.fail)throw Error('network failed');return {data:clone(cloud.rows.get(this.id)||null),error:null}}}},async rpc(name,p){if(cloud.fail)throw Error('network failed');const row=cloud.rows.get(cloud.user);if((row?.version||0)!==p.p_expected_version)return {data:null,error:null};const version=(row?.version||0)+1;cloud.rows.set(cloud.user,{state:clone(p.p_state),version});return {data:version,error:null}},auth:{async signOut(){return {error:null}},async signInWithOtp(){return {error:null}}}};
const u1={id:'u1',email:'one@test.invalid'},u2={id:'u2',email:'two@test.invalid'};
let passed=0;
async function test(name,f){await f();passed++;console.log('PASS '+name)}
(async()=>{
 const e=env();
 await test('12 modules / 60 tasks / 23 HTTPS resources',()=>{
  const content=vm.runInContext('JSON.stringify(W)',e),W=JSON.parse(content);
  assert.equal(W.length,12);assert.equal(W.reduce((n,w)=>n+w.tasks.length,0),60);
  const urls=W.flatMap(w=>w.videos.map(v=>v[2]));assert.equal(urls.length,23);assert(urls.every(u=>new URL(u).protocol==='https:'));
  assert.equal((e.element('weeksList').innerHTML.match(/class="week-btn"/g)||[]).length,12);
  assert.equal(e.element('doneCount').textContent,'0 / 60');
 });
 await test('Backup validation rejects arrays, malformed fields and negative hours',()=>{
  for(const s of [[],{notes:null},{notes:{0:123}},{taskDone:{'99-1':true}},{hours:{0:-1}},{hours:[]}])assert.throws(()=>e.bridge.validateState(s));
 });
 let state=blank();state.taskDone['1-1']=true;state.notes[0]='Study <script>alert(1)</script>';state.notes.e0='https://example.com/evidence';state.hours[0]=6.25;
 await test('Local task, notes, hours and evidence persist; rendering escapes notes',()=>{
  e.edit(state);assert.deepEqual(JSON.parse(e.localStorage.getItem('enterprise-ai-architect-tracker-v1')),state);
  assert(e.element('mainContent').innerHTML.includes('&lt;script&gt;'));assert.equal(e.element('hoursCount').textContent,'6.3 h');
 });
 await test('JSON export/import roundtrip; invalid import leaves state intact',async()=>{
  e.element('exportBtn').listeners.click();const backup=JSON.parse(await e.downloads.at(-1).text());assert.deepEqual(backup.state,state);
  await e.element('importFile').listeners.change({target:{files:[{size:100,text:async()=>JSON.stringify(backup)}],value:'x'}});
  assert.deepEqual(clone(e.bridge.getState()),state);
  await e.element('importFile').listeners.change({target:{files:[{size:100,text:async()=>JSON.stringify({app:'enterprise-ai-architect',version:1,state:{hours:[]}})}],value:'x'}});
  assert.match(e.lastAlert,/Unable to import/);assert.deepEqual(clone(e.bridge.getState()),state);
 });
 e.testSync.setClient(client);
 await test('First authenticated save uploads full local state',async()=>{await e.testSync.initialize(u1);await e.testSync.push();assert.deepEqual(cloud.rows.get('u1').state,state);assert.equal(e.testSync.flags().version,1)});
 await test('Failed save retains pending edits through refresh and retries against baseline',async()=>{
  state.notes[0]='Offline note';e.edit(state);cloud.fail=true;await e.testSync.push();assert(e.testSync.flags().dirty);
  const refreshed=env(e.localStorage,copyStore(e.sessionStorage));refreshed.testSync.setClient(client);cloud.fail=false;
  await refreshed.testSync.initialize(u1);assert.equal(refreshed.bridge.getState().notes[0],'Offline note');await refreshed.testSync.push();assert.equal(cloud.rows.get('u1').state.notes[0],'Offline note');
 });
 await test('Second session loads saved cloud progress',async()=>{const second=env();second.testSync.setClient(client);await second.testSync.initialize(u1);assert.equal(second.bridge.getState().notes[0],'Offline note')});
 await test('Stale browser save reports conflict and cannot replace newer remote',async()=>{
  state.notes[0]='Stale edit';e.edit(state);await e.testSync.push();assert(e.testSync.flags().conflict);assert.equal(cloud.rows.get('u1').state.notes[0],'Offline note');
 });
 await test('Load-cloud conflict resolution preserves recovery copy',async()=>{
  await e.element('loadCloudBtn').listeners.click();assert(!e.testSync.flags().conflict);assert.equal(e.bridge.getState().notes[0],'Offline note');assert([...e.localStorage.m.keys()].some(k=>k.startsWith('ai-tracker-recovery:')));
 });
 await test('Offline refresh with newer remote keeps local progress and shows conflict',async()=>{
  state.notes[0]='Keep this pending note';e.edit(state);const row=cloud.rows.get('u1');row.version++;row.state.notes[0]='New device edit';
  const refreshed=env(e.localStorage,copyStore(e.sessionStorage));refreshed.testSync.setClient(client);await refreshed.testSync.initialize(u1);
  assert(refreshed.testSync.flags().conflict);assert.equal(refreshed.bridge.getState().notes[0],'Keep this pending note');
 });
 await test('Logout/re-login retains unsynced edits',async()=>{
  await e.testSync.initialize(null);assert(e.testSync.flags().dirty);await e.testSync.initialize(u1);assert.equal(e.bridge.getState().notes[0],'Keep this pending note');assert(e.testSync.flags().conflict);
 });
 await test('Different account never automatically inherits previous account state',async()=>{
  cloud.user='u2';await e.testSync.initialize(u2);assert.deepEqual(clone(e.bridge.getState()),blank());await e.testSync.push();assert.deepEqual(cloud.rows.get('u2').state,blank());assert.equal(cloud.rows.get('u1').state.notes[0],'New device edit');
 });
 await test('Account change during in-flight write ignores obsolete response',async()=>{
  let resolve;const delayed={...client,rpc:()=>new Promise(r=>resolve=r)};e.testSync.setClient(delayed);e.edit({...blank(),notes:{0:'old session'}});const p=e.testSync.push();await e.testSync.initialize(null);resolve({data:999,error:null});await p;assert.notEqual(e.testSync.flags().version,999);
 });
 console.log(`${passed} functional checks passed (simulated DOM/cloud; no live deployment).`);
})().catch(err=>{console.error(err);process.exitCode=1});
