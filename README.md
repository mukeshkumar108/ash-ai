# RPD2 - High-Quality GFE Roleplay 💖

<div align="center">
  <h1 align="center">Immersive Girlfriend Experience RP</h1>
  <p align="center">A sophisticated, memory-rich roleplay platform featuring distinct personas and deep narrative continuity.</p>
</div>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#characters"><strong>Characters</strong></a> ·
  <a href="#getting-started"><strong>Getting Started</strong></a> ·
  <a href="#deployment"><strong>Deployment</strong></a>
</p>
<br/>

## ✨ Key Features

- **🧠 Incremental Memory System** - Bidirectional memory that tracks NPCs, milestones, and story evolution from both user and character input.
- **🎭 Modular Character Roster** - 4 distinct personas (Lila, Mia, Sophia, Raven) powered by specialized character kernels.
- **⏩ Narrative Director** - A "Next Scene" feature that allows the AI to narrate time jumps and setting changes seamlessly.
- **💬 Immersive UI** - Beautiful speech bubble interface that separates dialogue from actions/narration.
- **⚡ Fast & Modern** - Built with Next.js 15, Vercel AI SDK, and optimized for low-latency RP.
- **🔒 Privacy-First** - Secure data handling with Neon Postgres and local-first memory distillation.

## 👥 Character Roster

1. **Lila Harper**: The sweet, innocent girl with a hidden side that opens up with trust.
2. **Mia Voss**: The playful, teasing, and confident partner who loves pushing boundaries.
3. **Sophia Bennett**: The gentle, slightly religious "good girl" with intense internal conflicts.
4. **Raven Kane**: The sarcastic, sharp-tongued brat with a secretly kinky interior.

## 🏗️ Architecture

Built on a modular foundation for scalable roleplay:
- **Universal Rules**: Global prompt block enforcing RP quality and character agency.
- **Character Kernels**: Isolated persona data for unique voices and values.
- **Bidirectional Memory**: Tracks events introduced by either the user or the AI.

## 🚀 Getting Started

### **Prerequisites**
- Node.js 18+
- pnpm
- OpenRouter API Key

### **Quick Setup**

1. **Clone the repository**
   ```bash
   git clone https://github.com/mukeshkumar108/rpd2.git
   cd rpd2
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Database Setup**
   ```bash
   pnpm db:migrate
   ```

4. **Start RP**
   ```bash
   pnpm dev
   ```

---

## 🗄️ Database migrations

Migrations are **hand-authored SQL + journal entries** under `lib/db/migrations/`
(`NNNN_short_name.sql` + a matching `meta/_journal.json` entry), applied with
`pnpm exec tsx lib/db/migrate.ts` (drizzle `migrate()`).

Repo convention: `drizzle-kit` snapshots exist **only for migrations
`0000`–`0008`**. Everything from `0009` onward is written by hand, so there are
no matching `meta/*_snapshot.json` files (`0009`–`0026`), and `drizzle-kit
generate` against the current schema would produce a misleading diff off the
stale `0008` snapshot. Do **not** manufacture a single snapshot for one recent
migration; keep hand-writing SQL + journal entries, or do a deliberate
snapshot-rebuild pass across `0009`+ as one explicit task.

Each migration is written to be safely re-runnable (`CREATE … IF NOT EXISTS`,
`DO $$ … EXCEPTION WHEN duplicate_object`), and the migrator only applies
journal entries newer than the DB's last applied `created_at`.

---

**Ready to start your story? Choose your partner and begin the experience.** 🚀✨
