type LegalTranslation = {
  eyebrow: string;
  title: string;
  description: string;
  sections: Array<{ title: string; paragraphs: string[] }>;
};

export const refundTranslationsV3: { en: LegalTranslation; ja: LegalTranslation } = {
  en: {
    eyebrow: "Cancellation & Refund Policy",
    title: "Cancellation & Refund Policy",
    description: "This policy sets the cancellation, withdrawal, termination, and refund rules for Easy Cut paid services.",
    sections: [
      { title: "1. Purpose and scope", paragraphs: ["This policy applies to Easy Cut monthly subscriptions, X3/X6 usage packages, separately purchased processing time, and other paid services. The product, price, allowance, validity period, renewal status, checkout consents, and policy version shown at payment form part of the order. Mandatory law prevails over this policy."] },
      { title: "2. Product rules", paragraphs: ["Easy Cut Pro is a monthly auto-renewing product. Cancellation stops the next charge but does not by itself reverse an approved payment. X3/X6 packages are one-time purchases whose full displayed allowance is granted immediately, remains valid for 12 months, and does not renew. Expired allowance is not converted to cash or points.", "Source-video duration is reserved while a job runs and finalized when the job completes successfully. Where several allowance ledgers exist, we may deduct from the ledger that expires first."] },
      { title: "3. Withdrawal and refund restrictions", paragraphs: ["Withdrawal and refunds are processed only when the requirements and time limits under applicable law are met. To the extent permitted by law, a request may be restricted after paid access or allowance has been supplied, allowance has been reserved or consumed, paid results, features, files, or guides have been delivered, or use failed for a reason attributable to the user.", "A request made within seven days is not automatically approved. We review the order, disclosures and consents, entitlement grant, usage, and content-delivery records before deciding the request."] },
      { title: "4. Change of mind after seven days", paragraphs: ["We do not offer discretionary refunds after the statutory withdrawal period for a change of mind, loss of need, switching services, or subjective dissatisfaction with a normally completed result. If mandatory law requires mid-term termination or repayment, the request is handled under the applicable legal standard after reflecting supplied and used value and legally permitted deductions."] },
      { title: "5. Completed results", paragraphs: ["A technically completed job for which output is delivered is treated as supplied paid service. Differences involving editing taste, scene, title or subtitle selection, resemblance, prompt interpretation, expected views or revenue, user settings, source quality, or unsupported input do not justify allowance restoration or a refund unless they constitute an objective defect attributable to us."] },
      { title: "6. Failed jobs and objective defects", paragraphs: ["Reserved allowance is restored when a job ends in a system failure. If the paid service is unavailable or an objective defect materially inconsistent with the contract or advertising is confirmed, we may reprocess, provide a substitute, restore allowance, or provide a refund required by law."] },
      { title: "7. Validity and refundable value", paragraphs: ["X3/X6 packages and separately purchased processing time expire at the time displayed at checkout and are not automatically refunded merely because they remain unused or expire. Free or bonus allowance and benefits without separate consideration have no cash refund value and may be removed when the underlying order is canceled."] },
      { title: "8. Request and processing", paragraphs: ["Send the account email, order number, payment date and amount, product, and reason to easycut@easycut.co.kr. Subscription cancellation, account deletion, or a general inquiry is not a completed refund request.", "We may request material needed to verify identity, payment, supply, and use. An approved refund is returned to the original payment method under the time and method required by law, and the related paid access, allowance, downloads, and benefits are removed."] },
      { title: "9. Overpayment, unauthorized payment, and abuse", paragraphs: ["Duplicate or excess payments caused by us are returned to the original payment method. We may review account, order, authorization, and use records and request supporting material for an unauthorized-payment claim.", "False evidence, concealment of use, abuse of the refund process, or simultaneous card disputes and company refunds are prohibited. Duplicate recovery or unjust enrichment may be reclaimed."] },
      { title: "10. Records and policy versions", paragraphs: ["We may retain payment, disclosure, consent, policy-version, supply, usage, job-result, refund-review, and entitlement-removal records for the periods permitted by law and the Privacy Policy.", "Orders governed by refund-policy v1 or v2 remain subject to the archived version at /refund/versions/1 or /refund/versions/2. Matters not covered here follow the Terms, Purchase Terms, checkout conditions, and Korean law."] },
      { title: "11. Business and contact", paragraphs: ["Business: Artiroom · Representative: Kim Dong-min · Business registration no. 638-04-03590 · Mail-order business report no. 2025-Seoul Mapo-2971 · Address: 40, Seongsan-ro 8-gil, Mapo-gu, Seoul, Republic of Korea · Contact: easycut@easycut.co.kr / +82-10-4836-2874"] },
    ],
  },
  ja: {
    eyebrow: "Cancellation & Refund Policy",
    title: "キャンセル・返金ポリシー",
    description: "本ポリシーは、Easy Cutの有料サービスに関する取消し、撤回、解約および返金の取扱基準を定めます。",
    sections: [
      { title: "第1条 目的と適用範囲", paragraphs: ["本ポリシーは、Easy Cutの月間サブスクリプション、X3・X6利用量パッケージ、別途購入する処理時間その他の有料サービスに適用されます。決済時に表示された商品、金額、提供量、有効期間、自動更新の有無、個別同意およびポリシー版が注文条件となります。強行法規は本ポリシーに優先します。"] },
      { title: "第2条 商品別の基本基準", paragraphs: ["Easy Cut Proは月間自動決済商品です。解約は次回の決済を停止しますが、それだけで承認済みの決済が取り消されるものではありません。X3・X6は表示された全利用量が直ちに付与され、12か月間有効な一回払い商品であり、自動更新されません。失効した利用量は現金またはポイントに転換されません。", "元動画の長さは処理中に予約され、正常完了時に確定使用となります。複数の利用量原簿がある場合、当社は有効期限が先に到来する原簿から控除できます。"] },
      { title: "第3条 撤回および返金の制限", paragraphs: ["撤回および返金は、関係法令上の期間と要件を満たす場合に限り処理します。有料権限・利用量の提供開始、利用量の予約・消費、有料結果・機能・ファイル・ガイドの提供、または利用者に責任のある利用不能がある場合、法令で許容される範囲で撤回・返金が制限されます。", "決済から7日以内の申請であっても自動承認されません。当社は注文、事前表示・同意、権限付与、利用量およびコンテンツ提供記録を確認して判断します。"] },
      { title: "第4条 7日経過後の事情変更", paragraphs: ["法定撤回期間後の嗜好の変化、利用不要、他サービスの選択または正常完了結果への主観的不満について、当社は任意返金を行いません。強行法規により中途解約または返還が必要な場合は、提供・使用済み価値および法令上認められる控除額を反映し、法定基準に従って処理します。"] },
      { title: "第5条 正常完了結果", paragraphs: ["技術的に正常完了し結果物が提供された作業は、有料サービスが提供されたものとします。編集上の嗜好、場面・タイトル・字幕の選択、人物類似度、プロンプト解釈、期待再生数・収益、利用者設定、原本品質または非対応入力の差は、当社に責任のある客観的瑕疵でない限り、利用量復元または返金の理由になりません。"] },
      { title: "第6条 失敗作業と客観的瑕疵", paragraphs: ["システム障害で作業が失敗終了した場合、予約利用量を復元します。決済後にサービスを利用できない場合、または契約・表示広告と明白に異なる客観的瑕疵が確認された場合、当社は再処理、代替提供、利用量復元または法令上必要な返金措置を行うことがあります。"] },
      { title: "第7条 有効期間と返金対象", paragraphs: ["X3・X6および別途購入した処理時間は決済画面に表示された有効期間の満了時に失効し、未使用または失効のみを理由として自動返金されません。別途対価のない無料・ボーナス利用量および特典は現金返金価値を持たず、原注文の取消し時に回収できます。"] },
      { title: "第8条 申請および処理", paragraphs: ["アカウントメール、注文番号、決済日・金額、商品名および申請理由をeasycut@easycut.co.krへ送信してください。サブスクリプション解約、アカウント削除または一般問い合わせのみでは返金申請は完了しません。", "本人、決済、提供および利用を確認する資料を求める場合があります。承認された返金は法令上の期限・方法に従い元の決済手段へ処理し、関連する有料権限、利用量、ダウンロードおよび特典を回収します。"] },
      { title: "第9条 過誤金・無断決済・不正利用", paragraphs: ["当社責任による重複決済または過誤金は元の決済手段へ返還します。無断決済の申立てについて、アカウント、注文、承認および利用記録を確認し、資料を求めることがあります。", "虚偽資料、利用事実の隠蔽、返金制度の悪用またはカード会社への異議申立てと当社返金の重複進行を禁止します。二重回収または不当利得は回収できます。"] },
      { title: "第10条 記録およびポリシー版", paragraphs: ["決済、表示・同意、ポリシー版、サービス提供、利用量、作業結果、返金審査および権限回収の記録を、法令およびプライバシーポリシーで認められる期間保存できます。", "返金ポリシーv1またはv2が適用された注文には、/refund/versions/1または/refund/versions/2の旧版を適用します。本ポリシーに定めのない事項は、利用規約、購入規約、決済条件および韓国法に従います。"] },
      { title: "第11条 事業者・窓口", paragraphs: ["商号：Artiroom · 代表者：Kim Dong-min · 事業者登録番号：638-04-03590 · 通信販売業届出番号：2025-Seoul Mapo-2971 · 住所：40, Seongsan-ro 8-gil, Mapo-gu, Seoul, Republic of Korea · 問い合わせ：easycut@easycut.co.kr / +82-10-4836-2874"] },
    ],
  },
};
