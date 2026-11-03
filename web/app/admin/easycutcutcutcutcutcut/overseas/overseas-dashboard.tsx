import { OverseasSignOut } from "./overseas-sign-out";
import Link from "next/link";
import { OverseasOverview } from "./overseas-overview";
import { paddleAdminProduct, formatAdminCurrency } from "@/lib/admin-paddle-contract";
import { overseasPath, type OverseasData, type OverseasTab } from "@/lib/admin-overseas-contract";
import shell from "../admin-shell.module.css";
import styles from "./overseas.module.css";

const tabs: Array<{id:OverseasTab;label:string;icon:string;eyebrow:string}> = [
  {id:"overview",label:"해외 운영 현황",icon:"◎",eyebrow:"International / Overview"},
  {id:"billing",label:"해외 결제",icon:"▤",eyebrow:"International / Payments"},
  {id:"members",label:"해외 회원",icon:"♧",eyebrow:"International / Members"},
  {id:"projects",label:"해외 제작",icon:"▷",eyebrow:"International / Projects"},
];
const count = (n:number) => n.toLocaleString("ko-KR");
const date = (value:string) => new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
const labels:Record<string,string> = {member:"회원",completed:"완료",refunded:"환불 완료",partially_refunded:"부분 환불",chargeback:"차지백",new:"신규",in_progress:"처리 중",waiting_on_customer:"답변 대기",resolved:"해결",closed:"종료",failed:"실패",queued:"대기",running:"제작 중",processing:"처리 중"};

export function OverseasDashboard({data}: {data:OverseasData}) {
  const active = tabs.find(tab=>tab.id===data.filters.tab)!;
  const link = (page:number) => `${overseasPath}?${new URLSearchParams({tab:data.filters.tab,q:data.filters.query,page:String(page)})}`;
  return <main className={shell.shell}>
    <aside className={`${shell.sidebar} ${styles.sidebar}`}>
      <div className={shell.brand}><span className={shell.brandMark} aria-hidden="true"/><div><p className={shell.brandEyebrow}>Easy Cut</p><p className={shell.brandName}>Global Console</p></div></div>
      <div className={styles.scopeBadge}><span aria-hidden="true">◉</span> 해외 전용 · 국내 결제 제외</div>
      <nav className={shell.navigation} aria-label="해외 관리자 메뉴"><p className={shell.navGroupLabel}>INTERNATIONAL</p>{tabs.map(tab=><Link key={tab.id} href={`${overseasPath}?tab=${tab.id}`} prefetch={false} aria-current={active.id===tab.id?"page":undefined} className={`${shell.navLink} ${active.id===tab.id?shell.navLinkActive:""}`}><span className={styles.navIcon} aria-hidden="true">{tab.icon}</span>{tab.label}</Link>)}</nav>
      <div className={styles.sidebarNote}><strong>해외 운영 전용</strong><p>실서비스 해외 거래만 표시합니다.<br/>국내 결제 내역은 포함하지 않습니다.</p></div>
    </aside>
    <div className={`${shell.main} ${styles.main}`}>
      <header className={shell.topbar}><div><p className={shell.pageEyebrow}><span className={shell.liveDot} aria-hidden="true"/>{active.eyebrow}</p><h1 className={shell.pageTitle}>{active.label}</h1></div><div className={shell.topbarActions}><span className={shell.kstBadge}>해외 데이터만 표시 · KST</span><Link className={`${shell.serviceLink} ${styles.refresh}`} href={link(data.filters.page)} prefetch={false}>새로고침 ↗</Link><OverseasSignOut /></div></header>
      <div className={shell.workspace}>
        <section aria-labelledby="overseas-overview-title"><div className={shell.overviewHeading}><div><p className={shell.overviewKicker}>International operations</p><h2 id="overseas-overview-title" className={shell.overviewTitle}>해외 비즈니스만, 한눈에.</h2></div><p className={shell.overviewDescription}>해외 회원과 결제, 제작 현황을 한곳에서 확인하세요.<br/>해외 결제와 이용 기록을 기준으로 집계됩니다.</p></div>
          <OverseasOverview data={data}/>
        </section>
        <section className={styles.sales} aria-label="해외 매출">{data.sales.map(sale=><article key={sale.currency} className={styles.panel}><div className={styles.panelHeading}><h2>{sale.currency==="USD"?"달러 매출":"엔화 매출"}</h2><span className={styles.pill}>{sale.currency}</span></div><p className={styles.money}>{formatAdminCurrency(sale.gross,sale.currency)}</p><p className={styles.muted}>누적 결제 {count(sale.orders)}건 · 실결제 기록</p><dl className={styles.moneyDetails}><div><dt>오늘 결제</dt><dd>{formatAdminCurrency(sale.today,sale.currency)}</dd></div><div><dt>환불 · 차지백</dt><dd>{formatAdminCurrency(sale.refunded+sale.chargeback,sale.currency)}</dd></div><div><dt>차감 후 매출</dt><dd>{formatAdminCurrency(sale.gross-sale.refunded-sale.chargeback,sale.currency)}</dd></div>{sale.pending>0&&<div><dt>환불 승인 대기</dt><dd>{formatAdminCurrency(sale.pending,sale.currency)}</dd></div>}</dl></article>)}</section>
        <p className={styles.muted}>통화별 별도 집계 · 세금 포함, 수수료 차감 전 · 결제 일자는 KST 기록 수신일 기준 · 실결제 테스트 포함</p>
        <section className={styles.panel} aria-label="해외 상세 목록"><div className={styles.panelHeading}><div><h2>{active.id==="overview"?"최근 해외 회원":active.label}</h2><p className={styles.muted}>검색 결과 {count(data.total)}건</p></div><span className={styles.pill}>OVERSEAS ONLY</span></div><form action={overseasPath} method="get" className={styles.search}><input type="hidden" name="tab" value={active.id}/><label className={styles.srOnly} htmlFor="overseas-search">이메일, 이름, 내용, ID 검색</label><input id="overseas-search" name="q" type="search" maxLength={100} defaultValue={data.filters.query} placeholder="이메일, 이름, 내용, ID 검색"/><button type="submit">검색</button></form>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>회원</th><th>{active.id==="billing"?"상품 / 거래 ID":active.id==="projects"?"영상 제목":"구분"}</th><th>상태</th>{active.id==="billing"&&<><th>결제 금액</th><th>환불·차지백</th></>}<th>{active.id==="billing"?"기록 수신일 · KST":"등록일 · KST"}</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><td><strong>{row.name||row.email}</strong>{row.name&&<small>{row.email}</small>}</td><td><span className={styles.rowLabel}>{active.id==="billing"?paddleAdminProduct(row.label):row.label}</span>{active.id==="billing"&&<small>{row.id}</small>}</td><td><span className={styles.status}>{labels[row.status]||row.status}</span></td>{active.id==="billing"&&<><td>{formatAdminCurrency(row.amount||0,row.currency||"USD")}</td><td>{formatAdminCurrency((row.refunded||0)+(row.chargeback||0),row.currency||"USD")}</td></>}<td>{date(row.createdAt)}</td></tr>)}</tbody></table>{data.rows.length===0&&<div className={styles.empty}><span aria-hidden="true">◎</span><h3>{data.filters.query?"검색 결과가 없습니다":"표시할 해외 데이터가 없습니다"}</h3><p>해외 거래와 확인된 해외 이용 기록만 표시합니다.</p></div>}</div>
          <div className={styles.pagination}><span>{data.filters.page} / {data.pages} 페이지</span><div>{data.filters.page>1&&<Link href={link(data.filters.page-1)} prefetch={false}>← 이전</Link>}{data.filters.page<data.pages&&<Link href={link(data.filters.page+1)} prefetch={false}>다음 →</Link>}</div></div>
        </section>
        <details className={styles.policy}><summary>해외 전용 분류 기준</summary><p>결제 내역과 매출은 실서비스 Paddle / PayPal 원장 기준입니다. 계정의 한국어 이름이나 제작 이력과 무관하게 해외 거래를 표시하며, 국내 결제 내역과 sandbox 거래는 포함하지 않습니다. 회원 수에는 해외 결제 회원과 해외 이용이 확인된 회원을 포함하고 운영·탈퇴 계정은 제외합니다. 한국어 영상과 고객 문의 원문은 표시하지 않습니다.</p><p>이 분류는 저장된 이용 기록에 따른 것으로, 국적이나 실제 거주 국가를 보증하지 않습니다. 현재 계정별 국가 정보는 별도로 저장되지 않습니다.</p></details>
      </div>
    </div>
  </main>;
}
