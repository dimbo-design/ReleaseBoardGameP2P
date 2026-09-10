import { useCallback } from 'react'
import { useNavigate } from '~/app/router'

// Single source of the lobby-resume navigation contract: route to
// /lobby/:lobbyId carrying the `resumed` flag that [lobbyId].tsx reads to skip
// the Continue/Leave interstitial. Centralized so the three entry points
// (create, join, resume-from-start) stay in lockstep, and routed through the
// generouted-typed navigate so a route rename is caught at build time.
export function useGoToLobby() {
  const navigate = useNavigate()
  return useCallback(
    // `nickname` travels with the navigation so the invite screen can pre-fill
    // it. A join begun in the start-screen modal only fails once we're already
    // on /lobby/:lobbyId, and without this the user would land on the error
    // state facing an empty field, retyping the name they just entered.
    (code: string, nickname?: string) =>
      navigate('/lobby/:lobbyId', {
        params: { lobbyId: code },
        state: { resumed: true, ...(nickname ? { nickname } : {}) },
      }),
    [navigate],
  )
}

// Where leaving a finished match goes. With a room to return to that is the
// lobby, carrying the same `resumed` flag as every other entry point — the
// session outlives the match, so the room still has everyone in it and the host
// can start the next one straight away.
//
// Without one there is nothing to return TO: reloading on the results route
// loses the session, and the screen is already empty because the projection
// went with it. Sending that case to the start screen is the difference between
// a way out and a button that does nothing at all.
//
// It lives here rather than in the page for the reason the whole module does:
// the lobby-resume contract is one thing, and a second copy of it in a page
// would be the copy that gets missed when the route changes.
export function useLeaveMatch() {
  const goToLobby = useGoToLobby()
  const navigate = useNavigate()
  return useCallback(
    (roomCode: string | null) => {
      if (roomCode) goToLobby(roomCode)
      else void navigate('/start')
    },
    [goToLobby, navigate],
  )
}
