import {validateBackup,validateTx,uid,cents} from './domain.mjs';
import {validateInvoices,invoicePeriod} from './invoice-schema.mjs';
export {invoicePeriod};
export function saveInvoice(state,input,id=null){
  const next=structuredClone(state);next.invoices??=[];
  const existing=id?next.invoices.find(v=>v.id===id):null;if(id&&!existing)throw Error('找不到發票');
  const row={id:id||uid(),number:String(input.number||'').toUpperCase().replace(/[\s-]/g,''),date:input.date,seller:input.seller,amount:input.amount,source:input.source||'cloud',carrier:input.carrier||'',sellerTaxId:input.sellerTaxId||'',note:input.note||'',status:input.status||'active',reimbursement:input.reimbursement||'none',txId:existing?.txId??null};
  if(existing?.txId&&existing.amount!==row.amount)throw Error('已關聯交易的發票，請先核對並解除關聯，再修改金額');
  next.invoices=validateInvoices([...next.invoices.filter(v=>v.id!==id),row]);return validateBackup(next);
}
export function invoiceExpense(state,id,{account,category,bookId='personal',existingTxId=null}){
  const next=structuredClone(state),invoice=next.invoices?.find(v=>v.id===id);if(!invoice)throw Error('找不到發票');
  if(invoice.status==='void')throw Error('作廢發票不可入帳');
  if(invoice.txId)throw Error('這張發票已有入帳關聯，請先核對原紀錄，避免重複');
  let tx;
  if(existingTxId){tx=next.transactions.find(v=>v.id===existingTxId);if(!tx||tx.type!=='expense'||tx.amount!==invoice.amount)throw Error('請選擇相同金額的既有支出');if(next.invoices.some(v=>v.txId===tx.id))throw Error('這筆交易已關聯另一張發票');}
  else{tx={id:uid(),date:invoice.date,note:invoice.seller,amount:invoice.amount,type:'expense',category,account,toAccount:null,bookId,tags:[]};validateTx(tx,next);next.transactions.unshift(tx);}
  invoice.txId=tx.id;return validateBackup(next);
}
export function unlinkInvoice(state,id){const next=structuredClone(state),v=next.invoices?.find(v=>v.id===id);if(!v)throw Error('找不到發票');v.txId=null;return validateBackup(next);}
export function deleteInvoice(state,id){const next=structuredClone(state);next.invoices=(next.invoices||[]).filter(v=>v.id!==id);return validateBackup(next);}
export const INVOICE_HEADERS=['發票號碼','日期','店家','含稅金額','來源','載具','賣方統編','備註'];
export function parseCSV(text){
  if(text.length>5000000)throw Error('CSV 超過5MB');
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=ch;}else if(ch==='"'){if(field)throw Error('CSV 引號位置不正確');quoted=true;}else if(ch===','){row.push(field);field='';}else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=ch;}
  if(quoted)throw Error('CSV 引號未關閉');row.push(field);if(row.some(v=>v.trim()))rows.push(row);if(rows.length>2001)throw Error('一次最多匯入2000張發票');return rows;
}
export function previewInvoiceCSV(text,state){
  const rows=parseCSV(text.replace(/^\uFEFF/,'')),head=rows.shift();if(!head||INVOICE_HEADERS.slice(0,4).some((v,i)=>head[i]!==v))throw Error('請使用本站發票 CSV 範本，前四欄需為發票號碼、日期、店家、含稅金額');
  const candidates=[],duplicates=[],errors=[],known=new Set((state.invoices||[]).map(v=>invoicePeriod(v.date)+':'+v.number));
  rows.forEach((r,index)=>{try{
    const [number,date,seller,amount,source='cloud',carrier='',sellerTaxId='',note='']=r;
    if(!/^\d+(?:\.\d{1,2})?$/.test(amount?.trim()))throw Error('金額需為數字，最多兩位小數');
    const v=validateInvoices([{id:uid(),number:number.toUpperCase().replace(/[\s-]/g,''),date:date.trim(),seller:seller.trim(),amount:cents(amount),source:({雲端:'cloud',紙本:'paper',其他:'other'})[source]||source||'cloud',carrier:carrier.trim(),sellerTaxId:sellerTaxId.trim(),note:note.trim(),status:'active',reimbursement:'none',txId:null}])[0];
    const key=invoicePeriod(v.date)+':'+v.number;if(known.has(key)){duplicates.push({row:index+2,number:v.number});return;}known.add(key);candidates.push(v);
  }catch(e){errors.push({row:index+2,message:e.message});}});
  return {candidates,duplicates,errors};
}
export function importInvoices(state,candidates){const next=structuredClone(state);next.invoices=validateInvoices([...(next.invoices||[]),...candidates]);return validateBackup(next);}
export function invoiceCSV(state){const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+[INVOICE_HEADERS,...(state.invoices||[]).map(v=>[v.number,v.date,v.seller,(v.amount/100).toFixed(2),v.source,v.carrier,v.sellerTaxId,v.note])].map(r=>r.map(cell).join(',')).join('\r\n');}

export function invoiceMatches(state,id){
  const invoice=state.invoices?.find(v=>v.id===id);if(!invoice||invoice.status!=='active'||invoice.txId)return [];
  const used=new Set((state.invoices||[]).filter(v=>v.txId).map(v=>v.txId));
  const normalize=s=>s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
  return state.transactions.filter(t=>t.type==='expense'&&t.amount===invoice.amount&&!used.has(t.id)).map(t=>{
    const days=Math.abs((new Date(t.date+'T12:00:00Z')-new Date(invoice.date+'T12:00:00Z'))/86400000),a=normalize(invoice.seller),b=normalize(t.note),nameMatch=a.length>=2&&b.length>=2&&(a.includes(b)||b.includes(a));
    return {tx:t,days,nameMatch,score:(days===0?60:Math.max(0,30-days*3))+(nameMatch?30:0),reason:(days===0?'同日':'相差'+days+'天')+'、同額'+(nameMatch?'、店名相似':'')};
  }).filter(v=>v.days<=7).sort((a,b)=>b.score-a.score||a.tx.id.localeCompare(b.tx.id));
}
