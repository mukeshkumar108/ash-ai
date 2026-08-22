import type { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  integer,
  primaryKey,
  foreignKey,
  boolean,
  index,
  date,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const user = pgTable('User', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 }),
  displayName: varchar('display_name', { length: 100 }),
  rpDisplayName: varchar('rp_display_name', { length: 100 }),
  rpAge: varchar('rp_age', { length: 32 }),
  rpLocation: varchar('rp_location', { length: 120 }),
  rpOccupation: varchar('rp_occupation', { length: 120 }),
  rpVibe: varchar('rp_vibe', { length: 160 }),
  languagePreference: varchar('language_preference', { length: 10 }).default(
    'en',
  ),
  themePreference: varchar('theme_preference', { length: 20 }).default(
    'system',
  ),
  timeZone: varchar('time_zone', { length: 64 }),
});

export type User = InferSelectModel<typeof user>;

export const chat = pgTable('Chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  title: text('title').notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  characterId: varchar('characterId', { length: 50 })
    .notNull()
    .default('lila-harper'),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
  memoryState: json('memory_state'),
  activeState: json('active_state'),
  relationshipDynamics: json('relationship_dynamics'),
  continuityEvents: json('continuity_events'),
  continuitySeq: integer('continuity_seq').notNull().default(0),
  chatModel: varchar('chatModel', { length: 100 })
    .notNull()
    .default('chat-model'),
  sessionRouting: json('session_routing'),
});

export type Chat = InferSelectModel<typeof chat>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://chat-sdk.dev/docs/migration-guides/message-parts
export const messageDeprecated = pgTable('Message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  content: json('content').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type MessageDeprecated = InferSelectModel<typeof messageDeprecated>;

export const message = pgTable('Message_v2', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  parts: json('parts').notNull(),
  attachments: json('attachments').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const relationshipInitiative = pgTable(
  'RelationshipInitiative',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id, { onDelete: 'cascade' }),
    trigger: varchar('trigger', { length: 24 }).notNull(),
    triggerMessageId: uuid('triggerMessageId')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    dedupeKey: varchar('dedupeKey', { length: 180 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('evaluating'),
    candidateKind: varchar('candidateKind', { length: 40 }),
    topicKey: varchar('topicKey', { length: 80 }),
    reason: text('reason'),
    evidence: json('evidence'),
    guidance: text('guidance'),
    generatedMessageId: uuid('generatedMessageId').references(
      () => message.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    evaluationAt: timestamp('evaluationAt').notNull().defaultNow(),
    decidedAt: timestamp('decidedAt'),
    sentAt: timestamp('sentAt'),
    repliedAt: timestamp('repliedAt'),
    replyMessageId: uuid('replyMessageId').references(() => message.id, {
      onDelete: 'set null',
    }),
  },
  (table) => ({
    dedupeIdx: uniqueIndex('RelationshipInitiative_dedupe_idx').on(
      table.dedupeKey,
    ),
    userCreatedIdx: index('RelationshipInitiative_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
    chatCreatedIdx: index('RelationshipInitiative_chat_created_idx').on(
      table.chatId,
      table.createdAt,
    ),
  }),
);

export type RelationshipInitiative = InferSelectModel<
  typeof relationshipInitiative
>;

export const relationshipOpportunity = pgTable(
  'RelationshipOpportunity',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id, { onDelete: 'cascade' }),
    anchorMessageId: uuid('anchorMessageId')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    trigger: varchar('trigger', { length: 24 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('scheduled'),
    notBefore: timestamp('notBefore').notNull(),
    context: json('context'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    claimedAt: timestamp('claimedAt'),
  },
  (table) => ({
    anchorTriggerIdx: uniqueIndex(
      'RelationshipOpportunity_anchor_trigger_idx',
    ).on(table.anchorMessageId, table.trigger),
    dueIdx: index('RelationshipOpportunity_due_idx').on(
      table.status,
      table.notBefore,
    ),
  }),
);

export type RelationshipOpportunity = InferSelectModel<
  typeof relationshipOpportunity
>;

// DEPRECATED: The following schema is deprecated and will be removed in the future.
// Read the migration guide at https://chat-sdk.dev/docs/migration-guides/message-parts
export const voteDeprecated = pgTable(
  'Vote',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    messageId: uuid('messageId')
      .notNull()
      .references(() => messageDeprecated.id),
    isUpvoted: boolean('isUpvoted').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type VoteDeprecated = InferSelectModel<typeof voteDeprecated>;

export const vote = pgTable(
  'Vote_v2',
  {
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    messageId: uuid('messageId')
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean('isUpvoted').notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  'Document',
  {
    id: uuid('id').notNull().defaultRandom(),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    kind: varchar('text', { enum: ['text', 'code', 'image', 'sheet'] })
      .notNull()
      .default('text'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  },
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  'Suggestion',
  {
    id: uuid('id').notNull().defaultRandom(),
    documentId: uuid('documentId').notNull(),
    documentCreatedAt: timestamp('documentCreatedAt').notNull(),
    originalText: text('originalText').notNull(),
    suggestedText: text('suggestedText').notNull(),
    description: text('description'),
    isResolved: boolean('isResolved').notNull().default(false),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  }),
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  'Stream',
  {
    id: uuid('id').notNull().defaultRandom(),
    chatId: uuid('chatId').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  }),
);

export const generation = pgTable(
  'Generation',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    modelId: varchar('modelId', { length: 200 }).notNull(),
    prompt: text('prompt').notNull(),
    images: json('images').notNull(),
    generationIndex: integer('generationIndex').notNull().default(1),
    parentGenerationId: uuid('parentGenerationId'),
    parentOutputPathname: varchar('parentOutputPathname', { length: 200 }),
    instruction: text('instruction'),
    inputImages: json('inputImages'),
    remixState: json('remixState'),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => {
    return {
      parentGenerationRef: foreignKey({
        columns: [table.parentGenerationId],
        foreignColumns: [table.id],
      }).onDelete('set null'),
      parentGenerationIdx: index('Generation_parentGenerationId_idx').on(
        table.parentGenerationId,
      ),
    };
  },
);

export type Generation = InferSelectModel<typeof generation>;

export const gemAccount = pgTable('GemAccount', {
  userId: uuid('userId')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(20),
  dailyGrantCount: integer('dailyGrantCount').notNull().default(0),
  lastDailyGrantOn: date('lastDailyGrantOn'),
  devMode: boolean('devMode').notNull().default(false),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export const gemTransaction = pgTable(
  'GemTransaction',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    kind: varchar('kind', { length: 40 }).notNull(),
    referenceKey: varchar('referenceKey', { length: 240 }).notNull(),
    metadata: json('metadata'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => ({
    referenceKeyIdx: uniqueIndex('GemTransaction_referenceKey_idx').on(
      table.referenceKey,
    ),
    userCreatedIdx: index('GemTransaction_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export const gemPromoCode = pgTable(
  'GemPromoCode',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    codeHash: varchar('codeHash', { length: 64 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    gems: integer('gems').notNull(),
    maxRedemptions: integer('maxRedemptions'),
    redemptionCount: integer('redemptionCount').notNull().default(0),
    active: boolean('active').notNull().default(true),
    expiresAt: timestamp('expiresAt'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => ({
    codeHashIdx: uniqueIndex('GemPromoCode_codeHash_idx').on(table.codeHash),
  }),
);

export const gemPromoRedemption = pgTable(
  'GemPromoRedemption',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    promoCodeId: uuid('promoCodeId')
      .notNull()
      .references(() => gemPromoCode.id, { onDelete: 'cascade' }),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => ({
    onePerUserIdx: uniqueIndex('GemPromoRedemption_code_user_idx').on(
      table.promoCodeId,
      table.userId,
    ),
  }),
);

export const gemPurchase = pgTable(
  'GemPurchase',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    checkoutSessionId: varchar('checkoutSessionId', { length: 255 }).notNull(),
    bundleId: varchar('bundleId', { length: 40 }).notNull(),
    gems: integer('gems').notNull(),
    amountPaidCents: integer('amountPaidCents').notNull(),
    currency: varchar('currency', { length: 10 }).notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => ({
    checkoutIdx: uniqueIndex('GemPurchase_checkout_idx').on(
      table.checkoutSessionId,
    ),
  }),
);

/** Role an image plays in a remix. The baseline is the image being edited. */
export type RemixInputImage = {
  pathname: string;
  mediaType: string;
  role: 'baseline' | 'style' | 'object' | 'identity' | 'layout';
};

/**
 * Compact creative state maintained across a remix chain. `locked` holds
 * explicit user constraints ("keep the room layout exactly the same");
 * `preserve` is softer continuity guidance ("unrelated visible elements stay
 * stable unless the change requires them to move").
 */
export type RemixState = {
  originalIntent: string;
  locked: string[];
  preserve: string[];
  established: string[];
  removed: string[];
};

export type Stream = InferSelectModel<typeof stream>;
