export const SHORTCUTS={stocks:'股票投資',scan:'掃發票',bills:'待繳帳單',available:'可花金額',ai:'智慧記帳',ledger:'我的帳本',plans:'分期管理',settlements:'代墊分帳',accounts:'帳戶管理',reports:'收支報表'};
export const defaultDaily=()=>({compact:true,shortcuts:['scan','bills','available','ai'],templates:[],rules:[]});
export const normalizeMerchant=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g,'').trim();
export function validateDaily(raw,{accounts,books,categories}){
  const fail=()=>{throw Error('日常工具資料不正確，請檢查範本、分類規則與捷徑');};
  const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  const validBook=id=>books.some(b=>b.id===id);
  if(!raw||typeof raw.compact!=='boolean'||!Array.isArray(raw.shortcuts)||raw.shortcuts.length<1||raw.shortcuts.length>4||new Set(raw.shortcuts).size!==raw.shortcuts.length||raw.shortcuts.some(x=>!Object.hasOwn(SHORTCUTS,x)))fail();
  if(!Array.isArray(raw.templates)||raw.templates.length>40||!Array.isArray(raw.rules)||raw.rules.length>200)fail();
  const templateIds=new Set(),ruleIds=new Set(),patterns=new Set();
  const templates=raw.templates.map(t=>{
    if(!t||!text(t.id,100)||templateIds.has(t.id)||!text(t.name,40)||!text(t.note,200)||!['expense','income'].includes(t.type)||!Number.isSafeInteger(t.amount)||t.amount<0||t.amount>1e12||!accounts.some(a=>a.id===t.account&&a.kind!=='receivable')||!validBook(t.bookId)||!categories.includes(t.category))fail();
    templateIds.add(t.id);return {id:t.id,name:t.name.trim(),note:t.note.trim(),type:t.type,amount:t.amount,account:t.account,bookId:t.bookId,category:t.category};
  });
  const rules=raw.rules.map(r=>{
    if(!r||!text(r.id,100)||ruleIds.has(r.id)||!text(r.pattern,60)||normalizeMerchant(r.pattern).length<2||!['expense','income','refund'].includes(r.type)||!validBook(r.bookId)||!categories.includes(r.category)||typeof r.enabled!=='boolean')fail();
    const key=JSON.stringify([r.bookId,r.type,normalizeMerchant(r.pattern)]);if(patterns.has(key))fail();patterns.add(key);ruleIds.add(r.id);
    return {id:r.id,pattern:r.pattern.trim(),type:r.type,bookId:r.bookId,category:r.category,enabled:r.enabled};
  });
  return {compact:raw.compact,shortcuts:[...raw.shortcuts],templates,rules};
}
