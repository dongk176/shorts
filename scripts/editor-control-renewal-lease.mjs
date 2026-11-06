import postgres from '../web/node_modules/postgres/src/index.js';
import { requireProductionDatabaseUrl } from './production-database-identity.mjs';

export function validateControlRenewalLease({ owner, leaseId, ttlSeconds = 7200, successor = null }) {
  if (!/^stage-b:renewal:[0-9a-f]{40}$/.test(owner || '') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(leaseId || '') ||
      !Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 7200 || successor) {
    throw new Error('Control renewal requires an exact renewal identity without successor routing.');
  }
  return { owner, leaseId, ttlSeconds };
}

async function mutate(action, options = {}) {
  const { owner, leaseId, ttlSeconds } = validateControlRenewalLease(options);
  const sql = postgres(requireProductionDatabaseUrl(options.environment || process.env), {
    max: 1, prepare: false, connect_timeout: 15,
    connection: { application_name: 'easycut-control-renewal', statement_timeout: 15000 },
  });
  try {
    return await sql.begin(async (tx) => {
      // Lock order is identical to the legacy infrastructure controller. The DB
      // trigger additionally rejects legacy writes while this lease is active.
      const [state] = await tx`select *,
        (control_renewal_lease_expires_at>clock_timestamp()) as renewal_active,
        (render_v4_infra_lease_expires_at>clock_timestamp()) as infra_active
        from shorts_mvp.editor_release_state where singleton for update`;
      if (!state) throw new Error('Missing release singleton.');
      if (action === 'acquire') {
        if (state.renewal_active || state.infra_active ||
            (state.render_v4_target_successor && state.render_v4_target_successor.phase !== 'active')) {
          throw new Error('Another infrastructure or control renewal is active.');
        }
      } else if (state.control_renewal_lease_id !== leaseId || state.control_renewal_lease_owner !== owner ||
                 (action === 'renew' && !state.renewal_active)) {
        throw new Error('Control renewal lease expired or ownership changed.');
      }
      if (action === 'release') {
        await tx`update shorts_mvp.editor_release_state set control_renewal_lease_id=null,
          control_renewal_lease_owner=null,control_renewal_lease_expires_at=null where singleton`;
      } else {
        await tx`update shorts_mvp.editor_release_state set control_renewal_lease_id=${leaseId}::uuid,
          control_renewal_lease_owner=${owner},control_renewal_lease_expires_at=clock_timestamp()+${ttlSeconds}*interval '1 second'
          where singleton`;
      }
    });
  } finally { await sql.end({ timeout: 5 }); }
}
export const acquireEditorControlRenewalLease = (options) => mutate('acquire', options);
export const renewEditorControlRenewalLease = (options) => mutate('renew', options);
export const releaseEditorControlRenewalLease = (options) => mutate('release', options);
