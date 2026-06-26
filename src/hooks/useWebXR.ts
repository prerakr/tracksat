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
      // No dom-overlay: Quest's browser does not reliably composite it, and when
      // present it forwards controller `select` as DOM pointer events that fight
      // our in-scene raycasting. All XR UI is rendered as a 3D menu in the scene.
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking'],
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
