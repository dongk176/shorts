export type MeetingPeriod = '7' | '30' | '90' | 'all';
export type MeetingLocale = 'all' | 'ko' | 'ja' | 'en' | 'unknown';
export type MeetingGrain = 'week' | 'month';
export type MeetingFact = {day:string;metric:string;currency:string;value:number};
export type MeetingBreakdown = {category:string;label:string;value:number};
export type MeetingSnapshot = {
 members:number; accounts:number; active:number; pastdue:number; cancelscheduled:number;
 channels:number; channelmembers:number; exposed:number; cancelrequests:number;
 previousexposed:number; previouscancelrequests:number; totalaccounts:number; classifiedaccounts:number;
 languagesince:string|null; reasonssince:string|null; memberssince:string|null; onboardingsince:string|null;
};
export type MeetingData = {
 period:MeetingPeriod; locale:MeetingLocale; start:string; end:string; previousStart:string|null;
 generatedAt:string; daily:MeetingFact[]; breakdown:MeetingBreakdown[]; snapshot:MeetingSnapshot;
};
export const meetingLocales:Record<MeetingLocale,string>={all:'전체',ko:'한국어',ja:'일본어',en:'영어',unknown:'분류 안 됨'};
export function kstDay(date:Date) {return new Date(date.getTime()+9*3600_000).toISOString().slice(0,10);}
export function shiftDay(day:string,n:number) {return new Date(Date.parse(`${day}T00:00:00Z`)+n*86400_000).toISOString().slice(0,10);}
export function meetingRange(period:MeetingPeriod,now=new Date()) {
 const end=shiftDay(kstDay(now),1), start=period==='all'?'2000-01-01':shiftDay(end,-Number(period));
 return {start,end,previousStart:period==='all'?null:shiftDay(start,-Number(period))};
}
export function total(data:MeetingData,metric:string,currency='',previous=false) {
 if(previous&&!data.previousStart)return 0;
 const start=previous?data.previousStart!:data.start,end=previous?data.start:data.end;
 return data.daily.filter(x=>x.metric===metric&&x.currency===currency&&x.day>=start&&x.day<end).reduce((n,x)=>n+x.value,0);
}
export function percent(n:number,d:number):number|null {return d>0?n/d*100:null;}
export function change(current:number,previous:number):string {
 if(previous===0)return current===0?'이전 기간과 같음':'이전 기간 0 → 새로 발생';
 const n=(current-previous)/previous*100;return `${n>0?'+':''}${n.toFixed(1)}% · 이전 기간 대비`;
}
export function formatAmount(minor:number,currency:string) {
 return new Intl.NumberFormat('ko-KR',{style:'currency',currency,maximumFractionDigits:currency==='USD'?2:0}).format(minor/(currency==='USD'?100:1));
}
export function bucket(day:string,grain:MeetingGrain) {
 if(grain==='month')return day.slice(0,7)+'-01';
 const weekday=new Date(`${day}T00:00:00Z`).getUTCDay();return shiftDay(day,-((weekday+6)%7));
}
export function series(data:MeetingData,metric:string,currency:string,grain:MeetingGrain) {
 const rows=data.daily.filter(x=>x.metric===metric&&x.currency===currency&&x.day>=data.start&&x.day<data.end);
 const earliest=data.period==='all'?(data.daily.filter(x=>x.day<data.end).map(x=>x.day).sort()[0]||shiftDay(data.end,-1)):data.start;
 const sums=new Map<string,number>();
 for(let day=bucket(earliest,grain);day<data.end;day=grain==='week'?shiftDay(day,7):new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),1)).toISOString().slice(0,10))sums.set(day,0);
 for(const row of rows){const key=bucket(row.day,grain);sums.set(key,(sums.get(key)||0)+row.value);}
 return [...sums].map(([day,value])=>({day,value}));
}
