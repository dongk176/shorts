import 'server-only';
import { unstable_cache } from 'next/cache';
import { getDb } from './db';
import { meetingQuery } from './admin-meeting-query';
import { meetingRange, type MeetingData, type MeetingLocale, type MeetingPeriod } from './admin-meeting';
const aggregate = unstable_cache(async (period:MeetingPeriod,locale:MeetingLocale,start:string,end:string,previousStart:string|null):Promise<MeetingData>=>{
 const rows=await getDb().unsafe(meetingQuery,[`${start}T00:00:00+09:00`,`${end}T00:00:00+09:00`,locale,`${previousStart||start}T00:00:00+09:00`]);
 const row=rows[0];
 return {period,locale,start,end,previousStart,generatedAt:new Date().toISOString(),daily:row.daily,breakdown:row.breakdown,snapshot:row.snapshot};
},['admin-meeting-v1'],{revalidate:300});
export function loadMeeting(period:MeetingPeriod,locale:MeetingLocale) {
 const {start,end,previousStart}=meetingRange(period);return aggregate(period,locale,start,end,previousStart);
}
