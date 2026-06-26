import { Glasses, LogOut } from 'lucide-react'

interface Props {
  isSupported: boolean
  isPresenting: boolean
  onEnter: () => void
  onExit: () => void
}

export function XRButton({ isSupported, isPresenting, onEnter, onExit }: Props) {
  if (!isSupported) return null

  return (
    <button
      onClick={isPresenting ? onExit : onEnter}
      title={isPresenting ? 'Exit AR' : 'Enter AR (passthrough)'}
      className="absolute bottom-6 right-20 z-20 flex items-center gap-2 px-3 h-10 rounded-full bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 hover:border-indigo-500 hover:text-indigo-300 transition-colors shadow-lg font-mono text-xs"
    >
      {isPresenting ? <LogOut size={15} /> : <Glasses size={15} />}
      {isPresenting ? 'Exit AR' : 'Enter AR'}
    </button>
  )
}
