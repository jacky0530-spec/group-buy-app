import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { neonHelperRuntime } from '../lib/neonRuntime'
import { useToast } from './UI'

const taipeiToday=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date())
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const pad2=value=>String(value).padStart(2,'0')
const dateText=(year,month,day)=>`${year}-${pad2(month)}-${pad2(day)}`

function parseDate(value){
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if(!match)return null
  return{year:Number(match[1]),month:Number(match[2]),day:Number(match[3])}
}
function monthDays(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate()}
function monthWeekday(year,month){return new Date(Date.UTC(year,month-1,1)).getUTCDay()}
function shiftMonth(year,month,delta){
  const date=new Date(Date.UTC(year,month-1+delta,1,12))
  return{year:date.getUTCFullYear(),month:date.getUTCMonth()+1}
}
function addTaipeiDays(today,offset){
  const parsed=parseDate(today)
  if(!parsed)return today
  const date=new Date(Date.UTC(parsed.year,parsed.month-1,parsed.day+offset,12))
  return dateText(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate())
}

function DeadlineCalendar({value,today,onChange}){
  const wrapperRef=useRef(null)
  const[open,setOpen]=useState(false)
  const initial=parseDate(value)||parseDate(today)
  const[view,setView]=useState({year:initial?.year||new Date().getFullYear(),month:initial?.month||1})
  const selected=parseDate(value)
  const todayParts=parseDate(today)

  useEffect(()=>{
    if(!open)return
    const target=parseDate(value)||parseDate(today)
    if(target)setView({year:target.year,month:target.month})
  },[open,value,today])

  useEffect(()=>{
    if(!open)return undefined
    const close=event=>{
      if(wrapperRef.current&&!wrapperRef.current.contains(event.target))setOpen(false)
    }
    document.addEventListener('pointerdown',close,true)
    return()=>document.removeEventListener('pointerdown',close,true)
  },[open])

  const days=monthDays(view.year,view.month)
  const offset=monthWeekday(view.year,view.month)
  const cells=Array.from({length:offset+days},(_,index)=>index<offset?null:index-offset+1)
  const changeMonth=delta=>setView(current=>shiftMonth(current.year,current.month,delta))
  const choose=day=>{
    onChange(dateText(view.year,view.month,day))
    setOpen(false)
  }
  const quickToday=()=>{
    const target=parseDate(today)
    if(target)setView({year:target.year,month:target.month})
    onChange(today)
    setOpen(false)
  }
  const quickTomorrow=()=>{
    const next=addTaipeiDays(today,1)
    const target=parseDate(next)
    if(target)setView({year:target.year,month:target.month})
    onChange(next)
    setOpen(false)
  }
  const clear=()=>{onChange('');setOpen(false)}
  const display=value?value.replace(/-/g,' / '):'請選擇結單日期'
  const weekday=['週日','週一','週二','週三','週四','週五','週六']

  return <div ref={wrapperRef} style={{position:'relative'}}>
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={()=>setOpen(current=>!current)}
      style={{height:52,width:'100%',padding:'0 14px',border:'1.5px solid var(--border)',borderRadius:10,background:'var(--surface)',color:value?'var(--text-primary)':'var(--text-muted)',fontSize:17,fontWeight:value?700:500,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,textAlign:'left'}}
    >
      <span>📅 {display}</span><span aria-hidden="true" style={{fontSize:18}}>▾</span>
    </button>
    {open&&<div role="dialog" aria-label="結單日曆" style={{position:'absolute',zIndex:1200,top:58,left:0,width:'min(390px, 100%)',padding:14,border:'1.5px solid var(--border)',borderRadius:14,background:'var(--surface)',boxShadow:'0 18px 50px rgba(15,23,42,.20)'}}>
      <div style={{display:'grid',gridTemplateColumns:'48px 1fr 48px',alignItems:'center',gap:8,marginBottom:10}}>
        <button type="button" aria-label="上個月" onClick={()=>changeMonth(-1)} style={{height:48,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',fontSize:24}}>‹</button>
        <div style={{textAlign:'center',fontSize:20,fontWeight:800}}>{view.year} 年 {view.month} 月</div>
        <button type="button" aria-label="下個月" onClick={()=>changeMonth(1)} style={{height:48,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface)',fontSize:24}}>›</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4,marginBottom:4}}>
        {weekday.map(item=><div key={item} style={{height:30,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'var(--text-muted)'}}>{item}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
        {cells.map((day,index)=>{
          if(!day)return <span key={`blank-${index}`} style={{height:44}}/>
          const iso=dateText(view.year,view.month,day)
          const isSelected=iso===value
          const isToday=iso===today
          return <button
            key={iso}
            type="button"
            aria-label={iso}
            aria-pressed={isSelected}
            onClick={()=>choose(day)}
            style={{height:44,minWidth:0,border:isToday?'2px solid var(--primary)':'1px solid transparent',borderRadius:999,background:isSelected?'var(--primary)':'transparent',color:isSelected?'white':'var(--text-primary)',fontSize:17,fontWeight:isSelected||isToday?800:600}}
          >{day}</button>
        })}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:12,paddingTop:12,borderTop:'1px solid var(--border)'}}>
        <button type="button" className="btn btn-sm btn-ghost" onClick={quickToday} style={{height:44}}>今天</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={quickTomorrow} style={{height:44}}>明天</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={clear} style={{height:44}}>不限結單</button>
      </div>
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:8,textAlign:'center'}}>目前：{value||'不限結單'}</div>
    </div>}
  </div>
}

function deadlineStatus(row,today){
  const deadline=String(row?.order_deadline||'')
  if(!deadline)return{label:'不限結單',className:'badge badge-gray'}
  if(deadline<today)return{label:`已結單 ${deadline}`,className:'badge badge-rose'}
  if(deadline===today)return{label:`今日結單 ${deadline}`,className:'badge badge-amber'}
  return{label:`結單 ${deadline}`,className:'badge badge-indigo'}
}
function productTable(){
  return [...document.querySelectorAll('table')].find(table=>{
    const headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim())
    return headers.includes('商品名稱')&&headers.includes('供應商')&&headers.includes('售價')&&headers.includes('操作')
  })||null
}
function productModal(){
  return [...document.querySelectorAll('.app-modal-backdrop .modal-card')].find(card=>{
    const title=card.querySelector('.modal-header')?.textContent||''
    return title.includes('新增商品')||title.includes('編輯商品')
  })||null
}
function rowProductName(tr){
  const first=tr?.querySelector('td')
  const primary=first?.querySelector('div')
  return String(primary?.textContent||first?.textContent||'').trim()
}

export default function ProductDeadlineManager(){
  const toast=useToast()
  const[rows,setRows]=useState([])
  const[modalHost,setModalHost]=useState(null)
  const[editor,setEditor]=useState({mode:'',id:'',name:'',deadline:''})
  const today=useMemo(()=>taipeiToday(),[])
  const rowsRef=useRef([])
  const editorRef=useRef(editor)
  const pendingSaveRef=useRef(null)
  const modalWasOpenRef=useRef(false)
  const modalHostRef=useRef(null)
  const committingRef=useRef(false)

  const replaceRows=useCallback(next=>{
    rowsRef.current=next
    setRows(next)
  },[])

  const mergeDeadlineRow=useCallback(result=>{
    if(!result?.id)return
    const id=String(result.id)
    const orderDeadline=String(result.order_deadline||'')
    const current=rowsRef.current
    const index=current.findIndex(row=>String(row.id||'')===id)
    const nextRow={...(index>=0?current[index]:{}),...result,id,order_deadline:orderDeadline}
    const next=index>=0
      ? current.map((row,i)=>i===index?nextRow:row)
      : [...current,nextRow]
    replaceRows(next)
  },[replaceRows])

  const load=useCallback(async()=>{
    try{
      // V47：catalog 本身已回傳全部啟用商品與 order_deadline，不受 product_deadlines 250 筆上限影響。
      const data=await neonHelperRuntime('catalog')
      const next=Array.isArray(data?.rows)?data.rows:[]
      replaceRows(next)
    }catch(err){toast('結單日資料載入失敗：'+err.message,'error')}
  },[replaceRows,toast])

  const setDeadlineValue=useCallback(deadlineInput=>{
    const deadline=String(deadlineInput||'')
    editorRef.current={...editorRef.current,deadline}
    setEditor(prev=>prev.deadline===deadline?prev:{...prev,deadline})
  },[])

  useEffect(()=>{editorRef.current=editor},[editor])
  useEffect(()=>{rowsRef.current=rows},[rows])
  useEffect(()=>{load()},[load])

  const decorate=useCallback(()=>{
    const table=productTable()
    if(table){
      for(const tr of table.querySelectorAll('tbody tr')){
        const first=tr.querySelector('td')
        if(!first)continue
        const name=rowProductName(tr)
        if(!name)continue
        const row=rowsRef.current.find(item=>String(item.name||'').trim()===name)
        const status=deadlineStatus(row,today)
        let badge=first.querySelector('[data-product-deadline-badge]')
        if(!badge){
          badge=document.createElement('span')
          badge.dataset.productDeadlineBadge='1'
          badge.style.marginTop='5px'
          badge.style.fontSize='10px'
          badge.style.display='inline-flex'
          first.appendChild(badge)
        }
        const nextText=`📅 ${status.label}`
        const nextClass=status.className
        if(badge.textContent!==nextText)badge.textContent=nextText
        if(badge.className!==nextClass)badge.className=nextClass
      }
    }

    const modal=productModal()
    if(modal){
      modalWasOpenRef.current=true
      const body=modal.querySelector('.modal-body')
      if(body){
        let host=body.querySelector('[data-product-deadline-inline-host]')
        if(!host){
          host=document.createElement('div')
          host.dataset.productDeadlineInlineHost='1'
          const firstGroup=body.querySelector('.form-group')
          if(firstGroup?.nextSibling)body.insertBefore(host,firstGroup.nextSibling)
          else body.prepend(host)
        }
        if(modalHostRef.current!==host){
          modalHostRef.current=host
          setModalHost(host)
        }
      }
    }else{
      if(modalHostRef.current){modalHostRef.current=null;setModalHost(null)}
      if(modalWasOpenRef.current){
        modalWasOpenRef.current=false
        const pending=pendingSaveRef.current
        pendingSaveRef.current=null
        if(pending&&!committingRef.current){
          committingRef.current=true
          ;(async()=>{
            try{
              let targetId=String(pending.id||'')
              if(!targetId&&pending.deadline){
                for(let attempt=0;attempt<6&&!targetId;attempt++){
                  const data=await neonHelperRuntime('product_deadlines',{q:pending.name,limit:50})
                  const exact=(data?.rows||[]).find(row=>String(row.name||'').trim()===pending.name)
                  if(exact?.id)targetId=exact.id
                  else if(attempt<5)await sleep(300)
                }
              }
              if(targetId&&(pending.mode==='edit'||pending.deadline)){
                const saved=await neonHelperRuntime('set_product_deadline',{id:targetId,order_deadline:pending.deadline||''})
                mergeDeadlineRow(saved?.result)
                toast(pending.deadline?`✅ 結單日已設為 ${pending.deadline}`:'✅ 已改為不限結單')
              }else if(pending.deadline&&!targetId){
                toast('商品已儲存，但暫時找不到新商品來設定結單日，請重新開啟商品編輯後再設定','warning')
              }
              await load()
            }catch(err){toast('商品已儲存，但結單日同步失敗：'+err.message,'error')}
            finally{committingRef.current=false}
          })()
        }
      }
    }
  },[load,mergeDeadlineRow,today,toast])

  useEffect(()=>{
    decorate()
    const observer=new MutationObserver(()=>decorate())
    observer.observe(document.body,{childList:true,subtree:true})
    const onClick=event=>{
      const button=event.target.closest('button')
      if(!button)return
      const modal=button.closest('.modal-card')
      const label=button.textContent.trim()

      if(!modal&&label.includes('新增商品')){
        pendingSaveRef.current=null
        setEditor({mode:'add',id:'',name:'',deadline:''})
        return
      }
      if(!modal&&button.querySelector('.lucide-pencil')){
        const tr=button.closest('tr')
        const name=rowProductName(tr)
        const row=rowsRef.current.find(item=>String(item.name||'').trim()===name)
        pendingSaveRef.current=null
        setEditor({mode:'edit',id:String(row?.id||''),name,deadline:String(row?.order_deadline||'')})
        return
      }
      if(!modal)return
      if(label==='取消'||button.getAttribute('aria-label')==='關閉'){
        pendingSaveRef.current=null
        return
      }
      if(label==='新增商品'||label==='確認更新'){
        const nameInput=modal.querySelector('.modal-body .form-group input')
        const current=editorRef.current
        pendingSaveRef.current={
          mode:label==='確認更新'?'edit':'add',
          id:label==='確認更新'?String(current.id||''):'',
          name:String(nameInput?.value||current.name||'').trim(),
          deadline:String(current.deadline||''),
        }
      }
    }
    document.addEventListener('click',onClick,true)
    return()=>{
      observer.disconnect()
      document.removeEventListener('click',onClick,true)
      document.querySelectorAll('[data-product-deadline-badge]').forEach(node=>node.remove())
      document.querySelectorAll('[data-product-deadline-inline-host]').forEach(node=>node.remove())
    }
  },[decorate])

  useEffect(()=>{decorate()},[decorate,rows,editor])

  return modalHost?createPortal(
    <div className="form-group" style={{marginBottom:14,padding:'12px 14px',border:'1.5px solid var(--border)',borderRadius:10,background:'var(--surface)'}}>
      <label style={{fontWeight:800}}>📅 結單日（選填）</label>
      <DeadlineCalendar
        key={`${editor.mode}:${editor.id}:${editor.name}`}
        value={editor.deadline||''}
        today={today}
        onChange={setDeadlineValue}
      />
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:6,lineHeight:1.5}}>
        點日期欄直接開啟日曆，可用左右箭頭切換月份後選日期。此日曆由系統自行控制，不使用 iPad／Safari 原生日期選擇器，因此不會再被當日值卡住。留空＝不限結單；結單日當天小幫手仍可開單，隔天起才限制，管理者不受限制。
      </div>
    </div>,
    modalHost
  ):null
}
