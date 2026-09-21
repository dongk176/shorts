import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { verifyMetaDeletionRequest } from "./signed-request";
const sign = (value: unknown, secret = "expected") => { const body = Buffer.from(JSON.stringify(value)).toString("base64url"); return createHmac("sha256", secret).update(body).digest("base64url")+"."+body; };
it("requires the correct app signature, exact algorithm, valid identity and timestamp", () => {
  const value = { algorithm:"HMAC-SHA256",user_id:"17841405793187219",issued_at:1000 };
  expect(verifyMetaDeletionRequest(sign(value),"expected",1000)).toEqual({userId:value.user_id,issuedAt:1000});
  for (const input of [sign(value,"different"),sign({...value,algorithm:"none"}),sign({...value,user_id:"../other"}),sign({...value,issued_at:5000}),sign({...value,expires:999}),"unsigned"]) expect(() => verifyMetaDeletionRequest(input,"expected",1000)).toThrow();
});
