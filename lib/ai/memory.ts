export interface MemorySlice {
  tldr: string;
  bullets: string[];
  recentWindow: { role: 'user' | 'assistant'; content: string }[];
}

export function renderMemoryBlock(memory: MemorySlice): string {
  const { tldr, bullets, recentWindow } = memory;

  let block = '[MEMORY]\n';
  block += `TL;DR: ${tldr}\n`;
  block += 'Facts & Open:\n';
  bullets.forEach((bullet) => {
    block += `- ${bullet}\n`;
  });
  block += '\n[RECENT WINDOW]\n';

  recentWindow.forEach((msg) => {
    block += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
  });

  return block;
}

export function buildNaiveMemorySlice(allMessages: any[]): MemorySlice {
  // Take last 8 messages for recent window
  const recentMessages = allMessages.slice(-8);

  const recentWindow = recentMessages.map((msg) => ({
    role: msg.role,
    content: getTextFromMessage(msg),
  }));

  // Simple naive implementation
  const tldr =
    'Proceed based on recent chat; ask if a user decision is missing.';

  const bullets = [
    'Ask when a user decision is missing before calling tools',
    "Don't paste full documents in chat; redirect to artifacts",
    'Respect user preferences for language and tone',
    'Keep responses concise and actionable',
    'Default to warm, professional communication',
    'Ensure all technical tasks are completed thoroughly',
  ];

  return { tldr, bullets, recentWindow };
}

function getTextFromMessage(message: any): string {
  if (message.parts && Array.isArray(message.parts)) {
    return message.parts
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('');
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  return '';
}

export function renderMemory(output: any) {
  const facts = output.facts.length
    ? output.facts.map((x: string) => `- ${x}`).join('\n')
    : '- (none)';
  const open = output.open.length
    ? output.open.map((x: string) => `- ${x}`).join('\n')
    : '- (none)';
  const recent = output.recentWindow
    .map(
      (t: any) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`,
    )
    .join('\n');

  return `[MEMORY]
TL;DR: ${output.tldr}

Facts:
${facts}

Open:
${open}

[RECENT WINDOW | last_k=${output.lastK}]
${recent}`;
}
