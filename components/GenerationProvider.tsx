'use client'

import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { CaptionPerspective, CaptionStyle, CaptionTopic } from '@/lib/generation-options'

export type GenerationInput = {requestId:string;imageId:string;style:CaptionStyle;topic:CaptionTopic;perspective:CaptionPerspective;prompt:string}
export type GenerationResult = {generationId?:string;captionIds?:string[];remaining?:number;error?:string;code?:string}
type Job = {requestId:string;startedAt:number;status:'running'|'pending'|'succeeded'|'failed';generationId?:string;error?:string}
type Service = {busy:boolean;remaining:number|null;job:Job|null;start:(input:GenerationInput)=>Promise<{ok:boolean;status:number;data:GenerationResult}>;check:()=>Promise<void>}
const Context=createContext<Service|null>(null)
const STORAGE_KEY='punchline-active-generation'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function record(value:unknown): value is Record<string,unknown> {return typeof value==='object' && value!==null && !Array.isArray(value)}
function resultData(value:unknown): GenerationResult {
  if (!record(value)) return {code:'save_failed',error:'We could not confirm your captions. Checking their status…'}
  return {
    ...(typeof value.generationId==='string' ? {generationId:value.generationId} : {}),
    ...(Array.isArray(value.captionIds) && value.captionIds.length===3 && value.captionIds.every((id)=>typeof id==='string') ? {captionIds:value.captionIds as string[]} : {}),
    ...(typeof value.remaining==='number' && Number.isInteger(value.remaining) && value.remaining>=0 && value.remaining<=5 ? {remaining:value.remaining} : {}),
    ...(typeof value.error==='string' ? {error:value.error.slice(0,300)} : {}),
    ...(typeof value.code==='string' ? {code:value.code.slice(0,64)} : {}),
  }
}
function validSuccess(value:GenerationResult) {return typeof value.generationId==='string' && UUID.test(value.generationId) && Array.isArray(value.captionIds) && value.captionIds.length===3 && value.captionIds.every((id)=>typeof id==='string' && UUID.test(id)) && new Set(value.captionIds).size===3}

export function useGeneration() {
  const service=useContext(Context)
  if (!service) throw new Error('Caption generation is unavailable outside its provider.')
  return service
}
export default function GenerationProvider({children}:{children:ReactNode}) {
  const [job,setJob]=useState<Job|null>(null)
  const [restoring,setRestoring]=useState(true)
  const restoringRef=useRef(true)
  const [remaining,setRemaining]=useState<number|null>(null)
  const active=useRef<Job|null>(null)
  const checking=useRef(false)
  const router=useRouter()
  const pathname=usePathname()
  const update=useCallback((next:Job|null)=>{
    active.current=next;setJob(next)
    try {
      if (next && (next.status==='running' || next.status==='pending')) sessionStorage.setItem(STORAGE_KEY,JSON.stringify({requestId:next.requestId,startedAt:next.startedAt}))
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {}
  },[])
  const finish=useCallback((current:Job,data:GenerationResult)=>{
    if (active.current?.requestId!==current.requestId) return
    if (typeof data.remaining==='number') setRemaining(Math.max(0,data.remaining))
    update({...current,status:'succeeded',generationId:data.generationId,error:undefined})
    router.refresh()
  },[router,update])
  const check=useCallback(async()=>{
    const current=active.current
    if (!current || checking.current || !['running','pending'].includes(current.status)) return
    checking.current=true
    try {
      const response=await fetch(`/api/generate?requestId=${encodeURIComponent(current.requestId)}`,{cache:'no-store',signal:AbortSignal.timeout(12_000)})
      const data:unknown=await response.json()
      if (active.current?.requestId!==current.requestId || active.current.status==='succeeded') return
      if (!record(data)) return
      const result=resultData(data)
      if (typeof result.remaining==='number') setRemaining(result.remaining)
      if (response.ok && data.status==='succeeded' && validSuccess(result)) {finish(current,result);return}
      if (response.status===401) {update({...current,status:'failed',error:'Sign in again to check your captions.'});return}
      if (response.ok && data.status==='missing' && Date.now()-current.startedAt<70_000) {
        // The original POST may still be reaching the server. Keep its UUID
        // until the 60-second worker window has passed; never start another AI call.
        update({...current,status:'pending'});return
      }
      if (response.ok && (data.status==='failed' || data.status==='missing')) {
        update({...current,status:'failed',error:data.status==='missing' ? 'The connection dropped before this round started. You can try again.' : 'This round did not finish. Your daily generation was returned.'});return
      }
      if (Date.now()-current.startedAt>180_000) update({...current,status:'failed',error:'We could not confirm this round. Check My posts before starting another.'})
    } catch {
      // An interrupted request may still be running. Poll without another AI call.
      if (Date.now()-current.startedAt>180_000 && active.current?.requestId===current.requestId) update({...current,status:'failed',error:'Connection lost. Check My posts before trying again.'})
    } finally {checking.current=false}
  },[finish,update])
  useEffect(()=>{
    const timer=setTimeout(()=>{
      try {
        if (active.current) return
        const saved:unknown=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null')
        const age=record(saved) && typeof saved.startedAt==='number' ? Date.now()-saved.startedAt : -1
        if (record(saved) && typeof saved.requestId==='string' && UUID.test(saved.requestId)
          && typeof saved.startedAt==='number' && Number.isFinite(saved.startedAt) && age>=0 && age<180_000) {
          update({requestId:saved.requestId,startedAt:saved.startedAt,status:'pending'})
          void check()
        } else sessionStorage.removeItem(STORAGE_KEY)
      } catch {} finally {
        restoringRef.current=false
        setRestoring(false)
      }
    },0)
    return ()=>clearTimeout(timer)
  },[check,update])
  useEffect(()=>{
    if (job?.status!=='pending') return
    const timer=setInterval(()=>void check(),4000)
    return ()=>clearInterval(timer)
  },[job?.status,check])
  async function start(input:GenerationInput) {
    if (restoringRef.current || (active.current && ['running','pending'].includes(active.current.status))) return {ok:false,status:409,data:{code:'generation_pending',error:'Your current round is still being generated.'}}
    const current:Job={requestId:input.requestId,startedAt:Date.now(),status:'running'}
    update(current)
    try {
      const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(65_000)})
      const body:unknown=await response.json().catch(()=>null)
      const data=resultData(body)
      if (response.ok && !validSuccess(data)) {data.code='save_failed';data.error='We could not confirm your captions. Checking their status…'}
      if (active.current?.requestId!==current.requestId || active.current.status==='succeeded') return {ok:response.ok && validSuccess(data),status:response.status,data}
      if (typeof data.remaining==='number') setRemaining(Math.max(0,data.remaining))
      if (response.ok && validSuccess(data)) finish(current,data)
      else if (response.ok || !record(body) || (response.status>=500 && !data.code) || data.code==='generation_pending' || data.code==='save_failed') {update({...current,status:'pending'});void check()}
      else update({...current,status:'failed',error:data.error||'This round could not finish. Please try again.'})
      return {ok:response.ok && validSuccess(data),status:response.status,data}
    } catch {
      if (active.current?.requestId!==current.requestId || active.current.status==='succeeded') return {ok:false,status:503,data:{code:'save_failed',error:'We could not confirm that earlier response.'}}
      update({...current,status:'pending'})
      void check()
      return {ok:false,status:503,data:{code:'save_failed',error:'The connection dropped. We are checking for your saved captions.'}}
    }
  }
  const busy=restoring||job?.status==='running'||job?.status==='pending'
  return <Context.Provider value={{busy,remaining,job,start,check}}>{children}
    {job && <aside className={`generation-widget generation-widget-${job.status}`} aria-label="Caption generation status" aria-live="polite">
      <button className="generation-widget-close" type="button" aria-label="Dismiss generation status" onClick={()=>update(null)} disabled={busy}>×</button>
      <strong>{busy ? 'Finding your punchlines…' : job.status==='succeeded' ? 'Three captions are ready.' : 'Generation needs attention'}</strong>
      <p>{busy ? 'You can keep exploring. This round will continue here.' : job.status==='succeeded' ? 'Saved and ready for your verdict.' : job.error}</p>
      {busy ? <><Link href="/explore">{pathname==='/create' ? 'Browse Explore while you wait ↗' : 'Keep exploring ↗'}</Link>{job.status==='pending' && <button type="button" className="text-link" onClick={()=>void check()}>Check status</button>}</>
        : job.status==='succeeded' ? <Link href={`/explore?generation=${encodeURIComponent(job.generationId||'')}`}>View your captions ↗</Link> : <Link href="/create">Back to Create ↗</Link>}
    </aside>}
  </Context.Provider>
}
