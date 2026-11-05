const int=(n,min=0)=>Number.isSafeInteger(n)&&n>=min&&n<=1e12;
const str=(s,max=200)=>typeof s==='string'&&s.length>0&&s.length<=max;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const fail=()=>{throw Error('代墊／分帳資料或關聯交易不正確');};
export function validateSettlements(raw,state){
  if(!raw||raw.version!==1||!int(raw.reserve)||!Array.isArray(raw.claims)||raw.claims.length>2000)fail();
  const accounts=new Map(state.accounts.map(a=>[a.id,a])),txs=new Map(state.transactions.map(t=>[t.id,t])),ids=new Set(),linkedTx=new Set();
  const claims=raw.claims.map(c=>{
    if(!str(c.id,100)||ids.has(c.id)||!str(c.name)||!validDate(c.date)||!int(c.total,1)||!int(c.selfShare)||c.selfShare>c.total||!state.features?.books.some(b=>b.id===c.bookId)||!str(c.category,40)||!accounts.has(c.source)||accounts.get(c.receivable)?.kind!=='receivable'||!Array.isArray(c.parties)||!c.parties.length||c.parties.length>50||!Array.isArray(c.payments)||c.payments.length>5000)fail();ids.add(c.id);
    const partyIds=new Set(),parties=c.parties.map(p=>{if(!str(p.id,100)||partyIds.has(p.id)||!str(p.name,80)||!int(p.amount,1))fail();partyIds.add(p.id);return {id:p.id,name:p.name,amount:p.amount};});
    const lent=parties.reduce((n,p)=>n+p.amount,0);if(lent+c.selfShare!==c.total||lent<=0)fail();
    const outgoing=txs.get(c.outTxId);if(!outgoing||outgoing.type!=='transfer'||outgoing.amount!==lent||outgoing.account!==c.source||outgoing.toAccount!==c.receivable||outgoing.date!==c.date||outgoing.bookId!==c.bookId||outgoing.origin?.kind!=='advanceOut'||outgoing.origin.id!==c.id)fail();linkedTx.add(c.outTxId);
    if(c.selfShare){const own=txs.get(c.selfTxId);if(!own||own.type!=='expense'||own.amount!==c.selfShare||own.account!==c.source||own.date!==c.date||own.bookId!==c.bookId||own.origin?.kind!=='advanceExpense'||own.origin.id!==c.id)fail();linkedTx.add(c.selfTxId);}else if(c.selfTxId!==null)fail();
    const paid=new Map(),paymentIds=new Set();const payments=c.payments.map(p=>{if(!str(p.id,100)||paymentIds.has(p.id)||!partyIds.has(p.partyId)||!int(p.amount,1)||!validDate(p.date)||!accounts.has(p.target))fail();paymentIds.add(p.id);paid.set(p.partyId,(paid.get(p.partyId)||0)+p.amount);const t=txs.get(p.txId);if(!t||t.type!=='transfer'||t.amount!==p.amount||t.account!==c.receivable||t.toAccount!==p.target||t.date!==p.date||t.origin?.kind!=='advanceReturn'||t.origin.id!==c.id||t.origin.relatedId!==p.id)fail();return {id:p.id,partyId:p.partyId,amount:p.amount,date:p.date,target:p.target,txId:p.txId};});
    for(const p of parties)if((paid.get(p.id)||0)>p.amount)fail();for(const p of payments)linkedTx.add(p.txId);
    let originalTx=null;if(c.originalTx){const o=c.originalTx;if(!str(o.id,100)||o.type!=='expense'||o.amount!==c.total||o.account!==c.source||o.date!==c.date||o.origin||!str(o.note)||!str(o.category,40)||!state.features.books.some(b=>b.id===o.bookId)||!Array.isArray(o.tags)||o.tags.length>20||o.tags.some(t=>!str(t,40)))fail();if(c.selfShare&&o.id!==c.selfTxId)fail();if(!c.selfShare&&txs.has(o.id))fail();originalTx={id:o.id,type:'expense',amount:o.amount,date:o.date,note:o.note,category:o.category,account:o.account,toAccount:null,bookId:o.bookId,tags:o.tags};}
    return {id:c.id,name:c.name,date:c.date,total:c.total,selfShare:c.selfShare,bookId:c.bookId,category:c.category,source:c.source,receivable:c.receivable,outTxId:c.outTxId,selfTxId:c.selfTxId,originalTx,parties,payments};
  });
  for(const t of state.transactions)if(t.origin?.kind?.startsWith('advance')&&!linkedTx.has(t.id))fail();
  return {version:1,reserve:raw.reserve,claims};
}
