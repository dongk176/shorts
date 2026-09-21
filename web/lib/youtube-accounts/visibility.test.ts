import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { metadata } from "./upload-engine.mjs";
import { uploadInput } from "./uploads";
import { isPrivacy, privacyResult } from "./visibility";
const input = {shortId:"55555555-5555-4555-8555-555555555555",connectionId:"11111111-1111-4111-8111-111111111111",title:"Test",description:"",madeForKids:false,synthetic:false};
it("defaults old drafts and clients to private and rejects invalid visibility or client gate overrides",()=>{
  expect(uploadInput.parse(input).privacy).toBe("private");
  expect(metadata(input).status.privacyStatus).toBe("private");
  for(const privacy of ["PUBLIC","friends",null,{},"",true]) {
    expect(uploadInput.safeParse({...input,privacy}).success).toBe(false);
    expect(isPrivacy(privacy)).toBe(false);
  }
  expect(()=>metadata({...input,privacy:"friends" as never})).toThrow();
  expect(uploadInput.safeParse({...input,allowNonPrivateUploads:true}).success).toBe(false);
});
it("enforces 5000 UTF-8 bytes in both API validation and upload metadata",()=>{
  const within="가".repeat(1666)+"ab";
  expect(Buffer.byteLength(within)).toBe(5000);
  expect(uploadInput.safeParse({...input,description:within}).success).toBe(true);
  expect(()=>metadata({...input,description:within})).not.toThrow();
  const over=within+"가";
  expect(uploadInput.safeParse({...input,description:over}).success).toBe(false);
  expect(()=>metadata({...input,description:over})).toThrow();
});
it("does not label an unverified or downgraded result as publicly uploaded",()=>{
  expect(privacyResult("public",null)).toBe("YouTube 공개 범위 확인 전");
  expect(privacyResult("public","private")).toBe("요청: 공개 · YouTube 확인: 비공개");
  expect(privacyResult("unlisted","unlisted")).toBe("YouTube 확인: 일부 공개");
});
