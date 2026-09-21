# 데이터 처리 국가 확인 문의 — 발송 전 초안

작성일: 2026-09-21. 아직 발송하지 않았다. 아래 수신 주소는 각 업체의 공식 개인정보 페이지에서 확인했다. 실제 토큰, 앱 시크릿, 고객 정보, 데이터베이스 접속 정보는 포함하지 않는다.

Meta 신청서는 보관 지역뿐 아니라 인터넷을 통한 원격 접근 위치를 포함한 모든 처리 국가를 요구한다. 현재 문서로 확인한 기본 서비스 지역만으로 전체 국가 목록을 단정하지 않는다. 두 업체의 답변이나 해당 서비스에 적용되는 공식 목록을 확보한 뒤 입력한다.

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
