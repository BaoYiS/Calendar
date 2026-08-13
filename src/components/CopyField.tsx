import { useRef, useState } from 'react'

interface CopyFieldProps {
  value: string
  label: string
  multiline?: boolean
}

export default function CopyField({ value, label, multiline = false }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const timer = useRef<number | undefined>(undefined)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      inputRef.current?.select()
      return
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="copyfield">
      {multiline ? (
        <textarea
          ref={(el) => {
            inputRef.current = el
          }}
          className="copyfield-input"
          readOnly
          value={value}
          rows={3}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : (
        <input
          ref={(el) => {
            inputRef.current = el
          }}
          className="copyfield-input"
          readOnly
          value={value}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <button type="button" className="btn btn-mint btn-sm" onClick={copy}>
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}
