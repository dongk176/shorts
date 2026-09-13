import assert from 'node:assert/strict';
import test from 'node:test';
import {referralAnonymizer} from './referral-reconciliation-anonymizer.mjs';

test('anonymization preserves same-timestamp evidence ordering and joins',()=>{
  const ids=['aaaaaaaa-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000001'];
  const source={audits:ids.map(id=>({id,created_at:'2026-09-01T00:00:00Z'})),contract:{sourceId:ids[0]}};
  const scrub=referralAnonymizer(source),result=scrub(source);
  assert.notEqual(result.audits[0].id,ids[0]);
  assert.equal(result.audits[0].id,result.contract.sourceId);
  assert.deepEqual(result.audits.map(a=>a.id).sort(),scrub([...ids].sort()));
  assert.deepEqual(referralAnonymizer(source)(source),result);
  assert.equal(scrub({sourceId:ids[0]}).sourceId,result.contract.sourceId);
});
test('anonymization rejects identifiers outside the locked source',()=>{
  assert.throws(()=>referralAnonymizer({})('aaaaaaaa-0000-4000-8000-000000000002'),/absent/);
});
