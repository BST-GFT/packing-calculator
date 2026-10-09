import { useId } from 'react'

export function Field({
  label,
  value,
  onChange,
  suffix,
  hint,
  placeholder,
  inputMode = 'decimal',
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  suffix?: string
  hint?: string
  placeholder?: string
  inputMode?: 'decimal' | 'numeric' | 'text'
  className?: string
}) {
  const id = useId()
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={id}>{label}</label>
      <div className="control">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </div>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            type="button"
            key={o.id}
            aria-pressed={o.id === value}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
