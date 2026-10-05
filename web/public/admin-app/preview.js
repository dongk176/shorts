function previewSnapshot() {
    const checkedAt = "2026-10-05T05:42:00.000Z";
    const ago = minutes => new Date(Date.parse(checkedAt) - minutes * 60_000).toISOString();
    const counts = [11,9,7,12,8,6,10,8,7,5,9,6,8,10,7,8,5,6,7,4,8,6,5,7,4,6,5,4,6,5];
    const dailySales = counts.map((count, index) => ({
      day: new Date(Date.parse(checkedAt) - index * 86400_000).toISOString().slice(0,10),
      currency:"KRW", gross:count*39000, refunds:index === 0 ? 39000 : 0, count,
      newCount:index === 0 ? 4 : 3, renewalCount:count-(index === 0 ? 4 : 3),
    }));
    const payments = counts.flatMap((count, day) => Array.from({ length:count }, (_, index) => ({
      id:day === 0 ? `EC-104${index}` : `EC-D${day}-${index}`, kind:index < (day === 0 ? 4 : 3) ? "new" : "renewal",
      amountMinor:39000, currency:"KRW", occurredAt:ago(day*1440 + index*12+2),
      entitlement:!(day === 0 && index === 1), refundedMinor:day === 0 && index === 8 ? 39000 : 0,
    })));
    const routes = [
      {id:"A-01",identity:"a1",assignedAt:ago(7200),samples:{1:[24,25],6:[143,150],24:[566,590],72:[1680,1750]},recommendation:"유지",reason:"모든 구간에서 안정적인 성공률을 유지하고 있어요.",lastSuccess:ago(1),consecutiveFailures:0,coolingDown:false,failures:[{name:"연결 지연",count:1}]},
      {id:"B-02",identity:"b2",assignedAt:ago(540),samples:{1:[14,20],6:[101,120],24:[166,190],72:[166,190]},recommendation:"관찰",reason:"차단 응답이 늘었지만 다른 경로에서 수집은 완료되고 있어요.",lastSuccess:ago(4),consecutiveFailures:2,coolingDown:false,failures:[{name:"봇 확인",count:4},{name:"요청 제한 · 429",count:2}]},
      {id:"C-03",identity:"c3",assignedAt:ago(5760),samples:{1:[18,18],6:[112,114],24:[437,445],72:[1299,1330]},recommendation:"유지",reason:"최근 1시간 모든 수집 시도가 성공했어요.",lastSuccess:ago(2),consecutiveFailures:0,coolingDown:false,failures:[]},
    ];
    const events = [
      {id:"preview-entitlement",kind:"urgent",title:"이용권 지급이 늦어지고 있어요",subtitle:"결제 후 14분 · 고객 1명",occurredAt:ago(9),impact:"고객 1명",detail:"결제 승인은 완료됐지만 이용권 지급이 확인되지 않았어요.",nextStep:"주문 내역과 이용권 지급 기록을 확인해주세요.",paymentId:"EC-1041",routeId:null,read:false,acknowledged:false,resolved:false,timeline:[{title:"결제 승인",date:ago(14)},{title:"지급 지연 감지",date:ago(9)}]},
      {id:"preview-route",kind:"attention",title:"B-02 성공률이 낮아졌어요",subtitle:"최근 1시간 70% · 다른 경로로 복구",occurredAt:ago(18),impact:"수집 최종 성공 100%",detail:"20번 중 14번 성공했어요. 봇 확인 4건과 요청 제한 2건이 있었어요.",nextStep:"6시간 추세와 다른 IP 상태를 함께 살펴보세요.",paymentId:null,routeId:"B-02",read:false,acknowledged:false,resolved:false,timeline:[{title:"현재 IP 할당",date:ago(540)},{title:"성공률 하락 감지",date:ago(18)}]},
      {id:"preview-payment",kind:"payment",title:"새로운 구독이 시작됐어요",subtitle:"₩39,000 · 이용권 지급 완료",occurredAt:ago(2),impact:"오늘 결제 11건",detail:"신규 구독 결제와 이용권 지급이 모두 완료됐어요.",nextStep:"추가로 확인할 내용이 없어요.",paymentId:"EC-1040",routeId:null,read:false,acknowledged:false,resolved:false,timeline:[{title:"결제 승인",date:ago(2)},{title:"이용권 지급 완료",date:ago(2)}]},
      {id:"preview-recovery",kind:"recovery",title:"제작 대기열이 정상화됐어요",subtitle:"18분 지연 · 대기 작업 12건 처리",occurredAt:ago(84),impact:"12건 처리 완료",detail:"지연됐던 작업이 모두 시작됐고 대기 시간이 정상 범위로 돌아왔어요.",nextStep:"정상 상태를 유지하고 있어요.",paymentId:null,routeId:null,read:true,acknowledged:false,resolved:true,timeline:[{title:"대기 지연 감지",date:ago(102)},{title:"정상화 확인",date:ago(84)}]},
    ];
    return {version:1,mode:"preview",actor:"preview",checkedAt,dailySales,payments,routes,events,
      jobs:{sample:[49,50],window:"최근 1시간",waiting:3,running:4,oldestWaitMinutes:2},
      stages:[{title:"영상 수집",sample:[56,56],duration:"평균 42초"},{title:"AI 분석",sample:[52,52],duration:"평균 1분 18초"},{title:"영상 렌더링",sample:[49,50],duration:"평균 2분 06초"}],
      stats:{activeSubscriptions:128,newMembers:18,unansweredInquiries:2},
      availability:{billing:true,jobs:true,routes:true,alerts:true},monitor:{lastTickAt:checkedAt,pushReady:false}};
  }
export { previewSnapshot };

