export function formatStoredCardLabel(input: {
  last4: string | null | undefined;
}) {
  const last4 = input.last4?.replace(/\D/g, "").slice(-4) || "";
  if (last4.length !== 4) return null;
  return `••${last4}`;
}

const issuerAliases: Array<[RegExp, string]> = [
  [/(?:^|\s)(?:kb|국민)/i, "국민카드"],
  [/신한/i, "신한카드"],
  [/삼성/i, "삼성카드"],
  [/(?:bc|비씨)/i, "BC카드"],
  [/현대/i, "현대카드"],
  [/(?:nh|농협)/i, "NH농협카드"],
  [/하나|외환|keb/i, "하나카드"],
  [/우리/i, "우리카드"],
  [/롯데/i, "롯데카드"],
];

const issuerByBin6: Record<string, string> = {
  // Former Korea Exchange Bank card range, now serviced by Hana Card.
  "433689": "하나카드",
};

function normalizedIssuerCandidate(value: string | null | undefined) {
  const candidate = value?.trim() || "";
  if (!candidate || /^(?:기타|other|unknown|etc\.?)$/i.test(candidate)) return null;
  const alias = issuerAliases.find(([pattern]) => pattern.test(candidate));
  return alias?.[1] || candidate;
}

export function resolveStoredCardIssuer(input: {
  issuer?: string | null;
  acquirer?: string | null;
  cardNumberMasked?: string | null;
}) {
  const issuer = normalizedIssuerCandidate(input.issuer);
  if (issuer) return issuer;
  const acquirer = normalizedIssuerCandidate(input.acquirer);
  if (acquirer) return acquirer;
  const bin6 = input.cardNumberMasked?.replace(/\D/g, "").slice(0, 6) || "";
  return issuerByBin6[bin6] || null;
}
