import {balance,fundingAccount} from './domain.mjs';
export function creditStatus(state,id){
  const account=state.accounts.find(a=>a.id===fundingAccount(state,id));if(!account||!['card','bnpl'].includes(account.kind))return null;
  const net=balance(state,account.id),used=Math.max(0,-net),overpaid=Math.max(0,net);
  const limit=Number.isSafeInteger(account.creditLimit)?account.creditLimit:null;
  return {accountId:account.id,limit,used,overpaid,remaining:limit===null?null:Math.max(0,limit-used),overLimit:limit===null?0:Math.max(0,used-limit)};
}
export function debtOpening(state,id,{used,overpaid=0}){
  if(!Number.isSafeInteger(used)||used<0||used>1e12||!Number.isSafeInteger(overpaid)||overpaid<0||overpaid>1e12||used>0&&overpaid>0)throw Error('已用額度與溢繳款需為非負金額，且不能同時大於0');
  const accounts=state.accounts.map(a=>a.id===id?{id:a.id,name:a.name,kind:'card',opening:0}:a);
  const movement=id?balance({...state,accounts},id):0,opening=overpaid-used-movement;
  if(!Number.isSafeInteger(opening)||Math.abs(opening)>1e12)throw Error('帳戶校正金額超過允許範圍');return opening;
}
