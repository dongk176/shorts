"use client";
import {useState} from 'react';
export function PayPalConfigurationPanel(){
 const [result,setResult]=useState('설정 확인 대기'),[busy,setBusy]=useState(false);
 async function run(action?:string){setBusy(true);try{const response=await fetch('/api/admin/paypal/diagnostics',action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}:{cache:'no-store'});const data=await response.json();setResult(JSON.stringify(data,null,2));}catch{setResult('설정 확인 실패');}finally{setBusy(false);}}
 return <main className="mx-auto max-w-4xl p-8 text-white"><h1 className="text-2xl font-bold">PayPal 일회성 결제 확인</h1><p className="my-4">미결제 주문 검사는 실제 돈을 청구하거나 이용권을 지급하지 않습니다.</p><div className="flex gap-3">{[['','설정 조회'],['configure_webhook','일회성 결제 알림 연결'],['verify_unpaid_order','미결제 주문 API 검사']].map(([action,label])=><button className="rounded-lg border p-3" key={label} disabled={busy} onClick={()=>run(action||undefined)}>{label}</button>)}</div><pre role="status" className="mt-6 whitespace-pre-wrap rounded-lg bg-neutral-900 p-5">{result}</pre></main>;
}
