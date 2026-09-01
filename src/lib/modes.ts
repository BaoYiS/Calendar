import type { EventDef, EventMode } from '../types'

/** Events from before modes existed carry no mode field — they are 'overlap'. */
export function eventMode(def: Pick<EventDef, 'mode'>): EventMode {
  return def.mode ?? 'overlap'
}

export const MODE_VALUES: EventMode[] = ['overlap', 'exclusive', 'schedule']

interface ModeCopy {
  /** Picker + chip label. */
  label: string
  /** One-liner under the picker on the create form. */
  blurb: string
  /** '…paint the times you're free' — the paint-toolbar hint verb phrase. */
  paintHint: string
  /** Big CTA on the event page. */
  respondCta: string
  /** Results-section heading on the event page. */
  resultsTitle: string
  /** Link back to the results from the respond page. */
  resultsCta: string
  /** What a reply's slots are called in buttons/messages. */
  noun: string
  /** '…can <verb> — no account needed.' for the invite blurb. */
  inviteVerb: string
}

export const MODE_COPY: Record<EventMode, ModeCopy> = {
  overlap: {
    label: 'Mutually available',
    blurb:
      'Find a time that works for the whole group: everyone paints when they’re free, and the times when the most people overlap rise to the top.',
    paintHint: 'paint the times you’re free',
    respondCta: 'Add / edit my availability',
    resultsTitle: 'Group availability',
    resultsCta: 'See the group heatmap',
    noun: 'availability',
    inviteVerb: 'paint their availability',
  },
  exclusive: {
    label: 'Mutually exclusive',
    blurb:
      'Hand out separate times: each slot can be claimed by only one person, first come first served — for sign-ups, shifts, or 1-on-1 sessions.',
    paintHint: 'claim your times — greyed-out slots are already taken',
    respondCta: 'Claim my times',
    resultsTitle: 'Claimed times',
    resultsCta: 'See who claimed what',
    noun: 'claimed times',
    inviteVerb: 'claim their own times',
  },
  schedule: {
    label: 'Schedule planning',
    blurb:
      'Collect everyone’s times side by side: invitees pick whatever suits them (overlaps allowed), and you plan the schedule around the picks.',
    paintHint: 'pick your times',
    respondCta: 'Pick my times',
    resultsTitle: 'Everyone’s picks',
    resultsCta: 'See everyone’s picks',
    noun: 'picks',
    inviteVerb: 'pick their times',
  },
}
