import {expect,it,vi} from 'vitest';
import {waitForEditorSource} from './wait-editor-source';
const pending=()=>Object.assign(new Error('preparing'),{code:'EDITOR_SOURCE_PREPARING'});
it('waits for original source instead of using shortened output bounds',async()=>{
 const load=vi.fn().mockRejectedValueOnce(pending()).mockResolvedValue({start:5.66,end:96.17});
 const pause=vi.fn().mockResolvedValue(undefined);
 expect(await waitForEditorSource(load,()=>false,pause)).toEqual({start:5.66,end:96.17});
 expect(load).toHaveBeenCalledTimes(2);expect(pause).toHaveBeenCalledTimes(1);
});
it('stops retries after leaving the editor',async()=>{
 let stopped=false;const load=vi.fn().mockRejectedValue(pending());
 expect(await waitForEditorSource(load,()=>stopped,async()=>{stopped=true;})).toBeUndefined();
 expect(load).toHaveBeenCalledTimes(1);
});
it('does not retry authentication errors and bounds preparation retries',async()=>{
 const load=vi.fn().mockRejectedValue(new Error('unauthorized'));const pause=vi.fn().mockResolvedValue(undefined);
 await expect(waitForEditorSource(load,()=>false,pause)).rejects.toThrow('unauthorized');expect(pause).not.toHaveBeenCalled();
 load.mockRejectedValue(pending());await expect(waitForEditorSource(load,()=>false,pause)).rejects.toThrow('preparing');
 expect(pause).toHaveBeenCalledTimes(12);
});
it('polls every five seconds and stops at the sixty-second preparation bound',async()=>{
 vi.useFakeTimers();
 try {
  const load=vi.fn().mockRejectedValue(pending());
  const result=waitForEditorSource(load,()=>false).catch(error=>error);
  await vi.advanceTimersByTimeAsync(4999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(55000);
  expect(load).toHaveBeenCalledTimes(13);
  expect(await result).toMatchObject({code:'EDITOR_SOURCE_PREPARING'});
  expect(vi.getTimerCount()).toBe(0);
 } finally { vi.useRealTimers(); }
});
