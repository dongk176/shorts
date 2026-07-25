import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal-document";
import { createPageMetadata } from "@/lib/seo";
import { getRequestLocale } from "@/lib/i18n/server";
import { privacyTranslations } from "@/lib/i18n/legal-translations";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const translated = locale === "ko" ? undefined : privacyTranslations[locale];
  return createPageMetadata({
    title: `${translated?.title ?? "개인정보처리방침"} | Easy Cut`,
    description: translated?.description ?? "이지컷 AI 쇼츠 제작 서비스 개인정보처리방침입니다.",
    path: "/privacy",
  });
}

export default function PrivacyPage() {
  return (
    <LegalDocument eyebrow="Privacy Policy" title="개인정보처리방침" description="아티룸(이하 “회사”라 한다)은 Easy Cut을 운영하며, 이용자의 개인정보를 필요한 범위에서만 처리하고 안전하게 보호하기 위해 다음과 같이 개인정보처리방침을 공개합니다." effectiveDate="2026년 7월 26일" translations={privacyTranslations}>
      <LegalSection title="1. 개인정보의 처리 목적">
        <p>회사는 다음 목적을 위해 개인정보를 처리합니다.</p>
        <ul><li>• Google 등 소셜 로그인, 이용자 식별 및 계정 관리</li><li>• YouTube 영상 분석, 쇼츠 생성·편집·다운로드 및 프로젝트 관리</li><li>• 구독·추가 상품 결제, 정기결제, 결제 취소 및 거래 대사</li><li>• 서비스 이용량 산정, 요금제 한도 적용 및 부정 이용 방지</li><li>• 방문·이용 통계 분석 및 서비스 개선</li><li>• 오류 대응, 보안 유지, 서비스 품질 개선 및 이용자 문의 처리</li></ul>
      </LegalSection>
      <LegalSection title="2. 처리하는 개인정보 항목">
        <div className="overflow-x-auto"><table><thead><tr><th>구분</th><th>처리 항목</th></tr></thead><tbody>
          <tr><td>소셜 로그인</td><td>계정 식별자, 이메일 주소, 표시 이름, 프로필 이미지, 로그인 제공자 및 최근 로그인 시각</td></tr>
          <tr><td>서비스 이용</td><td>YouTube URL·영상 ID·제목·채널명·길이·썸네일, 생성된 제목·자막·편집 설정·결과물, 프로젝트 상태 및 이용량</td></tr>
          <tr><td>결제</td><td>구매자 이름·이메일·암호화된 연락처, 결제 상품·금액·거래번호, 카드사·카드 종류·마스킹 카드번호, 암호화된 더페이원 카드 ID</td></tr>
          <tr><td>자동 생성 정보</td><td>세션 쿠키, 접속 시각, IP 주소, 브라우저·기기 정보, 요청 및 오류 기록, 유료 기능 사용 시각·필터 조건·결과 수와 연결된 구독·주문 식별자, Google Analytics 방문자 식별자, 방문 페이지, 유입 경로, 대략적 지역 및 이용 이벤트</td></tr>
        </tbody></table></div>
        <p>Easy Cut은 Google 또는 다른 소셜 로그인 제공자의 비밀번호를 수집하거나 저장하지 않습니다. 카드번호·유효기간·생년월일·사업자번호·카드 비밀번호는 결제 요청에만 사용하고 회사 데이터베이스와 애플리케이션 로그에 저장하지 않습니다. 결제 연락처는 반복 입력을 줄이고 결제 처리를 수행하기 위해 AES-256-GCM으로 암호화해 저장하며 애플리케이션 로그에 기록하지 않습니다.</p>
      </LegalSection>
      <LegalSection title="3. 개인정보의 처리 및 보유 기간">
        <ul><li>• 계정 정보: 회원 탈퇴 또는 계정 삭제 요청 시까지</li><li>• 로그인 세션 쿠키: 발급일 또는 마지막 갱신일부터 최대 30일</li><li>• Google Analytics 쿠키 및 이벤트 수준 데이터: 쿠키의 설정 기간과 해당 속성에 설정된 보유 기간 동안</li><li>• 결제·거래 기록: 전자상거래 등 관련 법령이 정한 기간</li><li>• 암호화된 카드 ID와 결제 연락처: 정기결제 종료, 결제수단 폐기 또는 계정 삭제 시까지</li><li>• 전체 원본 영상·추출 오디오·전사 중간 데이터: 쇼츠 생성 작업 중 임시 저장하며 작업 종료 시 삭제</li><li>• 편집용 클립·완성 영상·썸네일·자막 구간: 요금제 정책에 따라 최초 생성일부터 최대 30일</li><li>• 프로젝트, 이용량 및 유료 기능 사용 기록: 계정 유지 기간 또는 결제·환불·분쟁 대응에 필요한 기간</li></ul>
        <p>관련 법령에 따라 보존할 의무가 있는 정보는 해당 법령이 정한 기간 동안 분리하여 보관할 수 있습니다.</p>
      </LegalSection>
      <LegalSection title="4. 개인정보의 제3자 제공">
        <p>회사는 원칙적으로 이용자의 개인정보를 제3자에게 판매하거나 제공하지 않습니다. 법령에 근거가 있거나 이용자가 별도로 동의한 경우에는 예외로 합니다.</p>
      </LegalSection>
      <LegalSection title="5. 처리업무의 위탁 및 외부 서비스 이용">
        <p>서비스 제공을 위해 다음 외부 서비스를 이용할 수 있으며, 각 수탁자는 서비스 제공에 필요한 범위에서 정보를 처리합니다.</p>
        <div className="overflow-x-auto"><table><thead><tr><th>수탁자</th><th>업무 내용</th><th>처리될 수 있는 정보</th></tr></thead><tbody>
          <tr><td>Supabase</td><td>인증 및 데이터베이스 운영</td><td>계정 정보, 프로젝트·이용량 데이터</td></tr>
          <tr><td>Vercel</td><td>웹 호스팅 및 요청 처리</td><td>접속·요청 기록 및 서비스 데이터</td></tr>
          <tr><td>Amazon Web Services</td><td>영상 처리, 임시 작업 및 결과물 저장·전송</td><td>영상·오디오·자막·결과물 및 작업 식별자</td></tr>
          <tr><td>Google</td><td>소셜 로그인, YouTube 정보 조회, AI 구간 분석 및 방문 통계 분석</td><td>로그인 정보, YouTube URL·메타데이터·전사 텍스트, 방문·기기·유입·이용 이벤트 정보</td></tr>
          <tr><td>OpenAI</td><td>전체 영상 오디오 전사 및 Gemini 실패 시 하이라이트 구간·제목 선정</td><td>작업 대상 오디오, 전사 텍스트, 영상 메타데이터</td></tr>
          <tr><td>더페이원</td><td>카드 등록, 구독·단건 결제, 정기결제 및 결제 결과 통지</td><td>구매자 이름·이메일·연락처, 카드 인증정보, 상품·금액·거래 식별자</td></tr>
        </tbody></table></div>
        <p>외부 서비스의 인프라 운영 과정에서 정보가 국외에서 처리될 수 있습니다. 회사는 서비스 제공에 필요한 범위로 전송을 제한하고 각 공급자의 보호조치와 계약 조건을 확인합니다.</p>
      </LegalSection>
      <LegalSection title="6. AI를 이용한 데이터 처리">
        <p>Easy Cut은 모든 작업 영상의 오디오를 OpenAI로 전사합니다. 생성된 전사 텍스트와 영상 메타데이터는 하이라이트 구간 선정 및 제목 생성을 위해 Gemini에 전달될 수 있으며, Gemini가 설정되지 않았거나 요청·응답 처리에 실패하면 OpenAI에 전달될 수 있습니다. 회사는 이용자의 콘텐츠를 자체 AI 모델 학습 데이터로 별도 활용하지 않습니다.</p>
        <p>AI가 생성한 결과에는 오류나 부정확한 내용이 포함될 수 있으므로 이용자는 게시 또는 배포 전에 결과를 확인해야 합니다.</p>
      </LegalSection>
      <LegalSection title="7. 개인정보의 파기 절차 및 방법"><p>보유 기간이 끝나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일은 복구하기 어려운 방식으로 삭제하고 영상 결과물은 애플리케이션 정리 작업과 저장소 수명주기 정책을 통해 삭제합니다.</p></LegalSection>
      <LegalSection title="8. 쿠키의 사용"><p>Easy Cut은 로그인 상태와 프로젝트 소유권을 유지하기 위한 필수 세션 쿠키와 방문자 수, 재방문 및 이용 흐름을 측정하기 위한 Google Analytics 쿠키를 사용합니다. Google Analytics의 광고 저장, 광고 사용자 데이터, 광고 개인화 및 Google Signals 기능은 사용하지 않습니다. 이용자는 브라우저 설정에서 분석 쿠키를 삭제하거나 차단할 수 있으며, 이 경우 방문 통계 집계가 제한되지만 서비스의 일반 기능은 이용할 수 있습니다. 필수 쿠키를 차단하면 로그인이나 프로젝트 기능이 정상적으로 작동하지 않을 수 있습니다.</p></LegalSection>
      <LegalSection title="9. 이용자의 권리와 행사 방법"><p>이용자는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지 및 동의 철회를 요청할 수 있습니다. 서비스 내 고객 지원을 통해 요청하면 본인 확인 후 관련 법령이 정한 절차에 따라 처리합니다.</p></LegalSection>
      <LegalSection title="10. 개인정보의 안전성 확보 조치"><p>회사는 전송 구간 암호화, 접근 권한 제한, 비밀정보의 서버 전용 관리, 비공개 저장소와 서명 URL, 세션 쿠키 보호, 접근 기록 및 정기적인 삭제 정책 등 합리적인 기술적·관리적 보호조치를 적용합니다.</p></LegalSection>
      <LegalSection title="11. 만 14세 미만 아동"><p>Easy Cut은 만 14세 미만 아동을 대상으로 하지 않으며 법정대리인의 동의 없이 만 14세 미만 아동의 개인정보를 의도적으로 수집하지 않습니다.</p></LegalSection>
      <LegalSection title="12. 개인정보 보호책임자 및 문의">
        <div className="overflow-x-auto"><table><tbody>
          <tr><th>개인정보처리자</th><td>아티룸</td></tr><tr><th>대표 및 개인정보 보호책임자</th><td>김동민</td></tr><tr><th>전화</th><td><a href="tel:010-4836-2874" className="text-[#ff8c7c] underline underline-offset-4">010-4836-2874</a> (평일 14:00 ~ 19:00)</td></tr><tr><th>이메일</th><td><a href="mailto:artiroom176@gmail.com" className="text-[#ff8c7c] underline underline-offset-4">artiroom176@gmail.com</a></td></tr><tr><th>주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
        </tbody></table></div>
        <p>개인정보 보호 관련 문의와 권리 행사는 위 고객센터를 통해 접수할 수 있습니다.</p>
        <ul><li>• 개인정보침해신고센터: 국번 없이 118</li><li>• 개인정보분쟁조정위원회: 1833-6972</li></ul>
      </LegalSection>
      <LegalSection title="13. 처리방침의 변경"><p>법령, 서비스 또는 데이터 처리 방식이 변경되는 경우 이 처리방침을 수정할 수 있으며 중요한 변경은 시행 전에 서비스 화면을 통해 안내합니다.</p></LegalSection>
    </LegalDocument>
  );
}
