import {SnapshotSync,cleanState} from './sync-core.mjs';
import {validateCloudConfig} from './cloud-config.mjs';

export function createSupabaseTransport(client,config,userId,fetcher=fetch){
  async function request(path,options={}){
    const {data,error}=await client.auth.getSession();
    if(error||data?.session?.user?.id!==userId||!data.session.access_token)throw Error('登入已失效，請重新登入');
    const response=await fetcher(config.url+'/rest/v1/'+path,{...options,headers:{apikey:config.publishableKey,Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});
    if(!response.ok){
      if(response.status===401)throw Error('登入已失效，請重新登入');
      if(response.status===404)throw Error('雲端資料表尚未建立，請完成部署設定');
      if(response.status===403)throw Error('雲端存取權限不足，請檢查帳號與資料權限');
      throw Error('雲端連線錯誤（'+response.status+'）');
    }
    return response.json();
  }
  return {
    async read(){const rows=await request('ledger_snapshots?select=revision,payload,updated_at&user_id=eq.'+encodeURIComponent(userId)+'&limit=1');if(!Array.isArray(rows))throw Error('雲端回應格式不正確');return rows[0]||null;},
    async write(payload,revision){const rows=await request('rpc/save_ledger_snapshot',{method:'POST',body:JSON.stringify({expected_revision:revision,new_payload:cleanState(payload)})});if(!Array.isArray(rows))throw Error('雲端回應格式不正確');return rows[0]||null;}
  };
}

export function createCloudUI(c){
  const {E,I,toast}=c,$=s=>document.querySelector(s);
  let config=null,client=null,user=null,engine=null,status={kind:'local',message:'訪客帳本 · 儲存在此裝置'},timer=null,interval=null,starting=false;
  let activeIdentity='',switchQueue=Promise.resolve(),authSubscription=null;
  function metaKey(){return 'yoyu-sync-meta:'+new URL(config.url).hostname+':'+user.id;}
  function getMeta(){try{return JSON.parse(localStorage.getItem(metaKey())||'null')}catch{return null}}
  function setStatus(next){status=next;updateStatus();}
  function label(){return c.isDemo()?'示範帳本':status.kind==='synced'?'雲端已同步':status.kind==='conflict'?'同步需要確認':status.kind==='syncing'?'同步中':user?'帳號帳本 · 本機已存':'訪客帳本 · 本機儲存';}
  function updateStatus(){
    const el=$('#cloud-status');if(el)el.textContent=status.message;
    const pill=$('#cloud-pill');if(pill)pill.textContent=navigator.onLine?label():'離線 · 本機儲存';
    const profile=$('#cloud-profile');if(profile)profile.textContent=user?'帳號帳本 · 支援離線':'訪客帳本 · 此裝置';
    const conflict=$('#cloud-conflict');if(conflict)conflict.hidden=status.kind!=='conflict';
    const buttons=document.querySelectorAll('[data-cloud-resolve],#cloud-sync');buttons.forEach(b=>b.disabled=!!engine?.busy||c.isDemo()||!navigator.onLine||(b.dataset.cloudResolve==='cloud'&&!engine?.conflict?.remote));
  }
  function schedule(){clearTimeout(timer);if(user&&engine&&!c.isDemo())timer=setTimeout(()=>sync(),1200);}
  async function sync(){if(!engine||c.isDemo())return;if(!navigator.onLine){setStatus({kind:'pending',message:'離線中，帳目已保存在此裝置，恢復連線後再同步'});return;}await engine.run();updateStatus();}
  async function acceptSession(session){
    const nextUser=session?.user||null,identity=nextUser?.id||'';
    if(activeIdentity===identity)return;
    clearTimeout(timer);engine?.stop();engine=null;
    user=nextUser;activeIdentity=identity;
    await c.switchAccount(nextUser?.id||null,config?.url);
    if(user){
      const key=metaKey(),id=user.id;
      engine=new SnapshotSync({transport:createSupabaseTransport(client,config,id),getState:c.getRealState,applyState:c.applyCloudState,getMeta:()=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}},setMeta:meta=>localStorage.setItem(key,JSON.stringify(meta)),archive:async(value,reason)=>{c.download(JSON.stringify(value,null,2),'日常有餘_'+reason+'_'+Date.now()+'.json','application/json');},onStatus:setStatus});
      setStatus({kind:'pending',message:'已登入，正在確認雲端帳目'});
    }else setStatus({kind:'local',message:'已登出，使用此裝置的訪客帳本'});
    c.render();if(user)await sync();
  }
  function queueSession(session){switchQueue=switchQueue.then(()=>acceptSession(session)).catch(e=>{setStatus({kind:'error',message:'帳本切換未完成：'+e.message});toast(status.message);});return switchQueue;}
  async function connect(){
    const {createClient}=await import('./vendor/supabase.mjs');
    client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true,storageKey:'yoyu-auth:'+new URL(config.url).hostname+':'+new URL('./',location.href).pathname}});
    const {data}=client.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>queueSession(session),0);});authSubscription=data.subscription;
    const result=await client.auth.getSession();if(result.error)throw result.error;
    await queueSession(result.data.session);
    const current=new URL(location.href);if(current.searchParams.has('code')){current.searchParams.delete('code');history.replaceState({},'',current);}
    c.render();
  }
  async function init(){
    if(starting)return;starting=true;
    try{
      let stored=null;try{stored=JSON.parse(localStorage.getItem('yoyu-cloud-config')||'null')}catch{}
      let baked=null;try{const r=await fetch('./cloud-config.json',{cache:'no-cache'});if(r.ok)baked=await r.json();}catch{}
      const raw=baked||stored;if(raw){config=validateCloudConfig(raw);await connect();}
      interval=setInterval(()=>{if(document.visibilityState==='visible')sync();},60000);
      window.addEventListener('online',()=>sync());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')sync();});
      window.addEventListener('storage',e=>{if(e.key===c.getStorageKey()){schedule();updateStatus();}});
    }catch(e){setStatus({kind:'error',message:'雲端尚未連接：'+e.message+'。仍可離線記帳'});c.render();}
    finally{starting=false;updateStatus();}
  }
  function panel(){
    return `<div class="card cloud-card" style="margin-bottom:24px"><div class="card-heading"><h2>${I('cloud')} 雲端同步</h2><span class="pill">${user?'已登入':'可選用'}</span></div><div class="notice" id="cloud-status" role="status" aria-live="polite">${E(status.message)}</div>${config?user?`<p class="help">登入帳號：${E(user.email||user.id)}。帳目同步至你的 Supabase 專案，保留此裝置的離線副本；這不是端對端加密儲存，仍建議定期下載加密備份。</p><div class="row" style="flex-wrap:wrap"><button class="primary" id="cloud-sync">${I('refresh')}立即同步</button><button class="secondary" id="cloud-import-guest">匯入此裝置的訪客帳本</button><button class="secondary" id="cloud-logout">登出</button></div><p class="help">登出會切回訪客帳本。此帳號的離線副本仍留在此瀏覽器；共用裝置請在備份後清除網站資料。</p>`:`<p class="help">登入後，可在手機與電腦同步同一份帳本。登入過程由 ${config.provider==='google'?'Google':'GitHub'} 處理，本站不收集登入密碼。</p><button class="primary" id="cloud-login">使用 ${config.provider==='google'?'Google':'GitHub'} 登入</button><p class="help">訪客紀錄會保留在本機；登入後可自行選擇匯入，不會自動上傳。</p>`:`<p class="help">目前可離線記帳，雲端尚未完成設定。完成連接後，其他裝置登入同一帳號即可同步。</p><details><summary>連接自己的 Supabase 專案</summary><form id="cloud-config-form" style="margin-top:16px"><label class="field">專案網址<input type="url" id="cloud-url" placeholder="https://…supabase.co" required></label><label class="field">Publishable Key<input id="cloud-public-key" autocomplete="off" placeholder="sb_publishable_…" required></label><label class="field">已啟用的登入方式<select id="cloud-provider"><option value="github">GitHub</option><option value="google">Google</option></select></label><p class="help">請先完成資料表與登入回呼設定。僅能使用公開連線金鑰，不可填 Secret 或 service_role。</p><button class="secondary">儲存並連接</button></form></details>`}<div class="notice cloud-conflict" id="cloud-conflict" ${status.kind==='conflict'?'':'hidden'} style="margin-top:16px"><strong>兩邊都有版本，請先確認</strong><p class="help">${engine?.conflict?.remote?'雲端版本 '+E(engine.conflict.remote.revision)+' · '+E(engine.conflict.remote.updated_at||''):''}。選擇後會先下載被取代的版本。帳目、分期與預算會整份保留，避免合併後重複入帳。請保存下載的備份。</p><div class="row" style="flex-wrap:wrap"><button class="secondary" data-cloud-resolve="cloud" ${engine?.conflict?.remote?'':'disabled'}>採用雲端，備份本機</button><button class="secondary" data-cloud-resolve="local">採用本機，備份雲端</button></div></div><p class="help">離線變更會在恢復連線、頁面開啟時再同步。兩邊同時修改時會停止覆寫，請到此處確認。免費方案低活動可能暫停；暫停時仍可本機記帳。</p></div>`;
  }
  function bind(){
    $('#cloud-config-form')?.addEventListener('submit',async event=>{event.preventDefault();try{const value=validateCloudConfig({url:$('#cloud-url').value,publishableKey:$('#cloud-public-key').value,provider:$('#cloud-provider').value});localStorage.setItem('yoyu-cloud-config',JSON.stringify(value));config=value;await connect();toast('已儲存雲端設定');}catch(e){toast(e.message);}});
    $('#cloud-login')?.addEventListener('click',async()=>{try{if(!navigator.onLine)throw Error('登入需要網路');const redirect=new URL('./',location.href).href;const {error}=await client.auth.signInWithOAuth({provider:config.provider,options:{redirectTo:redirect}});if(error)throw error;}catch(e){toast('登入未完成：'+e.message);}});
    $('#cloud-logout')?.addEventListener('click',async()=>{clearTimeout(timer);engine?.stop();try{const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;await queueSession(null);}catch(e){toast('登出未完成：'+e.message);if(user){activeIdentity='';await queueSession({user});}}});
    $('#cloud-sync')?.addEventListener('click',()=>sync());
    $('#cloud-import-guest')?.addEventListener('click',async()=>{if(c.isDemo())return;try{const raw=localStorage.getItem('yoyu-ledger-data-v1');if(!raw)throw Error('此裝置沒有訪客帳本，可使用「還原備份」匯入舊網站帳目');const value=cleanState(JSON.parse(raw));if(!confirm('以訪客帳本取代目前帳號在此裝置的帳目？會先下載目前帳目備份，之後再檢查雲端版本。'))return;c.download(JSON.stringify(c.getRealState(),null,2),'日常有餘_匯入訪客前_'+Date.now()+'.json','application/json');if(c.commit(value)){c.render();toast('訪客帳本已匯入此帳號，等待同步確認');}}catch(e){toast(e.message);}});
    document.querySelectorAll('[data-cloud-resolve]').forEach(b=>b.addEventListener('click',async()=>{if(c.isDemo()||!engine)return;if(!confirm('確定'+(b.dataset.cloudResolve==='cloud'?'採用雲端帳目':'採用此裝置帳目')+'？被取代的版本會下載備份，請保管好。'))return;await engine.resolve(b.dataset.cloudResolve);c.render();}));updateStatus();
  }
  function onChange(){if(c.isDemo())return;setStatus({kind:status.kind==='conflict'?'conflict':'pending',message:user?'已儲存在此裝置，等待同步':'訪客帳本已儲存在此裝置'});schedule();}
  return {init,panel,bind,onChange,label,hasUser:()=>!!user};
}
