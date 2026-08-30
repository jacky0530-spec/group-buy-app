import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

function setNativeInputValue(input,value) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')
  descriptor?.set?.call(input,String(value))
  input.dispatchEvent(new Event('input',{ bubbles:true }))
  input.dispatchEvent(new Event('change',{ bubbles:true }))
}

export default function OrderArrivalResetPatch() {
  const location = useLocation()

  useEffect(() => {
    if (location.pathname !== '/orders') return undefined

    const sync = () => {
      document.querySelectorAll('input[type="number"][aria-label$="到貨數量"]').forEach(input => {
        const parent = input.parentElement
        if (!parent) return
        let button = parent.querySelector(':scope > button[data-arrival-reset="1"]')
        const arrived = Math.max(0,Number(input.value || 0))

        if (arrived > 0) {
          if (!button) {
            button = document.createElement('button')
            button.type = 'button'
            button.dataset.arrivalReset = '1'
            button.className = 'btn btn-sm btn-ghost'
            button.textContent = '改未到貨'
            button.style.fontSize = '10px'
            button.style.padding = '2px 6px'
            button.addEventListener('click',event => {
              event.preventDefault()
              event.stopPropagation()
              setNativeInputValue(input,0)
            })
            parent.appendChild(button)
          }
        } else if (button) {
          button.remove()
        }
      })
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body,{ childList:true,subtree:true })
    document.addEventListener('input',sync,true)
    document.addEventListener('change',sync,true)
    return () => {
      observer.disconnect()
      document.removeEventListener('input',sync,true)
      document.removeEventListener('change',sync,true)
      document.querySelectorAll('button[data-arrival-reset="1"]').forEach(button => button.remove())
    }
  },[location.pathname])

  return null
}
