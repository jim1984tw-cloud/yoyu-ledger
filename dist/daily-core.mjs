import {defaultDaily,normalizeMerchant} from './daily-schema.mjs';
import {validateBackup,uid,today,validDate} from './domain.mjs';
export const dailyPrefs=state=>state.features?.daily||defaultDaily();
export function updateDaily(state,patch){if(!state.features)throw Error('請先開啟新版帳本');return validateBackup({...state,features:{...state.features,daily:{...dailyPrefs(state),...patch}}});}
export function saveTemplate(state,input,id=null){const rows=dailyPrefs(state).templates;if(id&&!rows.some(t=>t.id===id))throw Error('找不到範本');const row={...input,id:id||uid()};return updateDaily(state,{templates:id?rows.map(t=>t.id===id?row:t):[...rows,row]});}
export function templateDraft(state,id,date=today()){
  const t=dailyPrefs(state).templates.find(t=>t.id===id);if(!t)throw Error('找不到範本');if(!validDate(date))throw Error('日期不正確');
  return {id:uid(),type:t.type,note:t.note,amount:t.amount,account:t.account,category:t.category,bookId:t.bookId,date,toAccount:null,tags:[]};
}
export function lastDraft(state,bookId,date=today()){
  const linked=new Set((state.invoices||[]).map(v=>v.txId).filter(Boolean));
  const t=state.transactions.filter(t=>!t.origin&&!linked.has(t.id)&&['expense','income'].includes(t.type)&&(bookId==='all'||(t.bookId||'personal')===bookId)&&state.accounts.some(a=>a.id===t.account&&a.kind!=='receivable')).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(!t)throw Error('這個帳本還沒有可複製的一般收支');if(!validDate(date))throw Error('日期不正確');
  return {id:uid(),type:t.type,note:t.note,amount:t.amount,account:t.account,category:t.category,bookId:t.bookId||'personal',date,toAccount:null,tags:[...(t.tags||[])]};
}
export function saveMerchantRule(state,input,id=null){
  const rows=dailyPrefs(state).rules;if(id&&!rows.some(r=>r.id===id))throw Error('找不到分類規則');
  const same=rows.find(r=>r.bookId===input.bookId&&r.type===input.type&&normalizeMerchant(r.pattern)===normalizeMerchant(input.pattern));
  const target=id||same?.id||uid(),row={...input,id:target,enabled:input.enabled!==false};
  return updateDaily(state,{rules:rows.some(r=>r.id===target)?rows.map(r=>r.id===target?row:r):[...rows,row]});
}
export function merchantMatch(state,{note,type,bookId='personal'}){
  if(!['expense','income','refund'].includes(type))return null;const name=normalizeMerchant(note);if(!name)return null;
  return dailyPrefs(state).rules.filter(r=>r.enabled&&r.type===type&&r.bookId===bookId&&name.includes(normalizeMerchant(r.pattern))).sort((a,b)=>{
    const x=normalizeMerchant(a.pattern),y=normalizeMerchant(b.pattern);return Number(name===y)-Number(name===x)||y.length-x.length||a.id.localeCompare(b.id);
  })[0]||null;
}
export const applyMerchantRules=(state,rows)=>rows.map(t=>{const match=merchantMatch(state,t);return match?{...t,category:match.category,dailyRule:match.pattern}:{...t};});
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export async function ledgerFingerprint(raw,crypto=globalThis.crypto){const state=validateBackup(raw);if(!crypto?.subtle)throw Error('備份比對需要 HTTPS 安全連線');const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(state)));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function backupHealth(meta,{now=Date.now(),hasData=true}={}){
  const days=[1,3,7,14,30].includes(meta?.remindDays)?meta.remindDays:7;
  const latest=meta?.latest;const valid=Number.isSafeInteger(latest?.at)&&latest.at>0&&latest.at<=now&&/^[a-f0-9]{64}$/.test(latest.fingerprint||'');
  const age=valid?Math.floor((now-latest.at)/86400000):null;const due=hasData&&(!valid||age>=days);
  return {days,age,due,remind:due&&!(Number.isFinite(meta?.snoozeUntil)&&meta.snoozeUntil>now),label:!hasData?'尚無交易紀錄':!valid?'尚未記錄完整備份':age>=days?`已有 ${age} 天未記錄完整備份`:`${age===0?'今天':age+' 天前'}已產生或驗證完整備份`};
}
