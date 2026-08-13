export type SceneKind =
  | 'walking'
  | 'on_call'
  | 'driving'
  | 'in_bed'
  | 'at_shop'
  | 'cooking';

export type SceneFact = {
  scene: SceneKind;
  status: 'active' | 'inactive' | 'historical';
  source: 'current_turn' | 'recent_user_turn';
  observedAt: string;
  confidence: 'explicit' | 'inferred';
};

export type SceneState = {
  current: SceneFact[];
  historical: SceneFact[];
};

export type SceneMessage = {
  role: string;
  text: string;
  createdAt: Date;
};

const SCENES: Array<{
  scene: SceneKind;
  ttlMinutes: number;
  positive: RegExp[];
  negative: RegExp[];
}> = [
  {
    scene: 'walking',
    ttlMinutes: 120,
    positive: [
      /\b(?:i(?:'m| am)|we(?:'re| are)) (?:just )?(?:out )?(?:on|for) (?:an? |my |our )?(?:evening |morning |night )?walk\b/iu,
      /\b(?:i(?:'m| am)|we(?:'re| are)) (?:still )?walking\b/iu,
    ],
    negative: [
      /\bi (?:haven't|have not|hadn't|had not) (?:gone|been) (?:out )?(?:on|for) (?:my |a )?walk\b/iu,
      /\b(?:not|no longer) (?:out )?walking\b/iu,
      /\b(?:back|got) home (?:from|after) (?:my |the |a )?walk\b/iu,
      /\bwalk(?:'s| is) still (?:ahead|to come)\b/iu,
    ],
  },
  {
    scene: 'on_call',
    ttlMinutes: 180,
    positive: [
      /\b(?:i(?:'m| am)|we(?:'re| are)) (?:on|in) (?:a |the )?(?:phone )?call\b/iu,
      /\bon the phone with\b/iu,
    ],
    negative: [
      /\b(?:off|finished|done with|ended) (?:the |that )?(?:phone )?call\b/iu,
    ],
  },
  {
    scene: 'driving',
    ttlMinutes: 120,
    positive: [
      /\bi(?:'m| am) driving\b/iu,
      /\bwe(?:'re| are) (?:in the car|driving)\b/iu,
    ],
    negative: [
      /\b(?:stopped|finished) driving\b/iu,
      /\b(?:i(?:'ve| have)|we(?:'ve| have)) arrived\b/iu,
    ],
  },
  {
    scene: 'in_bed',
    ttlMinutes: 480,
    positive: [/\bi(?:'m| am) (?:in|lying in|going to) bed\b/iu],
    negative: [
      /\bi(?:'m| am) (?:out of|not in) bed\b/iu,
      /\bi (?:got|have gotten) up\b/iu,
    ],
  },
  {
    scene: 'at_shop',
    ttlMinutes: 180,
    positive: [
      /\bi(?:'m| am) (?:at|in) (?:the |a )?(?:shop|store|supermarket)\b/iu,
    ],
    negative: [
      /\bi(?:'m| am) (?:back|home) from (?:the |a )?(?:shop|store|supermarket)\b/iu,
    ],
  },
  {
    scene: 'cooking',
    ttlMinutes: 180,
    positive: [
      /\bi(?:'m| am) (?:cooking|making (?:dinner|lunch|breakfast|tea))\b/iu,
    ],
    negative: [
      /\bi(?:'m| am) (?:done|finished) cooking\b/iu,
      /\b(?:dinner|lunch|breakfast|tea)(?:'s| is) (?:done|ready)\b/iu,
    ],
  },
];

function localDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function deriveSceneState({
  messages,
  currentTurn,
  now = new Date(),
  timeZone = 'Europe/London',
}: {
  messages: SceneMessage[];
  currentTurn: string;
  now?: Date;
  timeZone?: string;
}): SceneState {
  const turns = [
    ...messages.filter((message) => message.role === 'user'),
    { role: 'user', text: currentTurn, createdAt: now },
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const current: SceneFact[] = [];
  const historical: SceneFact[] = [];

  for (const definition of SCENES) {
    const observation = turns.find((turn) =>
      [...definition.negative, ...definition.positive].some((pattern) =>
        pattern.test(turn.text),
      ),
    );
    if (!observation) continue;
    const inactive = definition.negative.some((pattern) =>
      pattern.test(observation.text),
    );
    const ageMinutes = Math.max(
      0,
      (now.getTime() - observation.createdAt.getTime()) / 60_000,
    );
    const sameDay =
      localDate(now, timeZone) === localDate(observation.createdAt, timeZone);
    const source =
      observation.createdAt.getTime() === now.getTime()
        ? 'current_turn'
        : 'recent_user_turn';
    const fact: SceneFact = {
      scene: definition.scene,
      status: inactive ? 'inactive' : 'active',
      source,
      observedAt: observation.createdAt.toISOString(),
      confidence: 'explicit',
    };
    if (
      source === 'current_turn' ||
      (sameDay && ageMinutes <= definition.ttlMinutes)
    ) {
      current.push(fact);
    } else {
      historical.push({ ...fact, status: 'historical' });
    }
  }

  return { current, historical };
}
