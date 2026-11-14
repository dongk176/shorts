import { describe,it,expect } from 'vitest';
import { bucket,change,formatAmount,kstDay,meetingRange,percent,series,total,type MeetingData } from './admin-meeting';
const data={period:'7',locale:'all',start:'2026-11-09',end:'2026-11-16',previousStart:'2026-11-02',daily:[{day:'2026-11-02',metric:'gross',currency:'KRW',value:10},{day:'2026-11-09',metric:'gross',currency:'KRW',value:20},{day:'2026-11-09',metric:'gross',currency:'USD',value:399},{day:'2026-11-16',metric:'gross',currency:'KRW',value:999}]} as MeetingData;
describe('meeting report arithmetic',()=>{
 it('uses Korean midnight and disjoint equal length comparison windows',()=>{expect(kstDay(new Date('2026-11-14T15:01:00Z'))).toBe('2026-11-15');expect(meetingRange('7',new Date('2026-11-14T15:01:00Z'))).toEqual({start:'2026-11-09',end:'2026-11-16',previousStart:'2026-11-02'});});
 it('never mixes currencies or counts end boundary twice',()=>{expect(total(data,'gross','KRW')).toBe(20);expect(total(data,'gross','USD')).toBe(399);expect(total(data,'gross','KRW',true)).toBe(10);});
 it('groups Monday weeks across a year boundary',()=>{expect(bucket('2027-01-01','week')).toBe('2026-12-28');expect(bucket('2027-01-01','month')).toBe('2027-01-01');});
 it('includes empty periods instead of hiding gaps',()=>{expect(series({...data,start:'2026-11-01'},'gross','KRW','week')).toEqual([{day:'2026-10-26',value:0},{day:'2026-11-02',value:10},{day:'2026-11-09',value:20}]);});
 it('does not invent rates for empty denominators',()=>{expect(percent(0,0)).toBeNull();expect(percent(1,4)).toBe(25);expect(change(3,0)).toContain('새로 발생');});
 it('formats JPY as units and USD as cents',()=>{expect(formatAmount(399,'USD')).toContain('3.99');expect(formatAmount(399,'JPY')).toContain('399');});
 it('all time does not compare to an imaginary previous period',()=>{expect(meetingRange('all').previousStart).toBeNull();expect(total({...data,previousStart:null},'gross','KRW',true)).toBe(0);});
});
