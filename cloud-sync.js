// Client-side keys are public. Authorization is enforced by PostgreSQL.
const ui = id => document.getElementById(id);
const bridge = window.trackerBridge;
const config = window.TRACKER_CONFIG || {};
let client, account = null, owner = null, version = 0, ready = false;
let dirty = false, busy = false, conflict = false, timer, changes = 0, generation = 0;
let loading = false, retry = 0;
const prefix = 'ai-tracker-pending-v2:';
let tabId, previousTabId, adopted = null;
try {
  previousTabId = sessionStorage.getItem('ai-tracker-tab');
  tabId = crypto.randomUUID(); // duplicated tabs must not share a pending-record key
  sessionStorage.setItem('ai-tracker-tab', tabId);
  owner = sessionStorage.getItem('ai-tracker-owner') || localStorage.getItem('ai-tracker-last-owner');
} catch { tabId = crypto.randomUUID(); }
const recordKey = user => prefix + user + ':' + tabId;
const canonical = value => value && typeof value==='object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
const equal = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function status(message, style = '') {
  ui('syncStatus').textContent = message;
  ui('syncStatus').className = 'sync-status ' + style;
}
function actions() {
  ui('signinForm').classList.toggle('hidden', !!account || !client);
  ui('signoutBtn').classList.toggle('hidden', !account);
  ui('syncNowBtn').classList.toggle('hidden', !account || conflict);
  ui('loadCloudBtn').classList.toggle('hidden', !conflict);
  ui('overwriteCloudBtn').classList.toggle('hidden', !conflict);
  ui('accountLabel').textContent = account ? `Signed in: ${account.email}` : 'Not signed in · progress retained locally';
}
function records(user) {
  const found = [];
  for (let i=0; i<localStorage.length; i++) {
    const k=localStorage.key(i);
    if (!k.startsWith(prefix+user+':')) continue;
    try { const r=JSON.parse(localStorage.getItem(k)); bridge.validateState(r.state); found.push({key:k,...r}); } catch { /* never delete an unreadable recovery copy */ }
  }
  return found.sort((a,b)=>b.at-a.at);
}
function persist() {
  if (!owner) return true;
  try {
    localStorage.setItem(recordKey(owner),JSON.stringify({state:bridge.getState(),version,dirty,at:Date.now()}));
    sessionStorage.setItem('ai-tracker-owner',owner);
    localStorage.setItem('ai-tracker-last-owner',owner);
    return true;
  } catch {
    status('Local storage full/unavailable — export a JSON backup now','error');
    return false;
  }
}
function settleAdopted() {
  if(!adopted || adopted.key===recordKey(owner)) return;
  try {
    const stored=JSON.parse(localStorage.getItem(adopted.key));
    if(stored?.at===adopted.at) localStorage.setItem(adopted.key,JSON.stringify({...stored,dirty:false}));
  } catch { /* recovery record remains available */ }
  adopted=null;
}
function snapshot(state = bridge.getState()) {
  try {localStorage.setItem('ai-tracker-recovery:'+crypto.randomUUID(),JSON.stringify({state,at:Date.now(),owner}));}
  catch { throw Error('Cannot preserve a recovery copy. Export JSON before resolving.'); }
}
function showConflict(message) {
  conflict = true; ready = true; dirty = true; persist();
  status('Sync conflict — choose a version','error');
  ui('cloudHelp').textContent=message+' Export JSON to keep this copy. Load cloud preserves a local recovery copy; Overwrite cloud requires confirmation and another version check.';
  actions();
}
async function getRemote(user = account) {
  const {data,error}=await client.from('tracker_progress').select('state,version').eq('user_id',user.id).maybeSingle();
  if (error) throw error;
  if (data) { bridge.validateState(data.state); if (!Number.isSafeInteger(Number(data.version))) throw Error('Invalid cloud version'); }
  return data;
}
async function initialize(user) {
  const run=++generation;
  clearTimeout(timer); ready=false; conflict=false; busy=false; loading=true;
  account=user; actions();
  if (!user) {loading=false; status(dirty ? 'Signed out — pending edits retained locally' : 'Local only','warn'); return;}
  const previousOwner=owner;
  const local=records(user.id);
  const saved=local.find(r=>r.key===recordKey(user.id)) || local.find(r=>r.key===prefix+user.id+':'+previousTabId) || local.find(r=>r.dirty) || local[0];
  adopted=saved||null;
  if (saved) {
    bridge.setState(saved.state); version=Number(saved.version)||0; dirty=!!saved.dirty;
  } else if (previousOwner) {
    bridge.setState(bridge.fresh()); version=0; dirty=false;
  } else { version=0; dirty=bridge.hasProgress(); }
  owner=user.id; persist();
  status('Loading cloud progress…','warn');
  try {
    const remote=await getRemote(user);
    if (run!==generation) return;
    loading=false;
    if (remote) {
      if (dirty && !equal(bridge.getState(),remote.state)) {
        if (saved && version===Number(remote.version)) {
          ready=true; persist(); schedule(0); // replay pending edits against their known baseline
        } else showConflict('Cloud and local progress differ. Neither has been overwritten.');
      } else {
        bridge.setState(remote.state); version=Number(remote.version); dirty=false; ready=true; settleAdopted(); persist(); status('Saved to cloud');
      }
    } else {
      if (version>0) { showConflict('The previous cloud record is missing. Choose explicitly whether to recreate it.'); return; }
      if (!saved && dirty && !confirm('No cloud record exists. Upload this browser’s local progress? Cancel keeps it locally without uploading.')) {
        ready=false; status('Local progress retained — Sync now to upload','warn'); return;
      }
      version=0; dirty=true; ready=true; persist(); schedule(0);
    }
    actions();
  } catch (err) {
    if (run!==generation) return;
    loading=false; status('Cloud load failed — local edits retained','error');
    ui('cloudHelp').textContent=err.message+'. Sync now will retry loading before saving.';
  }
}
function schedule(delay=800) {
  clearTimeout(timer);
  if (!ready || !account || conflict || !dirty) return;
  timer=setTimeout(push,delay);
}
async function push() {
  if (!ready || !account || !dirty || conflict || busy) return;
  if (!navigator.onLine) {status('Offline — saved locally','warn'); return;}
  busy=true;
  const run=generation, revision=changes, payload=bridge.getState(), initial=version;
  status('Saving…','warn');
  try {
    const {data,error}=await client.rpc('save_tracker_progress',{p_state:payload,p_expected_version:initial});
    if (run!==generation) return;
    if (error) throw error;
    if (data===null) {showConflict('Another browser/device has saved newer progress.'); return;}
    if (!Number.isSafeInteger(Number(data)) || Number(data)<=initial) throw Error('Invalid save response');
    version=Number(data); dirty=revision!==changes; retry=0; if(!dirty)settleAdopted(); persist();
    status(dirty?'More changes queued…':'Saved to cloud');
    ui('cloudHelp').textContent='Tasks, hours, notes and evidence are saved. Export JSON for an independent backup.';
  } catch (err) {
    if (run!==generation) return;
    status('Save failed — local copy retained','error');
    ui('cloudHelp').textContent=err.message+'. Retrying automatically; Sync now also retries. Export JSON for a portable backup.';
    retry=Math.min(retry+1,6);
  } finally {
    if (run===generation) {busy=false; if(dirty&&!conflict) schedule(retry?Math.min(30000,1000*2**retry):800);}
  }
}
window.addEventListener('tracker-changed',()=>{
  dirty=true; changes++; persist();
  status(navigator.onLine?'Saved locally — cloud changes pending':'Offline — saved locally','warn');
  if(account&&!loading) schedule();
});
window.addEventListener('online',()=>{if(account) ready?schedule(0):initialize(account);});
window.addEventListener('offline',()=>status('Offline — progress retained locally','warn'));
window.addEventListener('pagehide',persist);
ui('syncNowBtn').addEventListener('click',()=>{if(!ready) initialize(account); else {dirty=true; changes++; persist(); schedule(0);}});
ui('loadCloudBtn').addEventListener('click',async()=>{
  if(!confirm('Load cloud progress? Your current local progress will be kept as a recovery copy.')) return;
  const run=generation, revision=changes;
  try {
    const remote=await getRemote();
    if(run!==generation || revision!==changes) throw Error('Progress changed while loading. Try again.');
    if(!remote) throw Error('Cloud record is missing. Export JSON, then use Overwrite cloud to recreate.');
    snapshot(); bridge.setState(remote.state); version=Number(remote.version); dirty=false; conflict=false; ready=true; settleAdopted(); persist(); status('Cloud progress loaded'); actions();
  } catch(err) {status(err.message,'error');}
});
ui('overwriteCloudBtn').addEventListener('click',async()=>{
  const run=generation;
  try {
    const remote=await getRemote();
    if(run!==generation) return;
    if(!confirm('Replace cloud progress with THIS local copy? A recovery copy of the cloud version will be kept locally. This can replace changes from another device.')) return;
    if(remote) snapshot(remote.state);
    version=remote?Number(remote.version):0; dirty=true; conflict=false; ready=true; changes++; persist(); actions(); schedule(0);
  } catch(err) {status(err.message,'error');}
});
ui('recoveryBtn').addEventListener('click',()=>{
  const copies=[];
  for(let i=0;i<localStorage.length;i++) { const key=localStorage.key(i); if(key.startsWith(prefix)||key.startsWith('ai-tracker-recovery:')) {try{copies.push({key,...JSON.parse(localStorage.getItem(key))});}catch{}} }
  bridge.download(JSON.stringify({app:'enterprise-ai-recovery',copies},null,2),'AI_Recovery_Copies.json','application/json');
});
ui('signinForm').addEventListener('submit',async e=>{
  e.preventDefault(); const email=ui('emailInput').value.trim();
  if(!client||!email) return;
  status('Sending sign-in email…','warn');
  try {
    const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
    if(error) throw error;
    status('Check your email'); ui('cloudHelp').textContent='Open the email sign-in link to return to this tracker.';
  } catch(err) {status(err.message,'error');}
});
ui('signoutBtn').addEventListener('click',async()=>{
  persist();
  if(dirty&&!confirm('Pending edits are saved locally and will be checked against cloud progress at next sign-in. Sign out?')) return;
  generation++; ready=false; clearTimeout(timer);
  const {error}=await client.auth.signOut({scope:'local'});
  if(error) {status(error.message,'error'); await initialize(account);} else await initialize(null);
});
async function start() {
  const url=config.supabaseUrl?.trim(), key=config.supabasePublishableKey?.trim();
  if(!url||!key||url.includes('YOUR-PROJECT')||key.includes('YOUR_SUPABASE')) {
    status('Setup required','warn'); ui('signinForm').classList.add('hidden'); ui('accountLabel').textContent='Configure config.js with the Supabase URL and public key'; return;
  }
  try {
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw Error('Use the HTTPS Supabase project URL');
    if(!key.startsWith('sb_publishable_')) {
      const claims=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      if(claims.role!=='anon') throw Error('Only publishable/anon keys are allowed');
    }
    // Pin the dependency; dynamic import keeps local tracking working if the CDN fails.
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
    client=createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    client.auth.onAuthStateChange((event,session)=>{
      const user=session?.user||null;
      if(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT'].includes(event) && (event==='INITIAL_SESSION'||(user?.id||null)!==(account?.id||null))) setTimeout(()=>initialize(user),0);
    });
    actions(); status('Checking session…','warn');
  } catch(err) {status('Cloud unavailable — local tracking works','error'); ui('cloudHelp').textContent=err.message; actions();}
}
start();
