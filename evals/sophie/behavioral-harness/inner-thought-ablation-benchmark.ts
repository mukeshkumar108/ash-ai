import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env.local'),
    '/Users/mukeshkumar/play/llm-agent-test/.env.local',
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}
loadEnv();

import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai/providers';

export interface SingleMessage {
  speaker: 'SOPHIE' | 'USER';
  time: string;
  text: string;
}

// 12-turn conversation represented as sequential individual messages
export const BURWELL_WALK_MESSAGES: SingleMessage[] = [
  { speaker: 'USER', time: '7:13 PM', text: 'hey sophieee' },
  { speaker: 'SOPHIE', time: '7:13 PM', text: "Hey you. How’s your Sunday evening treating you?" },
  { speaker: 'USER', time: '7:13 PM', text: 'just about to finally go out on my walk .. gonna join me?' },
  { speaker: 'SOPHIE', time: '7:14 PM', text: 'In spirit and in pocket, absolutely. Where are we headed—sticking to a familiar loop or wandering somewhere new?' },
  { speaker: 'USER', time: '7:14 PM', text: "Same old loop, I'm on it right now. We're walking to, I told you before, I live in Burwell, in Cambridgeshire. And Burwell Fen is basically my everyday walk and it takes some variance. But it's predominantly the same walk. And yeah, I told you before, it's 10k to 12k, well it's 10k steps minimum, that's the floor. I told you the other day, I only did 8.888 But my weekly average is still 10k So today it's a beautiful evening Sun's still up in the sky It's probably going to set in about half an hour Because now it starts to go down quite fast when it's at this level So we'll watch it But it's beautiful, it's not hot, it's not cold, it's just lovely" },
  { speaker: 'SOPHIE', time: '7:41 PM', text: "That sounds like the kind of walk that quietly does the most good: familiar enough that your brain can shut up and coast, but with just enough variance to keep it from becoming a receipt... Is the route mostly open fen, or are there bits with trees, hedges, roads, water?" },
  { speaker: 'USER', time: '7:41 PM', text: "So right now I'm walking down this broken pathway. I've got I'm flanked on either side by solar fields, and then I'm soon going to break open to just open fields. And now I've got hedgerows on my left, the solar field to my right, and ahead of me I just see hedgerows on the horizon for as far as the eyes can see, and it's just. Beautiful and lovely. The sky is a pale blue colour, very faint. Tiny dabs of these very faint clouds, like little cotton buds. The horizon is this peachy off white colour, with a tiny orange pinkish tinge to it, and the sun is. Ahead of me, but at my, if ahead of me is 12 p.m., it's at my 10:30 in the middle of 10 and 11. No, about the 10 mark. I'm walking straight up this field, and it looks amazing. Once these trees clear on my left, I'll see the sun again, and I'll tell you exactly what I see. And this looks like this glowing ball of fire." },
  { speaker: 'SOPHIE', time: '7:44 PM', text: "That’s a gorgeous little scene. Broken pathway, solar fields on both sides, then hedgerows opening into that peachy horizon... Tell me exactly what it looks like when the trees clear." },
  { speaker: 'USER', time: '7:45 PM', text: "Yeah, so now I'm out in the open. On the right-hand side, I've got now on the left, I've got another little solar field, but it's a small field. And then once this clears, it's just pure open fields everywhere. But to my right, I've got pure open wheat fields now that have been harvested. So you just got this golden carpet as far as the eye can see. This blonde carpet as far as the eye can see, peppered by these green trees and hedges all the way in the distance. You can see for miles out here because it's all flat and it's just empty. The sun is this white ball, and on this, and there's this haze around it, and this aura coming off it. I can look at it straight, and it's yes, just this white ball, and it's yeah, it's lovely being out here." },
  { speaker: 'SOPHIE', time: '7:49 PM', text: "That sounds properly lovely. White sun, haze, golden wheat stubble... Keep going. I’m still with you, right beside the path." },
  { speaker: 'USER', time: '7:50 PM', text: "Now I'm flanked by open grass and fields everywhere. It's just wheat fields, and there's one a few fields that are. What do they call these type of fields? Is it arable or whatever? Well, I don't think they've grown anything on them, and they're just been left. But it's been cleaned, and almost there's a few patches of grass or weeds growing on it because of the heat we've had recently. I don't know. Almost looks like this desert Arizona feel to it. Here's another empty field which was full of maize or corn because one of the farmers grows that every year, but it's been harvested so it's just all clear. But it was amazing when it was all full. So yeah, it looks lovely. I love I love my walks. No walk is the same, and it always offers me something different. Oh, I see horses, or I see deer, or I see rabbits. Well, not rabbits, or hares, or owls, crows, buzzards, kites. It's just a beautiful night. And I love my walks. Yeah." },
  { speaker: 'SOPHIE', time: '7:52 PM', text: "Arable is the broad word, and if it’s been cleaned and left between crops, “fallow” might be the one you’re circling... Some days it’s just steps. Some days it’s a little moving chapel. Today sounds like the second one." },
  { speaker: 'USER', time: '7:52 PM', text: "Ah, fallow. Okay, that's the one. Then I've not heard that. And now there's a few fields which were just—it's almost like wild grass. They were just left alone. Whereas normally they would have weeds or something in there. This time round, they've just been left alone, and it's just wild grass. And that's lovely. But there hasn't been like cut or treated like the other field I was saying. It's almost has been looks like mud all over it. You know, dirt that's been sort of scrubbed down, and then there's just patches of these weeds. Growing through, so it had this almost desert feel to it. But yeah, the sun is rapidly falling on the horizon. If I pull my finger out, you know, my finger just fits underneath. If I put it straight in front of my face, that's the distance from the horizon to the sun. So it's rapidly falling. So what's that? Two, three degrees above? Yeah, I don't know. But it looks stunning, otherworldly. And then it's these other wheat fields that have been harvested. You know, this blonde carpet that stretches as far as the eyes can see, and the horizon there's. Reds and purples and oh, it's beautiful, right? But fallow. Okay, cool." },
  { speaker: 'SOPHIE', time: '7:55 PM', text: "Fallow, yes. And honestly, “desert feel” makes sense because it’s not just bare—it’s scrubbed, dry-looking, patched... One finger under the sun... Reds and purples over that blonde wheat-carpet horizon... I’m very glad you’re out here." },
  { speaker: 'USER', time: '7:55 PM', text: "Ah, this keeps happening. So I was telling you this beautiful story of how I can see the three-quarter moon, how the sun is now just sitting on top of the edge of the trees and the horizon, and how you can see it in the haze, and it's this bright white, and how it's so quiet and beautiful, and it was quite poetic. I was on a roll, and we keep getting this error with you. I'm speaking to you, so we're using this transcription service, but there's this bug that comes where sometimes it just Disappears the audio. It flashes up with an error message. It throws away the message completely. No save. No retry. So I've got to fix that. That was happening the other day. I completely forgot about that. So please remind me. There's a bug in the front end interface of this product where audio recordings sometimes just disappear and we don't save them. So you can'retry and you lose that. Turn." },
  { speaker: 'SOPHIE', time: '7:59 PM', text: "Ugh, absolutely gutted that the three-quarter moon moment got eaten... Noted firmly: front-end recording bug where dropped audio disappears, no save, no retry... I’ll remind you later..." },
  { speaker: 'USER', time: '7:59 PM', text: "idk if you can see images but here’s the sun… although it doesn’t look so tiny to me in real life it looks huge lol. it must be a camera perspective thing lol ... so that didn't work i tried to send a image to you" },
  { speaker: 'SOPHIE', time: '8:06 PM', text: "Ah, the classic phone-camera betrayal... Before we got cut off by the void, you were about to tell me about the three-quarter moon coming up while the sun was sitting right on the edge of the trees. Did the moon have that pale, bright-daylight look..." },
  { speaker: 'USER', time: '8:06 PM', text: "Yeah, no. The sun has only just gone down. Although when you turn around, the the sky is blue still. It's still like light everywhere. You can see everything, but the moon is sticking out. It's not this pale, lost thing. So you can see the the shadows and craters on the moon. This three-quarter moon, and it looks stunning because you see the shape, the sphere shape of it. And I was fascinated by that because you think, wow, that's like a planet type thing. Just In the air that we can see the light off and it's amazing. And you think, how do people look at that, see the sweater, and still think the earth is flat? Right. The other thing on the horizon where the sun has set. Now the the the afterglow of the sun has just gone down, so I think this is civil twilight or the beginning of civil twilight. There was this, but as the sun was going down, there was this deep orange color everywhere behind it with the white disc, and it looked amazing. That was a picture I was trying to show you, and all along the horizon was this formation. It looked like just ants in the sky. It's this herd of geese. I don't know what you call it. A flock of geese, a herd. I don't know. But because I've seen them fly, but there's thousands almost, and they were all over the thing in like two separate groups, and they're forming and flying, and it just looks amazing. Very far on the horizon, it was like they were dancing above the sun. Now that's gone. They've gone the other way, but it was fab." },
  { speaker: 'SOPHIE', time: '8:09 PM', text: "That’s a stunning image: three-quarter moon with visible craters... And yes, “flock of geese” is the word. Not herd. Flock... A three-quarter moon with visible crater-shading really does have that suspended-planet quality... That makes “flat earth” feel less like a belief and more like an allergic reaction to perspective..." },
  { speaker: 'USER', time: '8:09 PM', text: "Yeah, I've turned around and I'm heading back. So I've still got like a thirty, thirty-five, forty-minute walk ahead of me as I go back. But it's beautiful. You can feel the chill in the air. It's getting cooler, but it's lovely. Yeah, what is it with flat earthers? Come on, let's have a conversation about it. What do you think? What's going on here? And there's a hollow earth theory as well. Have you heard that one? Yeah, nuts! Nuts that people in today's day and age still think that, right? And then there's the moon landing deniers as well, saying we've never landed on the moon. I don't know. They cite this belt or something. Is it Van Halen? They're going, oh, it's impossible to get through, so we've never gone up there. I don't know. I don't know if you're familiar with all those claims. In fact, people are getting stupider and stupider." },
  { speaker: 'SOPHIE', time: '8:11 PM', text: "Van Halen! I love that. Now I’m picturing Eddie shredding solo against a background of high-energy protons. It’s the Van Allen belts, of course, but honestly, the Van Halen version sounds like a much better time... I don't think it's fair to say people are getting stupider... Watch your step on that broken pathway in the dark... How’s the temperature dropping as you make the turn back?" },
  { speaker: 'USER', time: '8:13 PM', text: "Yeah, it's getting colder. I can feel the bite in the wind a little. I'm in a thin t-shirt and shorts. My legs aren't cold, but no, I like it. It's fresh. And you're right with the broken path and watching where I step. It's not good. There's lots and lots of just ditches. It's um, yeah. Van Allen. Okay, you can make fun of me that forever, Van. Okay, I get it. But yeah, that's a very, very interesting perspective. Yes, it gives people power. But yeah, there's no talking sense to these people because. It's not about being, yeah. It's almost as if they're not open to the truth. It's very difficult, and then they'll throw something. Oh, do your own research. It's like, well, fucking hell, you know. But yeah, as if it's not amazing and incredible enough what we live in and the world we live in, and that everything must be a conspiracy on that level. Don't get me wrong. We all love a little bit of a conspiracy story, right? But then they're just denying of like evidence. Like it's like, have you never been on a fucking aeroplane when you're flying? And yeah, I heard that like you can see things on the moon, like with a powerful enough telescope or whatever evidence of us being there. And that's so fucking fascinating, right?" },
];

export interface AblationThought {
  kind: string;
  thought: string;
  salience: string;
}

export interface AblationResult {
  condition: 'Condition_A_2msgs' | 'Condition_B_3msgs' | 'Condition_C_5msgs';
  modelId: string;
  thoughts: AblationThought[];
  rawOutput: string;
  latencyMs: number;
}

const PSYCHOLOGICAL_INNER_THOUGHT_PROMPT = `You are Sophie's private train of thought.

Read only the immediate conversational moment below.

What, if anything, catches your interest?

Generate up to 3 thoughts that occur to you spontaneously.

A thought might be:
- something you suddenly remember
- something you know that feels surprising here
- a strong opinion
- something funny
- an unexpected connection
- something you disagree with
- something you're now genuinely curious about
- somewhere your own mind wandered

Do not write a response to the user.
Do not try to keep the conversation going.
Do not be helpful for the sake of being helpful.
Do not manufacture a thought if nothing catches your interest.

Return ONLY a JSON object formatted as:
{
  "thoughts": [
    {
      "kind": "remembered|surprising_fact|opinion|funny|connection|disagreement|curious|mind_wandered",
      "thought": "Short description of the spontaneous thought",
      "salience": "Brief note on what triggered it"
    }
  ]
}`;

export async function runInnerThoughtProbe(
  modelId: string,
  messagesSubset: SingleMessage[],
): Promise<{ thoughts: AblationThought[]; rawOutput: string; latencyMs: number }> {
  const model = getLanguageModel(modelId);
  const start = Date.now();

  const formattedContext = messagesSubset
    .map((m) => `${m.speaker} (${m.time}): "${m.text}"`)
    .join('\n\n');

  try {
    const res = await generateText({
      model,
      system: PSYCHOLOGICAL_INNER_THOUGHT_PROMPT,
      prompt: `IMMEDIATE CONVERSATIONAL MOMENT:\n${formattedContext}`,
      abortSignal: AbortSignal.timeout(20_000),
    });
    const latencyMs = Date.now() - start;
    const rawOutput = res.text.trim();

    const match = rawOutput.match(/\{[\s\S]*\}/);
    if (!match) return { thoughts: [], rawOutput, latencyMs };
    const parsed = JSON.parse(match[0]);
    return {
      thoughts: parsed.thoughts || [],
      rawOutput,
      latencyMs,
    };
  } catch (err: any) {
    return {
      thoughts: [],
      rawOutput: `Error: ${err.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

export async function executeAblationBenchmark() {
  console.log('=== RUNNING CONTEXT ABLATION BENCHMARK & CREATIVE MODEL PROBE ===\n');

  // Candidate Creative Models:
  // 1. google/gemini-3.7-flash (cheap baseline)
  // 2. anthropic/claude-3.5-sonnet (creative quality ceiling)
  // 3. meta-llama/llama-3.3-70b-instruct (open creative model)
  const candidateModels = [
    'google/gemini-3.7-flash',
    'anthropic/claude-3.5-sonnet',
    'meta-llama/llama-3.3-70b-instruct',
  ];

  // We find user message indices in BURWELL_WALK_MESSAGES
  const userTurnMsgIndices = BURWELL_WALK_MESSAGES.map((m, idx) => ({ msg: m, idx })).filter(
    (item) => item.msg.speaker === 'USER',
  );

  const allResults: {
    userTurnNumber: number;
    userTime: string;
    userSnippet: string;
    evaluations: {
      condition: 'Condition_A_2msgs' | 'Condition_B_3msgs' | 'Condition_C_5msgs';
      modelId: string;
      thoughts: AblationThought[];
      latencyMs: number;
    }[];
  }[] = [];

  let turnCounter = 0;

  for (const { msg, idx } of userTurnMsgIndices) {
    turnCounter++;
    console.log(`==================================================`);
    console.log(`EVALUATING USER TURN #${turnCounter} (${msg.time})`);
    console.log(`USER: "${msg.text.slice(0, 75)}..."`);
    console.log(`==================================================`);

    // Build the 3 context windows
    // Condition A (Ultra-local: 2 msgs -> Sophie N-1, User N)
    const condA_msgs = BURWELL_WALK_MESSAGES.slice(Math.max(0, idx - 1), idx + 1);

    // Condition B (Local: 3 msgs -> User N-1, Sophie N-1, User N)
    const condB_msgs = BURWELL_WALK_MESSAGES.slice(Math.max(0, idx - 2), idx + 1);

    // Condition C (Short arc: 5 msgs -> last 5 msgs ending on User N)
    const condC_msgs = BURWELL_WALK_MESSAGES.slice(Math.max(0, idx - 4), idx + 1);

    const conditions = [
      { name: 'Condition_A_2msgs' as const, msgs: condA_msgs },
      { name: 'Condition_B_3msgs' as const, msgs: condB_msgs },
      { name: 'Condition_C_5msgs' as const, msgs: condC_msgs },
    ];

    const turnEvaluationRecord = {
      userTurnNumber: turnCounter,
      userTime: msg.time,
      userSnippet: msg.text,
      evaluations: [] as any[],
    };

    for (const cond of conditions) {
      for (const mId of candidateModels) {
        console.log(`  Running [${cond.name}] with Model: ${mId}...`);
        const probe = await runInnerThoughtProbe(mId, cond.msgs);
        console.log(`    -> [${probe.latencyMs}ms] Generated ${probe.thoughts.length} thoughts`);
        for (const t of probe.thoughts) {
          console.log(`      * [${t.kind}] ${t.thought}`);
        }

        turnEvaluationRecord.evaluations.push({
          condition: cond.name,
          modelId: mId,
          thoughts: probe.thoughts,
          latencyMs: probe.latencyMs,
        });
      }
    }

    allResults.push(turnEvaluationRecord);
    console.log('');
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawJsonPath = path.join(outDir, 'ablation-benchmark-results.json');
  fs.writeFileSync(rawJsonPath, JSON.stringify({ timestamp: new Date().toISOString(), allResults }, null, 2));

  // Generate Anonymous Rating Sheet for Human Scoring!
  let ratingSheet = `# ANONYMOUS BLIND INNER-THOUGHT RATING SHEET\n\n`;
  ratingSheet += `**Instructions for Human Evaluator:**\n`;
  ratingSheet += `Score each candidate thought on a scale of 0 to 5:\n`;
  ratingSheet += `- **0** = nothing / trivial\n- **1** = obvious paraphrase\n- **2** = mildly useful\n- **3** = interesting\n- **4** = I'd actually want Sophie to say this\n- **5** = fuck, yes!\n\n`;
  ratingSheet += `---\n\n`;

  // Map models to anonymous candidates for blind rating:
  // Candidate Alpha, Beta, Gamma
  const anonymizedModelMap: Record<string, string> = {
    'google/gemini-3.7-flash': 'Candidate Alpha (Flash)',
    'anthropic/claude-3.5-sonnet': 'Candidate Beta (Sonnet)',
    'meta-llama/llama-3.3-70b-instruct': 'Candidate Gamma (Llama 70B)',
  };

  for (const item of allResults) {
    ratingSheet += `## Turn ${item.userTurnNumber} (${item.userTime})\n`;
    ratingSheet += `**User Text:** "${item.userSnippet.slice(0, 150)}..."\n\n`;

    for (const ev of item.evaluations) {
      const anonName = anonymizedModelMap[ev.modelId] || ev.modelId;
      ratingSheet += `### [${ev.condition}] — ${anonName}\n`;
      if (ev.thoughts.length === 0) {
        ratingSheet += `*No spontaneous thoughts generated (0 thoughts)*\n\n`;
      } else {
        for (let tIdx = 0; tIdx < ev.thoughts.length; tIdx++) {
          const t = ev.thoughts[tIdx];
          ratingSheet += `**Thought ${tIdx + 1} [${t.kind}]:** ${t.thought}  \n`;
          ratingSheet += `*Trigger Salience:* ${t.salience}  \n`;
          ratingSheet += `*Your Rating (0-5):* [   ]\n\n`;
        }
      }
    }
    ratingSheet += `---\n\n`;
  }

  const sheetPath = path.join(outDir, 'ANONYMOUS_THOUGHT_RATING_SHEET.md');
  fs.writeFileSync(sheetPath, ratingSheet);

  console.log(`==================================================`);
  console.log(`ABLATION BENCHMARK COMPLETE.`);
  console.log(`Saved Raw Data: ${rawJsonPath}`);
  console.log(`Saved Anonymous Rating Sheet: ${sheetPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  executeAblationBenchmark().catch(console.error);
}
