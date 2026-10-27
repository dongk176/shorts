import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({owner:vi.fn(),query:vi.fn(),queue:vi.fn()}));
vi.mock('./db',()=>({getDb:()=>state.query}));
vi.mock('./ranking-access',()=>({requireRankingProject:state.owner}));
vi.mock('./ranking-jobs',()=>({queueRankingOperation:state.queue}));
import {retryRankingRender} from './ranking-retry';
const project='9db8aaaf-0930-4d24-89dd-0342d615f7d1';
const body={requestId:'acb3c072-ef17-41a4-9ebd-531e802edcfa',retryOperationId:'ae650b08-c1dd-4cf6-acf1-81daf7784771'};
beforeEach(()=>vi.resetAllMocks());
it('uses the owner-checked saved spec and normal idempotent billing/dispatch path',async()=>{
 const payload={title:'football',clips:[{rank:1,start:6.583,end:17.915}],playbackOrder:[1]};
 state.query.mockResolvedValue([{payload}]);state.queue.mockResolvedValue({operationId:'new'});
 await expect(retryRankingRender(project,'owner',body,'https://www.easycut.co.kr')).resolves.toEqual({operationId:'new'});
 expect(state.owner).toHaveBeenCalledWith(project,'owner');
 expect(state.query.mock.calls[0][0].join('?')).toContain("and action='render' and status in ('failed','succeeded')");
 expect(state.queue).toHaveBeenCalledWith(project,'owner','render',{requestId:body.requestId,spec:payload},undefined,'https://www.easycut.co.kr');
});
it('never reads or queues another owner project',async()=>{
 state.owner.mockRejectedValue(new Error('not found'));
 await expect(retryRankingRender(project,'other',body,'https://www.easycut.co.kr')).rejects.toThrow('not found');expect(state.query).not.toHaveBeenCalled();expect(state.queue).not.toHaveBeenCalled();
});
it('rejects missing or successful operations and arbitrary payload overrides',async()=>{
 state.query.mockResolvedValue([]);
 await expect(retryRankingRender(project,'owner',body,'https://www.easycut.co.kr')).rejects.toMatchObject({status:404});
 await expect(retryRankingRender(project,'owner',{...body,spec:{}},'https://www.easycut.co.kr')).rejects.toMatchObject({status:400});expect(state.queue).not.toHaveBeenCalled();
});

it('changes only the requested sound on an owned completed result',async()=>{
 const payload={title:'football',clips:[{rank:1,start:6.583,end:17.741}],playbackOrder:[1],transitionSound:null};
 state.query.mockResolvedValue([{payload,status:'succeeded'}]);
 await retryRankingRender(project,'owner',{...body,transitionSound:'lip-bass'},'https://www.easycut.co.kr');
 expect(state.queue.mock.calls[0][3].spec).toEqual({...payload,transitionSound:'lip-bass',transitionVersion:2});
 expect(payload.transitionSound).toBe(null);
});
it('requires an explicit sound change for completed renders',async()=>{
 state.query.mockResolvedValue([{payload:{},status:'succeeded'}]);
 await expect(retryRankingRender(project,'owner',body,'https://www.easycut.co.kr')).rejects.toMatchObject({status:404});expect(state.queue).not.toHaveBeenCalled();
});
