'use client';
import { useNavigationLocale } from "@/lib/i18n/provider";
import { useUiText } from "@/lib/i18n/use-ui-text";
import { useEffect, useRef, useState } from 'react';
import { useRankingBackdrop } from "./use-ranking-backdrop";
import { PopularFilterSelect } from '@/components/popular-filter-select';
import { VideoCard, popularVideoParams } from '../실시간인기/popular-videos-explorer';
import type { PopularVideo, PopularVideoCategory, PopularVideoResponse, PopularDiscoveryPeriod } from '@/lib/youtube-popular';

type PickerResponse = PopularVideoResponse & { searchMode?: 'related' | 'keyword' };
async function pickerRequest(params: string, search: string | null, signal: AbortSignal, cursor?: string): Promise<PickerResponse> {
  const response = search
    ? await fetch('/api/ranking-shorts/discover', {method:'POST', signal, cache:'no-store', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...JSON.parse(search),cursor})})
    : await fetch(`/api/youtube/popular?${params}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {signal,cache:'no-store'});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || data.detail || '목록을 불러오지 못했습니다.');
  return data;
}

export default function PopularPicker({onClose,onSelect}:{onClose:()=>void;onSelect:(video:PopularVideo)=>void}) {
  const ui = useUiText();
  const locale = useNavigationLocale();
  const backdrop = useRankingBackdrop(onClose);
  const dialog=useRef<HTMLDialogElement>(null);
  const [category,setCategory]=useState<PopularVideoCategory>('all');
  const [language,setLanguage]=useState(locale === 'en' ? 'en' : 'all');
  const [period,setPeriod]=useState<PopularDiscoveryPeriod>('all');
  const [order,setOrder]=useState<'trending'|'views'>('trending');
  const [reusable,setReusable]=useState(false);
  const [query,setQuery]=useState(''),[search,setSearch]=useState('');
  const [items,setItems]=useState<PopularVideo[]>([]),[cursor,setCursor]=useState<string>();
  const [loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState('');
  const [active,setActive]=useState<string|null>(null),[retry,setRetry]=useState(0);
  const [searchMode,setSearchMode]=useState<'related'|'keyword'>('related');
  const controller=useRef<AbortController|null>(null);
  const params=popularVideoParams(search?'views':order,category,reusable,false,language==='ko',language==='ja',language==='en',period,undefined,undefined,search).toString();
  const searchPayload=search?JSON.stringify({q:search,category,language,period,reusable}):null;
  useEffect(()=>{
    const el=dialog.current; const focus=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';el?.showModal();
    return()=>{el?.close();document.body.style.overflow=overflow;focus?.focus();};
  },[]);
  useEffect(()=>{
    const request=new AbortController();controller.current?.abort();controller.current=request;
    setLoading(true);setMore(false);setError('');setItems([]);setCursor(undefined);setActive(null);
    void pickerRequest(params,searchPayload,request.signal).then(data=>{if(request.signal.aborted)return;setItems(data.items.filter(v=>v.durationSeconds>0&&v.durationSeconds<=180));setCursor(data.nextCursor);setSearchMode(data.searchMode??'related');}).catch(e=>{if(!request.signal.aborted)setError(e instanceof Error?e.message:ui('목록을 불러오지 못했습니다.'));}).finally(()=>{if(!request.signal.aborted)setLoading(false);});
    return()=>request.abort();
  },[params,searchPayload,retry, ui]);
  async function loadMore(){
    if(!cursor||more)return;const request=new AbortController();controller.current?.abort();controller.current=request;setMore(true);setError('');
    try {const data=await pickerRequest(params,searchPayload,request.signal,cursor);if(request.signal.aborted)return;
      setItems(previous=>Array.from(new Map([...previous,...data.items.filter(v=>v.durationSeconds>0&&v.durationSeconds<=180)].map(v=>[v.videoId,v])).values()));setCursor(data.nextCursor);
    }catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:ui('목록을 불러오지 못했습니다.'));}finally{if(!request.signal.aborted)setMore(false);}
  }
  useEffect(()=>()=>controller.current?.abort(),[]);
  return <dialog ref={dialog} className="ranking-popular-picker" aria-labelledby="ranking-popular-title" onCancel={onClose} {...backdrop}>
    <header><div><h2 id="ranking-popular-title">{ui("실시간 인기에서 찾기")}</h2></div><button type="button" onClick={onClose} aria-label={ui("실시간 인기 닫기")}>×</button></header>
    <div className="ranking-popular-scroll">
      <form className="ranking-popular-search" onSubmit={e=>{e.preventDefault();const value=query.normalize('NFKC').trim();if(value&&([...value].length<2||[...value].length>100)){setError(ui('검색어를 2~100자로 입력해 주세요.'));return;}setSearch(value);}}><input aria-label={ui("관련 영상·제목·채널 검색")} value={query} placeholder={ui("원하는 영상 설명이나 채널명으로 검색")} onChange={e=>setQuery(e.target.value)}/><button type="submit">{ui("검색")}</button>{search&&<button type="button" onClick={()=>{setQuery('');setSearch('');}}>{ui("초기화")}</button>}</form>
      <div className="ranking-popular-filters">
        {search?<div className="ranking-related-sort">{ui("관련도순")}</div>:<PopularFilterSelect id="rank-popular-order" label={ui("정렬")} value={order} onChange={setOrder} closeLabel={ui("닫기")} options={[{value:'trending',label:ui('실시간 인기순')},{value:'views',label:ui('조회수순')}]}/>}
        <PopularFilterSelect id="rank-popular-category" label={ui("카테고리")} value={category} onChange={setCategory} closeLabel={ui("닫기")} options={[{value:'all',label:ui('전체 카테고리')},{value:'entertainment',label:ui('예능·엔터테인먼트')},{value:'gaming',label:ui('게임')},{value:'sports',label:ui('스포츠')},{value:'music',label:ui('음악')},{value:'news',label:ui('뉴스')},{value:'science',label:ui('과학·기술')},{value:'howto',label:ui('노하우·스타일')}]}/>
        <PopularFilterSelect id="rank-popular-language" label={ui("언어")} value={language} onChange={setLanguage} closeLabel={ui("닫기")} options={[{value:'all',label:ui('전체 언어')},{value:'ko',label:ui('한국어')},{value:'en',label:ui('영어')},{value:'ja',label:ui('일본어')}]}/>
        <PopularFilterSelect id="rank-popular-period" label={ui("수집 기간")} value={period} onChange={setPeriod} closeLabel={ui("닫기")} options={[{value:'all',label:ui('전체 기간')},{value:'today',label:ui('오늘 수집')},{value:'week',label:ui('최근 7일')}]}/>
        <button type="button" aria-pressed={reusable} className="ranking-reuse-filter" onClick={()=>setReusable(v=>!v)}>{ui("재사용 허용만")}{reusable?'✓':''}</button>
      </div>
      <p className="ranking-popular-count" aria-live="polite">{loading?(search?ui('관련 영상을 찾고 있어요…'):ui('인기 영상을 찾고 있어요…')):ui(`${items.length}개 표시`)}{search&&!loading?(searchMode==='related'?ui(' · 의미·제목·채널을 함께 검색'):ui(' · 제목·채널 검색 결과')):''}</p>
      {error&&<div className="ranking-popular-error" role="alert"><strong>{ui("영상을 불러오지 못했어요")}</strong><p>{error}</p><button type="button" onClick={()=>items.length?void loadMore():setRetry(v=>v+1)}>{ui("다시 시도")}</button></div>}
      {loading?<div className="ranking-popular-loading" role="status">{ui("목록을 불러오는 중…")}</div>:<div className="ranking-popular-grid">{items.map((video,index)=><VideoCard key={video.videoId} video={video} rank={index+1} searching active={active===video.videoId} onOpen={()=>setActive(video.videoId)} onClose={()=>setActive(null)} onSelect={()=>onSelect(video)} selectLabel={ui("쇼츠 선택")} openYoutubeLabel={ui("유튜브로 보기")}/>)}</div>}
      {!loading&&!error&&!items.length&&<div className="ranking-popular-empty"><strong>{search?ui('관련 영상을 찾지 못했어요.'):ui('현재 목록에 3분 이하 영상이 없어요.')}</strong><p>{cursor?ui('다음 목록을 불러오거나 필터를 바꿔보세요.'):ui('검색어나 필터를 바꿔보세요.')}</p></div>}
      {!loading&&cursor&&<button className="ranking-popular-more" type="button" disabled={more} onClick={()=>void loadMore()}>{more?ui('불러오는 중…'):ui('영상 더 불러오기')}</button>}
    </div>
  </dialog>;
}
