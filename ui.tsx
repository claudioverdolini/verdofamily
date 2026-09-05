import React from 'react'
import { X } from 'lucide-react'

export function Button({ children, variant = 'primary', size = 'md', icon, className = '', ...props }: any) {
  return (
    <button className={`btn btn--${variant} btn--${size} ${className}`} {...props}>
      {icon ? <span className="btn__icon">{icon}</span> : null}
      <span>{children}</span>
    </button>
  )
}

export function IconButton({ label, children, className = '', ...props }: any) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

export function Card({ children, className = '', onClick }: any) {
  return <section className={`card ${onClick ? 'card--clickable' : ''} ${className}`} onClick={onClick}>{children}</section>
}

export function CardHeader({ title, subtitle, action }: any) {
  return (
    <div className="card-header">
      <div className="card-header__copy">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <div className="card-header__action">{action}</div> : null}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: any) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function Field({ label, hint, children, className = '' }: any) {
  return (
    <label className={`field ${className}`}>
      {label ? <span className="field__label">{label}</span> : null}
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  )
}

export function EmptyState({ icon, title, text, action }: any) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-state__icon">{icon}</div> : null}
      <div className="empty-state__title">{title}</div>
      {text ? <div className="empty-state__text">{text}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}

export function Modal({ open, title, subtitle, children, onClose, footer, size = 'md' }: any) {
  if (!open) return null
  return (
    <div className="modal-layer" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton label="Chiudi" onClick={onClose}><X size={20} /></IconButton>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Segmented({ value, options, onChange }: any) {
  return (
    <div className="segmented">
      {options.map((option: any) => {
        const item = typeof option === 'string' ? { value: option, label: option } : option
        return (
          <button key={item.value} type="button" className={value === item.value ? 'is-active' : ''} onClick={() => onChange(item.value)}>
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function Avatar({ user, size = 'md' }: any) {
  const initial = (user?.name || '?').slice(0, 1).toUpperCase()
  return (
    <span className={`avatar avatar--${size}`} style={{ '--avatar-color': user?.color || '#5B5BD6' } as React.CSSProperties}>
      {user?.avatarUrl ? <img src={user.avatarUrl} alt={user.name || 'Avatar'} /> : <span>{initial}</span>}
    </span>
  )
}

export function PageIntro({ eyebrow, title, description, actions }: any) {
  return (
    <div className="page-intro">
      <div className="page-intro__copy">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-intro__actions">{actions}</div> : null}
    </div>
  )
}

export function ListRow({ leading, title, subtitle, trailing, onClick, className = '' }: any) {
  return (
    <div className={`list-row ${onClick ? 'list-row--clickable' : ''} ${className}`} onClick={onClick}>
      {leading ? <div className="list-row__leading">{leading}</div> : null}
      <div className="list-row__content">
        <div className="list-row__title">{title}</div>
        {subtitle ? <div className="list-row__subtitle">{subtitle}</div> : null}
      </div>
      {trailing ? <div className="list-row__trailing">{trailing}</div> : null}
    </div>
  )
}

export function StatCard({ icon, label, value, note, onClick, tone = 'accent' }: any) {
  return (
    <button className={`stat-card stat-card--${tone}`} onClick={onClick}>
      <span className="stat-card__icon">{icon}</span>
      <span className="stat-card__label">{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </button>
  )
}
