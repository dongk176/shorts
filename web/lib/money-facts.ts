import catalog from "./language-context.json";

// Conservative grounding of explicit monetary amounts, shared with the worker fixtures.
const label = String.raw`(?:South Korean won|Korean won|KRW|USD|JPY|EUR|GBP|US dollars?|dollars?|won|yen|euros?|pounds?|韓国ウォン|ウォン|米ドル|ドル|ユーロ|ポンド|달러|유로|원|円|엔|[₩$¥￥€£])`;
const number = String.raw`[-+]?\d(?:[\d,.]*\d)?`;
const scale = String.raw`(?:trillion|billion|million|thousand|[kmbt](?![a-z])|[천만억조千万億兆])`;
const expression = number + String.raw`\s*(?:` + scale + String.raw`)*(?:\s*` + number + String.raw`\s*` + scale + ")*";
const separator = String.raw`(?:에서|부터|から|to\b|[~〜～–—、,-])`;
const moneyPattern = String.raw`(?<![\d.,])(?:` + "(" + label + String.raw`)\s*(` + expression + ")"
  + String.raw`(?:\s*` + separator + String.raw`\s*(` + expression + String.raw`))?|`
  + "(" + expression + String.raw`)(?:\s*(?:` + label + String.raw`)?\s*` + separator
  + String.raw`\s*(` + expression + String.raw`))?\s*(` + label + String.raw`))(?![a-z])`;
const units: Record<string, number> = {
  k: 1e3, thousand: 1e3, 천: 1e3, 千: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9,
  t: 1e12, trillion: 1e12, 만: 1e4, 万: 1e4, 억: 1e8, 億: 1e8, 조: 1e12, 兆: 1e12,
};
type MoneyClaim = { currency: string; low: number | null; high: number | null };

function currency(value: string) {
  if (/won|ウォン|원|KRW|₩/i.test(value)) return "KRW";
  if (/dollar|ドル|달러|USD|\$/i.test(value)) return "USD";
  if (/yen|円|엔|JPY|[¥￥]/i.test(value)) return "JPY";
  return /euro|ユーロ|유로|EUR|€/i.test(value) ? "EUR" : "GBP";
}

function quantity(value: string, inherited = 1): number | null {
  const tokens = value.match(new RegExp(number + "|" + scale, "gi")) || [];
  let total = 0, section = 0, pending: number | null = null, scaled = false;
  for (const token of tokens) {
    if (/^[-+]?\d/.test(token)) {
      if (!/^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(token) || pending !== null) return null;
      pending = Number(token.replaceAll(",", ""));
    } else {
      const unit = units[token.toLowerCase()];
      scaled = true;
      if (unit < 1e4) section += (pending ?? 1) * unit;
      else {
        const base = section + (pending ?? 0);
        total += (pending === null && section === 0 ? 1 : base) * unit; section = 0;
      }
      pending = null;
    }
  }
  const result = total + section + (pending ?? 0);
  const valueResult = scaled ? result : result * inherited;
  return Math.abs(valueResult) <= Number.MAX_SAFE_INTEGER ? valueResult : null;
}

export function moneyClaims(text: string, includeUnlabeled = false): MoneyClaim[] {
  text = text.normalize("NFKC");
  const matches = Array.from(text.matchAll(new RegExp(moneyPattern, "gi")));
  const claims = matches.map((match) => {
    const [, prefix, first, second, suffixFirst, suffixSecond, suffix] = match;
    const rangeEnd = second || suffixSecond;
    const endScale = rangeEnd?.match(new RegExp(scale, "gi"))?.at(-1);
    const low = quantity(first || suffixFirst, endScale ? units[endScale.toLowerCase()] : 1);
    return { currency: currency(prefix || suffix), low, high: rangeEnd ? quantity(rangeEnd) : low };
  });
  if (includeUnlabeled) {
    const pattern = "(" + expression + String.raw`)(?:\s*` + separator + String.raw`\s*(` + expression + "))?";
    for (const match of text.matchAll(new RegExp(pattern, "gi"))) {
      const index = match.index;
      if (matches.some((m) => m.index <= index && index < m.index + m[0].length)) continue;
      if (!new RegExp(scale, "i").test(match[0])) continue;
      const after = text.slice(index + match[0].length).trimStart();
      if (new RegExp("^(?:(?:명|개|회|년|개월|번|대|시간|분|초)|" + catalog.amountCountUnitPattern + ")", "i").test(after)) continue;
      const nearby = text.slice(Math.max(0, index - 45), index + match[0].length + 45);
      if (!/원|달러|돈|벌|자산|고정비|이자|매출|수익|비용|금액|cost|income|earn|profit|asset|revenue|ウォン|ドル|稼|資産/i.test(nearby)) continue;
      const [, first, second] = match;
      const endScale = second?.match(new RegExp(scale, "gi"))?.at(-1);
      const low = quantity(first, endScale ? units[endScale.toLowerCase()] : 1);
      claims.push({ currency: "?", low, high: second ? quantity(second) : low });
    }
  }
  return claims;
}

export function ungroundedMoney(text: string, source: string): boolean {
  const originals = moneyClaims(source, true);
  const minimum = /\b(?:min(?:imum)?|at least)\b|最低|少なくとも|최소/i.test(text);
  const maximum = /\b(?:max(?:imum)?|up to|at most)\b|最大|최대/i.test(text);
  const question = /[?？]|(?:かな|だろう|かも(?:しれない)?)(?:[。！!…\s]|$)|\b(?:could|would|might)\b/i.test(text);
  return moneyClaims(text).some((claim) => {
    if (claim.low === null || claim.high === null) return true;
    if (originals.some((value) => (value.currency === "?" || value.currency === claim.currency)
      && value.low === claim.low && value.high === claim.high)) return false;
    if (claim.low === claim.high && originals.some((value) => (value.currency === "?" || value.currency === claim.currency)
      && value.low !== null && value.high !== null && value.low !== value.high
      && ((minimum && !maximum && claim.low === value.low)
        || (maximum && !minimum && claim.high === value.high)
        || (question && !minimum && !maximum
          && (claim.low === value.low || claim.low === value.high))))) return false;
    return true;
  });
}
