export const stockKey=(market,code)=>market+':'+code;
export const stockDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
export const stockInt=(x,min=0,max=1e12)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
export const validStockCode=x=>typeof x==='string'&&/^[0-9A-Z]{4,6}$/.test(x)&&/^\d/.test(x);
export const defaultInvestments=()=>({version:1,positions:[],events:[],prices:[],profile:{risk:'conservative',monthlyBudget:0,horizon:5,concentration:35}});
export function stockGross(shares,price4){if(!stockInt(shares,1,1e9)||!stockInt(price4,1,1e10))throw Error('股數或單價不正確');const n=Number((BigInt(shares)*BigInt(price4)+50n)/100n);if(!stockInt(n))throw Error('成交總額超過允許範圍');return n;}
export function replayPosition(position,events){
  let shares=position.openingShares,cost=shares?position.openingCost:0,realizedKnown=0,unknownSales=0,dividends=0,fees=0;
  const rows=events.filter(e=>e.positionId===position.id).map((e,index)=>({...e,index})).sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order||a.index-b.index);
  for(const e of rows){if(e.date<position.openingDate&&e.type!=='dividend')throw Error('交易日期早於持股起點，請先核對持股或日期');
    if(e.type==='buy'){const gross=stockGross(e.shares,e.price4);shares+=e.shares;cost=cost===null?null:cost+gross+e.fee;fees+=e.fee;}
    if(e.type==='sell'){if(e.shares>shares)throw Error('賣出股數超過當時持股，請先補買進或持股起點');const allocated=cost===null?null:e.shares===shares?cost:Number((BigInt(cost)*BigInt(e.shares)+BigInt(Math.floor(shares/2)))/BigInt(shares));const net=stockGross(e.shares,e.price4)-e.fee-e.tax;if(allocated===null)unknownSales++;else realizedKnown+=net-allocated;shares-=e.shares;cost=shares===0?0:cost===null?null:cost-allocated;fees+=e.fee+e.tax;}
    if(e.type==='dividend')dividends+=e.amount;
    if(e.type==='split'){if(!shares)throw Error('沒有持股時無法調整分割股數');shares=e.sharesAfter;}
    if(!stockInt(shares,0,1e9)||cost!==null&&!stockInt(cost)||!Number.isSafeInteger(realizedKnown)||!stockInt(dividends)||!stockInt(fees))throw Error('投資彙總超過允許範圍');
  }
  return {shares,cost,average:shares&&cost!==null?cost/100/shares:null,realized:unknownSales?null:realizedKnown,realizedKnown,unknownSales,dividends,fees};
}
export function validateInvestments(raw){
  const fail=message=>{throw Error('投資資料不正確：'+message);},text=(x,n)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
  if(!raw||raw.version!==1||!Array.isArray(raw.positions)||raw.positions.length>1000||!Array.isArray(raw.events)||raw.events.length>50000||!Array.isArray(raw.prices)||raw.prices.length>1000)fail('版本或筆數');
  const ids=new Set(),keys=new Set(),eventIds=new Set(),quoteKeys=new Set();
  const positions=raw.positions.map(p=>{if(!p||!text(p.id,100)||ids.has(p.id)||!['TWSE','TPEX'].includes(p.market)||!validStockCode(p.code)||!text(p.name,80)||!['stock','etf','unknown'].includes(p.kind)||!stockDate(p.openingDate)||!stockInt(p.openingShares,0,1e9)||(p.openingCost!==null&&!stockInt(p.openingCost))||(!p.openingShares&&p.openingCost))fail('持股欄位');const key=stockKey(p.market,p.code);if(keys.has(key))fail('同市場股票重複，持股截圖不可直接相加');ids.add(p.id);keys.add(key);return {id:p.id,market:p.market,code:p.code,name:p.name.trim(),kind:p.kind,openingDate:p.openingDate,openingShares:p.openingShares,openingCost:p.openingShares?p.openingCost:0};});
  const events=raw.events.map((e,i)=>{if(!e||!text(e.id,100)||eventIds.has(e.id)||!ids.has(e.positionId)||!stockDate(e.date)||!['buy','sell','dividend','split'].includes(e.type)||!stockInt(e.order??i,0,1e9))fail('交易關聯');eventIds.add(e.id);const row={id:e.id,positionId:e.positionId,date:e.date,type:e.type,order:e.order??i};if(['buy','sell'].includes(e.type)){if(!stockInt(e.shares,1,1e9)||!stockInt(e.price4,1,1e10)||!stockInt(e.fee)||!stockInt(e.tax??0))fail('成交金額');Object.assign(row,{shares:e.shares,price4:e.price4,fee:e.fee,tax:e.type==='sell'?e.tax||0:0});stockGross(row.shares,row.price4);}if(e.type==='dividend'){if(!stockInt(e.amount,1))fail('實收股利');row.amount=e.amount;}if(e.type==='split'){if(!stockInt(e.sharesAfter,1,1e9))fail('調整後股數');row.sharesAfter=e.sharesAfter;}return row;});
  const prices=raw.prices.map(q=>{const key=stockKey(q?.market,q?.code);if(!keys.has(key)||quoteKeys.has(key)||!stockDate(q.date)||!stockInt(q.price4,1,1e10))fail('手動價格');quoteKeys.add(key);return {market:q.market,code:q.code,date:q.date,price4:q.price4,source:'manual'};});
  const p=raw.profile;if(!p||!['conservative','balanced','growth'].includes(p.risk)||!stockInt(p.monthlyBudget)||!stockInt(p.horizon,1,30)||!stockInt(p.concentration,5,100))fail('投資目標');
  for(const position of positions)replayPosition(position,events);
  return {version:1,positions,events,prices,profile:{risk:p.risk,monthlyBudget:p.monthlyBudget,horizon:p.horizon,concentration:p.concentration}};
}
