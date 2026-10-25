import {describe,expect,it,vi} from "vitest";
import {createShortEmbeddings,SHORT_EMBEDDING_DIMENSIONS} from "./short-video-embeddings.mjs";
const vector=()=>Array.from({length:SHORT_EMBEDDING_DIMENSIONS},(_,i)=>i===0?1:0);
describe("short metadata embedding client",()=>{
  it("requests shortened text vectors and restores response order",async()=>{
    const fetcher=vi.fn(async()=>Response.json({data:[{index:1,embedding:vector()},{index:0,embedding:vector()}],usage:{total_tokens:15}}));
    const result=await createShortEmbeddings(["first","second"],{apiKey:"test",fetcher});
    expect(result.vectors).toHaveLength(2);expect(result.tokens).toBe(15);
    const options=fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(options[0]).toBe("https://api.openai.com/v1/embeddings");
    expect(JSON.parse(String(options[1].body))).toEqual({model:"text-embedding-3-small",dimensions:768,encoding_format:"float",input:["first","second"]});
    expect(options[1].signal).toBeInstanceOf(AbortSignal);
  });
  it("never exposes an upstream response body on failure",async()=>{
    const fetcher=vi.fn(async()=>new Response('secret credentials and public titles',{status:429}));
    await expect(createShortEmbeddings(["title"],{apiKey:"test",fetcher})).rejects.toThrow(/^EmbeddingHttp429$/);
  });
  it.each([
    {data:[{index:0,embedding:[1]}]},
    {data:[{index:0,embedding:Array(768).fill(0)}]},
    {data:[{index:0,embedding:vector()},{index:0,embedding:vector()}]},
  ])("rejects malformed vectors or duplicate indexes",async({data})=>{
    await expect(createShortEmbeddings(Array(data.length).fill('text'),{apiKey:"test",fetcher:async()=>Response.json({data})})).rejects.toThrow('EmbeddingResponseInvalid');
  });
  it("does not request the provider without a configured key",async()=>{
    const fetcher=vi.fn();await expect(createShortEmbeddings(['title'],{fetcher})).rejects.toThrow('EmbeddingKeyMissing');expect(fetcher).not.toHaveBeenCalled();
  });
});
