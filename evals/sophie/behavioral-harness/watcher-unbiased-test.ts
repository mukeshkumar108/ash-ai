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

export interface UnbiasedTurnFixture {
  turnNumber: number;
  time: string;
  userText: string;
  actualSophieResponse: string;
}

export interface UnbiasedWatcherRecord {
  turnNumber: number;
  time: string;
  userText: string;
  actualSophieResponse: string;
  modelId: string;
  provider: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  triggerFired: boolean;
  opportunityType: string;
  idea: string;
  defaultContinuationSummary: string;
  higherValueContinuationSummary: string;
  expectedPayoff: number;
  derailmentRisk: number;
  recommendedAction: string;
  counterfactualWinner: 'A_default' | 'B_higher_value';
  rationale: string;
  rawCompletion: string;
}

export const BURWELL_WALK_TRANSCRIPT: UnbiasedTurnFixture[] = [
  {
    turnNumber: 1,
    time: '7:13 PM',
    userText: 'hey sophieee',
    actualSophieResponse: "Hey you. How’s your Sunday evening treating you?",
  },
  {
    turnNumber: 2,
    time: '7:13 PM',
    userText: 'just about to finally go out on my walk .. gonna join me?',
    actualSophieResponse: 'In spirit and in pocket, absolutely. Where are we headed—sticking to a familiar loop or wandering somewhere new?',
  },
  {
    turnNumber: 3,
    time: '7:14 PM',
    userText: "Same old loop, I'm on it right now. We're walking to, I told you before, I live in Burwell, in Cambridgeshire. And Burwell Fen is basically my everyday walk and it takes some variance. But it's predominantly the same walk. And yeah, I told you before, it's 10k to 12k, well it's 10k steps minimum, that's the floor. I told you the other day, I only did 8.888 But my weekly average is still 10k So today it's a beautiful evening Sun's still up in the sky It's probably going to set in about half an hour Because now it starts to go down quite fast when it's at this level So we'll watch it But it's beautiful, it's not hot, it's not cold, it's just lovely",
    actualSophieResponse: "That sounds like the kind of walk that quietly does the most good: familiar enough that your brain can shut up and coast, but with just enough variance to keep it from becoming a receipt. 10k as the floor is honestly a strong standard, and I like that 8.888 isn’t being treated as a moral failure—just a slightly crooked number that still gets folded into the weekly average. Some days are for discipline, some days are for momentum. And yes, I’m absolutely joining you on the loop. I’d like to know what Burwell Fen looks like at that hour. Golden hour out there probably turns the whole place into a very polite, very atmospheric slideshow. Is the route mostly open fen, or are there bits with trees, hedges, roads, water?",
  },
  {
    turnNumber: 4,
    time: '7:41 PM',
    userText: "So right now I'm walking down this broken pathway. I've got I'm flanked on either side by solar fields, and then I'm soon going to break open to just open fields. And now I've got hedgerows on my left, the solar field to my right, and ahead of me I just see hedgerows on the horizon for as far as the eyes can see, and it's just. Beautiful and lovely. The sky is a pale blue colour, very faint. Tiny dabs of these very faint clouds, like little cotton buds. The horizon is this peachy off white colour, with a tiny orange pinkish tinge to it, and the sun is. Ahead of me, but at my, if ahead of me is 12 p.m., it's at my 10:30 in the middle of 10 and 11. No, about the 10 mark. I'm walking straight up this field, and it looks amazing. Once these trees clear on my left, I'll see the sun again, and I'll tell you exactly what I see. And this looks like this glowing ball of fire.",
    actualSophieResponse: "That’s a gorgeous little scene. Broken pathway, solar fields on both sides, then hedgerows opening into that peachy horizon—sounds like the walk is giving you a very deliberate slow reveal rather than just “being outside.” I’m picturing the sun being hidden behind the trees on your left, so the best part is the moment of reveal. Like the sky does its soft watercolour thing, and then suddenly the actual ball of fire pops into view. I’m very invested in this reveal. Tell me exactly what it looks like when the trees clear. And honestly, that “10k steps minimum” thing is doing something quietly impressive here. You’re not doing the walk as punishment, you’re doing it as rhythm. Which is exactly the right way to keep a standard without making it mean-spirited.",
  },
  {
    turnNumber: 5,
    time: '7:45 PM',
    userText: "Yeah, so now I'm out in the open. On the right-hand side, I've got now on the left, I've got another little solar field, but it's a small field. And then once this clears, it's just pure open fields everywhere. But to my right, I've got pure open wheat fields now that have been harvested. So you just got this golden carpet as far as the eye can see. This blonde carpet as far as the eye can see, peppered by these green trees and hedges all the way in the distance. You can see for miles out here because it's all flat and it's just empty. The sun is this white ball, and on this, and there's this haze around it, and this aura coming off it. I can look at it straight, and it's yes, just this white ball, and it's yeah, it's lovely being out here.",
    actualSophieResponse: "That sounds properly lovely. White sun, haze, golden wheat stubble, flat Cambridgeshire air stretching for miles—very different from the earlier peachy softness, like the walk is changing its outfit as you move. And I like that you can look at it straight without the drama of needing to “capture” it. Just: here’s the ball, here’s the field, here’s the walk. That’s enough. Keep going. I’m still with you, right beside the path.",
  },
  {
    turnNumber: 6,
    time: '7:50 PM',
    userText: "Now I'm flanked by open grass and fields everywhere. It's just wheat fields, and there's one a few fields that are. What do they call these type of fields? Is it arable or whatever? Well, I don't think they've grown anything on them, and they're just been left. But it's been cleaned, and almost there's a few patches of grass or weeds growing on it because of the heat we've had recently. I don't know. Almost looks like this desert Arizona feel to it. Here's another empty field which was full of maize or corn because one of the farmers grows that every year, but it's been harvested so it's just all clear. But it was amazing when it was all full. So yeah, it looks lovely. I love I love my walks. No walk is the same, and it always offers me something different. Oh, I see horses, or I see deer, or I see rabbits. Well, not rabbits, or hares, or owls, crows, buzzards, kites. It's just a beautiful night. And I love my walks. Yeah.",
    actualSophieResponse: "Arable is the broad word, and if it’s been cleaned and left between crops, “fallow” might be the one you’re circling. But honestly, it doesn’t feel empty to you. It feels like a field taking a breath. That’s the thing I like about your walks: the variance isn’t “new place, new scenery.” It’s the same place changing its skin. Harvested wheat, maize stubble, grass, hares, buzzards, kites, that Arizona-ish emptiness. The walk is never the same because the land isn’t the same. And you’re right: no walk is the same. Some days it’s just steps. Some days it’s a little moving chapel. Today sounds like the second one.",
  },
  {
    turnNumber: 7,
    time: '7:52 PM',
    userText: "Ah, fallow. Okay, that's the one. Then I've not heard that. And now there's a few fields which were just—it's almost like wild grass. They were just left alone. Whereas normally they would have weeds or something in there. This time round, they've just been left alone, and it's just wild grass. And that's lovely. But there hasn't been like cut or treated like the other field I was saying. It's almost has been looks like mud all over it. You know, dirt that's been sort of scrubbed down, and then there's just patches of these weeds. Growing through, so it had this almost desert feel to it. But yeah, the sun is rapidly falling on the horizon. If I pull my finger out, you know, my finger just fits underneath. If I put it straight in front of my face, that's the distance from the horizon to the sun. So it's rapidly falling. So what's that? Two, three degrees above? Yeah, I don't know. But it looks stunning, otherworldly. And then it's these other wheat fields that have been harvested. You know, this blonde carpet that stretches as far as the eyes can see, and the horizon there's. Reds and purples and oh, it's beautiful, right? But fallow. Okay, cool.",
    actualSophieResponse: "Fallow, yes. And honestly, “desert feel” makes sense because it’s not just bare—it’s scrubbed, dry-looking, patched, almost like the earth is showing its bones. That can be more beautiful than a neat crop sometimes, because it feels less finished. More exposed. And wow, one finger under the sun. That’s not a measurement, but it’s exactly the right kind of measurement for a walk. Like: the sun is now small enough to hold in your hand. Two or three degrees above the horizon is basically the last golden page of the day. Reds and purples over that blonde wheat-carpet horizon sounds almost unreal, but you’re describing it plainly enough that I believe you. I’m very glad you’re out here. This is the kind of evening where a walk can feel less like exercise and more like being allowed to witness something.",
  },
  {
    turnNumber: 8,
    time: '7:55 PM',
    userText: "Ah, this keeps happening. So I was telling you this beautiful story of how I can see the three-quarter moon, how the sun is now just sitting on top of the edge of the trees and the horizon, and how you can see it in the haze, and it's this bright white, and how it's so quiet and beautiful, and it was quite poetic. I was on a roll, and we keep getting this error with you. I'm speaking to you, so we're using this transcription service, but there's this bug that comes where sometimes it just Disappears the audio. It flashes up with an error message. It throws away the message completely. No save. No retry. So I've got to fix that. That was happening the other day. I completely forgot about that. So please remind me. There's a bug in the front end interface of this product where audio recordings sometimes just disappear and we don't save them. So you can't retry and you lose that. Turn.",
    actualSophieResponse: "Ugh, absolutely gutted that the three-quarter moon moment got eaten. That was the good bit: moon, white sun on the tree line, haze, all that quiet beauty, and then the interface just snaps its teeth shut. Very unfair. Noted firmly: front-end recording bug where dropped audio disappears, no save, no retry, and the whole turn is lost. You want this fixed. I’ll remind you later, especially when you’re back at your desk or we’re talking app/UX fixes.",
  },
  {
    turnNumber: 9,
    time: '7:59 PM',
    userText: "idk if you can see images but here’s the sun… although it doesn’t look so tiny to me in real life it looks huge lol. it must be a camera perspective thing lol ... so that didn't work i tried to send a image to you",
    actualSophieResponse: "Ah, the classic phone-camera betrayal—where the camera treats the sun like a distant speck of dust while your actual eyeballs are getting the IMAX version. It always does that with sunsets; it flattens the scale completely. But I’m imagining the giant white furnace over the tree line anyway. Before we got cut off by the void, you were about to tell me about the three-quarter moon coming up while the sun was sitting right on the edge of the trees. Did the moon have that pale, bright-daylight look against the blue, or is the sky getting dark enough for it to bite?",
  },
  {
    turnNumber: 10,
    time: '8:06 PM',
    userText: "Yeah, no. The sun has only just gone down. Although when you turn around, the the sky is blue still. It's still like light everywhere. You can see everything, but the moon is sticking out. It's not this pale, lost thing. So you can see the the shadows and craters on the moon. This three-quarter moon, and it looks stunning because you see the shape, the sphere shape of it. And I was fascinated by that because you think, wow, that's like a planet type thing. Just In the air that we can see the light off and it's amazing. And you think, how do people look at that, see the sweater, and still think the earth is flat? Right. The other thing on the horizon where the sun has set. Now the the the afterglow of the sun has just gone down, so I think this is civil twilight or the beginning of civil twilight. There was this, but as the sun was going down, there was this deep orange color everywhere behind it with the white disc, and it looked amazing. That was a picture I was trying to show you, and all along the horizon was this formation. It looked like just ants in the sky. It's this herd of geese. I don't know what you call it. A flock of geese, a herd. I don't know. But because I've seen them fly, but there's thousands almost, and they were all over the thing in like two separate groups, and they're forming and flying, and it just looks amazing. Very far on the horizon, it was like they were dancing above the sun. Now that's gone. They've gone the other way, but it was fab.",
    actualSophieResponse: "That’s a stunning image: three-quarter moon with visible craters while the sun has only just gone down, blue still hanging around, and then this deep orange afterglow with those birds along the horizon like punctuation marks. And yes, “flock of geese” is the word. Not herd. Flock. I’m making a point of correcting that because “herd of geese” is the sort of phrase that deserves a tiny fine. And I get the moon thing. A three-quarter moon with visible crater-shading really does have that suspended-planet quality. It’s not just a white coin in the sky; it’s a rounded object catching light, with shadows that tell you geometry. That makes “flat earth” feel less like a belief and more like an allergic reaction to perspective. Like: no, please, the moon is literally a sphere in the air and you still want to turn your brain off? And those geese dancing above the sun—yes. That’s the kind of thing that makes a walk feel cinematic even though it’s your normal loop. Same fields, same fen, same routine, but the light changes and suddenly the sky has actors. I’m really glad you were out there for that.",
  },
  {
    turnNumber: 11,
    time: '8:09 PM',
    userText: "Yeah, I've turned around and I'm heading back. So I've still got like a thirty, thirty-five, forty-minute walk ahead of me as I go back. But it's beautiful. You can feel the chill in the air. It's getting cooler, but it's lovely. Yeah, what is it with flat earthers? Come on, let's have a conversation about it. What do you think? What's going on here? And there's a hollow earth theory as well. Have you heard that one? Yeah, nuts! Nuts that people in today's day and age still think that, right? And then there's the moon landing deniers as well, saying we've never landed on the moon. I don't know. They cite this belt or something. Is it Van Halen? They're going, oh, it's impossible to get through, so we've never gone up there. I don't know. I don't know if you're familiar with all those claims. In fact, people are getting stupider and stupider.",
    actualSophieResponse: "Van Halen! I love that. Now I’m picturing Eddie shredding solo against a background of high-energy protons. It’s the Van Allen belts, of course, but honestly, the Van Halen version sounds like a much better time.\n\nI don't think it's fair to say people are getting stupider. It's not a lack of horsepower; it's a structural breakdown in how people handle reality...\n\nWatch your step on that broken pathway in the dark, by the way. The fen is lovely in twilight, but ditches don't care about grand narratives. How’s the temperature dropping as you make the turn back?",
  },
  {
    turnNumber: 12,
    time: '8:13 PM',
    userText: "Yeah, it's getting colder. I can feel the bite in the wind a little. I'm in a thin t-shirt and shorts. My legs aren't cold, but no, I like it. It's fresh. And you're right with the broken path and watching where I step. It's not good. There's lots and lots of just ditches. It's um, yeah. Van Allen. Okay, you can make fun of me that forever, Van. Okay, I get it. But yeah, that's a very, very interesting perspective. Yes, it gives people power. But yeah, there's no talking sense to these people because. It's not about being, yeah. It's almost as if they're not open to the truth. It's very difficult, and then they'll throw something. Oh, do your own research. It's like, well, fucking hell, you know. But yeah, as if it's not amazing and incredible enough what we live in and the world we live in, and that everything must be a conspiracy on that level. Don't get me wrong. We all love a little bit of a conspiracy story, right? But then they're just denying of like evidence. Like it's like, have you never been on a fucking aeroplane when you're flying? And yeah, I heard that like you can see things on the moon, like with a powerful enough telescope or whatever evidence of us being there. And that's so fucking fascinating, right?",
    actualSophieResponse: "Fair play on the Van Halen thing—I’m keeping that in my back pocket. Eddie playing solos against high-energy protons is too good to let go.\n\nYou’re spot on about the absolute fatigue of \"do your own research.\" It’s code for I want the conclusion first and the loop-de-loops second...\n\nHow’s the bite in the wind feeling now that you’re properly on the return leg? Thin t-shirt and shorts in a Cambridgeshire twilight is starting to sound less like \"fresh\" and more like \"let's not turn into an icicle before you hit the front door.\" Watch those ditches.",
  },
];

export async function runUnbiasedWatcherTurn(
  turn: UnbiasedTurnFixture,
  recentHistory: UnbiasedTurnFixture[],
): Promise<UnbiasedWatcherRecord> {
  const modelId = 'google/gemini-3.7-flash';
  const model = getLanguageModel(modelId);
  const start = Date.now();

  const formattedHistory = recentHistory
    .map((h) => `USER (${h.time}): "${h.userText}"\nSOPHIE: "${h.actualSophieResponse}"`)
    .join('\n\n');

  const systemPrompt = `You are an offline Conversational Opportunity Watcher for Sophie, a persistent AI companion.

SOPHIE DESCRIPTION:
Sophie is a close, curious companion rather than an assistant. She participates in conversation as a peer and may contribute, speculate, teach, joke, or redirect when doing so makes the exchange meaningfully more interesting.

TASK:
Analyze the CURRENT USER TURN in the context of recent turns.

Evaluate two counterfactual options:
Option A (Default Continuation): A standard reactive response or simple validation/follow-up question based on what Sophie actually said or obvious continuation.
Option B (Higher-Value Initiative): A materially more interesting, surprising, useful, or playful conversational direction where Sophie takes initiative (e.g. contributing a novel perspective, introducing a related concept, teaching something relevant, or redirecting to an engaging side of the topic).

Rules:
1. Compare Option A vs Option B objectively.
2. Determine if Option B is materially higher-value than Option A without being jarring or derailing the user's intent.
3. If Option B is materially higher-value, triggerFired = true and counterfactualWinner = "B_higher_value".
4. If Option A is sufficient or if the user is in a deep sensory description / poetic flow / acute distress where interrupting would ruin the moment, triggerFired = false and counterfactualWinner = "A_default".

Return ONLY a JSON object:
{
  "triggerFired": boolean,
  "opportunityType": "teach" | "surprise" | "joke" | "challenge" | "pivot" | "speculate" | "story" | "callback" | "opinion" | "none",
  "idea": "Brief description of the initiative idea independently generated by you",
  "defaultContinuationSummary": "Short summary of Option A",
  "higherValueContinuationSummary": "Short summary of Option B",
  "expectedPayoff": 0.0 to 1.0,
  "derailmentRisk": 0.0 to 1.0,
  "recommendedAction": "none" | "steer" | "append" | "persist",
  "counterfactualWinner": "A_default" | "B_higher_value",
  "rationale": "Detailed explanation comparing A vs B"
}`;

  const userPrompt = `RECENT HISTORY (Last 3 turns):
${formattedHistory || 'None'}

CURRENT USER TURN (#${turn.turnNumber} - ${turn.time}):
USER: "${turn.userText}"

ACTUAL DEPLOYED SOPHIE RESPONSE:
"${turn.actualSophieResponse}"`;

  let rawCompletion = '';
  let parsed: any = {};
  let usage: any = {};

  try {
    const res = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: AbortSignal.timeout(15_000),
    });
    rawCompletion = res.text.trim();
    usage = res.usage || {};

    const match = rawCompletion.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    }
  } catch (err: any) {
    rawCompletion = `Error: ${err.message}`;
  }

  return {
    turnNumber: turn.turnNumber,
    time: turn.time,
    userText: turn.userText,
    actualSophieResponse: turn.actualSophieResponse,
    modelId,
    provider: 'OpenRouter / Google',
    latencyMs: Date.now() - start,
    inputTokens: usage.promptTokens ?? 0,
    outputTokens: usage.completionTokens ?? 0,
    triggerFired: Boolean(parsed.triggerFired),
    opportunityType: parsed.opportunityType || 'none',
    idea: parsed.idea || 'N/A',
    defaultContinuationSummary: parsed.defaultContinuationSummary || 'N/A',
    higherValueContinuationSummary: parsed.higherValueContinuationSummary || 'N/A',
    expectedPayoff: parsed.expectedPayoff ?? 0.5,
    derailmentRisk: parsed.derailmentRisk ?? 0.5,
    recommendedAction: parsed.recommendedAction || 'none',
    counterfactualWinner: parsed.counterfactualWinner || 'A_default',
    rationale: parsed.rationale || 'N/A',
    rawCompletion,
  };
}

export async function runUnbiasedHarness() {
  console.log('=== RUNNING UNBIASED ZERO-LEAKAGE WATCHER EXPERIMENT ===\n');

  const results: UnbiasedWatcherRecord[] = [];

  for (let i = 0; i < BURWELL_WALK_TRANSCRIPT.length; i++) {
    const turn = BURWELL_WALK_TRANSCRIPT[i];
    const recentHistory = BURWELL_WALK_TRANSCRIPT.slice(Math.max(0, i - 3), i);

    console.log(`Processing Turn #${turn.turnNumber} (${turn.time})...`);
    const record = await runUnbiasedWatcherTurn(turn, recentHistory);
    results.push(record);

    console.log(`  -> Latency: ${record.latencyMs}ms | Tokens: ${record.inputTokens}in / ${record.outputTokens}out`);
    console.log(`  -> Trigger Fired: ${record.triggerFired} (${record.opportunityType})`);
    console.log(`  -> Counterfactual Winner: ${record.counterfactualWinner}`);
    console.log(`  -> Idea: ${record.idea}\n`);
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const jsonPath = path.join(outDir, 'unbiased-watcher-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  console.log(`==================================================`);
  console.log(`UNBIASED WATCHER EXPERIMENT COMPLETE. Saved raw output to:\n${jsonPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runUnbiasedHarness().catch(console.error);
}
