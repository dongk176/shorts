import { expect,it } from "vitest";
import { RankingSourceQueue } from "./ranking-source-queue";
it("starts three sources immediately, frees failures independently, and bounds queued work", async () => {
  const queue=new RankingSourceQueue(3), starts:number[]=[], ends: (()=>void)[]=[];
  const jobs=Array.from({length:5},(_,i)=>queue.run(async()=>{
    starts.push(i);await new Promise<void>(r=>{ends[i]=r;});if(i===1)throw Error("blocked");return i;
  }).catch(()=>-1));
  expect(starts).toEqual([0,1,2]);
  ends[1]();await jobs[1];await Promise.resolve();
  expect(starts).toEqual([0,1,2,3]);
  ends[2]();await jobs[2];await Promise.resolve();
  expect(starts).toEqual([0,1,2,3,4]);
  ends[0]();ends[3]();ends[4]();
  expect(await Promise.all(jobs)).toEqual([0,-1,2,3,4]);
  expect(await queue.run(async()=>6)).toBe(6);
});
