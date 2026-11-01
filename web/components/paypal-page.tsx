"use client";
import { useEffect, useState } from "react";
import type { AuthProfile } from "@/lib/session";
import type { SiteLocale } from "@/lib/i18n/config";
import { localizedHref } from "@/lib/i18n/routing";
import { paypalPlans } from "@/lib/paypal/catalog";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { AuthControls } from "@/components/auth-controls";
import styles from "./paypal-page.module.css";
export type PayPalViewState={id:string;status:string;planCode:string;currentPeriodEnd:string|null;cancelAtPeriodEnd:boolean}|null;
export function PayPalPage({user,locale,subscription,enabled,blocked=false,checkoutId,managementOnly=false}:{user:AuthProfile|null;locale:SiteLocale;subscription:PayPalViewState;enabled:boolean;blocked?:boolean;checkoutId?:string;managementOnly?:boolean}) {
 const ja=locale==="ja",[months,setMonths]=useState<3|6|12>(6),[loginOpen,setLoginOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[state,setState]=useState(subscription);
 const text=(en:string,jp:string)=>ja?jp:en;
 useEffect(()=>{
  if(!checkoutId||!user)return;
  let live=true;
  fetch('/api/paypal/checkout',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({checkoutId})}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(live){setState(data);setMessage(data?.currentPeriodEnd?(ja?'お支払いを確認しました。利用枠が反映されました。':'Payment verified. Your processing allowance is available.'):(ja?'お支払いを確認しています。少し待ってから再読み込みしてください。':'Payment is being verified. Please refresh shortly.'));}}).catch(()=>{if(live)setMessage(ja?'お支払いはまだ確認できません。再購入せず、少し待って再読み込みするかサポートにお問い合わせください。':'Payment is not yet confirmed. Do not purchase again; refresh shortly or contact support.');});
  return()=>{live=false;};
 },[checkoutId,user,ja]);
 async function buy(code:string){
  if(!user){setLoginOpen(true);return;}
  setBusy(true);setMessage('');
  try{const r=await fetch('/api/paypal/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planCode:code,locale:ja?'ja':'en'})});const data=await r.json();if(!r.ok)throw Error(data.code);const url=new URL(data.approvalUrl);if(url.protocol!=='https:'||!['www.paypal.com','www.sandbox.paypal.com'].includes(url.hostname))throw Error();window.location.assign(url.toString());}
  catch{setMessage(text('Checkout could not be confirmed. If you already started a payment, do not pay again. Contact support to resolve the previous checkout.','決済を確認できません。すでに決済を開始した場合は再購入せず、サポートにお問い合わせください。'));setBusy(false);}
 }
 async function cancel(){
  if(!window.confirm(text('Stop automatic renewal? Your paid allowance remains available until its expiry.','自動更新を停止しますか？お支払い済みの利用枠は有効期限まで使用できます。')))return;
  setBusy(true);
  try{const r=await fetch('/api/paypal/subscription',{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error();setState(await r.json());setMessage(text('Automatic renewal stopped. Your paid access remains until expiry.','自動更新を停止しました。お支払い済みの期間は引き続き利用できます。'));}catch{setMessage(text('Cancellation is not yet confirmed. Please retry or contact support.','解約はまだ確認されていません。再試行するかサポートにお問い合わせください。'));}finally{setBusy(false);}
 }
 return <div className="app-shell site-chrome desktop-sidebar-layout pricing-page min-h-screen text-neutral-100">
  <SiteHeader desktopSidebar><AuthControls user={user} next={localizedHref('/pricing',locale)} loginOpen={loginOpen} onLoginOpenChange={setLoginOpen}/></SiteHeader>
  <main className={styles.main}><h1>{managementOnly?text('Manage PayPal subscription','PayPalサブスクリプション管理'):text('Choose your EasyCut plan','EasyCutプランを選択')}</h1>
   <p>{text('Pay securely with PayPal. All prices and charges are in US dollars (USD).','PayPalで安全に決済。表示価格・請求通貨はすべて米ドル（USD）です。')}</p>
   {message&&<p className={styles.notice} role="status">{message}</p>}
   {blocked&&<p className={styles.notice}>{text('You already have a subscription or paid plan. Manage it before starting another subscription.','既存のサブスクリプションまたは利用プランがあります。新しく購入する前に既存の契約をご確認ください。')} <a href={localizedHref('/settings/plan',locale)}>{text('Manage plan','契約を管理')}</a></p>}
   {state&&<section className={styles.notice}><h2>{text('Your PayPal subscription','ご契約中のPayPalプラン')}</h2><p>{paypalPlans.find(p=>p.code===state.planCode)?.name} · {state.status}</p>{state.currentPeriodEnd&&<p>{text('Paid access until: ','利用期限：')}{new Date(state.currentPeriodEnd).toLocaleString(ja?'ja-JP':'en-US')}</p>}{state.status==='APPROVAL_PENDING'&&<button disabled={busy} onClick={()=>buy(state.planCode)}>{text('Resume PayPal checkout','PayPal決済を再開')}</button>}{['ACTIVE','SUSPENDED'].includes(state.status)&&<button disabled={busy} onClick={cancel}>{text('Stop automatic renewal','自動更新を停止')}</button>}</section>}
   {!managementOnly&&<><div className={styles.terms} role="group" aria-label={text('Package duration','パッケージ期間')}>{([3,6,12] as const).map(m=><button key={m} aria-pressed={months===m} onClick={()=>setMonths(m)}>{m}{text(' months','か月')}</button>)}</div>
   <div className={styles.grid}>{[paypalPlans[0],...paypalPlans.filter(p=>p.months===months)].map(p=><section key={p.code} className={styles.card}><h2>{p.name}</h2><p className={styles.price}>US${(p.amount/100/p.months).toFixed(2)}<small>{text(' / month',' / 月')}</small></p><p>{p.months===1?text('US$12 billed every month','毎月US$12を請求'):text(`US$${(p.amount/100).toFixed(2)} billed every ${p.months} months`,`${p.months}か月ごとにUS$${(p.amount/100).toFixed(2)}を一括請求`)}</p><ul><li>{text(`${p.minutes} source minutes every month`,`毎月${p.minutes}分の動画処理枠`)}</li><li>{text(`${p.jobs} concurrent video${p.jobs>1?'s':''}`,`同時処理${p.jobs}本`)}</li><li>{text('30-day project storage','プロジェクト保存期間30日')}</li><li>{text('Monthly allowance resets each month; the full package allowance is not available upfront.','利用枠は毎月更新されます。全期間分の枠を一度に利用することはできません。')}</li></ul><button disabled={busy||!enabled||blocked||Boolean(state&&!['CANCELLED','EXPIRED'].includes(state.status)&&!(state.status==='APPROVAL_PENDING'&&state.planCode===p.code))} onClick={()=>buy(p.code)}>{busy?text('Please wait…','処理中…'):text('Subscribe with PayPal','PayPalで購読')}</button><p><small>{text('Automatically renews at the same price and interval until canceled. Cancel renewal in account settings.','解約するまで同じ料金・周期で自動更新されます。アカウント設定から更新を停止できます。')}</small></p></section>)}</div></>}
   {!enabled&&<p role="status">{text('Checkout is temporarily unavailable. Please contact support.','現在決済をご利用いただけません。サポートにお問い合わせください。')}</p>}
   <p><a href={localizedHref('/refund',locale)}>{text('Cancellation & refunds','解約・返金')}</a> · <a href={localizedHref('/support',locale)}>{text('Contact support','お問い合わせ')}</a></p>
  </main><SiteFooter/>
 </div>;
}
