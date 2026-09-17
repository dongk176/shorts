"use client";

import { useEffect, useRef, useState } from "react";
import { EXPENSE_CATEGORIES, EXPENSE_ENVIRONMENTS, PAYMENT_METHODS, RECEIPT_LIMIT, copyExpense, emptyExpense, expenseInput, expenseSchema, money, paidAmount, paymentStatus, summarizeExpenses, todayKst, type Expense, type ExpenseAudit, type ExpenseInput, type ExpenseList, type Receipt } from "@/lib/admin-expenses-model";
import { csvText, downloadBlob, xlsxBytes, type ExportTable } from "./export";
import styles from "./expenses.module.css";

const API = "/api/admin/expenses";
async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || "요청을 완료하지 못했습니다. 다시 시도해 주세요.");
  return body as T;
}
function exportTable(items: Expense[], month: string, basis: string): ExportTable[] {
  return [{name:"비용 내역",headers:["비용 ID","귀속월","항목명","분류","거래처·지급 대상","비용 총액(원)","지급 누계(원)","미지급액(원)","상태","증빙 수","사용 구분","반복 여부","지급 예정일","외화 통화","외화 금액","메모"],currencyColumns:[5,6,7],rows:items.map(i=>[i.id,i.month,i.name,i.category,i.vendor,i.amount,paidAmount(i),i.stage==="draft"?null:i.amount-paidAmount(i),paymentStatus(i),i.receipts.length,i.environment,i.recurring?"매월":"일회성",i.dueOn,i.foreignCurrency,i.foreignAmount,i.note])},
  {name:"지급 내역",headers:["비용 ID","항목명","지급일","지급액(원)","지급 방법","메모"],currencyColumns:[3],rows:items.flatMap(i=>i.payments.filter(p=>basis!=="paid"||p.date.startsWith(month)).map(p=>[i.id,i.name,p.date,p.amount,p.method,p.note]))},
  {name:"집계 기준",headers:["항목","내용"],rows:[["조회월",month],["목록 기준",basis==="paid"?"선택월에 지급 내역이 있는 비용":"귀속월"],["내보내기 범위","현재 필터의 비용 전체. 삭제 내역 제외."],["지급 누계","비용별 전체 지급액. 조회월 지급액은 지급 내역 시트를 확인하세요."],["예상 초안","확정 비용·미지급액에 포함하지 않음"],["금액","직접 입력한 원화 총액. 회계·세무 자동 계산 없음"],["증빙","파일 개수만 포함. 원본은 비용 상세에서 다운로드"]]}];
}

export function AdminExpenses() {
  const [month,setMonth]=useState(()=>todayKst().slice(0,7));
  const [items,setItems]=useState<Expense[]>([]);
  const [loadedMonth,setLoadedMonth]=useState("");
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState("");
  const [attempt,setAttempt]=useState(0);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("all");
  const [status,setStatus]=useState("all");
  const [basis,setBasis]=useState("incurred");
  const [missing,setMissing]=useState(false);
  const [deleted,setDeleted]=useState(false);
  const [editing,setEditing]=useState<ExpenseInput|null>(null);
  const [historyItem,setHistoryItem]=useState<Expense|null>(null);
  const [toast,setToast]=useState("");
  const [exporting,setExporting]=useState(false);
  const current=loadedMonth===month&&!loading&&!loadError;
  useEffect(()=>{
    const controller=new AbortController();
    let disposed=false;
    setLoading(true);setLoadError("");
    const timeout=window.setTimeout(()=>controller.abort(),15000);
    fetch(`${API}?month=${month}`,{cache:"no-store",signal:controller.signal})
      .then(responseJson<ExpenseList>).then(data=>{if(!controller.signal.aborted){setItems(data.expenses);setLoadedMonth(data.month);}})
      .catch(error=>{if(!disposed)setLoadError(controller.signal.aborted?"응답이 늦어 중단했습니다. 다시 불러와 주세요.":error.message);})
      .finally(()=>{window.clearTimeout(timeout);if(!disposed)setLoading(false);});
    return()=>{disposed=true;window.clearTimeout(timeout);controller.abort();};
  },[month,attempt]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(""),6000);return()=>clearTimeout(timer);},[toast]);
  const summary=summarizeExpenses(items,month);
  const visible=items.filter(i=>Boolean(i.deletedAt)===deleted&&(basis==="incurred"?i.month===month:i.payments.some(p=>p.date.startsWith(month)))
    &&(category==="all"||i.category===category)&&(status==="all"||paymentStatus(i)===status)
    &&(!missing||(i.stage==="confirmed"&&!i.receipts.length))&&`${i.name} ${i.vendor} ${i.note}`.toLowerCase().includes(query.trim().toLowerCase()));
  const confirmedTotal=visible.filter(i=>i.stage==="confirmed").reduce((n,i)=>n+i.amount,0);
  const draftTotal=visible.filter(i=>i.stage==="draft").reduce((n,i)=>n+i.amount,0);
  function moveMonth(offset:number){const date=new Date(`${month}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()+offset);const next=date.toISOString().slice(0,7);if(/^20\d{2}-/.test(next)){setMonth(next);resetFilters();}}
  function resetFilters(){setQuery("");setCategory("all");setStatus("all");setMissing(false);setDeleted(false);setBasis("incurred");}
  function saved(expense:Expense){
    setItems(previous=>[expense,...previous.filter(i=>i.id!==expense.id)]);
    setEditing(null);setToast(expense.deletedAt?"비용을 삭제했습니다. 변경 이력은 보관됩니다.":"비용을 저장했습니다.");
    if(expense.month!==month)setMonth(expense.month);
  }
  async function exportFile(format:"xlsx"|"csv"){
    setExporting(true);
    try {
      const tables=exportTable(visible.filter(i=>!i.deletedAt),month,basis);
      downloadBlob(format==="csv"?new Blob([csvText(tables[0])],{type:"text/csv;charset=utf-8"}):new Blob([xlsxBytes(tables).buffer as ArrayBuffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),`이지컷-비용-${month}.${format}`);
      setToast("현재 조회 조건의 비용 내역을 내려받았습니다.");
    } catch {setToast("파일을 만들지 못했습니다. 다시 시도해 주세요.");} finally {setExporting(false);}
  }
  return <div className={styles.root}>
    <div className={styles.heading}><div><span className={styles.eyebrow}>MANUAL EXPENSE LEDGER</span><h2>운영 비용을 한곳에서.</h2><p>인건비부터 서비스 이용료까지, 직접 기록하고 확인하세요.</p></div><div className={styles.actions}><button aria-label="이전 달" onClick={()=>moveMonth(-1)}>‹</button><label className={styles.month}>조회월<input type="month" min="2000-01" max="2099-12" value={month} onChange={e=>{if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)){setMonth(e.target.value);resetFilters();}}}/></label><button aria-label="다음 달" onClick={()=>moveMonth(1)}>›</button><button className={styles.primary} onClick={()=>setEditing(emptyExpense(month))}>＋ 비용 등록</button></div></div>
    <div className={styles.metrics} aria-label="월별 비용 요약">
      {[{label:"확정 비용",value:summary.confirmed,note:"선택한 귀속월의 확정 비용",tone:""},{label:"이번 달 지급액",value:summary.paid,note:"귀속월과 무관하게 이번 달 실제 지급",tone:"green"},{label:"미지급액",value:summary.unpaid,note:"선택한 귀속월의 남은 지급액",tone:"amber"},{label:"증빙 미첨부",value:summary.missing,note:"선택한 귀속월의 확정 비용",tone:"purple"}].map((metric,index)=><button key={metric.label} className={`${styles.metric} ${styles[metric.tone]||""}`} disabled={index!==3||!current} onClick={()=>{resetFilters();setMissing(true);}}><span>{metric.label}{index===3?<b>↗</b>:null}</span><strong>{current?(index===3?`${metric.value}건`:money(metric.value)):"—"}</strong><small>{metric.note}</small></button>)}
    </div>
    <div className={styles.card}>
      <div className={styles.listHeading}><div><h3>매입·비용 내역 <span>{current?visible.length:"—"}건</span></h3><p>예상 초안은 확정 비용 합계에 포함되지 않습니다.</p></div><div className={styles.actions}><button disabled={!current||exporting||deleted} onClick={()=>exportFile("xlsx")}>Excel 다운로드</button><button disabled={!current||exporting||deleted} onClick={()=>exportFile("csv")}>CSV</button><button aria-label="목록 새로고침" disabled={loading} onClick={()=>setAttempt(n=>n+1)}>↻</button></div></div>
      <div className={styles.filters}><input aria-label="비용 검색" placeholder="항목명, 거래처 또는 메모 검색" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="분류 필터" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">전체 분류</option>{EXPENSE_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><select aria-label="상태 필터" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">전체 상태</option>{["미지급","일부 지급","지급 완료","예상 초안"].map(s=><option key={s}>{s}</option>)}</select><select aria-label="조회 기준" value={basis} onChange={e=>setBasis(e.target.value)}><option value="incurred">귀속월 기준</option><option value="paid">지급월 기준</option></select></div>
      <div className={styles.options}><div><label><input type="checkbox" checked={missing} onChange={e=>setMissing(e.target.checked)}/>증빙 미첨부만</label><label><input type="checkbox" checked={deleted} onChange={e=>setDeleted(e.target.checked)}/>삭제 내역</label></div><button className={styles.textButton} onClick={resetFilters}>필터 초기화</button></div>
      {loadError?<div className={styles.empty} role="alert"><strong>{loadError}</strong><button onClick={()=>{setLoading(false);setAttempt(n=>n+1);}}>다시 불러오기</button></div>:!current?<div className={styles.empty} role="status">비용 장부를 불러오는 중입니다…</div>:visible.length?<div className={styles.tableScroll}><table><thead><tr><th>항목명·귀속월</th><th>분류</th><th>거래처·지급 대상</th><th className={styles.number}>비용 총액</th><th className={styles.number}>미지급액</th><th>지급 상태</th><th>증빙</th><th><span className={styles.srOnly}>변경 이력</span></th></tr></thead><tbody>{visible.map(item=><tr key={item.id}><td><button className={styles.rowTitle} onClick={()=>item.deletedAt?setHistoryItem(item):setEditing(expenseInput(item))}>{item.name}</button><small>{item.month} · {item.environment}{item.recurring?" · 매월 반복":""}{item.deletedAt?" · 삭제됨":""}</small></td><td><span className={styles.category}>{item.category}</span></td><td>{item.vendor}</td><td className={styles.number}><strong>{money(item.amount)}</strong>{item.foreignCurrency?<small>{item.foreignCurrency} {item.foreignAmount}</small>:null}</td><td className={styles.number}>{item.stage==="draft"?"—":money(item.amount-paidAmount(item))}</td><td><span className={`${styles.badge} ${item.stage==="draft"?styles.draft:paidAmount(item)===item.amount?styles.paid:styles.unpaid}`}>{paymentStatus(item)}</span></td><td><button className={styles.textButton} onClick={()=>item.deletedAt?setHistoryItem(item):setEditing(expenseInput(item))}>{item.receipts.length?`${item.receipts.length}개 첨부`:"미첨부"}</button></td><td><button className={styles.textButton} aria-label={`${item.name} 변경 이력`} onClick={()=>setHistoryItem(item)}>이력</button></td></tr>)}</tbody></table></div>:<div className={styles.empty}><span className={styles.emptyIcon}>＋</span><strong>조회된 비용이 없어요</strong><p>비용을 직접 등록하거나 조회 조건을 바꿔 보세요.</p><button onClick={()=>setEditing(emptyExpense(month))}>첫 비용 등록하기</button></div>}
      <div className={styles.tableFooter}><span>{basis==="incurred"?"귀속월":"지급월"} {month} · 직접 입력한 원화 금액</span><span>조회된 확정 비용 <b>{current?money(confirmedTotal):"—"}</b> <i/> 예상 초안 {current?money(draftTotal):"—"}</span></div>
    </div>
    <div className={styles.footer}><span>금액과 증빙은 직접 등록한 내용만 반영됩니다.</span><span>재무 권한 전용 · 수정·삭제 이력 보관</span></div>
    {editing?<ExpenseEditor key={editing.id} initial={editing} existing={items} onClose={()=>setEditing(null)} onSaved={saved} onCopy={value=>{setEditing(copyExpense(value));setToast("다음 달 예상 초안입니다. 금액을 확인하고 직접 저장해 주세요.");}}/>:null}
    {historyItem?<HistoryDialog item={historyItem} onClose={()=>setHistoryItem(null)}/>:null}
    {toast?<div className={styles.toast} role="status">✓ {toast}<button aria-label="알림 닫기" onClick={()=>setToast("")}>×</button></div>:null}
  </div>;
}

function ExpenseEditor({initial,existing,onClose,onSaved,onCopy}:{initial:ExpenseInput;existing:Expense[];onClose:()=>void;onSaved:(value:Expense)=>void;onCopy:(value:ExpenseInput)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [value,setValue]=useState(initial);
  const [busy,setBusy]=useState(false);
  const [fileBusy,setFileBusy]=useState(false);
  const [error,setError]=useState("");
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [duplicateChecked,setDuplicateChecked]=useState(false);
  const requestRef=useRef({body:"",id:""});
  const paid=paidAmount(value);
  const duplicate=existing.some(i=>!i.deletedAt&&i.id!==value.id&&i.month===value.month&&i.vendor.trim().toLowerCase()===value.vendor.trim().toLowerCase()&&i.amount===value.amount);
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
  const change=<K extends keyof ExpenseInput>(key:K,field:ExpenseInput[K])=>{setValue(current=>({...current,[key]:field}));setDuplicateChecked(false);};
  async function submit(deleting=false){
    if(busy||fileBusy)return;
    setError("");
    if(!deleting){const parsed=expenseSchema.safeParse(value);if(!parsed.success){setError(parsed.error.issues[0].message);return;}if(duplicate&&!duplicateChecked){setError("같은 달·거래처·금액의 비용이 있습니다. 중복 여부를 확인해 주세요.");return;}}
    const payload=deleting?{version:value.version}:{expense:expenseSchema.parse(value)};
    const serialized=JSON.stringify({deleting,...payload});
    if(requestRef.current.body!==serialized)requestRef.current={body:serialized,id:crypto.randomUUID()};
    setBusy(true);
    try {
      const result=await fetch(deleting?`${API}/${value.id}`:API,{method:deleting?"DELETE":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,requestId:requestRef.current.id}),signal:AbortSignal.timeout(25000)}).then(responseJson<{expense:Expense}>);
      onSaved(result.expense);
    }catch(cause){setError(cause instanceof Error&&cause.name!=="TimeoutError"?cause.message:"저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 저장하면 중복 등록되지 않습니다.");}finally{setBusy(false);}
  }
  async function addFiles(files:FileList|null){
    if(!files?.length)return;
    setError("");setFileBusy(true);
    try {
      const incoming=Array.from(files);
      if(incoming.length+value.receipts.length>5||incoming.reduce((n,f)=>n+f.size,0)+value.receipts.reduce((n,r)=>n+r.size,0)>RECEIPT_LIMIT)throw new Error("증빙은 최대 5개, 합계 2MB까지 첨부할 수 있습니다.");
      const receipts=await Promise.all(incoming.map(file=>new Promise<Receipt>((resolve,reject)=>{
        if(!["application/pdf","image/png","image/jpeg","image/webp"].includes(file.type)){reject(new Error("PDF, PNG, JPG, WebP 파일을 선택해 주세요."));return;}
        const reader=new FileReader();reader.onerror=()=>reject(new Error("파일을 읽지 못했습니다."));reader.onload=()=>resolve({id:crypto.randomUUID(),name:file.name,type:file.type as Receipt["type"],size:file.size,data:String(reader.result).split(",")[1]});reader.readAsDataURL(file);
      })));
      change("receipts",[...value.receipts,...receipts]);
    } catch(cause){setError((cause as Error).message);}finally{setFileBusy(false);}
  }
  const disabled=busy||fileBusy;
  return <dialog ref={dialog} className={styles.dialog} onCancel={e=>{if(disabled)e.preventDefault();else onClose();}} aria-labelledby="expense-dialog-title">
    <form onSubmit={e=>{e.preventDefault();void submit();}}><header className={styles.dialogHeader}><div><span className={styles.eyebrow}>매입·비용</span><h2 id="expense-dialog-title">{value.version?"비용 상세·수정":"새 비용 등록"}</h2><p>직접 확인한 비용과 실제 지급 내역을 기록하세요.</p></div><button type="button" aria-label="비용 창 닫기" disabled={disabled} onClick={onClose}>×</button></header>
    <div className={styles.dialogBody}><fieldset disabled={disabled} className={styles.fieldset}>
      <div className={styles.formGrid}><label className={styles.wide}>항목명 *<input autoFocus required maxLength={100} placeholder="예: 9월 직원 급여, 서버 이용료" value={value.name} onChange={e=>change("name",e.target.value)}/></label>
      <label>분류 *<select value={value.category} onChange={e=>change("category",e.target.value as ExpenseInput["category"])}>{EXPENSE_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label>
      <label>거래처·지급 대상 *<input required maxLength={100} placeholder="업체명 또는 이름" value={value.vendor} onChange={e=>change("vendor",e.target.value)}/></label>
      <label>비용 총액 (원) *<input type="number" required min="1" max="1000000000" step="1" value={value.amount||""} onChange={e=>change("amount",Number(e.target.value))}/><small>{value.category==="인건비"?"급여는 공제 전 총액을 입력하세요.":"증빙에 기재된 세액 포함 원화 총액"}</small></label>
      <label>귀속월 *<input type="month" required min="2000-01" max="2099-12" value={value.month} onChange={e=>change("month",e.target.value)}/><small>실제로 비용이 발생한 달</small></label>
      <label>비용 확정 여부<select value={value.stage} onChange={e=>change("stage",e.target.value as ExpenseInput["stage"])}><option value="confirmed">확정 비용</option><option value="draft">예상 초안</option></select></label>
      <label>지급 예정일<input type="date" min="2000-01-01" max="2099-12-31" value={value.dueOn} onChange={e=>change("dueOn",e.target.value)}/></label>
      <label>사용 구분<select value={value.environment} onChange={e=>change("environment",e.target.value as ExpenseInput["environment"])}>{EXPENSE_ENVIRONMENTS.map(c=><option key={c}>{c}</option>)}</select></label>
      <label>반복 여부<select value={String(value.recurring)} onChange={e=>change("recurring",e.target.value==="true")}><option value="false">일회성</option><option value="true">매월 반복 · 직접 복사</option></select></label></div>
      {value.category==="인건비"?<p className={styles.notice}>급여 총액은 한 번만 비용으로 등록하세요. 실수령액 송금과 공제액 납부는 아래 지급 내역에 나눠 기록할 수 있습니다. 급여·세액은 자동 계산하지 않습니다.</p>:null}
      <section className={styles.formSection}><div className={styles.sectionTitle}><h3>지급 내역 <span>{paymentStatus(value)}</span></h3><button type="button" disabled={value.stage==="draft"||value.payments.length>=36||paid>=value.amount} onClick={()=>change("payments",[...value.payments,{id:crypto.randomUUID(),date:todayKst(),amount:Math.max(0,value.amount-paid),method:"계좌이체",note:""}])}>＋ 지급 내역 추가</button></div><p>실제로 지급한 날짜와 금액을 입력하세요. 분할 지급도 기록할 수 있습니다.</p>
      {value.payments.map((payment,index)=><div className={styles.payment} key={payment.id}><label>지급일 {index+1}<input type="date" required min="2000-01-01" max={todayKst()} value={payment.date} onChange={e=>change("payments",value.payments.map(p=>p.id===payment.id?{...p,date:e.target.value}:p))}/></label><label>지급액 (원)<input type="number" required min="1" max="1000000000" step="1" value={payment.amount||""} onChange={e=>change("payments",value.payments.map(p=>p.id===payment.id?{...p,amount:Number(e.target.value)}:p))}/></label><label>지급 방법<select value={payment.method} onChange={e=>change("payments",value.payments.map(p=>p.id===payment.id?{...p,method:e.target.value as typeof p.method}:p))}>{PAYMENT_METHODS.map(m=><option key={m}>{m}</option>)}</select></label><button type="button" aria-label={`지급 내역 ${index+1} 삭제`} onClick={()=>change("payments",value.payments.filter(p=>p.id!==payment.id))}>×</button><label className={styles.paymentNote}>지급 메모<input maxLength={200} placeholder="예: 실수령액 송금, 공제액 납부, 카드 끝 4자리" value={payment.note} onChange={e=>change("payments",value.payments.map(p=>p.id===payment.id?{...p,note:e.target.value}:p))}/></label></div>)}
      {!value.payments.length?<div className={styles.paymentEmpty}>{value.stage==="draft"?"예상 초안에는 지급 내역이 없습니다.":"아직 입력한 지급 내역이 없습니다."}</div>:null}<div className={styles.paymentSummary}><span>지급 합계 <b>{money(paid)}</b></span><span>남은 지급액 <b>{value.stage==="draft"?"—":money(value.amount-paid)}</b></span></div></section>
      <section className={styles.formSection}><div className={styles.sectionTitle}><h3>증빙 파일 <span>{value.receipts.length}/5</span></h3></div><label className={styles.upload}>＋ 영수증·인보이스·세금계산서 첨부<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" aria-label="증빙 파일 첨부" onChange={e=>{void addFiles(e.target.files);e.target.value="";}}/><small>PDF, PNG, JPG, WebP · 파일 합계 2MB 이내</small></label>{value.receipts.map(r=><div className={styles.receipt} key={r.id}><span>{r.data?<span>{r.name} · 저장 대기</span>:<a href={`${API}/${value.id}/receipts/${r.id}`}>{r.name}</a>}<small>{Math.ceil(r.size/1024)}KB</small></span><button type="button" aria-label={`${r.name} 첨부 제거`} onClick={()=>change("receipts",value.receipts.filter(item=>item.id!==r.id))}>제거</button></div>)}</section>
      <details className={styles.foreign}><summary>해외 결제 정보 (선택)</summary><div className={styles.formGrid}><label>외화 통화<select value={value.foreignCurrency} onChange={e=>{change("foreignCurrency",e.target.value as ExpenseInput["foreignCurrency"]);if(!e.target.value)change("foreignAmount","");}}><option value="">원화 결제</option>{["USD","EUR","JPY","GBP","CNY"].map(c=><option key={c}>{c}</option>)}</select></label><label>외화 금액<input type="number" min="0.01" step="0.01" disabled={!value.foreignCurrency} value={value.foreignAmount} onChange={e=>change("foreignAmount",e.target.value)}/></label></div><p>합계에는 위에서 입력한 원화 비용 총액만 반영됩니다.</p></details>
      <label className={styles.note}>메모<textarea rows={3} maxLength={2000} placeholder="사용 목적, 청구서 번호, 확인할 사항" value={value.note} onChange={e=>change("note",e.target.value)}/></label>
      {duplicate?<label className={styles.duplicate}><input type="checkbox" checked={duplicateChecked} onChange={e=>setDuplicateChecked(e.target.checked)}/>같은 달·거래처·금액의 내역을 확인했으며, 별도 비용입니다.</label>:null}
    </fieldset>{error?<div className={styles.error} role="alert">{error}</div>:null}
    {confirmDelete?<div className={styles.deleteConfirm}><p>이 비용을 삭제할까요? 합계에서 제외되며 변경 이력과 증빙은 보관됩니다.</p><button type="button" className={styles.danger} disabled={disabled} onClick={()=>submit(true)}>삭제 확정</button><button type="button" disabled={disabled} onClick={()=>setConfirmDelete(false)}>유지하기</button></div>:null}</div>
    <footer className={styles.dialogFooter}><div>{value.version?<><button type="button" className={styles.textButton} disabled={disabled} onClick={()=>setConfirmDelete(true)}>삭제</button><button type="button" disabled={disabled} onClick={()=>onCopy(value)}>다음 달 초안 복사</button></>:<small>저장하면 비용 장부에 반영됩니다.</small>}</div><div><button type="button" disabled={disabled} onClick={onClose}>취소</button><button className={styles.primary} type="submit" disabled={disabled}>{fileBusy?"파일 읽는 중…":busy?"저장 중…":"저장하기"}</button></div></footer></form>
  </dialog>;
}

function HistoryDialog({item,onClose}:{item:Expense;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [history,setHistory]=useState<ExpenseAudit[]|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{const el=dialog.current;el?.showModal();const controller=new AbortController();fetch(`${API}/${item.id}`,{cache:"no-store",signal:controller.signal}).then(responseJson<{history:ExpenseAudit[]}>).then(data=>setHistory(data.history)).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});return()=>{controller.abort();el?.close();};},[item.id]);
  return <dialog ref={dialog} className={styles.dialog} onCancel={onClose} aria-labelledby="expense-history-title"><header className={styles.dialogHeader}><div><span className={styles.eyebrow}>변경 이력</span><h2 id="expense-history-title">{item.name}</h2><p>최근 변경 100건 · 한국 시간</p></div><button aria-label="변경 이력 닫기" onClick={onClose}>×</button></header><div className={styles.dialogBody}>{error?<p role="alert">{error}</p>:!history?<p>이력을 불러오는 중입니다…</p>:history.map(entry=><details className={styles.history} key={entry.id}><summary><strong>{{created:"등록",updated:"수정",deleted:"삭제"}[entry.action]} · {money(entry.after.amount)}</strong><span>{new Date(entry.date).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} · {entry.actor}</span></summary><div className={styles.historyCompare}>{[{label:"변경 전",value:entry.before},{label:"변경 후",value:entry.after}].map(snapshot=><section key={snapshot.label}><h3>{snapshot.label}</h3>{snapshot.value?<><p>{snapshot.value.name} · {snapshot.value.vendor}</p><p>{snapshot.value.category} · {snapshot.value.month} · {money(snapshot.value.amount)}</p><p>{paymentStatus(snapshot.value)} · 지급 누계 {money(paidAmount(snapshot.value))}</p><p>{snapshot.value.note||"메모 없음"}</p><p>증빙: {snapshot.value.receipts.length?snapshot.value.receipts.map(r=><a key={r.id} href={`${API}/${item.id}/receipts/${r.id}`} style={{display:"block"}}>{r.name}</a>):"없음"}</p></>:<p>신규 등록</p>}</section>)}</div></details>)}{item.deletedAt&&item.receipts.length?<div className={styles.formSection}><h3>보관된 증빙</h3>{item.receipts.map(r=><p key={r.id}><a href={`${API}/${item.id}/receipts/${r.id}`}>{r.name}</a></p>)}</div>:null}</div><footer className={styles.dialogFooter}><span/><button onClick={onClose}>닫기</button></footer></dialog>;
}
