import { useEffect } from 'react'

export default function ReleasedTextStyler(){
  useEffect(()=>{
    const apply=()=>{
      document.querySelectorAll('strong,span,.badge').forEach(el=>{
        const text=String(el.textContent||'')
        if(!text.includes('已釋出'))return
        el.style.color='#dc2626'
        el.style.fontWeight='900'
        if(el.classList.contains('badge')){
          el.style.background='#fff1f2'
          el.style.borderColor='#fecdd3'
        }
      })
    }
    apply()
    const observer=new MutationObserver(()=>{
      observer.disconnect()
      apply()
      observer.observe(document.body,{childList:true,subtree:true,characterData:true})
    })
    observer.observe(document.body,{childList:true,subtree:true,characterData:true})
    return()=>observer.disconnect()
  },[])
  return null
}
