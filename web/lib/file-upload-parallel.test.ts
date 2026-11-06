import {afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {uploadCapacityFunctionForJob,parallelUploadAvailable} from './file-upload-parallel';
const id='11111111-1111-4111-8111-111111111111';
const arn='arn:aws:lambda:ap-northeast-2:181651591905:function:shorts-upload-candidate-test';
afterEach(()=>vi.unstubAllEnvs());
it('retains the job-pinned capacity service even with rollout environment off',async()=>{
  const db=vi.fn().mockResolvedValue([{silenceInlineReleaseId:id,capacityFunctionArn:arn}]);
  expect(await uploadCapacityFunctionForJob(db as never,id,id)).toBe(arn);
  expect(db.mock.calls[0].slice(1)).toEqual([id,id]);
});
it('never sends a marked session to the ordinary receiver when its registry is missing',async()=>{
  await expect(uploadCapacityFunctionForJob(vi.fn().mockResolvedValue([{silenceInlineReleaseId:id}]) as never,id,id)).rejects.toThrow();
  expect(await uploadCapacityFunctionForJob(vi.fn().mockResolvedValue([{silenceInlineReleaseId:null}]) as never,id,id)).toBeUndefined();
});
it('does not advertise parallel languages without an exact configured and registered route',async()=>{
  const db=vi.fn().mockResolvedValue([]);
  expect(await parallelUploadAvailable(db as never,id)).toBe(false);
  expect(db).not.toHaveBeenCalled();
  vi.stubEnv('FILE_UPLOAD_PARALLEL_RELEASE_ID',id);vi.stubEnv('SHORTS_SILENCE_PARALLEL_RELEASE_ID',id);
  expect(await parallelUploadAvailable(db as never,id)).toBe(false);
  db.mockResolvedValue([{releaseId:id}]);
  expect(await parallelUploadAvailable(db as never,id)).toBe(true);
  vi.stubEnv('FILE_UPLOAD_CANDIDATE_RELEASE_ID',id);
  expect(await parallelUploadAvailable(db as never,id)).toBe(false);
});
