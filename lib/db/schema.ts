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
