import { describe, expect, it } from "vitest";
import { creatorEnrollmentSchema, maskCreatorEmail, maskCreatorName, normalizeCreatorChannel } from "./creator-support";

describe("creator support channel identity", () => {
  it("normalizes tracking, scheme, case and trailing slashes without making network requests", () => {
    expect(normalizeCreatorChannel("instagram", "http://www.instagram.com/My.Channel/?igsh=tracking#x"))
      .toEqual({ channelUrl: "https://instagram.com/my.channel", channelKey: "instagram:/my.channel" });
    expect(normalizeCreatorChannel("youtube", "https://m.youtube.com/@MyChannel/?feature=shared").channelKey)
      .toBe("youtube:/@mychannel");
    expect(normalizeCreatorChannel("youtube", "https://youtube.com/channel/UCabcdefghijklmnopqrstuv").channelKey)
      .toBe("youtube:/channel/UCabcdefghijklmnopqrstuv");
  });
  it.each([
    ["youtube", "https://youtube.com/watch?v=abc"], ["youtube", "https://youtube.com/shorts/abc"],
    ["youtube", "https://youtube.com.evil.test/@creator"], ["youtube", "https://evil.test@youtube.com/@creator"],
    ["youtube", "https://youtu.be/abcd"], ["instagram", "https://instagram.com/p/abc"],
    ["instagram", "https://instagram.com/accounts"], ["instagram", "https://instagram.com/user/other"],
    ["instagram", "javascript:alert(1)"], ["instagram", "https://youtube.com/@creator"],
    ["instagram", "https://instagram.com:444/creator"], ["instagram", "https://instagram.com/name%2Fother"],
  ] as const)("rejects %s non-channel URL %s", (platform, value) => {
    expect(() => normalizeCreatorChannel(platform, value)).toThrow();
  });
  it("rejects missing agreement and caller-supplied grant recipient", () => {
    expect(creatorEnrollmentSchema.safeParse({ userId: "victim", email: "victim@example.test" }).success).toBe(false);
  });
});
describe("creator account presentation", () => {
  it.each([null, "", "ka***@kakao.com", "????@kakao.com", "not-an-email"])("does not display unusable email %s", (email) => {
    expect(maskCreatorEmail(email)).toBeNull();
  });
  it("masks actual account data without treating a kakao domain as an identity", () => {
    expect(maskCreatorEmail("person@kakao.com")).toBe("p***@kakao.com");
    expect(maskCreatorEmail("person@gmail.com")).toBe("p***@gmail.com");
    expect(maskCreatorName("홍길동")).toBe("홍**");
    expect(maskCreatorName(null)).toBe("이지컷 회원");
    expect(maskCreatorName("홍")).toBe("홍*");
  });
});
