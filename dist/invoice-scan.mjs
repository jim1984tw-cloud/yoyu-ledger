import {validDate,cents} from './domain.mjs';
export function parseInvoiceQR(raw){
  if(typeof raw!=='string'||raw.length>12000)throw Error('QR Code 內容不正確');
  raw=raw.trim();if(raw.startsWith('**'))throw Error('這是右側 QR Code，請改讀左側 QR Code');
  if(raw.length<77||!/^([A-Z]{2}\d{8})(\d{7})(\d{4})([0-9a-fA-F]{16})(\d{16})/.test(raw))throw Error('不是支援的台灣電子發票左側 QR Code');
  const roc=Number(raw.slice(10,13)),date=String(roc+1911).padStart(4,'0')+'-'+raw.slice(13,15)+'-'+raw.slice(15,17);
  if(!roc||!validDate(date))throw Error('QR Code 的發票日期不正確');
  const amount=parseInt(raw.slice(29,37),16)*100;if(!Number.isSafeInteger(amount)||amount<=0||amount>1e12)throw Error('QR Code 沒有可讀取的台幣總額，請手動核對；境外電商格式暫不支援');
  return {number:raw.slice(0,10),date,amount,seller:'',sellerTaxId:raw.slice(45,53),source:'paper',note:'由 QR Code 讀取，尚未向財政部查驗',warning:'請補上店家名稱，並核對日期、含稅總額。QR Code 讀取不代表官方驗證。'};
}
export async function scanInvoicePixels(data,width,height,{decoder}={}){
  if(!decoder){const mod=await import('./vendor/jsqr.mjs');decoder=mod.default;}
  const copy=new Uint8ClampedArray(data);let last;
  for(let i=0;i<4;i++){
    const code=decoder(copy,width,height,{inversionAttempts:'attemptBoth'});if(!code)break;
    try{return parseInvoiceQR(code.data);}catch(e){last=e;}
    // A photo may include both codes. Mask the decoded one and look for the left code.
    const pts=Object.values(code.location),xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
    const x0=Math.max(0,Math.floor(Math.min(...xs))-8),x1=Math.min(width,Math.ceil(Math.max(...xs))+8),y0=Math.max(0,Math.floor(Math.min(...ys))-8),y1=Math.min(height,Math.ceil(Math.max(...ys))+8);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const p=(y*width+x)*4;copy[p]=copy[p+1]=copy[p+2]=copy[p+3]=255;}
  }
  throw last||Error('未讀到發票 QR Code，請拍清楚左側方碼、裁切放大，或改用 AI／手動輸入');
}
export async function readInvoicePhoto(file){
  if(!file||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('請選擇10MB以內的 JPG、PNG 或 WebP 圖片');
  let bitmap;try{bitmap=await createImageBitmap(file);const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);return {pixels,image:canvas.toDataURL('image/jpeg',0.85)};}finally{bitmap?.close();}
}
