import { ALL_CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS } from '../lib/categories'
import type { SatCategory } from '../types/satellite'

interface Props {
  activeCategories: Set<SatCategory>
  onToggle: (cat: SatCategory) => void
}

export function FilterBar({ activeCategories, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_CATEGORIES.map(cat => {
        const active = activeCategories.has(cat)
        const color = CATEGORY_COLORS[cat]
        return (
          <button
            key={cat}
            onClick={() => onToggle(cat)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border"
            style={{
              borderColor: active ? color : '#334155',
              background: active ? `${color}22` : 'transparent',
              color: active ? color : '#64748b',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: active ? color : '#334155' }}
            />
            {CATEGORY_LABELS[cat]}
          </button>
        )
      })}
    </div>
  )
}
