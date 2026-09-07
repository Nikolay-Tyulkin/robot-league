import { clamp, type MatchState } from './sim';

/** Flash changes only this viewer's picture; the shared ball keeps simulating. */
export function flashPresentation(state: MatchState | undefined, viewer: number) {
  const remaining = state && (state.phase === 'play' || state.phase === 'paused') ? state.players[viewer].blinded : 0;
  return { strength: clamp(remaining / .3, 0, 1), ballVisible: remaining <= .3 };
}
