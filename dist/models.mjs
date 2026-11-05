// Free-tier input/output verified against Google's pricing on 2026-11-05.
// Discovery describes generation methods, not pricing or remaining quota.
export const POLICY_DATE='2026-11-05';
export const FREE_MODELS=['gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-2.5-flash-lite','gemini-3.8-flash','gemini-2.5-flash'];
const API='https://generativelanguage.googleapis.com/v1beta/';
export class AIError extends Error{constructor(message,{status=0,code='',retryable=false,cooldown=0}={}){super(message);this.name='AIError';Object.assign(this,{status,code,retryable,cooldown})}}
export async function responseError(res,now=Date.now()){
 let body={};try{body=await res.json()}catch{}const error=body.error||{};const detail=JSON.stringify(error);const message=error.message||'';const status=res.status;
 if(/API_KEY_INVALID|API_KEY_EXPIRED|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED/.test(detail)||status===401)return new AIError('金鑰無效、過期或受限，請檢查設定。',{status,code:'AUTH'});
 if(status===403)return new AIError('此金鑰或專案沒有使用權限，請確認地區、API 與金鑰限制。',{status,code:'AUTH'});
 if(status===402)return new AIError('專案帳務或餘額限制，已停止呼叫；請確認使用未啟用付費帳單的免費專案。',{status,code:'BILLING'});
 if(status===429){const retryInfo=(error.details||[]).find(d=>d.retryDelay);const retryHeader=res.headers?.get?.('retry-after');let delay=retryInfo?parseFloat(retryInfo.retryDelay)*1000:0;if(retryHeader){delay=Math.max(delay,/^\d+(\.\d+)?$/.test(retryHeader)?Number(retryHeader)*1000:Date.parse(retryHeader)-now)}const daily=/PerDay|per.day|daily|RPD|日配額/i.test(detail);return new AIError(daily?'本日額度已達上限':'額度不足或請求太頻繁',{status,code:daily?'DAILY_QUOTA':'RATE_LIMIT',retryable:true,cooldown:daily?Math.max(delay,nextPacificMidnight(now)-now):Math.max(60000,Number.isFinite(delay)?delay:0)})}
 if(status===404)return new AIError('模型目前不提供此功能或已下架',{status,code:'UNAVAILABLE',retryable:true,cooldown:30*60000});
 if(status===400&&/not supported|does not support|unsupported|not enabled/i.test(message)&&/model|image|schema|response|json/i.test(message))return new AIError('模型不支援此次辨識所需格式',{status,code:'UNSUPPORTED',retryable:true,cooldown:30*60000});
 if(status===408||status>=500)return new AIError('模型暫時忙碌或無法回應',{status,code:'TRANSIENT',retryable:true,cooldown:60000});
 return new AIError('AI 請求未被接受，請檢查輸入、圖片或專案設定。',{status,code:'REQUEST'});
}
export function nextPacificMidnight(now){const f=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});const today=f.format(new Date(now));let hi=now+27*3600000,lo=now;for(let i=0;i<32;i++){const mid=(hi+lo)/2;if(f.format(new Date(mid))===today)lo=mid;else hi=mid}return Math.ceil(hi)+1000}
export async function fetchJSON(url,{apiKey,fetcher=fetch,method='GET',body,timeoutMs=20000,signal}={}){
 const ctrl=new AbortController(),abort=()=>ctrl.abort(signal?.reason);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
 try{const res=await fetcher(url,{method,headers:{'x-goog-api-key':apiKey,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:ctrl.signal});if(!res.ok)throw await responseError(res);return await res.json()}
 catch(e){if(e instanceof AIError)throw e;if(ctrl.signal.aborted){if(signal?.aborted)throw new AIError('此次辨識已取消。',{code:'CANCELLED'});throw new AIError('模型回應逾時',{code:'TIMEOUT',retryable:true,cooldown:60000})}throw new AIError('無法連接 Google，請確認網路與金鑰限制。',{code:'NETWORK'})}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
export function eligibleModels(models){const seen=new Set(),result=[];for(const m of models){if(!m?.supportedGenerationMethods?.includes('generateContent')||!/^models\/[a-zA-Z0-9._-]+$/.test(m.name||''))continue;const id=m.name.slice(7);const bucket=FREE_MODELS.find(base=>id===base||(m.baseModelId===base&&new RegExp('^'+base+'-\\d{3}$').test(id)));if(!bucket)continue;const candidate={id,bucket,name:m.displayName||id,inputTokenLimit:m.inputTokenLimit||0,outputTokenLimit:m.outputTokenLimit||0,image:true};const previous=result.findIndex(x=>x.bucket===bucket);if(previous!==-1){if(id===bucket)result[previous]=candidate;continue}seen.add(bucket);result.push(candidate)}return result.sort((a,b)=>FREE_MODELS.indexOf(a.bucket)-FREE_MODELS.indexOf(b.bucket))}
export async function listModels({apiKey,fetcher=fetch,signal}={}){const deadline=Date.now()+20000;let token='',all=[],pages=0;const tokens=new Set();do{if(++pages>20||tokens.has(token))throw new AIError('模型清單分頁異常，請稍後再讀取。',{code:'DISCOVERY'});tokens.add(token);const url=API+'models?pageSize=1000'+(token?'&pageToken='+encodeURIComponent(token):'');if(Date.now()>=deadline)throw new AIError('讀取模型清單逾時，請稍後重試。',{code:'DISCOVERY'});const data=await fetchJSON(url,{apiKey,fetcher,signal,timeoutMs:Math.max(1,deadline-Date.now())});if(!Array.isArray(data.models))throw new AIError('Google 模型清單格式不完整。',{code:'DISCOVERY'});all.push(...data.models);token=data.nextPageToken||''}while(token);return {models:eligibleModels(all),total:all.length}}
export function createModelRouter({apiKey,fetcher=fetch,now=Date.now}={}){
 let models=[],total=0,loadedAt=null,discovery=null;const health=new Map();const status=id=>{const h=health.get(id);return h&&h.until>now()?h:null};
 async function refresh({force=false,signal}={}){if(discovery)return discovery;if(!force&&loadedAt!==null&&now()-loadedAt<15*60000)return snapshot();discovery=(async()=>{const result=await listModels({apiKey,fetcher,signal});models=result.models;total=result.total;loadedAt=now();return snapshot()})().finally(()=>{discovery=null});return discovery}
 function snapshot(){return {models:models.map(m=>({...m,health:status(m.bucket),lastSuccess:health.get(m.bucket)?.lastSuccess||null})),total,loadedAt}}
 async function run(text,image,{state,preferred='auto',autoSwitch=true,onStatus=()=>{},signal,task='transactions'}={}){
  const deadline=now()+75000;await refresh({signal});if(!models.length)throw new AIError('清單中沒有已確認免費且適合記帳的模型。請更新清單或使用免金鑰文字解析。',{code:'NO_MODELS'});
  let pool=[...models];if(preferred!=='auto'){const chosen=pool.find(m=>m.id===preferred);if(!chosen)throw new AIError('原選模型已不在支援清單，請改選自動或重新整理。',{code:'NO_MODELS'});pool=[chosen,...pool.filter(m=>m!==chosen)];if(!autoSwitch)pool=[chosen]}
  pool=pool.filter(m=>!image||m.image).filter(m=>!status(m.bucket));if(!pool.length)throw new AIError('候選模型目前都在冷卻中，請稍後重試；可先使用免金鑰解析或手動記帳。',{code:'COOLDOWN'});
  const attempts=[];for(const m of pool.slice(0,5)){if(signal?.aborted)throw new AIError('此次辨識已取消。',{code:'CANCELLED'});const remaining=deadline-now();if(remaining<=0)break;onStatus({model:m.id,message:(attempts.length?'自動切換至 ':'正在使用 ')+m.name,attempts:[...attempts]});try{const extractor=task==='stockImage'?(await import('./investment-ai.mjs')).geminiStockExtract:task==='stockCoach'?(await import('./investment-ai.mjs')).geminiStockCoach:task==='invoice'?(await import('./invoice-ai.mjs')).geminiInvoiceExtract:(await import('./ai.mjs')).geminiExtract;const output=await extractor(text,image,{state,model:m.id,apiKey,fetcher,signal,timeoutMs:Math.min(25000,remaining)});health.set(m.bucket,{until:0,lastSuccess:now()});return {...(task==='stockImage'?{stockRows:output}:task==='stockCoach'?{stockCoach:output}:task==='invoice'?{invoice:output}:{transactions:output}),model:m.id,attempts}}
  catch(e){if(!(e instanceof AIError)||!e.retryable)throw e;health.set(m.bucket,{until:now()+e.cooldown,reason:e.message,code:e.code,lastSuccess:health.get(m.bucket)?.lastSuccess||null});attempts.push({model:m.id,reason:e.message});onStatus({model:m.id,message:m.name+'：'+e.message+'，暫時跳過。',attempts:[...attempts]});if(!autoSwitch)break}}
  throw new AIError('本次候選模型皆無法完成辨識，已停止重試。稍後可再試，或改用免金鑰文字解析／手動記帳。',{code:'EXHAUSTED'});
 }
 return {refresh,snapshot,run};
}
