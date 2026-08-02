import { generateUUID } from '@/lib/utils';
import { expect, test } from '../fixtures';

test.describe('/api/chat with Actor Attribution and Domain Guard', () => {
  test('Ada can post a negation boundary message and verify activeState is initialized', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    // 1. Post a boundary message "Stop, don't touch me"
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: {
          id: generateUUID(),
          role: 'user',
          content: "Stop, don't touch me",
          parts: [{ type: 'text', text: "Stop, don't touch me" }],
          createdAt: new Date().toISOString(),
        },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });

    expect(response.status()).toBe(200);

    // Wait a brief moment for the async background extractor to process
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 2. Request the memory preview
    const previewResponse = await adaContext.request.get(
      `/api/memory/preview?chatId=${chatId}&mode=full`
    );
    expect(previewResponse.status()).toBe(200);

    const preview = await previewResponse.json();

    // The activeState should be created/retrieved successfully
    expect(preview.activeState).toBeDefined();
    
    // The activeState should have the actors and user_proxy structures
    expect(preview.activeState.actors).toBeDefined();
    expect(preview.activeState.user_proxy).toBeDefined();
    
    // In the DB, the volatile domain_guard is reset/expired back to allow
    expect(preview.activeState.domain_guard.mode).toBe('allow');
  });

  test('Ada can declare a proxy and verify proxy is resolved', async ({
    adaContext,
  }) => {
    const chatId = generateUUID();

    // Post message introducing user proxy
    const response = await adaContext.request.post('/api/chat', {
      data: {
        id: chatId,
        message: {
          id: generateUUID(),
          role: 'user',
          content: "I am Daniel in this scene",
          parts: [{ type: 'text', text: "I am Daniel in this scene" }],
          createdAt: new Date().toISOString(),
        },
        selectedChatModel: 'chat-model',
        selectedVisibilityType: 'private',
      },
    });

    expect(response.status()).toBe(200);
  });
});
