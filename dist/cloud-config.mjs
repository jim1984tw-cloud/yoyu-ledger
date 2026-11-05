export function validateCloudConfig(raw){
  const url=new URL(raw?.url||'');
  if(url.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(url.hostname)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Error('請使用 Supabase 專案的 https://…supabase.co 網址');
  const key=String(raw?.publishableKey||'').trim();
  if(key.startsWith('sb_secret_'))throw Error('不可使用 Supabase Secret Key，請改用 Publishable Key');
  if(!/^sb_publishable_[a-zA-Z0-9_-]{10,}$/.test(key)){
    let payload;try{const part=key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');payload=JSON.parse(atob(part))}catch{}
    if(payload?.role!=='anon')throw Error('請使用 Publishable Key 或舊版 anon key；不可使用 service_role');
  }
  const provider=raw.provider||'github';
  if(!['github','google'].includes(provider))throw Error('登入方式僅支援 GitHub 或 Google');
  return {url:url.origin,publishableKey:key,provider};
}
export function accountStorageKey(project,userId){
  if(!userId)return 'yoyu-ledger-data-v1';
  if(!/^[a-f0-9-]{36}$/.test(userId))throw Error('登入帳號編號不正確');
  return 'yoyu-ledger-account:'+new URL(project).hostname+':'+userId;
}
