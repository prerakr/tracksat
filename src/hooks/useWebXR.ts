import { useState, useEffect, useCallback, useRef } from 'react'

export function useWebXR() {
  const [isSupported, setIsSupported] = useState(false)
  const [isPresenting, setIsPresenting] = useState(false)
  const sessionRef = useRef<XRSession | null>(null)

  useEffect(() => {
    navigator.xr?.isSessionSupported('immersive-ar').then(setIsSupported).catch(() => {})
  }, [])

  const enter = useCallback(async (): Promise<XRSession | null> => {
    if (!navigator.xr) return null
    try {
      const root = document.getElementById('root') ?? undefined
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: [
          'hand-tracking',
          ...(root ? (['dom-overlay'] as XRSessionInit['optionalFeatures']) : []),
        ],
        ...(root ? { domOverlay: { root } } : {}),
      })
      sessionRef.current = session
      session.addEventListener('end', () => {
        setIsPresenting(false)
        sessionRef.current = null
      })
      setIsPresenting(true)
      return session
    } catch (err) {
      console.error('[WebXR] session request failed:', err)
      return null
    }
  }, [])

  const exit = useCallback(() => {
    sessionRef.current?.end()
  }, [])

  return { isSupported, isPresenting, enter, exit }
}
