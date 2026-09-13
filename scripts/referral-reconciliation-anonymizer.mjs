import crypto from 'node:crypto';

const isUuid=value=>typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Preserve UUID ordering: historical queries break same-timestamp audit ties
// by UUID and select the minimum checkout ID. Unordered hashing changes those
// choices in the preview even when the financial data is identical.
export function referralAnonymizer(source) {
  const identifiers=new Set();
  const collect=value=>{
    if(isUuid(value)) identifiers.add(value.toLowerCase());
    else if(value && typeof value==='object') Object.values(value).forEach(collect);
  };
  collect(source);
  const mapped=new Map([...identifiers].sort().map((value,index)=>{
    const h=hash(value),rank=(index+1).toString(16).padStart(8,'0');
    return [value,`${rank}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`];
  }));
  const scrub=value=>{
    if(Array.isArray(value)) return value.map(scrub);
    if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrub(v)]));
    if(isUuid(value)) {
      const anonymous=mapped.get(value.toLowerCase());
      if(!anonymous) throw new Error('Result contains an identifier absent from the source snapshot');
      return anonymous;
    }
    if(typeof value==='string' && /^EC-/.test(value)) return `order_${hash(value).slice(0,24)}`;
    return value;
  };
  return scrub;
}
