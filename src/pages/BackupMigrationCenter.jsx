import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Download, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '../components/AuthGuard'
import { useToast } from '../components/UI'
import { neonAccountsRuntime } from '../lib/neonRuntime'
import registry from '../migration-registry.json'

const OWNER_EMAIL='jacky0530@gmail.com'
const day=()=>new Date().toISOString().slice(0,10)
const saveBlob=(name,content,type)=>{
  const blob=new Blob([content],{type})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
}
const saveJson=(name,data)=>saveBlob(name,JSON.stringify(data,null,2),'application/json;charset=utf-8')
const saveText=(name,data)=>saveBlob(name,data,'text/plain;charset=utf-8')
const qi=v=>`"${String(v??'').replace(/"/g,'""')}"`
const qs=v=>`'${String(v??'').replace(/'/g,"''")}'`
const udtMap={int2:'smallint',int4:'integer',int8:'bigint,float4:'real',float8:'double precision',bool:'boolean',varchar:'character varying',bpchar:'character',timestamptz:'timestamp with time zone',timestamp:'timestamp without time zone',timetz:'time with time zone',time:'time without time zone',numeric:'numeric',text:'text',uuid:'uuid',json:'json',jsonb:'jsonb',date:'date',bytea:'bytea'}
const colType=c=>{
  if(c.data_type==='ARRAY')return `${udtMap[String(c.udt_name||'').replace(/^_/,'')]||qi(String(c.udt_name||'').replace(/^_/,''))}[]`
  if(c.data_type==='USER-DEFINED')return qi(c.udt_name)
  if(['character varying','character'].includes(c.data_type)&&c.character_maximum_length)return `${c.data_type}(${c.character_maximum_length})`
  if(c.data_type==='numeric'&&c.numeric_precision){return c.numeric_scale!=null?`numeric(${c.numeric_precision},${c.numeric_scale})`:`numeric(${c.numeric_precision})`}
  if(['timestamp with time zone','timestamp without time zone','time with time zone','time without time zone'].includes(c.data_type)&&c.datetime_precision!=null)return `${c.data_type}(${c.datetime_precision})`
  return c.data_type||udtMap[c.udt_name]||c.udt_name||'text'
}
const colDef=c=>{
  let s=`  ${qi(c.column_name)} ${colType(c)}`
  if(c.is_generated&&c.is_generated!=='NEVER'&&c.generation_expression)s+=` GENERATED ALWAYS AS (${c.generation_expression}) STORED`
  else if(c.is_identity==='YES')s+=` GENERATED ${c.identity_generation||'BY DEFAULT'} AS IDENTITY`
  else if(c.column_default!=null)s+=` DEFAULT ${c.column_default}`
  if(c.is_nullable==='NO')s+=' NOT NULL'
  return s
}
const sqlValue=(value,c)=>{
  if(value===null||value===undefined)return 'NULL'
  if(c?.data_type==='ARRAY'){
    const t=colType(c)
    if(Array.isArray(value))return value.length?`ARRAY[${value.map(v=>v==null?'NULL':qs(typeof v==='object'?JSON.stringify(v):v)).join(',')}]::${t}`:`ARRAY[]::${t}`
    return `${qs(value)}::${t}`
  }
  if(c?.data_type==='json'||c?.data_type==='jsonb'||['json','jsonb'].includes(c?.udt_name))return `${qs(typeof value==='string'?value:JSON.stringify(value))}::${c.udt_name||c.data_type}`
  if(c?.data_type==='boolean'||c?.udt_name==='bool')return value===true||String(value)==='true'?'TRUE':'FALSE'
  if(typeof value==='number'&&Number.isFinite(value))return String(value)
  if(typeof value==='bigint')return String(value)
  if(typeof value==='object')return qs(JSON.stringify(value))
  return qs(value)
}
const buildSchemaParts=o=>{
  const head=[];const tail=[]
  head.push('-- 團購百貨 PostgreSQL Schema Backup',`-- Generated: ${new Date().toISOString()}`,'-- Secrets are intentionally excluded.',"SET client_encoding = 'UTF8';",'SET standard_conforming_strings = on;','')
  for(const e of o.enums||[])head.push(`CREATE TYPE public.${qi(e.type_name)} AS ENUM (${(e.labels||[]).map(qs).join(', ')});`)
  if((o.enums||[]).length)head.push('')
  for(const s of o.sequences||[]){head.push(`CREATE SEQUENCE public.${qi(s.sequence_name)} START WITH ${s.start_value} INCREMENT BY ${s.increment_by} MINVALUE ${s.min_value} MAXVALUE ${s.max_value} ${s.cycle?'CYCLE':'NO CYCLE'} CACHE ${s.cache_size};`)}
  if((o.sequences||[]).length)head.push('')
  for(const t of o.tables||[]){
    const cols=(o.columns||[]).filter(c=>c.table_name===t).sort((a,b)=>Number(a.ordinal_position)-Number(b.ordinal_position))
    head.push(`CREATE TABLE public.${qi(t)} (\n${cols.map(colDef).join(',\n')}\n);`,'')
  }
  for(const owner of o.sequence_owners||[])tail.push(`ALTER SEQUENCE public.${qi(owner.sequence_name)} OWNED BY public.${qi(owner.table_name)}.${qi(owner.column_name)};`)
  if((o.sequence_owners||[]).length)tail.push('')
  for(const f of o.functions||[])tail.push(String(f.definition||'').trim().replace(/;?$/,';'),'')
  for(const c of o.constraints||[])tail.push(`ALTER TABLE ONLY public.${qi(c.table_name)} ADD CONSTRAINT ${qi(c.constraint_name)} ${c.definition};`)
  if((o.constraints||[]).length)tail.push('')
  const constraintNames=new Set((o.constraints||[]).map(c=>c.constraint_name))
  for(const i of o.indexes||[]){if(!constraintNames.has(i.index_name))tail.push(String(i.definition||'').trim().replace(/;?$/,';'))}
  if((o.indexes||[]).length)tail.push('')
  for(const tr of o.triggers||[])tail.push(String(tr.definition||'').trim().replace(/;?$/,';'))
  if((o.triggers||[]).length)tail.push('')
  for(const v of o.views||[])tail.push(`CREATE OR REPLACE VIEW public.${qi(v.view_name)} AS\n${String(v.definition||'').trim().replace(/;$/,'')};`,'')
  return {head:head.join('\n'),tail:tail.join('\n')}
}
const buildDataSql=(o,data)=>{
  const out=['-- 團購百貨 PostgreSQL Data Backup',`-- Generated: ${new Date().toISOString()}`,'']
  for(const t of o.export_tables||[]){
    const rows=data[t]||[]
    const meta=(o.columns||[]).filter(c=>c.table_name===t).sort((a,b)=>Number(a.ordinal_position)-Number(b.ordinal_position)).filter(c=>!c.is_generated||c.is_generated==='NEVER')
    if(!rows.length){out.push(`-- ${t}: 0 rows`,'');continue}
    const cols=meta.filter(c=>rows.some(r=>Object.prototype.hasOwnProperty.call(r,c.column_name)))
    const identity=cols.some(c=>c.is_identity==='YES')
    out.push(`-- ${t}: ${rows.length} rows`)
    for(const row of rows){out.push(`INSERT INTO public.${qi(t)} (${cols.map(c=>qi(c.column_name)).join(', ')})${identity?' OVERRIDING SYSTEM VALUE':''} VALUES (${cols.map(c=>sqlValue(row[c.column_name],c)).join(', ')});`)}
    out.push('')
  }
  for(const s of o.sequences||[]){if(s.last_value!=null)out.push(`SELECT setval(${qs(`public.${qi(s.sequence_name)}`)}, ${s.last_value}, true);`)}
  return out.join('\n')
}

export default function BackupMigrationCenter(){
  const { user,role }=useAuth(); const toast=useToast()
  const allowed=role==='owner'&&String(user?.email||'').toLowerCase()===OWNER_EMAIL
  const[loading,setLoading]=useState(false);const[overview,setOverview]=useState(null);const[exporting,setExporting]=useState('')
  const load=useCallback(async()=>{
    if(!allowed)return
    setLoading(true)
    try{const d=await neonAccountsRuntime('backup_overview');setOverview(d.overview||null)}catch(e){toast('備份資訊載入失敗：'+e.message,'error')}finally{setLoading(false)}
  },[allowed,toast])
  useEffect(()=>{load()},[load])
  const tableRows=useMemo(()=>overview?.tables||[],[overview])
  if(!allowed)return <div className="card" style={{padding:24}}><h2>無權限</h2><p>此頁僅開放指定系統擁有者。</p></div>
  const exportTable=async table=>{setExporting(table);try{const d=await neonAccountsRuntime('backup_export_table',{table});saveJson(`group-buy-${table}-${day()}.json`,d);toast(`${table} 備份已產生`)}catch(e){toast('匯出失敗：'+e.message,'error')}finally{setExporting('')}}
  const fetchAllTables=async()=>{const data={};for(const t of overview?.export_tables||[]){const d=await neonAccountsRuntime('backup_export_table',{table:t});data[t]=d.rows||[]}return data}
  const exportAll=async()=>{setExporting('all');try{const data=await fetchAllTables();saveJson(`group-buy-migration-backup-${day()}.json`,{generated_at:new Date().toISOString(),registry,overview,tables:data});toast('完整移轉 JSON 已產生')}catch(e){toast('完整備份失敗：'+e.message,'error')}finally{setExporting('')}}
  const exportSql=async mode=>{setExporting(`sql-${mode}`);try{
    const {head,tail}=buildSchemaParts(overview)
    if(mode==='schema'){saveText(`group-buy-postgresql-schema-${day()}.sql`,`${head}\n${tail}`);toast('PostgreSQL Schema SQL 已產生');return}
    const data=await fetchAllTables();const dataSql=buildDataSql(overview,data)
    if(mode==='data'){saveText(`group-buy-postgresql-data-${day()}.sql`,dataSql);toast('PostgreSQL Data SQL 已產生');return}
    const full=['-- 團購百貨 PostgreSQL Full Logical Backup','-- Restore with: psql "$NEW_DATABASE_URL" -f this-file.sql','BEGIN;',head,dataSql,tail,'COMMIT;',''].join('\n\n')
    saveText(`group-buy-postgresql-full-${day()}.sql`,full);toast('PostgreSQL 完整 SQL 備份已產生')
  }catch(e){toast('PostgreSQL SQL 備份失敗：'+e.message,'error')}finally{setExporting('')}}
  return <div style={{display:'grid',gap:16}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div><h1 style={{margin:0}}>🛡️ 系統備份／移轉中心</h1><p style={{margin:'6px 0 0',color:'var(--text-muted)'}}>僅 {OWNER_EMAIL} 可存取。Secret 不會匯出。</p></div><button className="btn btn-ghost" onClick={load} disabled={loading}><RefreshCw size={16}/>重新整理</button></div>
    <div className="card" style={{padding:20}}><div style={{display:'flex',gap:10,alignItems:'center'}}><ShieldCheck size={20}/><strong>Migration Registry 規則</strong></div><p>{registry.policy.rule}</p><p style={{color:'var(--text-muted)',fontSize:13}}>{registry.policy.secret_rule}</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{registry.entries.map(e=><span key={e.version} className="badge badge-indigo">{e.version} · {e.summary}</span>)}</div></div>
    <div className="card" style={{padding:20}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div><strong><Database size={17} style={{verticalAlign:'middle'}}/> PostgreSQL 現況</strong><div style={{fontSize:13,color:'var(--text-muted)',marginTop:4}}>產生時間：{overview?.generated_at||'—'}</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-ghost" onClick={()=>saveJson(`group-buy-schema-manifest-${day()}.json`,{registry,overview})} disabled={!overview}><Download size={15}/>Schema Manifest</button><button className="btn btn-primary" onClick={exportAll} disabled={!overview||!!exporting}><Download size={15}/>{exporting==='all'?'產生中…':'完整移轉 JSON'}</button></div></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12,padding:'12px 0',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)'}}><button className="btn btn-primary" onClick={()=>exportSql('full')} disabled={!overview||!!exporting}><Download size={15}/>{exporting==='sql-full'?'產生中…':'PostgreSQL 完整 SQL'}</button><button className="btn btn-ghost" onClick={()=>exportSql('schema')} disabled={!overview||!!exporting}><Download size={15}/>Schema-only SQL</button><button className="btn btn-ghost" onClick={()=>exportSql('data')} disabled={!overview||!!exporting}><Download size={15}/>{exporting==='sql-data'?'產生中…':'Data-only SQL'}</button><span style={{fontSize:12,color:'var(--text-muted)',alignSelf:'center'}}>完整 SQL 可用 psql 邏輯還原；不含 DATABASE_URL、Firebase 私鑰或 Token。</span></div>
      {overview&&<><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginTop:16}}>{Object.entries(overview.metrics||{}).map(([k,v])=><div key={k} style={{padding:12,border:'1px solid var(--border)',borderRadius:10}}><div style={{fontSize:11,color:'var(--text-muted)'}}>{k}</div><div style={{fontWeight:800,fontSize:18,marginTop:4}}>{String(v??0)}</div></div>)}</div>
      <div style={{overflowX:'auto',marginTop:16}}><table><thead><tr><th>資料表</th><th>欄位數</th><th></th></tr></thead><tbody>{tableRows.map(t=><tr key={t}><td><strong>{t}</strong></td><td>{(overview.columns||[]).filter(c=>c.table_name===t).length}</td><td>{overview.export_tables?.includes(t)?<button className="btn btn-sm btn-ghost" disabled={!!exporting} onClick={()=>exportTable(t)}><Download size={13}/>{exporting===t?'匯出中…':'JSON'}</button>:<span style={{fontSize:12,color:'var(--text-muted)'}}>僅結構</span>}</td></tr>)}</tbody></table></div></>}
    </div>
    <div className="card" style={{padding:20}}><h3>資料庫物件</h3><p>Columns：{overview?.columns?.length||0}　Constraints：{overview?.constraints?.length||0}　Indexes：{overview?.indexes?.length||0}　Triggers：{overview?.triggers?.length||0}　Functions：{overview?.functions?.length||0}　Views：{overview?.views?.length||0}　Enums：{overview?.enums?.length||0}　Sequences：{overview?.sequences?.length||0}</p></div>
  </div>
}
