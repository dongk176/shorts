export function paypalCheckoutErrorMessage(code: unknown, ja: boolean) {
  if(code === "CHECKOUT_REFRESH_REQUIRED") return ja ? "決済方法が更新されました。このページを再読み込みしてから購入してください。" : "Checkout has been updated. Refresh this page before purchasing.";
  if (code === "PAYPAL_REFERENCE_UNAVAILABLE") return ja
    ? "以前の決済情報をPayPalで確認できません。決済完了・キャンセルの判定はできていません。再購入する前にサポートへお問い合わせください。"
    : "PayPal cannot find the previous checkout reference. Payment or cancellation is not confirmed. Contact support before starting another checkout.";
  return ja
    ? "お支払いはまだ確認できません。すでに決済を開始した場合は再購入せず、少し待って再確認するかサポートにお問い合わせください。"
    : "Payment is not yet confirmed. If you already started checkout, do not pay again; check again shortly or contact support.";
}
