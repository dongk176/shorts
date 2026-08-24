import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { detail: "플랜은 결제 승인 또는 예약된 구독 변경으로만 바꿀 수 있습니다." },
    { status: 410 },
  );
}
