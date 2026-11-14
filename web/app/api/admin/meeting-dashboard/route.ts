import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/admin';
import { ensureReadDbReady } from '@/lib/db';
import { apiError, HttpError } from '@/lib/http';
import { loadMeeting } from '@/lib/admin-meeting-server';
import type { MeetingLocale, MeetingPeriod } from '@/lib/admin-meeting';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 try {
  await requireAdminUser();
  const params=new URL(request.url).searchParams,period=params.get('period')||'30',locale=params.get('locale')||'all';
  if(!['7','30','90','all'].includes(period)||!['all','ko','ja','en','unknown'].includes(locale))throw new HttpError(400,'조회 조건을 확인해 주세요.');
  await ensureReadDbReady();
  return NextResponse.json(await loadMeeting(period as MeetingPeriod,locale as MeetingLocale),{headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
 }catch(error){const response=apiError(error,'대시보드를 불러오지 못했습니다. 다시 시도해 주세요.');response.headers.set('Cache-Control','private, no-store');return response;}
}
