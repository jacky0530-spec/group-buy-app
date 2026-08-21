import { useEffect, useState } from 'react'

export default function QuantityInput({ value, onChange, min = 1, max, style, className, ariaLabel = '數量' }) {
  const [draft, setDraft] = useState(String(value ?? ''))

  useEffect(() => {
    setDraft(String(value ?? ''))
  }, [value])

  function commit(raw = draft) {
    let number = Number(raw)
    if (!Number.isFinite(number) || number < min) number = min
    if (max !== undefined && number > max) number = max
    number = Math.floor(number)
    setDraft(String(number))
    onChange(number)
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      className={className}
      aria-label={ariaLabel}
      style={style}
      onFocus={e => e.currentTarget.select()}
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        if (raw === '') return
        const number = Number(raw)
        if (Number.isFinite(number)) onChange(number)
      }}
      onBlur={() => commit()}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
