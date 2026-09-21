# 데이터 처리 국가 확인 문의 — 발송 전 초안

작성일: 2026-09-21. 아직 발송하지 않았다. 아래 수신 주소는 각 업체의 공식 개인정보 페이지에서 확인했다. 실제 토큰, 앱 시크릿, 고객 정보, 데이터베이스 접속 정보는 포함하지 않는다.

Meta 신청서는 보관 지역뿐 아니라 인터넷을 통한 원격 접근 위치를 포함한 모든 처리 국가를 요구한다. 현재 문서로 확인한 기본 서비스 지역만으로 전체 국가 목록을 단정하지 않는다. **업체 이메일 회신이나 확인서 첨부가 Meta의 필수 요건인 것은 아니다.** 공식 공개 자료와 실제 서비스 설정을 먼저 대조한다. 아래 메일은 공개 자료에서 해결되지 않는 사항에 대한 선택적인 문의 초안이며, 답장을 모든 심사 준비의 선행 조건으로 삼지 않는다. 사용자는 공개 자료 우선 확인을 요청했으며 발송은 승인하지 않았다.

## 공개 자료 재확인 — 2026-09-21

- Vercel Trust Center의 공개 Subprocessors 표(표시된 갱신일 2026-08-21)는 업체별 Purpose와 Location을 제공한다. 미국 외에 Tinybird는 Spain, Plain은 United Kingdom으로 표시된다. 이 목록에는 선택형 제품과 지원·결제 업체도 있으므로 모든 업체가 EasyCut의 Meta Platform Data를 처리한다고 단정하지 않는다. https://security.vercel.com/subprocessors
- Supabase의 현행 Subprocessor List 안내는 2026-06-01 PDF를 최신으로 연결한다. PDF는 업체명과 처리 설명을 제공하며 국가 열은 없다. https://supabase.com/legal/customer-resources/subprocessor-list
- 추가로 발견한 Supabase 공식 TIA(2025-03-14), 4쪽은 개인 데이터가 이전될 수 있는 국가를 United States of America와 Singapore로 명시한다. 이는 회사 주소에서 추정한 국가가 아니라 해당 문서에 명시된 이전 국가다. 다만 2026년 DPA 및 업체 목록보다 오래된 문서이므로 이를 현재 EasyCut의 모든 처리·원격 접근 국가를 확정한 자료로 취급하지 않는다. https://supabase.com/downloads/docs/Supabase%2BTIA%2B250314.pdf
- 앞서 확인한 EasyCut의 Vercel 함수 지역은 icn1/iad1, Supabase DB 지역은 Seoul이다. 이는 실제 기본 처리 지역에 대한 근거이며 업체의 모든 원격 지원 위치에 대한 근거는 아니다.
- 이번 작업은 공개 자료 조사와 이 기록 수정뿐이다. 외부 메일 발송, Meta 국가 답변 저장, 배포, DB 변경은 하지 않았다.

## Vercel

To: privacy@vercel.com

Subject: Processing-country information for EasyCut's Meta app review

Hello Vercel Privacy Team,

Artiroom operates EasyCut (https://www.easycut.co.kr), a short-video editing service hosted on Vercel. We are completing Meta app review for our Instagram and Threads publishing integrations.

Meta asks us to list every country where our service providers process Meta Platform Data, explicitly including countries from which personnel or subprocessors remotely access it.

Our Vercel server functions handle Instagram/Threads OAuth exchanges and authenticated publishing requests. The relevant data includes platform user IDs, profile names, access tokens and application secrets. Our currently deployed functions include Seoul (icn1) and Northern Virginia (iad1). We understand that these runtime locations alone may not cover all processing and support access.

Could you confirm:

1. The legal Vercel entity acting as processor for this service.
2. The complete applicable country list for this customer data, including runtime processing, any relevant storage/backups/logging, remote support access and subprocessors.
3. An authoritative, current document or written confirmation supporting that list, distinguishing optional products or subprocessors that do not apply to ordinary Vercel application hosting.

We do not need access to any personal data or credentials in your reply. If the answer depends on account configuration, please identify the necessary non-secret details or a secure support route.

Thank you,
Artiroom — EasyCut
easycut@easycut.co.kr
https://www.easycut.co.kr

## Supabase

To: privacy@supabase.com

Subject: Processing-country information for EasyCut's Meta app review

Hello Supabase Privacy Team,

Artiroom operates EasyCut (https://www.easycut.co.kr), a short-video editing service using Supabase. We are completing Meta app review for our Instagram and Threads publishing integrations.

Meta asks us to list every country where our service providers process Meta Platform Data, explicitly including countries from which personnel or subprocessors remotely access it.

Our PostgreSQL project is hosted in Seoul. It stores platform account IDs and profile details, encrypted OAuth grants, and publishing records such as post IDs and status. Supabase Auth also supports EasyCut account authentication. We understand that the database region and Supabase's registered office do not by themselves establish the full processing-country list.

Could you confirm:

1. The legal Supabase entity acting as processor for this service.
2. The complete applicable country list for this customer data, including database/Auth processing, backups, relevant logs, remote support access and subprocessors.
3. An authoritative, current document or written confirmation supporting that list, distinguishing optional products or subprocessors that are not involved in our use of PostgreSQL and Auth.

We do not need access to any personal data or credentials in your reply. If the answer depends on account configuration, please identify the necessary non-secret details or a secure support route.

Thank you,
Artiroom — EasyCut
easycut@easycut.co.kr
https://www.easycut.co.kr

## 공식 근거

- Vercel contact: https://vercel.com/legal/privacy-notice
- Vercel DPA: https://vercel.com/legal/dpa
- Vercel regions/compliance: https://vercel.com/docs/security/compliance
- Supabase contact: https://supabase.com/privacy
- Supabase DPA: https://supabase.com/legal/customer-resources/data-processing-addendum

외부 업체에 실제 발송하는 메시지이므로 발송에 대한 사용자 지시를 받은 뒤 보낸다. 발신 계정 또는 확인된 발신 별칭을 검증하고, 개인 Gmail 주소를 임의로 EasyCut 사업자 주소처럼 표시하지 않는다.
