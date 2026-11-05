import {validateBackup,fresh} from './domain.mjs';
import {upgrade} from './advanced-core.mjs';

export const cleanState=raw=>upgrade(validateBackup(raw));
export async function fingerprint(raw){
  const value=JSON.stringify(cleanState(raw));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export class SnapshotSync {
  constructor({transport,getState,applyState,getMeta,setMeta,archive,onStatus=()=>{}}){Object.assign(this,{transport,getState,applyState,getMeta,setMeta,archive,onStatus});this.busy=false;this.conflict=null;this.stopped=false;}
  stop(){this.stopped=true;}
  status(kind,message){if(!this.stopped)this.onStatus({kind,message});}
  async record(row,hash){if(this.stopped)return;this.setMeta({revision:row.revision,hash,lastSync:Date.now()});}
  async run(){
    if(this.stopped||this.busy)return;
    this.busy=true;this.status('syncing','正在同步…');
    try{
      const local=cleanState(this.getState()),localHash=await fingerprint(local),remote=await this.transport.read();
      if(this.stopped)return;
      // A local edit while fetching must be reevaluated; never apply an outdated decision.
      if(await fingerprint(this.getState())!==localHash){this.status('pending','新紀錄已保存在此裝置，等待下一次同步');return;}
      const meta=this.getMeta();
      if(!remote){
        if(meta?.revision){this.conflict={remote:null};this.status('conflict','雲端帳本已不存在，請確認要重新上傳的版本');return;}
        await this.push(local,localHash,0);return;
      }
      if(!Number.isSafeInteger(remote.revision)||remote.revision<1)throw Error('雲端版本資料不正確');
      remote.payload=cleanState(remote.payload);
      const remoteHash=await fingerprint(remote.payload);
      if(localHash===remoteHash){await this.record(remote,localHash);this.conflict=null;this.status('synced','已同步');return;}
      const pristine=!meta&&localHash===await fingerprint(upgrade(fresh()));
      if((meta?.hash===localHash)||pristine){
        const currentHash=await fingerprint(this.getState());
        if(this.stopped||currentHash!==localHash){this.status('pending','本機有新修改，等待同步');return;}
        if(!this.applyState(remote.payload))throw Error('無法儲存雲端帳目到此裝置');
        await this.record(remote,remoteHash);this.conflict=null;this.status('synced','已取得雲端最新帳目');return;
      }
      if(meta?.revision===remote.revision&&meta?.hash===remoteHash){await this.push(local,localHash,remote.revision);return;}
      this.conflict={remote};this.status('conflict','兩個裝置都有修改，請選擇要保留的版本；未覆寫任何資料');
    }catch(e){if(!this.stopped)this.status('error','同步未完成：'+e.message+'。帳目仍保存在此裝置');}
    finally{this.busy=false;}
  }
  async push(payload,hash,revision){
    if(this.stopped)return;
    const row=await this.transport.write(payload,revision);
    if(this.stopped)return;
    if(!row){this.conflict={remote:await this.transport.read()};this.status('conflict','其他裝置剛更新帳目，已停止覆寫，請處理版本差異');return;}
    await this.record(row,hash);this.conflict=null;
    this.status(await fingerprint(this.getState())===hash?'synced':'pending',await fingerprint(this.getState())===hash?'已同步':'新修改已保存在此裝置，等待下一次同步');
  }
  async resolve(choice){
    if(this.busy||this.stopped||!this.conflict)return;
    this.busy=true;
    try{
      const local=cleanState(this.getState()),localHash=await fingerprint(local),remote=await this.transport.read();
      if(this.stopped)return;
      if(remote)remote.payload=cleanState(remote.payload);
      // Preserve the exact observed version; reconfirm if the cloud changed after the choice was shown.
      if((remote?.revision??0)!==(this.conflict.remote?.revision??0)){
        this.conflict={remote};this.status('conflict','雲端又有新修改，請重新確認版本');return;
      }
      if(await fingerprint(this.getState())!==localHash){this.status('conflict','本機又有新修改，請重新確認版本');return;}
      if(choice==='cloud'){
        if(!remote)throw Error('雲端帳本不存在，請選擇本機版本');
        await this.archive(local,'採用雲端前的本機帳目');
        const currentHash=await fingerprint(this.getState());
        if(this.stopped||currentHash!==localHash)throw Error('本機有新修改，請重試');
        if(!this.applyState(remote.payload))throw Error('此裝置無法存檔');
        await this.record(remote,await fingerprint(remote.payload));this.conflict=null;this.status('synced','已採用雲端版本；原本機版本已下載備份');
      }else if(choice==='local'){
        if(remote)await this.archive(remote.payload,'採用本機前的雲端帳目');
        await this.push(local,localHash,remote?.revision??0);
      }else throw Error('請選擇本機或雲端版本');
    }catch(e){this.status('error','版本處理未完成：'+e.message);}
    finally{this.busy=false;}
  }
}
