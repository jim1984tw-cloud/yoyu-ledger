const text=(v,max=200)=>typeof v==='string'&&v.length<=max;
export function invoicePeriod(date){const month=Number(date.slice(5,7));return date.slice(0,4)+'-'+String(Math.ceil(month/2)*2).padStart(2,'0');}
export function validateInvoices(raw=[]){
  if(!Array.isArray(raw)||raw.length>100000)throw Error('發票資料數量不正確');
  const ids=new Set(),numbers=new Set();
  return raw.map(v=>{
    if(!v||!text(v.id,100)||!v.id||ids.has(v.id))throw Error('發票編號重複或不正確');ids.add(v.id);
    if(!/^[A-Z]{2}\d{8}$/.test(v.number))throw Error('發票號碼須為2個英文字母與8位數字');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(v.date)||isNaN(new Date(v.date+'T12:00:00Z'))||new Date(v.date+'T12:00:00Z').toISOString().slice(0,10)!==v.date)throw Error('發票日期不正確');
    const key=invoicePeriod(v.date)+':'+v.number;if(numbers.has(key))throw Error('同一期發票號碼已存在');numbers.add(key);
    if(!Number.isSafeInteger(v.amount)||v.amount<=0||v.amount>1e12)throw Error('發票含稅金額必須大於0，最多兩位小數');
    if(!text(v.seller,200)||!v.seller.trim()||!text(v.carrier||'',100)||!text(v.note||'',500)||!['cloud','paper','other'].includes(v.source)||!['active','void'].includes(v.status)||!['none','pending','submitted','paid'].includes(v.reimbursement))throw Error('發票店家、來源或狀態不正確');
    if(v.sellerTaxId&&!/^\d{8}$/.test(v.sellerTaxId))throw Error('賣方統編須為8位數字');
    if(v.txId!==null&&(!text(v.txId,100)||!v.txId))throw Error('發票關聯交易不正確');
    return {id:v.id,number:v.number,date:v.date,seller:v.seller.trim(),amount:v.amount,source:v.source,carrier:v.carrier||'',sellerTaxId:v.sellerTaxId||'',note:v.note||'',status:v.status,reimbursement:v.reimbursement,txId:v.txId};
  });
}
