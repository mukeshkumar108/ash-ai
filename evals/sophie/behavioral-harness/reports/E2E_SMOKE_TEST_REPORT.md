# E2E PROVIDER-BACKED SMOKE TEST REPORT

**Execution Timestamp:** 2026-08-24T14:38:20.546Z  
**Runtime URL:** `http://127.0.0.1:8080`  
**Raw Execution Data:** [`evals/sophie/behavioral-harness/reports/e2e-smoke-test-results.json`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/e2e-smoke-test-results.json)  

---

## Fixture A
**User Input:** "listen... you can hear the wind right through the reeds here. i'm just standing still listening."  
**Sophie Reply:**
> "Yeah. I can hear it. That dry hush—like the whole marsh is breathing."

**Execution Details:**
- **Model Used:** `deepseek/deepseek-v4-flash` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `hold`
- **Latency:** 6727ms

---

## Fixture B
**User Input:** "is it van halen? the radiation belt thing? 😂 people are getting stupider and stupider with these conspiracies"  
**Sophie Reply:**
> "undefined"

**Execution Details:**
- **Model Used:** `unknown` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `hold`
- **Latency:** 8080ms

---

## Fixture C
**User Input:** "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now."  
**Sophie Reply:**
> "undefined"

**Execution Details:**
- **Model Used:** `unknown` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `hold`
- **Latency:** 6067ms

---

## Fixture D
**User Input:** "fine mostly. honestly i felt really sad for a while earlier, but anyway, look at this photo i took on the walk."  
**Sophie Reply:**
> "That's a heavy shift—the casual "fine mostly" right after letting the sadness out. I want to see the photo, but don't just brush past the other part like it didn't happen. What brought that on?"

**Execution Details:**
- **Model Used:** `google/gemini-3.5-flash-lite` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `released:user_redirect`
- **Latency:** 7147ms

---

## Fixture E
**User Input:** "nah, genuinely don't want to talk about it. look at the sky though"  
**Sophie Reply:**
> "Fair enough, I'll drop it. The light hitting those clouds is doing something strange—kind of bruised and metallic all at once. Where were you when you caught this?"

**Execution Details:**
- **Model Used:** `google/gemini-3.5-flash-lite` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `released:user_redirect`
- **Latency:** 4482ms

---

## Fixture F1
**User Input:** "yeah just walking past the fields now."  
**Sophie Reply:**
> "Fields this time of year have that particular late August light — starting to soften, harvest dust in the air if it's crop fields. One of those moments where summer's still here but you can feel the season turning."

**Execution Details:**
- **Model Used:** `deepseek/deepseek-v4-flash` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `hold`
- **Latency:** 12058ms

---

## Fixture F2
**User Input:** "haha okay i'm in. what happens next?"  
**Sophie Reply:**
> "Depends what you're in the mood for. The path I'm thinking of splits a little further up — one way threads along the hedge where the blackberries are getting fat and stupidly ripe, the other cuts across open ground where the light's doing that thing where it turns the stubble gold. Neither's better, just different textures. Or we could just stand here a minute and watch whatever drifts past. Sometimes that's the whole thing."

**Execution Details:**
- **Model Used:** `deepseek/deepseek-v4-flash` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `hold`
- **Latency:** 15701ms

---

## Fixture G
**User Input:** "cool cool. anyway I reached the barn."  
**Sophie Reply:**
> "And? What's the barn doing? Is it one of those that's still holding together, or is it starting to lean into the earth the way old ones do when nobody's been fixing them for a decade?"

**Execution Details:**
- **Model Used:** `deepseek/deepseek-v4-flash` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `hold`
- **Latency:** 10966ms

---

## Fixture H
**User Input:** "give me a concise checklist for deploying a Next.js app to Vercel"  
**Sophie Reply:**
> "1. **Push to Git** — Make sure your repo is up on GitHub, GitLab, or Bitbucket. Vercel imports from a git provider. 2. **Import into Vercel** — Go to [vercel.com](https://vercel.com), click *Add New > Project*, and select your repository. The framework preset should auto-detect Next.js — verify it. 3. **Configure Environment Variables** — Add any `NEXT_PUBLIC_*` or server-side secrets under *Environment Variables* in the Vercel dashboard before deploying. Triple-check production values. 4. **Build & Output Settings** — Defaults usually work (`next build` produces `.next`). If you use a custom output directory or base path, set that here. Skip the override unless you know you need it. 5. **Deploy** — Hit deploy. Watch the build logs. Common gotcha: a missing dependency or `.env.local` being committed (don’t). 6. **Domain & HTTPS** — After first deploy, Vercel gives you a `*.vercel.app` URL. Add your custom domain under *Domains* and update DNS. Vercel provisions SSL automatically. 7. **Verify** — Check that environment variables load, routes work, and any API endpoints respond. Do a quick Lighthouse run if performance matters. That's it. The whole flow takes about 5 minutes if nothing breaks."

**Execution Details:**
- **Model Used:** `deepseek/deepseek-v4-flash` (Provider: `openrouter`)
- **Peripheral Decision:** `HOLD`
- **Impulse:** ""
- **Active Gear:** `default` | **Tenure:** `0` | **Transition:** `hold`
- **Continuation Signal:** `DOWNGRADE_OK` | **Objective Transition:** `hold`
- **Latency:** 13808ms

---

