"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./paypal-page.module.css";
type Payment = { status: string; paid: boolean; accessEnd: string | null; monthlyMinutes: number; months: number };
export function PayPalOrderResult({ checkoutId, canceled, endpoint = "/api/paypal/orders", japanese = false }: {
  checkoutId: string; canceled: boolean; endpoint?: string; japanese?: boolean;
}) {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const check = useCallback(async () => {
    setBusy(true); setMessage("");
    try {
      const r = await fetch(endpoint, { method: canceled ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutId }) });
      const data = await r.json();
      if (!r.ok) throw Error();
      setPayment(data);
    } catch { setMessage(japanese ? "お支払いはまだ確認できません。再購入せず、確認ボタンから再度確認してください。" : "Payment is not confirmed yet. Check again below before starting another purchase."); }
    finally { setBusy(false); }
  }, [checkoutId, canceled, endpoint, japanese]);
  useEffect(() => { void check(); }, [check]);
  return <main className={styles.main}>
    <h1>{japanese ? "お支払い状況" : "Payment status"}</h1>
    {payment?.paid ? <section className={styles.notice} role="status"><h2>{japanese ? "お支払いを確認しました" : "Payment verified"}</h2><p>{japanese ? "利用期限：" : "Access until: "}{payment.accessEnd}<br />{japanese ? `毎月${payment.monthlyMinutes}分・${payment.months}か月間。自動更新はありません。` : `${payment.monthlyMinutes} minutes/month for ${payment.months} month(s). No automatic renewal.`}</p></section>
      : payment?.status === "canceled" ? <p className={styles.notice} role="status">{japanese ? "決済をキャンセルしました。別のプランを選べます。" : "Checkout canceled. You can choose another plan."}</p>
      : payment?.status === "declined" ? <p className={styles.notice} role="status">{japanese ? "お支払いは承認されませんでした。料金ページから再度購入できます。" : "Payment was declined. You can try again from pricing."}</p>
      : payment && ["refunded","reversed","review"].includes(payment.status) ? <p className={styles.notice} role="status">{japanese ? "この決済は返金・取消、または確認中のため、利用枠を停止しています。サポートへお問い合わせください。" : "Access is paused because this payment was refunded, reversed, or needs review. Contact support if you need help."}</p>
      : <p className={styles.notice} role="status">{message || (japanese ? "決済状況を確認しています。" : "Checking payment status…")}</p>}
    <button disabled={busy} onClick={check}>{busy ? "…" : japanese ? "決済状況を確認" : "Check payment status"}</button>
    <p><a href={japanese ? "/jp/pricing" : "/en/pricing"}>{japanese ? "料金ページに戻る" : "Back to pricing"}</a></p>
  </main>;
}
