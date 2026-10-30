import { z } from "zod";
import { rankingFramingSchema, type RankingFraming } from "./ranking-framing";
import { rankingStyleSchema, defaultRankingStyle } from "./ranking-templates";
import { rankingSoundSchema } from "./ranking-audio";
import type { RankingSource } from "./ranking-shorts";

export type RankingSlot = { link: string; label: string; source: RankingSource | null; pendingLink?: boolean; start: number; end: number; framing?: RankingFraming };
export const emptyRankingSlots = (): RankingSlot[] => Array.from({length:10}, () => ({link:"",label:"",source:null,start:0,end:0}));
const sourceSchema = z.object({id:z.uuid(),duration:z.number().finite().nonnegative(),durationKnown:z.boolean().optional(),width:z.number(),height:z.number(),hasAudio:z.boolean(),previewReady:z.boolean().optional(),remote:z.object({url:z.string().max(2048),platform:z.enum(["youtube","tiktok","instagram"]),videoId:z.string().max(100)}).optional()});
export const rankingDraftSchema = z.object({
  version:z.literal(1), title:z.string().max(80), subtitle:z.string().max(60), style:rankingStyleSchema,
  count:z.number().int().min(1).max(10), active:z.number().int().min(0).max(9),
  slots:z.array(z.object({link:z.string().max(4096),label:z.string().max(60),source:sourceSchema.nullable(),pendingLink:z.boolean().optional(),start:z.number().finite().nonnegative(),end:z.number().finite().nonnegative(),framing:rankingFramingSchema.optional()})).length(10),
  orderMode:z.enum(["desc","asc","custom"]),customOrder:z.array(z.number().int().min(1).max(10)).max(10),
  soundEnabled:z.boolean(),sound:rankingSoundSchema,musicEnabled:z.boolean(),music:z.object({id:z.uuid(),name:z.string().max(512)}).nullable(),musicVolume:z.number().min(0).max(1),
});
export type RankingDraft = z.infer<typeof rankingDraftSchema>;
export type RankingDraftRecord = {draft:RankingDraft;files:Record<string,File>};
export function defaultRankingDraft(locale:string="ko"):RankingDraft {return {version:1,title:locale==="en"?"Moments you can't miss":"놓치면 아쉬운 순간",subtitle:locale==="en"?"Today's ranking":"오늘의 랭킹",style:defaultRankingStyle,count:5,active:0,slots:emptyRankingSlots(),orderMode:"desc",customOrder:[],soundEnabled:false,sound:"lip-bass",musicEnabled:false,music:null,musicVolume:.15};}
export function rankingDraftHasContent(draft:RankingDraft) {const base=defaultRankingDraft();return draft.slots.some(s=>s.source||s.link||s.label)||![base.title,defaultRankingDraft("en").title].includes(draft.title)||![base.subtitle,defaultRankingDraft("en").subtitle].includes(draft.subtitle)||draft.count!==5||JSON.stringify(draft.style)!==JSON.stringify(base.style)||draft.orderMode!=="desc"||draft.soundEnabled||draft.musicEnabled||Boolean(draft.music);}
export function rankingDraftKey(owner:string){return `easycut:ranking-draft:v1:${owner}`;}
export function parseRankingDraft(value:unknown):RankingDraft|null {const parsed=rankingDraftSchema.safeParse(value);return parsed.success?parsed.data:null;}
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open("easycut-ranking-drafts",1);r.onupgradeneeded=()=>r.result.createObjectStore("drafts");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function readRankingDraft(owner:string):Promise<RankingDraftRecord|null>{
 const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction("drafts","readonly");const r=tx.objectStore("drafts").get(rankingDraftKey(owner));r.onsuccess=()=>{const draft=parseRankingDraft(r.result?.draft);resolve(draft?{draft,files:r.result.files||{}}:null);};r.onerror=()=>reject(r.error);});}finally{db.close();}
}
export async function writeRankingDraft(owner:string,record:RankingDraftRecord|null){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction("drafts","readwrite");const store=tx.objectStore("drafts");if(record)store.put(record,rankingDraftKey(owner));else store.delete(rankingDraftKey(owner));tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
