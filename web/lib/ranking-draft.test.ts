import {describe,it,expect} from "vitest";
import {defaultRankingDraft,rankingDraftHasContent,parseRankingDraft,rankingDraftKey} from "./ranking-draft";
describe("ranking browser draft",()=>{
 it("does not treat a fresh workspace as a draft",()=>expect(rankingDraftHasContent(defaultRankingDraft())).toBe(false));
 it("preserves sparse slots, cuts, order, design and single sound/music configuration",()=>{
  const d=defaultRankingDraft();d.count=4;d.title="나의 랭킹";d.slots[3]={link:"",label:"마지막",source:{id:"00000000-0000-4000-8000-000000000001",duration:30,width:720,height:1280,hasAudio:true,previewReady:true},start:2.5,end:9};d.orderMode="custom";d.customOrder=[4,2,3,1];d.soundEnabled=true;d.sound="scratch";d.music={id:"00000000-0000-4000-8000-000000000002",name:"music.wav"};d.musicEnabled=true;d.musicVolume=.22;
  expect(parseRankingDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);expect(rankingDraftHasContent(d)).toBe(true);expect(d.slots[0].source).toBe(null);
 });
 it("isolates drafts by authenticated owner",()=>expect(rankingDraftKey("owner-a")).not.toBe(rankingDraftKey("owner-b")));
 it("rejects damaged or unsupported persisted data",()=>{
  expect(parseRankingDraft(null)).toBe(null);expect(parseRankingDraft({...defaultRankingDraft(),version:2})).toBe(null);expect(parseRankingDraft({...defaultRankingDraft(),count:999})).toBe(null);expect(parseRankingDraft({...defaultRankingDraft(),slots:[]})).toBe(null);
 });
 it("saves text-only edits before any server project or video exists",()=>{
  const d=defaultRankingDraft();d.slots[0].link="https://www.youtube.com/shorts/CF2lYqAbBzU";expect(rankingDraftHasContent(d)).toBe(true);expect(parseRankingDraft(d)).toEqual(d);
 });
});
