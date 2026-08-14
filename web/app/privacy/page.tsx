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
    <LegalDocument eyebrow="Privacy Policy" title="개인정보처리방침" description="아티룸(이하 “회사”라 한다)은 Easy Cut을 운영하며, 이용자의 개인정보를 필요한 범위에서만 처리하고 안전하게 보호하기 위해 다음과 같이 개인정보처리방침을 공개합니다." effectiveDate="2026년 8월 14일" translations={privacyTranslations} sectionIds={{ 5: "international-transfers" }}>
      <LegalSection title="1. 개인정보의 처리 목적">
        <p>회사는 다음 목적을 위해 개인정보를 처리합니다.</p>
        <ul><li>• Google 등 소셜 로그인, 이용자 식별 및 계정 관리</li><li>• YouTube 영상 분석, 쇼츠 생성·편집·다운로드 및 프로젝트 관리</li><li>• 프로젝트 완료 등 서비스 운영 알림 발송 및 선택 동의 시 이벤트·할인 등 광고성 정보 제공</li><li>• 구독·추가 상품 결제, 정기결제, 결제 취소 및 거래 대사</li><li>• 레퍼럴 링크 유입 확인, 신규 회원의 추천인 자동 귀속, 파트너 수익 및 정산 관리</li><li>• 서비스 이용량 산정, 요금제 한도 적용 및 부정 이용 방지</li><li>• 방문·이용 통계 분석 및 서비스 개선</li><li>• 오류 대응, 보안 유지, 서비스 품질 개선 및 이용자 문의 처리</li></ul>
      </LegalSection>
      <LegalSection title="2. 처리하는 개인정보 항목">
        <div className="overflow-x-auto"><table><thead><tr><th>구분</th><th>처리 항목</th></tr></thead><tbody>
          <tr><td>소셜 로그인</td><td>계정 식별자, 이메일 주소, 표시 이름, 프로필 이미지, 로그인 제공자 및 최근 로그인 시각</td></tr>
          <tr><td>서비스 이용</td><td>YouTube URL·영상 ID·제목·채널명·길이·썸네일, 생성된 제목·자막·편집 설정·결과물, 프로젝트 상태 및 이용량</td></tr>
          <tr><td>이메일 알림</td><td>계정 이메일, 광고성 이메일 수신 주소, 프로젝트 번호, 발송 내용·상태·시각, 광고성 이메일 수신 동의·거부 상태와 결정 시각</td></tr>
          <tr><td>결제</td><td>구매자 이름·이메일·암호화된 연락처, 결제 상품·금액·거래번호, 카드사·카드 종류·마스킹 카드번호, 암호화된 더페이원 카드 ID</td></tr>
          <tr><td>레퍼럴</td><td>레퍼럴 파트너·캠페인 식별자, 최초 링크 방문·가입 귀속 시각, 추천 회원의 마스킹 이메일, 연결된 결제·환불·수익·정산 내역, 파트너 로그인 아이디·비밀번호 해시 및 암호화된 정산 계좌</td></tr>
          <tr><td>고객 문의</td><td>답변받을 이메일, 문의 유형·내용, 접수 페이지, 브라우저·기기 정보 및 접수 시각</td></tr>
          <tr><td>자동 생성 정보</td><td>세션 쿠키, 접속 시각, IP 주소, 브라우저·기기 정보, 요청 및 오류 기록, 유료 기능 사용 시각·필터 조건·결과 수와 연결된 구독·주문 식별자, Google Analytics 분석 쿠키·방문자 및 세션 식별자, 방문 페이지, 유입 경로, 대략적 지역 및 이용 이벤트</td></tr>
        </tbody></table></div>
        <p>Easy Cut은 Google 또는 다른 소셜 로그인 제공자의 비밀번호를 수집하거나 저장하지 않습니다. 카드번호·유효기간·생년월일·사업자번호·카드 비밀번호는 결제 요청에만 사용하고 회사 데이터베이스와 애플리케이션 로그에 저장하지 않습니다. 결제 연락처는 반복 입력을 줄이고 결제 처리를 수행하기 위해 AES-256-GCM으로 암호화해 저장하며 애플리케이션 로그에 기록하지 않습니다.</p>
      </LegalSection>
      <LegalSection title="3. 개인정보의 처리 및 보유 기간">
        <ul><li>• 계정 프로필, 로그인 세션, 프로젝트, 템플릿, 저장 카드 식별정보 및 결제 연락처: 회원탈퇴 처리 시 지체 없이 삭제</li><li>• 이메일 발송 상태와 광고성 이메일 수신 동의·거부 기록: 회원탈퇴 시까지(법령상 보존이 필요한 경우 해당 기간)</li><li>• 레퍼럴 방문 쿠키와 익명 방문 식별정보: 최초 유효 방문일부터 1년</li><li>• 레퍼럴 귀속·수익·환불·정산 기록: 연결된 거래 기록의 보유기간 동안</li><li>• 계약 또는 청약철회 등에 관한 기록: 5년</li><li>• 대금결제 및 재화·서비스 공급에 관한 기록: 5년</li><li>• 소비자의 불만 또는 분쟁처리에 관한 기록: 3년</li><li>• 표시·광고에 관한 기록: 6개월</li><li>• Google Analytics 분석 쿠키: 생성일부터 최대 2년(브라우저 설정과 Google 정책에 따라 달라질 수 있음), 이벤트 데이터는 해당 속성에 설정된 보유 기간 동안</li><li>• 선택한 원본 영상 구간·추출 오디오·전사 중간 데이터: 쇼츠 생성 작업 중 임시 저장하며 작업 종료 시 삭제</li><li>• 편집용 클립·완성 영상·썸네일·자막 구간: 요금제 정책에 따라 최초 생성일부터 최대 30일</li></ul>
        <p>위 법정 보존기간은 「전자상거래 등에서의 소비자보호에 관한 법률 시행령」 제6조를 기준으로 합니다. 회원탈퇴 시 일반 계정·콘텐츠 데이터는 삭제하고, 법정 보존이 필요한 계약·결제·환불·서비스 공급 증빙만 직접 식별정보를 제거한 가명 식별자와 연결하여 일반 계정정보와 분리된 접근제한 영역에 최소한으로 보관합니다. 진행 중인 분쟁·수사·소송 등 다른 법적 근거가 있는 경우에는 그 해결에 필요한 범위와 기간에 한하여 보존기간이 연장될 수 있습니다.</p>
      </LegalSection>
      <LegalSection title="4. 개인정보의 제3자 제공">
        <p>회사는 원칙적으로 이용자의 개인정보를 제3자에게 판매하거나 제공하지 않습니다. 법령에 근거가 있거나 이용자가 별도로 동의한 경우에는 예외로 합니다.</p>
        <p>레퍼럴로 귀속된 회원의 결제가 발생하면 해당 레퍼럴 파트너에게 정산 확인에 필요한 범위에서 마스킹된 이메일, 결제일, 상품, 결제·환불액 및 파트너 수익 상태를 제공합니다. 카드정보, 전체 이메일, 결제대행사 거래 식별자는 제공하지 않습니다.</p>
      </LegalSection>
      <LegalSection title="5. 개인정보 처리업무의 위탁">
        <p>회사는 서비스 제공에 필요한 업무를 아래 수탁자에게 위탁합니다. 수탁자는 맡은 업무에 필요한 범위에서만 개인정보를 처리하며, 회사는 계약과 공급자 관리 절차를 통해 안전성 확보조치, 목적 외 처리 금지, 재위탁 관리, 사고 통지 및 삭제 의무를 확인합니다.</p>
        <div className="overflow-x-auto"><table><thead><tr><th>수탁자</th><th>위탁 업무</th><th>처리될 수 있는 정보</th><th>주 처리 위치</th></tr></thead><tbody>
          <tr><td>Supabase, Inc.</td><td>소셜 인증 연계, 데이터베이스 운영 및 백업</td><td>계정 정보, 프로젝트·이용량·결제 상태 데이터</td><td>대한민국 서울 리전(주 저장·처리)</td></tr>
          <tr><td>Vercel Inc.</td><td>웹 호스팅, 서버 요청 처리, 배포 및 보안 로그</td><td>접속·요청 기록과 요청에 포함된 서비스 데이터</td><td>미국 중심의 글로벌 인프라</td></tr>
          <tr><td>Amazon Web Services, Inc. 및 AWS Korea</td><td>영상 처리, 작업 중 임시 저장, 결과물 저장·전송</td><td>영상·오디오·자막·결과물과 작업 식별자</td><td>대한민국 서울 리전</td></tr>
          <tr><td>Google LLC</td><td>Google 로그인, YouTube 정보 조회, Gemini AI 분석 및 방문 통계</td><td>로그인 정보, YouTube URL·메타데이터, 전사 텍스트, 분석 쿠키·방문자 및 세션 식별자, 방문·기기·이용 이벤트</td><td>미국 등 글로벌 인프라</td></tr>
          <tr><td>OpenAI OpCo, LLC</td><td>오디오 전사, 대체 하이라이트·제목 및 합성 댓글 문구 생성</td><td>작업 대상 오디오, 전사 텍스트, 영상·클립 메타데이터</td><td>미국 및 하위처리자 운영 국가</td></tr>
          <tr><td>Plus Five Five, Inc. (Resend)</td><td>프로젝트 완료 알림 및 동의한 광고성 이메일 발송</td><td>수신 이메일, 프로젝트 번호, 이메일 내용과 발송 메타데이터</td><td>미국 및 하위처리자 운영 국가</td></tr>
          <tr><td>더페이원</td><td>카드 등록, 구독·단건·정기 결제 및 결제 결과 통지</td><td>구매자 이름·이메일·연락처, 카드 인증정보, 상품·금액·거래 식별자</td><td>대한민국</td></tr>
        </tbody></table></div>
      </LegalSection>
      <LegalSection id="international-transfers" title="6. 개인정보의 국외 이전">
        <p>회사는 아래와 같이 개인정보를 국외로 이전합니다. 서비스 제공에 필수적인 처리위탁·보관은 「개인정보 보호법」 제28조의8 제1항 제3호에 따라 이용계약의 체결·이행에 필요한 범위에서 수행합니다. Google Analytics는 방문·재방문·세션 통계와 서비스 개선을 위해 분석 쿠키를 사용합니다. 광고 저장, 광고 사용자 데이터, 광고 개인화 및 Google Signals는 사용하지 않습니다.</p>
        <div className="overflow-x-auto"><table><thead><tr><th>이전받는 자·연락처</th><th>이전 국가</th><th>이전 항목</th><th>시기·방법</th><th>목적</th><th>보유·이용 기간</th><th>거부 방법·효과</th></tr></thead><tbody>
          <tr>
            <td>Supabase, Inc.<br /><a href="mailto:privacy@supabase.com">privacy@supabase.com</a></td>
            <td>미국(지원·보안·장애 대응 시). 데이터베이스는 대한민국 서울 리전에 주 저장·처리</td>
            <td>계정 정보, 프로젝트·이용량·결제 상태 데이터</td>
            <td>가입·로그인 및 서비스 요청 시 TLS 암호화 통신으로 수시 이전 또는 국외에서 제한적으로 조회</td>
            <td>인증·데이터베이스 운영, 백업, 보안 및 장애 대응</td>
            <td>회사의 해당 정보 보유기간까지. 계약 종료 시 반환기간 30일 후 삭제(법령상 보존 제외)</td>
            <td>고객센터를 통해 이전을 거부할 수 있으나, 인증·프로젝트 기능을 제공할 수 없어 계정형 서비스 이용이 제한됩니다.</td>
          </tr>
          <tr>
            <td>Vercel Inc.<br /><a href="mailto:privacy@vercel.com">privacy@vercel.com</a></td>
            <td>미국(주요 처리) 및 <a href="https://security.vercel.com/" target="_blank" rel="noreferrer">하위처리자 운영 국가</a></td>
            <td>IP 주소, 브라우저·기기 정보, 접속·요청·오류 기록 및 요청에 포함된 서비스 데이터</td>
            <td>웹사이트 접속·API 요청 시 TLS 암호화 통신으로 수시 이전</td>
            <td>웹 호스팅, 요청 처리, 배포, 보안 및 장애 대응</td>
            <td>서비스 제공기간까지. 삭제·계약 종료 후 공급자 백업은 최대 30일(법령상 보존 제외)</td>
            <td>고객센터를 통해 이전을 거부할 수 있으나, 웹사이트와 API를 제공할 수 없어 서비스 이용이 불가합니다.</td>
          </tr>
          <tr>
            <td>Plus Five Five, Inc. (Resend)<br /><a href="mailto:privacy@resend.com">privacy@resend.com</a></td>
            <td>미국(주요 처리) 및 하위처리자 운영 국가</td>
            <td>수신 이메일, 프로젝트 번호, 이메일 제목·본문, 발송 시각·상태와 메시지 식별자</td>
            <td>프로젝트 완료 시 또는 광고성 이메일 수신에 동의한 뒤 발송 시 TLS 암호화 통신으로 이전</td>
            <td>프로젝트 완료 알림 및 동의한 이벤트·할인 등 광고성 이메일 발송</td>
            <td>서비스 제공·계약기간 동안 보유하며, 공급자 계약 종료 후 90일 이내 삭제(법령상 보존 제외)</td>
            <td>고객센터를 통해 국외이전을 거부할 수 있습니다. 완료 알림 이메일은 제공되지 않지만 웹서비스는 이용할 수 있으며, 광고성 이메일을 거부해도 서비스 이용에는 영향이 없습니다.</td>
          </tr>
          <tr>
            <td>Google LLC (Google 로그인·YouTube API)<br /><a href="https://support.google.com/policies/contact/general_privacy_form" target="_blank" rel="noreferrer">개인정보 문의</a></td>
            <td>미국 및 <a href="https://www.google.com/about/datacenters/locations/" target="_blank" rel="noreferrer">Google 데이터센터 운영 국가</a></td>
            <td>Google 계정 식별자·이메일·표시 이름·프로필 이미지, YouTube URL·영상 ID·제목·채널·길이·썸네일</td>
            <td>Google 로그인 또는 YouTube 영상 확인 요청 시 TLS 암호화 통신으로 이전</td>
            <td>로그인·계정 연결 및 YouTube 공개 영상 정보 확인</td>
            <td>계정 연결 및 서비스 제공에 필요한 기간 또는 이용자가 Google 계정 권한을 철회하고 삭제가 완료될 때까지</td>
            <td>Google 로그인을 진행하지 않거나 고객센터를 통해 연결 해제를 요청할 수 있으나, 로그인과 영상 확인이 필요한 기능은 이용할 수 없습니다.</td>
          </tr>
          <tr>
            <td>Google LLC (유료 Gemini API)<br /><a href="https://support.google.com/cloud/contact/dpo" target="_blank" rel="noreferrer">Google Cloud 개인정보 문의</a></td>
            <td>미국 및 Google 또는 그 대리인이 시설을 운영하는 국가</td>
            <td>전사 텍스트, 영상·클립 제목과 메타데이터, 선택 구간 후보, 생성 요청·응답</td>
            <td>쇼츠 생성 작업 중 TLS 암호화 API로 이전</td>
            <td>하이라이트 구간·제목 및 댓글 캡처 템플릿의 합성 댓글 문구 생성, 안전·오남용 방지</td>
            <td>요청·응답과 관련 로그 최대 55일(법령상 보존 제외)</td>
            <td>작업을 제출하지 않는 방법으로 거부할 수 있습니다. 거부하면 AI 기반 쇼츠 생성 기능을 제공할 수 없습니다.</td>
          </tr>
          <tr>
            <td>OpenAI OpCo, LLC<br /><a href="mailto:privacy@openai.com">privacy@openai.com</a></td>
            <td>미국(주요 처리), 대한민국·일본·싱가포르 등 <a href="https://openai.com/policies/sub-processor-list/" target="_blank" rel="noreferrer">하위처리자 처리 국가</a></td>
            <td>작업 영상의 오디오 청크, 전사 텍스트, 영상·클립 제목과 메타데이터, 생성 요청·응답</td>
            <td>쇼츠 생성 작업 중 TLS 암호화 API로 이전</td>
            <td>오디오 전사, Gemini 미사용·실패 시 하이라이트·제목·합성 댓글 문구 생성, 안전·오남용 방지</td>
            <td>오디오 전사 API 입력·출력은 기본 콘텐츠 보유 없음. 텍스트 생성 API 안전 로그는 최대 30일(법령상 보존 또는 중대한 오남용 방지 필요 시 예외)</td>
            <td>작업을 제출하지 않는 방법으로 거부할 수 있습니다. 거부하면 AI 기반 쇼츠 생성 기능을 제공할 수 없습니다.</td>
          </tr>
          <tr>
            <td>Google LLC (Google Analytics 방문 분석)<br /><a href="https://support.google.com/policies/contact/general_privacy_form" target="_blank" rel="noreferrer">개인정보 문의</a></td>
            <td>미국 및 Google 데이터센터 운영 국가</td>
            <td>분석 쿠키·방문자 및 세션 식별자, 접속 시각, 브라우저·기기 정보, 방문 페이지, 유입 경로, 대략적 지역 및 전송 과정에서 처리될 수 있는 IP 주소</td>
            <td>웹사이트 방문·페이지 전환 시 TLS 암호화 통신으로 수시 이전</td>
            <td>방문·재방문·세션 통계 분석 및 서비스 개선</td>
            <td>분석 쿠키는 생성일부터 최대 2년, 이벤트 데이터는 Google Analytics 속성에 설정된 보유기간까지</td>
            <td>브라우저 설정에서 분석 쿠키를 삭제·차단하거나 추적 방지·콘텐츠 차단 기능으로 전송을 제한할 수 있으며, 일반 서비스 이용에는 영향이 없습니다.</td>
          </tr>
        </tbody></table></div>
        <p>국외이전 수탁자나 처리 국가가 변경되면 이 방침을 갱신하고, 중요한 변경은 시행 전에 알립니다. 회사는 전송 구간 암호화, 접근 통제, 최소 전송, 공급자 계약·보호조치 확인, 삭제 및 침해 대응 절차를 적용합니다.</p>
      </LegalSection>
      <LegalSection title="7. AI를 이용한 데이터 처리">
        <p>Easy Cut은 작업 영상의 오디오를 청크로 나누어 OpenAI API로 전사합니다. 전사 텍스트와 영상·클립 메타데이터는 하이라이트 구간·제목을 만들고 댓글 캡처 템플릿에 표시할 합성 댓글 문구를 생성하기 위해 유료 Gemini API로 전송될 수 있습니다. 유료 데이터 처리 조건이 확인되지 않았거나 Gemini 요청이 실패하면 OpenAI API가 해당 텍스트 생성을 수행합니다.</p>
        <p>회사는 AI 공급자의 학습·제품 개선을 위한 데이터 공유에 이용자 콘텐츠를 별도로 제공하거나 이를 자체 AI 모델 학습에 사용하지 않습니다. 운영 설정상 무료 Gemini API로 이용자 콘텐츠를 처리하지 않으며, OpenAI API 입력·출력은 기본적으로 모델 학습에 사용되지 않습니다. 공급자는 안전과 오남용 방지를 위해 제6조의 기간 동안 제한된 로그를 보유할 수 있습니다.</p>
        <p>AI는 화자 생체식별이나 얼굴 인식을 수행하지 않으며, 이용자에게 법적 또는 그와 유사한 중대한 효과를 주는 완전 자동화된 결정을 내리지 않습니다. 생성 결과는 편집 보조 자료로서 오류·누락·부정확하거나 부적절할 수 있고, 합성 댓글은 실제 이용자의 댓글이 아닙니다. 이용자는 게시·배포 전에 결과의 정확성, 적법성 및 권리 관계를 직접 확인해야 합니다.</p>
      </LegalSection>
      <LegalSection title="8. 개인정보의 파기 절차 및 방법"><p>보유 기간이 끝나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 회원탈퇴 시 법정 보존 대상이 아닌 계정·콘텐츠·저장 결제수단 정보는 즉시 삭제하고, 분리 보관한 법정 기록은 각 기록의 보존 만료일이 지나면 진행 중인 법적 보존 사유가 없는지 확인한 후 파기 대상으로 처리합니다. 전자적 파일은 복구하기 어려운 방식으로 삭제하고 영상 결과물은 애플리케이션 정리 작업과 저장소 수명주기 정책을 통해 삭제합니다.</p></LegalSection>
      <LegalSection title="9. 쿠키의 사용"><p>Easy Cut은 로그인 상태와 프로젝트 소유권을 유지하기 위한 필수 세션 쿠키, 레퍼럴 링크의 최초 추천인을 기억하기 위한 1년 만료 쿠키, 방문·재방문·세션 통계와 서비스 개선을 위한 Google Analytics 분석 쿠키를 사용합니다. 레퍼럴 쿠키에는 임의 토큰만 저장하며 실제 파트너 연결정보는 서버에 토큰 해시와 함께 보관합니다. 광고 저장, 광고 사용자 데이터, 광고 개인화 및 Google Signals는 사용하지 않습니다. 필수 쿠키를 차단하면 로그인·프로젝트 또는 추천인 자동 귀속 기능이 정상적으로 동작하지 않을 수 있으며, 분석 쿠키 차단은 일반 서비스 이용에 영향을 주지 않습니다.</p></LegalSection>
      <LegalSection title="10. 이용자의 권리와 행사 방법"><p>이용자는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지, 동의 철회 및 국외이전 거부를 요청할 수 있습니다. 서비스 내 고객 지원을 통해 요청하면 본인 확인 후 관련 법령이 정한 절차에 따라 처리합니다. 필수 처리나 국외이전을 거부하면 해당 정보가 필요한 기능은 제한될 수 있습니다. Google Analytics 분석 쿠키는 브라우저 설정에서 삭제·차단할 수 있고 추적 방지 또는 콘텐츠 차단 기능으로 전송을 제한할 수 있으며, 일반 서비스 이용에는 영향이 없습니다.</p></LegalSection>
      <LegalSection title="11. 개인정보의 안전성 확보 조치"><p>회사는 전송 구간 암호화, 접근 권한 제한, 비밀정보의 서버 전용 관리, 비공개 저장소와 서명 URL, 세션 쿠키 보호, 접근 기록, 공급자 유료·비학습 데이터 처리 조건 확인 및 정기적인 삭제 정책 등 합리적인 기술적·관리적 보호조치를 적용합니다.</p></LegalSection>
      <LegalSection title="12. 만 14세 미만 아동"><p>Easy Cut은 만 14세 미만 아동을 대상으로 하지 않으며 법정대리인의 동의 없이 만 14세 미만 아동의 개인정보를 의도적으로 수집하지 않습니다.</p></LegalSection>
      <LegalSection title="13. 개인정보 보호책임자 및 문의">
        <div className="overflow-x-auto"><table><tbody>
          <tr><th>개인정보처리자</th><td>아티룸</td></tr><tr><th>대표 및 개인정보 보호책임자</th><td>김동민</td></tr><tr><th>전화</th><td><a href="tel:010-4836-2874" className="text-[#ff8c7c] underline underline-offset-4">010-4836-2874</a> (평일 14:00 ~ 19:00)</td></tr><tr><th>이메일</th><td><a href="mailto:artiroom176@gmail.com" className="text-[#ff8c7c] underline underline-offset-4">artiroom176@gmail.com</a></td></tr><tr><th>주소</th><td>서울특별시 마포구 성산로8길 40</td></tr>
        </tbody></table></div>
        <p>개인정보 보호 관련 문의와 권리 행사는 위 고객센터를 통해 접수할 수 있습니다.</p>
        <ul><li>• 개인정보침해신고센터: 국번 없이 118</li><li>• 개인정보분쟁조정위원회: 1833-6972</li></ul>
      </LegalSection>
      <LegalSection title="14. 처리방침의 변경"><p>법령, 서비스, 수탁자 또는 데이터 처리 방식이 변경되는 경우 이 처리방침을 수정할 수 있으며 중요한 변경은 시행 전에 서비스 화면을 통해 안내합니다. AI 공급자, 학습·보유 정책 또는 국외 처리 국가가 바뀌는 경우에도 실제 적용 전에 방침과 작업 화면의 안내를 갱신합니다.</p></LegalSection>
    </LegalDocument>
  );
}
