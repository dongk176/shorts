import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { detail: "피드백은 나중에 할 수 없습니다. 피드백을 작성해 주세요." },
    { status: 410 },
  );
}
