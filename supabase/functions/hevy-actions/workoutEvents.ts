import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import { deliverMcpEvent } from "./webhook.ts";

export const WORKOUT_EVENT_NAME="training.workout_completed";
const DAY=86400000;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function workoutSubscriptionInput(params:unknown,subscribe:boolean) {
  if (!object(params)||params.name!==WORKOUT_EVENT_NAME||!exact(params.arguments,[])||params.cursor!=null||Object.keys(params).some(k=>!["name","arguments","delivery","cursor","ttlMs","_meta"].includes(k))) throw new Error('Invalid subscription');
  if (params._meta!=null&&!object(params._meta)) throw new Error('Invalid metadata');
  const d=params.delivery;
  if (!exact(d,subscribe?["mode","url","secret"]:["mode","url"])||!object(d)||d.mode!=="webhook"||typeof d.url!=='string'||d.url.length>2048) throw new Error('Invalid delivery');
  let url:URL;try{url=new URL(d.url);}catch{throw new Error('Invalid callback');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443')throw new Error('Invalid callback');
  if(subscribe&&(typeof d.secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(d.secret)))throw new Error('Invalid secret');
  if(params.ttlMs!=null&&(typeof params.ttlMs!=='number'||!Number.isFinite(params.ttlMs)||params.ttlMs<=0))throw new Error('Invalid lifetime');
  return {url:url.href,secret:subscribe?String(d.secret):null,ttl:Math.max(60000,Math.min(typeof params.ttlMs==='number'?params.ttlMs:DAY,7*DAY))};
}
export async function workoutSubscriptionId(userId:string,ownerId:string,url:string) {
  const bytes=new TextEncoder().encode(JSON.stringify([userId,ownerId,WORKOUT_EVENT_NAME,url]));
  return 'sub_'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function changeWorkoutSubscription(db:SupabaseClient,userId:string,ownerId:string,params:unknown,subscribe:boolean,send=deliverMcpEvent,now=Date.now()) {
  if(typeof ownerId!=='string'||!ownerId||ownerId.length>256)throw new Error('Invalid owner');
  const input=workoutSubscriptionInput(params,subscribe),id=await workoutSubscriptionId(userId,ownerId,input.url);
  if(!subscribe){const {error}=await db.from('hevy_chat_subscriptions').delete().eq('id',id).eq('user_id',userId).eq('site_owner_id',ownerId);if(error)throw new Error('Unsubscribe failed');return {};}
  const challenge=crypto.randomUUID();
  const verified=await send({url:input.url,subscriptionId:id,secret:input.secret,event:{type:'verification',challenge}});
  if(!verified.accepted||verified.challenge!==challenge)throw new Error('Callback verification failed');
  const expiresAt=new Date(now+input.ttl).toISOString();
  const {error}=await db.rpc('save_chat_subscription',{p_user_id:userId,p_owner_id:ownerId,p_id:id,p_url:input.url,p_secret:input.secret,p_expires_at:expiresAt});
  if(error)throw new Error('Subscription could not be saved');
  return {id,refreshBefore:expiresAt,cursor:null,truncated:false};
}

/** A no-change import performs one bounded queue claim, never dashboard/model reads. */
export async function drainWorkoutEvents(db:SupabaseClient,userId:string,send=deliverMcpEvent,now=Date.now()) {
  const {data,error}=await db.rpc('claim_chat_event_deliveries',{p_user_id:userId,p_limit:4});
  if(error)throw new Error('Event queue unavailable');
  let accepted=0;
  for(const row of data||[]) {
    const {data:active,error:activeError}=await db.from('hevy_chat_subscriptions').select('signing_secret,expires_at,previous_secret,rotation_until').eq('id',row.subscription_id).eq('user_id',userId).maybeSingle();
    if(activeError||!active||Date.parse(active.expires_at)<=now||active.signing_secret!==row.signing_secret)continue;
    let result;
    try { result=await send({url:row.callback_url,subscriptionId:row.subscription_id,secret:active.signing_secret,
      ...(active.previous_secret&&Date.parse(active.rotation_until)>now?{previousSecret:active.previous_secret}:{}),
      event:{eventId:row.event_id,name:WORKOUT_EVENT_NAME,timestamp:new Date(row.occurred_at).toISOString(),data:{kind:'training',workout_id:row.workout_id},cursor:null}}); }
    catch { result={accepted:false,status:null,errorCode:'transport_failed'}; }
    const status=result.accepted?'accepted':result.status!=null&&result.status>=400&&result.status<500&&result.status!==429||['invalid_input','invalid_callback','invalid_secret','unsafe_address','invalid_event','invalid_subscription'].includes(result.errorCode||'')?'terminal':'retry';
    const finished=await db.rpc('finish_chat_event_delivery',{p_user_id:userId,p_subscription_id:row.subscription_id,p_event_id:row.event_id,p_lease_token:row.lease_token,p_result:status});
    if(finished.error)throw new Error('Event acceptance could not be recorded');
    if(result.accepted)accepted++;
    if(result.status===410)await db.from('hevy_chat_subscriptions').delete().eq('id',row.subscription_id).eq('user_id',userId);
  }
  return {accepted};
}
