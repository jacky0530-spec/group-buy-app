import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { neonHelperRuntime } from '../lib/neonRuntime'
import { useToast } from './UI'

const taipeiToday=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date())
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const pad2=value=>String(value).padStart(2,'0')

function parseDateParts(value){
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match?{year:match[1],month:match[2],day:match[3]}:{year:'',month:'',day:''}
}
function daysInMonth(year,month){
  const y=Number(year),m=Number(month)
  if(!y||!m)return 31
  return new Date(y,m,0).getDate()
}
function DeadlineDatePicker({value,today,onChange}){
  const initial=parseDateParts(value)
  const[parts,setParts]=useState(initial)
  const todayParts=parseDateParts(today)
  const selectedYear=Number(parts.year||todayParts.year||new Date().getFullYear())
  const baseYear=Number(todayParts.year||new Date().getFullYear())
  const yearOptions=useMemo(()=>{
    const years=[]
    for(let year=baseYear-1;year<=baseYear+5;year++)years.push(year)
    if(selectedYear&&!years.includes(selectedYear))years.push(selectedYear)
    return years.sort((a,b)=>a-b)
  },[baseYear,selectedYear])
  const maxDay=daysInMonth(parts.year,parts.month)

  useEffect(()=>{
    setParts(parseDateParts(value))
  },[value])

  function patch(key,raw){
    const next={...parts,[key]:String(raw||'')}
    if(next.year&&next.month&&next.day){
      const max=daysInMonth(next.year,next.month)
      if(Number(next.day)>max)next.day=pad2(max)
    }
    setParts(next)
    if(next.year&&next.month&&next.day){
      onChange(`${next.year}-${next.month}-${next.day}`)
    }
  }

  function quickDate(offsetDays){
    const [year,month,day]=today.split('-').map(Number)
    const date=new Date(Date.UTC(year,month-1,day+offsetDays,12))
    const next=`${date.getUTCFullYear()}-${pad2(date.getUTCMonth()+1)}-${pad2(date.getUTCDate())}`
    setParts(parseDateParts(next))
    onChange(next)
  }

  function clear(){
    setParts({year:'',month:'',day:''})
    onChange('')
  }

  const selectStyle={height:48,fontSize:16,minWidth:0,padding:'0 10px',border:'1.5px solid var(--border)',borderRadius:9,background:'var(--surface)',color:'var(--text-primary)'}
  return <div>
    <div style={{display:'grid',gridTemplateColumns:'1.15fr 1fr 1fr',gap:8}}>
      <select aria-label="結單年份" value={parts.year} onChange={event=>patch('year',event.target.value)} style={selectStyle}>
        <option value="">年份</option>
        {yearOptions.map(year=><option key={year} value={year}>{year} 年</option>)}
      </select>
      <select aria-label="結單月份" value={parts.month} onChange={event=>patch('month',event.target.value)} style={selectStyle}>
        <option value="">月份</option>
        {Array.from({length:12},(_,index)=>index+1).map(month=><option key={month} value={pad2(month)}>{month} 月</option>)}
      </select>
      <select aria-label="結單日期" value={parts.day} onChange={event=>patch('day',event.target.value)} style={selectStyle}>
        <option value="">日期</option>
        {Array.from({length:maxDay},(_,index)=>index+1).map(day=><option key={day} value={pad2(day)}>{day} 日</option>)}
      </select>
    </div>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={()=>quickDate(0)}>今天</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={()=>quickDate(1)}>明天</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>不限結單</button>
      <span style={{fontSize:12,color:'var(--text-muted)',display:'inline-flex',alignItems:'center',marginLeft:'auto'}}>{value?`目前：${value}`:'目前：不限結單'}</span>
    </div>
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
      <DeadlineDatePicker
        key={`${editor.mode}:${editor.id}:${editor.name}`}
        value={editor.deadline||''}
        today={today}
        onChange={setDeadlineValue}
      />
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:6,lineHeight:1.5}}>
        iPad／Safari 改用年、月、日三欄選擇，不再使用會卡住的原生日期日曆。留空＝不限結單；結單日當天小幫手仍可開單，隔天起小幫手搜尋不到且不能新開單，管理者不受限制。
      </div>
    </div>,
    modalHost
  ):null
}
