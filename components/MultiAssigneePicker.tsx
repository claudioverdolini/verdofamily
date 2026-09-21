import React from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { FamilyUser } from '../types'
import { Avatar } from '../ui'

function roleLabel(role: FamilyUser['role']) {
  if (role === 'bimbo') return 'Bambino'
  if (role === 'admin') return 'Admin'
  return 'Adulto'
}

export default function MultiAssigneePicker({
  users,
  selectedIds,
  onChange,
  disabled = false,
  showChildrenShortcut = true,
  showFamilyShortcut = true,
  childrenLabel = 'Tutti i bambini',
  familyLabel = 'Tutta la famiglia'
}: {
  users: FamilyUser[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
  showChildrenShortcut?: boolean
  showFamilyShortcut?: boolean
  childrenLabel?: string
  familyLabel?: string
}) {
  const selected = Array.from(new Set((selectedIds || []).map(Number).filter(id => id > 0)))
  const childIds = users.filter(user => user.role === 'bimbo').map(user => user.id)

  function toggle(userId: number) {
    if (disabled) return
    onChange(selected.includes(userId)
      ? selected.filter(id => id !== userId)
      : [...selected, userId])
  }

  return <div className="multi-assignee-control">
    <div className="recurring-assignee-picker multi-assignee-picker">
      {users.map(user => {
        const active = selected.includes(user.id)
        return <button
          type="button"
          key={user.id}
          disabled={disabled}
          className={active ? 'is-selected' : ''}
          onClick={() => toggle(user.id)}
        >
          <Avatar user={user} size="sm" />
          <span><strong>{user.name}</strong><small>{roleLabel(user.role)}</small></span>
          <span className="recurring-assignee-picker__check">{active ? <CheckCircle2 size={18} /> : null}</span>
        </button>
      })}
    </div>

    {!disabled && (showChildrenShortcut || showFamilyShortcut) ? <div className="recurring-assignee-shortcuts multi-assignee-shortcuts">
      {showChildrenShortcut && childIds.length ? <button type="button" onClick={() => onChange(childIds)}>{childrenLabel}</button> : null}
      {showFamilyShortcut ? <button type="button" onClick={() => onChange(users.map(user => user.id))}>{familyLabel}</button> : null}
      {selected.length > 1 ? <button type="button" onClick={() => onChange([])}>Deseleziona tutti</button> : null}
    </div> : null}
  </div>
}
