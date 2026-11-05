// Device-local persistence. Ciphertext and a non-exportable CryptoKey stay in IndexedDB.
// This avoids plaintext storage/export; it does not protect against malicious same-origin scripts.
export function createKeyVault({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto}={}){
  let opening;
  function db(){if(!indexedDB||!crypto?.subtle)throw Error('此瀏覽器無法記住金鑰，請使用 HTTPS 或改為僅本次使用');if(!opening)opening=new Promise((resolve,reject)=>{const r=indexedDB.open('yoyu-key-vault-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('entries',{keyPath:'scope'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>{opening=null;reject(Error('無法開啟此裝置的金鑰儲存空間'));};});return opening;}
  async function op(mode,action){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('entries',mode),r=action(tx.objectStore('entries'));let value;r.onsuccess=()=>value=r.result;tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(Error('裝置金鑰儲存未完成'));});}
  async function remember(scope,apiKey,settings={}){
    if(typeof apiKey!=='string'||apiKey.trim().length<15||apiKey.length>512)throw Error('請輸入有效的 AI Key');
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(scope)},key,new TextEncoder().encode(apiKey.trim()));
    await op('readwrite',store=>store.put({scope,key,iv,cipher,settings:{model:typeof settings.model==='string'?settings.model:'auto',autoSwitch:settings.autoSwitch!==false},savedAt:Date.now()}));
  }
  async function load(scope){const row=await op('readonly',store=>store.get(scope));if(!row)return null;try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:new TextEncoder().encode(scope)},row.key,row.cipher);return {apiKey:new TextDecoder().decode(plain),settings:row.settings,savedAt:row.savedAt};}catch{throw Error('此裝置保存的金鑰無法解密，請清除後重新輸入');}}
  async function forget(scope){await op('readwrite',store=>store.delete(scope));}
  return {remember,load,forget};
}
