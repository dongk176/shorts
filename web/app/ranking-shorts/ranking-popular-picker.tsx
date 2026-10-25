'use client';
import { useEffect, useRef, useState } from 'react';
import { useRankingBackdrop } from "./use-ranking-backdrop";
import { PopularFilterSelect } from '@/components/popular-filter-select';
import { VideoCard, popularVideoParams } from '../실시간인기/popular-videos-explorer';
import type { PopularVideo, PopularVideoCategory, PopularVideoResponse, PopularDiscoveryPeriod } from '@/lib/youtube-popular';


export default function PopularPicker({rank,onClose,onSelect}:{rank:number;onClose:()=>void;onSelect:(video:PopularVideo)=>void}) {
  const backdrop = useRankingBackdrop(onClose);
  const dialog=useRef<HTMLDialogElement>(null);
  const [category,setCategory]=useState<PopularVideoCategory>('all');
  const [language,setLanguage]=useState('all');
  const [period,setPeriod]=useState<PopularDiscoveryPeriod>('all');
  const [order,setOrder]=useState<'trending'|'views'>('trending');
  const [reusable,setReusable]=useState(false);
  const [query,setQuery]=useState(''),[search,setSearch]=useState('');
  const [items,setItems]=useState<PopularVideo[]>([]),[cursor,setCursor]=useState<string>();
  const [loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState('');
  const [active,setActive]=useState<string|null>(null),[retry,setRetry]=useState(0);
  const controller=useRef<AbortController|null>(null);
  const params=popularVideoParams(search?'views':order,category,reusable,false,language==='ko',language==='ja',language==='en',period,undefined,undefined,search).toString();
  useEffect(()=>{
    const el=dialog.current; const focus=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';el?.showModal();
    return()=>{el?.close();document.body.style.overflow=overflow;focus?.focus();};
  },[]);
  useEffect(()=>{
    const request=new AbortController();controller.current?.abort();controller.current=request;
    setLoading(true);setMore(false);setError('');setItems([]);setCursor(undefined);setActive(null);
    void fetch(`/api/youtube/popular?${params}`,{signal:request.signal,cache:'no-store'}).then(async response=>{
      const data=await response.json();if(!response.ok)throw Error(data.detail||'목록을 불러오지 못했습니다.');return data as PopularVideoResponse;
    }).then(data=>{if(request.signal.aborted)return;setItems(data.items.filter(v=>v.durationSeconds>0&&v.durationSeconds<=180));setCursor(data.nextCursor);}).catch(e=>{if(!request.signal.aborted)setError(e instanceof Error?e.message:'목록을 불러오지 못했습니다.');}).finally(()=>{if(!request.signal.aborted)setLoading(false);});
    return()=>request.abort();
  },[params,retry]);
  async function loadMore(){
    if(!cursor||more)return;const request=new AbortController();controller.current?.abort();controller.current=request;setMore(true);setError('');
    try {const response=await fetch(`/api/youtube/popular?${params}&cursor=${encodeURIComponent(cursor)}`,{signal:request.signal,cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.detail||'다음 목록을 불러오지 못했습니다.');if(request.signal.aborted)return;
      setItems(previous=>Array.from(new Map([...previous,...(data as PopularVideoResponse).items.filter(v=>v.durationSeconds>0&&v.durationSeconds<=180)].map(v=>[v.videoId,v])).values()));setCursor(data.nextCursor);
    }catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:'목록을 불러오지 못했습니다.');}finally{if(!request.signal.aborted)setMore(false);}
  }
  useEffect(()=>()=>controller.current?.abort(),[]);
  return <dialog ref={dialog} className="ranking-popular-picker" aria-labelledby="ranking-popular-title" onCancel={onClose} {...backdrop}>
    <header><div><h2 id="ranking-popular-title">실시간 인기에서 찾기</h2></div><button type="button" onClick={onClose} aria-label="실시간 인기 닫기">×</button></header>
    <div className="ranking-popular-scroll">
      <form className="ranking-popular-search" onSubmit={e=>{e.preventDefault();const value=query.trim();if(value&&(value.length<2||value.length>100)){setError('검색어를 2~100자로 입력해 주세요.');return;}setSearch(value);}}><input aria-label="제목·채널 검색" value={query} placeholder="제목이나 채널명으로 검색" onChange={e=>setQuery(e.target.value)}/><button type="submit">검색</button>{search&&<button type="button" onClick={()=>{setQuery('');setSearch('');}}>초기화</button>}</form>
      <div className="ranking-popular-filters">
        <PopularFilterSelect id="rank-popular-order" label="정렬" value={order} onChange={setOrder} closeLabel="닫기" options={[{value:'trending',label:'실시간 인기순'},{value:'views',label:'조회수순'}]}/>
        <PopularFilterSelect id="rank-popular-category" label="카테고리" value={category} onChange={setCategory} closeLabel="닫기" options={[{value:'all',label:'전체 카테고리'},{value:'entertainment',label:'예능·엔터테인먼트'},{value:'gaming',label:'게임'},{value:'sports',label:'스포츠'},{value:'music',label:'음악'},{value:'news',label:'뉴스'},{value:'science',label:'과학·기술'},{value:'howto',label:'노하우·스타일'}]}/>
        <PopularFilterSelect id="rank-popular-language" label="언어" value={language} onChange={setLanguage} closeLabel="닫기" options={[{value:'all',label:'전체 언어'},{value:'ko',label:'한국어'},{value:'en',label:'영어'},{value:'ja',label:'일본어'}]}/>
        <PopularFilterSelect id="rank-popular-period" label="수집 기간" value={period} onChange={setPeriod} closeLabel="닫기" options={[{value:'all',label:'전체 기간'},{value:'today',label:'오늘 수집'},{value:'week',label:'최근 7일'}]}/>
        <button type="button" aria-pressed={reusable} className="ranking-reuse-filter" onClick={()=>setReusable(v=>!v)}>재사용 허용만 {reusable?'✓':''}</button>
      </div>
      <p className="ranking-popular-count">{loading?'인기 영상을 찾고 있어요…':`${items.length}개 표시`}{search?' · 검색 결과는 조회수순':''}</p>
      {error&&<div className="ranking-popular-error" role="alert"><strong>영상을 불러오지 못했어요</strong><p>{error}</p><button type="button" onClick={()=>items.length?void loadMore():setRetry(v=>v+1)}>다시 시도</button></div>}
      {loading?<div className="ranking-popular-loading" role="status">목록을 불러오는 중…</div>:<div className="ranking-popular-grid">{items.map((video,index)=><VideoCard key={video.videoId} video={video} rank={index+1} searching active={active===video.videoId} onOpen={()=>setActive(video.videoId)} onClose={()=>setActive(null)} onSelect={()=>onSelect(video)} selectLabel={`${rank}위에 추가하기`}/>)}</div>}
      {!loading&&!error&&!items.length&&<div className="ranking-popular-empty"><strong>현재 목록에 3분 이하 영상이 없어요.</strong><p>{cursor?'다음 목록을 불러오거나 필터를 바꿔보세요.':'검색어나 필터를 바꿔보세요.'}</p></div>}
      {!loading&&cursor&&<button className="ranking-popular-more" type="button" disabled={more} onClick={()=>void loadMore()}>{more?'불러오는 중…':'영상 더 불러오기'}</button>}
    </div>
  </dialog>;
}
