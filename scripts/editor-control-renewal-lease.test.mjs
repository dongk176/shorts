import assert from 'node:assert/strict';
import test from 'node:test';
import { validateControlRenewalLease, acquireEditorControlRenewalLease } from './editor-control-renewal-lease.mjs';
import { stageBLeaseOperations } from './deploy-stage-b-release-control.mjs';
import { acquireEditorRenderV4InfrastructureLease } from './verify-editor-render-v4-release-control.mjs';
const valid = { owner: `stage-b:renewal:${'a'.repeat(40)}`, leaseId: '11111111-1111-4111-8111-111111111111' };
test('renewal alone selects the non-admission control lease', () => {
  assert.equal(stageBLeaseOperations('renewal').acquire, acquireEditorControlRenewalLease);
  for (const phase of ['bootstrap','rotation','lockdown'])
    assert.equal(stageBLeaseOperations(phase).acquire, acquireEditorRenderV4InfrastructureLease);
});
test('control lease rejects routing phases, successor and invalid bounded identity', () => {
  assert.equal(validateControlRenewalLease(valid).ttlSeconds, 7200);
  for (const change of [{owner:valid.owner.replace('renewal','rotation')},{successor:{}},{leaseId:'bad'},{ttlSeconds:7201},{ttlSeconds:29}])
    assert.throws(() => validateControlRenewalLease({...valid,...change}));
});
