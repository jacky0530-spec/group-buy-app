import { HelperAPI } from './helper'
import { neonHelperAdminRuntime } from './neonRuntime'

const INSTALLED=Symbol.for('group-buy.neon-helper-admin-read-installed')

if(!globalThis[INSTALLED]){
  globalThis[INSTALLED]=true
  HelperAPI.allEntries=async function(){
    const result=await neonHelperAdminRuntime()
    if(!Array.isArray(result?.rows)) throw new Error('Neon 回傳格式錯誤')
    return [...result.rows].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
  }
}
