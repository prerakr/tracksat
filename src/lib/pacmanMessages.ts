// Sarcastic flavor text shown as the player clears Starlink pellets. Pools are
// picked from randomly (never repeating the immediately-prior message within
// a pool) rather than shown in order, so replays don't feel scripted.

export const PROGRESS_MESSAGES = [
  "One down. Only 4,999 to go before astronomers can see stars again.",
  "Congratulations, you've personally reduced light pollution by 0.02%.",
  "Elon just felt a disturbance in the mega-constellation.",
  "Another satellite deorbited via mouth. Efficient.",
  "Somewhere, an astrophotographer just stopped crying for a second.",
  "You're doing more for dark skies than any UN resolution.",
  "25% cleared. The FCC is still approving more as we speak.",
  "Halfway there. Starlink will just launch 60 more tomorrow.",
  "75% cleared. This is basically orbital pest control now.",
  "Almost done — try not to get attached to any of them.",
  "You've eaten more Starlinks than Elon has apologized for tweets.",
  "Somewhere, Elon is personally launching a replacement as we speak.",
  "Breaking: local satellite-eater now a bigger threat to Starlink than SpaceX's own failure rate.",
  "Elon considers this a personal attack. He's not wrong.",
  "You're doing to his constellation what he did to Twitter's brand.",
  "Elon just renamed this satellite 'X.'",
  "He'll just call this 'anomalous constellation attrition' in the next investor call.",
  "Elon's already drafting a tweet blaming this on 'legacy space.'",
  "One more gone. Elon mutters something about Mars and walks away.",
  "You're now on Elon's list. It's a long list.",
  "He said Starlink was 'unstoppable.' You'd like a word.",
  "Elon's counting on you not noticing there are 12,000 more of these.",
  "This satellite's last words were probably '.@elonmusk we need to talk.'",
] as const

export const POWER_MESSAGES = [
  "Power pellet acquired. You are now legally a Kessler Syndrome.",
  "Temporary immunity granted. Use it to commit more space crimes.",
  "You feel powerful. The ghosts feel personally attacked.",
] as const

export const GHOST_MESSAGES = [
  "That ghost is definitely a disgruntled ham radio operator.",
  "Caught! Turns out space debris fights back.",
  "You've been out-orbited. Rude.",
] as const

export const WIN_MESSAGES = [
  "Region cleared! Somewhere, a radio astronomer is buying you a drink.",
  "All satellites eaten. Elon is already refilling the sky.",
  "You cleared the region. It'll be re-cluttered by Thursday.",
  "Mission complete. The night sky briefly remembered what it looked like in 1950.",
] as const

// Milestone fractions (of pellets eaten) that trigger a progress popup.
export const PROGRESS_MILESTONES = [0.1, 0.25, 0.5, 0.75, 0.9] as const

export function pickMessage(pool: readonly string[], avoid?: string): string {
  if (pool.length === 1) return pool[0]
  let pick: string
  do {
    pick = pool[Math.floor(Math.random() * pool.length)]
  } while (pick === avoid)
  return pick
}
