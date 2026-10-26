import type { Metadata } from "next";
import { createNoIndexMetadata } from "@/lib/seo";
import { OverseasLogin } from "./overseas-login";

export const metadata: Metadata = createNoIndexMetadata("해외 전용 관리자 로그인", "해외 전용 관리자 계정으로 로그인하세요.");
export default function OverseasLoginPage() { return <OverseasLogin />; }
