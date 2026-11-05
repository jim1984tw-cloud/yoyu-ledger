import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validateQuoteFile,price4} from '../dist/investment-core.mjs';
import {validStockCode,stockDate} from '../dist/investment-schema.mjs';
const SOURCES=[{market:'TWSE',url:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',code:'Code',name:'Name',close:'ClosingPrice'},{market:'TPEX',url:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',code:'SecuritiesCompanyCode',name:'CompanyName',close:'Close'}];
export function quoteDate(raw){const s=String(raw||'').trim().replaceAll('/','').replaceAll('-','');let date;if(/^\d{7}$/.test(s))date=String(Number(s.slice(0,3))+1911)+'-'+s.slice(3,5)+'-'+s.slice(5);else if(/^\d{8}$/.test(s))date=s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6);return stockDate(date)?date:null;}
export function parseOfficialQuotes(market,rows){const source=SOURCES.find(s=>s.market===market);if(!source||!Array.isArray(rows))throw Error('官方行情格式不正確');const quotes=[];for(const row of rows){const code=row[source.code],date=quoteDate(row.Date);if(!validStockCode(code)||!date||typeof row[source.name]!=='string')continue;try{quotes.push({market,code,name:row[source.name].slice(0,80),date,price4:price4(String(row[source.close]).replaceAll(',',''))});}catch{}}
  if(quotes.length<10)throw Error('有效收盤資料不足，保留舊價格');return quotes;
}
export async function refreshStockQuotes({path='dist/stock-quotes.json',fetcher=fetch,now=new Date()}={}){
  let previous={quotes:[]};try{previous=validateQuoteFile(JSON.parse(await readFile(path,'utf8')))}catch{try{const r=await fetcher('https://jim1984tw-cloud.github.io/yoyu-ledger/stock-quotes.json',{signal:AbortSignal.timeout(8000)});if(r.ok)previous=validateQuoteFile(await r.json());}catch{}}
  const results=await Promise.all(SOURCES.map(async source=>{try{const r=await fetcher(source.url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('HTTP '+r.status);const quotes=parseOfficialQuotes(source.market,await r.json());return {quotes,status:'已更新',market:source.market,date:quotes.map(q=>q.date).sort().at(-1)};}catch{return {market:source.market,quotes:previous.quotes.filter(q=>q.market===source.market),status:'來源暫時不可用；保留舊價格或改用手動',date:null};}}));
  const out=validateQuoteFile({version:1,generatedDate:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),quotes:results.flatMap(r=>r.quotes),sources:results.map(({quotes,...s})=>s)});
  await writeFile(path,JSON.stringify(out)+'\n');for(const r of results)console.log(r.market+'：'+r.status+'；'+r.quotes.length+' 筆（報價日期保留在每筆資料）');return out;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await refreshStockQuotes();
