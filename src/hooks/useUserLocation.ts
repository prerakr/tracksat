import { useState, useEffect } from 'react'

export interface UserLocation {
  lat: number
  lng: number
}

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      return
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setError(null)
      },
      (err) => setError(err.message),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    )

    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { location, error }
}
