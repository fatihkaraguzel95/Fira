import { useLayoutEffect } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { track } from '../../lib/nav'

/**
 * Keeps `lib/nav`'s mirror of the browser history in step with the router
 * (#a7d43aaf). Draws nothing. A layout effect, so the mirror is right before
 * anything on the new screen can be clicked.
 *
 * When `go` steps back to make room for a more general screen, the screen to
 * put there is carried out here, as soon as the step back has landed.
 */
export function NavTracker() {
  const location = useLocation()
  const type = useNavigationType()
  const navigate = useNavigate()
  useLayoutEffect(() => {
    const next = track(type, location.key, location.pathname + location.search)
    if (next) navigate(next.to, { replace: true, state: next.state })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])
  return null
}
