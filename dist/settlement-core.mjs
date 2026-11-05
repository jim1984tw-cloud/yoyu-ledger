import {validateBackup,validateTx,uid,today,fundingAccount,money} from './domain.mjs';
import {upgrade,forecast,splitCents,addDays,balanceAt} from './advanced-core.mjs';
export const settlementData=s=>s.settlements||{version:1,reserve:0,claims:[]};
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min&&n<=1e12;
export function equalShares(total,names){if(!integer(total,1)||!Array.isArray(names)||!names.length||names.length>50||new Set(names.map(s=>s.trim())).size!==names.length||names.some(s=>!s.trim()||s.trim().length>80))throw Error('請填寫不重複的分帳人名');const amounts=splitCents(total,names.length+1);return {selfShare:amounts[0],parties:names.map((name,i)=>({name:name.trim(),amount:amounts[i+1]}))};}
export function createClaim(state,input){
  const s=upgrade(state);s.settlements=structuredClone(settlementData(s));
  const source=s.accounts.find(a=>a.id===input.source);if(!source||source.kind==='receivable')throw Error('請選擇實際代付款帳戶');
  if(!integer(input.total,1)||!integer(input.selfShare)||!Array.isArray(input.parties)||!input.parties.length||input.parties.length>50||input.parties.some(p=>!p.name?.trim()||p.name.length>80||!integer(p.amount,1))||new Set(input.parties.map(p=>p.name.trim())).size!==input.parties.length)throw Error('請確認總金額、自己負擔與每位分帳金額');
  const others=input.parties.reduce((n,p)=>n+p.amount,0);if(others+input.selfShare!==input.total)throw Error('自己負擔＋他人分攤，必須等於實付總額');
  let receivable=s.accounts.find(a=>a.kind==='receivable');if(!receivable){receivable={id:uid(),name:'應收代墊款',kind:'receivable',opening:0};s.accounts.push(receivable);}
  const id=uid(),parties=input.parties.map(p=>({id:uid(),name:p.name.trim(),amount:p.amount}));let selfTxId=null,originalTx=null;
  if(input.existingTxId){
    const old=s.transactions.find(t=>t.id===input.existingTxId);
    if(!old||old.type!=='expense'||old.origin||old.amount!==input.total||old.account!==input.source||old.date!==input.date||(s.invoices||[]).some(v=>v.txId===old.id))throw Error('既有支出需同日期、金額、帳戶，且未連結發票或其他管理項目');
    originalTx=structuredClone(old);s.transactions=s.transactions.filter(t=>t.id!==old.id);selfTxId=input.selfShare?old.id:null;
  }
  if(input.selfShare){selfTxId??=uid();const t={id:selfTxId,type:'expense',amount:input.selfShare,date:input.date,note:input.name+' · 自己負擔',category:input.category,account:input.source,toAccount:null,bookId:input.bookId,tags:['分帳'],origin:{kind:'advanceExpense',id}};validateTx(t,s);s.transactions.unshift(t);}
  const outTxId=uid(),out={id:outTxId,type:'transfer',amount:others,date:input.date,note:input.name+' · 代墊',category:input.category,account:input.source,toAccount:receivable.id,bookId:input.bookId,tags:['代墊'],origin:{kind:'advanceOut',id}};validateTx(out,s);s.transactions.unshift(out);
  s.settlements.claims.unshift({id,name:input.name?.trim(),date:input.date,total:input.total,selfShare:input.selfShare,bookId:input.bookId,category:input.category,source:input.source,receivable:receivable.id,outTxId,selfTxId,originalTx,parties,payments:[]});return validateBackup(s);
}
export function partyRemaining(claim,partyId){const p=claim.parties.find(p=>p.id===partyId);return p?p.amount-claim.payments.filter(p=>p.partyId===partyId).reduce((n,p)=>n+p.amount,0):0;}
export const claimRemaining=claim=>claim.parties.reduce((n,p)=>n+partyRemaining(claim,p.id),0);
export function receiveClaim(state,id,{partyId,amount,date=today(),target}){
  const s=upgrade(state);s.settlements=structuredClone(settlementData(s));const c=s.settlements.claims.find(v=>v.id===id);if(!c||!integer(amount,1)||amount>partyRemaining(c,partyId))throw Error('還款金額超過此人尚欠金額，或項目不存在');
  const a=s.accounts.find(a=>a.id===fundingAccount(s,target));if(!a||!['cash','bank','mobile'].includes(a.kind))throw Error('請選擇現金、銀行或獨立錢包收款');
  const paymentId=uid(),txId=uid(),t={id:txId,type:'transfer',amount,date,note:c.name+' · '+c.parties.find(p=>p.id===partyId).name+' 還款',category:c.category,account:c.receivable,toAccount:target,bookId:c.bookId,tags:['收回代墊'],origin:{kind:'advanceReturn',id,relatedId:paymentId}};validateTx(t,s);s.transactions.unshift(t);c.payments.push({id:paymentId,partyId,amount,date,target,txId});return validateBackup(s);
}
export function reverseClaimPayment(state,id,paymentId){const s=upgrade(state);s.settlements=structuredClone(settlementData(s));const c=s.settlements.claims.find(v=>v.id===id),p=c?.payments.find(p=>p.id===paymentId);if(!p)throw Error('找不到還款紀錄');s.transactions=s.transactions.filter(t=>t.id!==p.txId);c.payments=c.payments.filter(p=>p.id!==paymentId);return validateBackup(s);}
export function cancelClaim(state,id){const s=upgrade(state);s.settlements=structuredClone(settlementData(s));const c=s.settlements.claims.find(v=>v.id===id);if(!c)throw Error('找不到分帳');if(c.payments.length)throw Error('請先撤銷所有還款，再撤銷代墊記帳');s.transactions=s.transactions.filter(t=>t.id!==c.outTxId&&t.id!==c.selfTxId);s.settlements.claims=s.settlements.claims.filter(c=>c.id!==id);if(c.originalTx)s.transactions.unshift(c.originalTx);return validateBackup(s);}
export function setReserve(state,reserve){if(!integer(reserve))throw Error('保留金需為非負金額');const s=upgrade(state);s.settlements=structuredClone(settlementData(s));s.settlements.reserve=reserve;return validateBackup(s);}
export function spendable(state,{days=30,date=today()}={}){
  const flow=forecast(state,days,date),reserve=settlementData(state).reserve;
  const outflows=flow.events.filter(e=>e.delta<0).reduce((n,e)=>n-e.delta,0),available=flow.initial-outflows-reserve;
  const unscheduled=state.accounts.filter(a=>['card','bnpl'].includes(a.kind)&&balanceAt(state,a.id,date)<0).filter(a=>{const debt=-balanceAt(state,a.id,date),scheduled=flow.events.filter(e=>e.type==='transfer'&&fundingAccount(state,e.toAccount)===a.id&&e.delta<0).reduce((n,e)=>n+e.amount,0);return scheduled<debt;});
  return {available,initial:flow.initial,outflows,reserve,days,end:addDays(date,days),unscheduled,uncollected:settlementData(state).claims.reduce((n,c)=>n+claimRemaining(c),0)};
}
