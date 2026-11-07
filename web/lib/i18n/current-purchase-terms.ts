import type { LegalTranslation } from "@/components/legal-document";
import { purchaseTermsV8Translations } from "./legal-translations";

// Clarify the currently sold Paddle products without rewriting archived terms
// or applying ThePayOne/Toss change and cancellation rules to Paddle orders.
const paddle: Record<"en" | "ja", { scope: string; payment: string; cancellation: string; changes: string; information: string }> = {
  en: {
    scope: "Payment conditions depend on the provider identified at checkout. Paddle subscriptions follow the Paddle conditions below. ThePayOne conditions apply only to ThePayOne orders, and Article 11 applies only to Toss automatic billing. Orders and payment methods are not transferred between providers.",
    payment: "Paddle: EasyCut Pro renews automatically every month. Starter and Expert packages are recurring subscriptions for the selected 3, 6, or 12 months. The full selected-period amount is paid upfront at the initial purchase and automatically at each renewal until cancellation. A monthly-equivalent price is for comparison, not a monthly installment. The checkout shows the currency, full amount due, taxes, billing period, and recurring charge. Processing allowances reset monthly and do not roll over; the whole package allowance is not granted upfront.",
    cancellation: "Paddle: To stop the next renewal, complete cancellation before the renewal date through Settings → Billing management. For an active, paid subscription, cancellation takes effect at the end of the current paid billing period; access and monthly allowances continue until then. Cancellation alone does not automatically refund the current payment. Refund requests are reviewed separately under the Cancellation & Refund Policy and applicable law. Past-due or paused subscriptions may end immediately when canceled in the Paddle customer portal.",
    changes: "Paddle: A higher tier within the same billing period takes effect after the displayed prorated charge succeeds. Changes to a different billing period, a lower tier, or an equal tier are scheduled for renewal; no payment is taken for scheduling. Review the amount, effective date, and next recurring payment on the confirmation screen. The ThePayOne one-time-package purchase limits and Pro-payment reversal rules below do not apply to Paddle subscriptions.",
    information: "Paddle processes Paddle checkout payments and recurring payment details. The ThePayOne card-storage and one-time-card rules below apply only to ThePayOne orders; they do not mean that a Paddle package is a one-time, non-renewing purchase.",
  },
  ja: {
    scope: "決済条件は決済画面に表示された事業者によって異なります。Paddleのサブスクリプションには以下のPaddle条件、ThePayOneの注文にはThePayOne条件、第11条はToss自動決済にのみ適用します。異なる事業者間で注文や決済手段を移管しません。",
    payment: "Paddle：EasyCut Proは毎月自動更新されます。Starter・Expertパッケージは、選択した3・6・12か月単位の継続契約です。初回に選択期間の総額を一括前払いし、解約まで各更新日に同じ周期で自動決済します。月額換算表示は比較用であり、毎月の分割請求ではありません。決済画面で通貨、支払総額、税金、契約期間、継続請求額をご確認ください。処理時間の利用枠は毎月更新され、繰り越されません。全期間分を一度に付与するものではありません。",
    cancellation: "Paddle：次回更新を停止するには、更新日前に「設定 → お支払い管理」から解約を確定してください。有効な支払済み契約は現在の決済期間の終了時に解約となり、それまでは利用権と月間利用枠の提供を継続します。解約だけで当期の決済が自動返金されることはありません。返金申請はキャンセル・返金ポリシーと適用法令に従い別途審査します。支払遅延中または一時停止中の契約をPaddleのカスタマーポータルで解約すると、直ちに終了する場合があります。",
    changes: "Paddle：契約期間が同じ上位プランへの変更は、表示された残存期間分の差額決済が完了した後に適用されます。契約期間の変更、下位または同等プランへの変更は次回更新時に適用し、予約時には決済しません。確認画面で金額、適用日、次回請求額をご確認ください。以下のThePayOneの1回限りのパッケージ購入制限およびPro決済取消条件は、Paddle契約には適用しません。",
    information: "Paddleでのお支払いと継続決済情報はPaddleが処理します。以下のThePayOneのカード保存・1回決済に関する条件はThePayOneの注文にのみ適用し、Paddleパッケージが自動更新のない1回限りの購入であることを意味しません。",
  },
};

function currentTranslation(locale: "en" | "ja"): LegalTranslation {
  const original = purchaseTermsV8Translations[locale];
  const text = paddle[locale];
  const clarifications: Record<number, string> = {
    0: text.scope, 2: text.payment, 4: text.cancellation,
    5: text.changes, 8: text.information,
  };
  return {
    ...original,
    description: `${original.description} ${text.scope}`,
    sections: original.sections.map((section, index) => ({
      ...section,
      paragraphs: [
        ...(clarifications[index] ? [clarifications[index]] : []),
        ...section.paragraphs.map((paragraph) => (
          [2, 4, 5].includes(index) || (index === 8 && paragraph === section.paragraphs[0])
            ? `ThePayOne${locale === "ja" ? "の注文のみ：" : " orders only: "}${paragraph}`
            : paragraph
        )),
      ],
    })),
  };
}

export const currentPurchaseTermsTranslations = {
  en: currentTranslation("en"),
  ja: currentTranslation("ja"),
};
