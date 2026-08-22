'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Bug, RefreshCw } from 'lucide-react';

import { fetcher } from '@/lib/utils';
import { Button } from './ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

type PreviewResponse = {
  chatId?: string;
  characterId?: string | null;
  mode?: 'quick' | 'full';
  turns: number;
  minTurnsRequired: number;
  recentConversation?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  recentWindowSize?: number;
  gate?: {
    memorySliceEnabled: boolean;
    tokensApprox: number;
    salience: number;
    minTokens: number;
    minSalience: number;
    shouldSummarize: boolean;
    activeStateWindowMessages: number;
  };
  memory: string | null;
  persistedMemory?: any;
  sessionRouting?: Record<string, any> | null;
  persistedActiveState?: any;
  persistedRelationshipDynamics?: Record<string, number> | null;
  persistedContinuityEvents?: Array<any> | null;
  structuredMemory?: any;
  stateCheck?: {
    requires_active_state_update: boolean;
    requires_chat_memory_update: boolean;
    confidence: number;
    reason: string;
  };
  activeState?: any;
  relationshipDynamics?: Record<string, number>;
  continuityEvents?: Array<any>;
  topContinuityEvents?: Array<any>;
  continuityEventsBrief?: string;
  ontologyData?: {
    items: Array<{
      type: string;
      statement: string;
      scope: string;
      perspective: string;
      status: string;
      confidence: number;
      evidence?: string[];
      event_family?: string;
    }>;
    relationship?: any;
  } | null;
  ontologyPrompt?: string | null;
  relationshipDynamicsBrief?: string;
  promptDomains?: {
    baseline: Record<string, number>;
    current: Record<string, number>;
    reasons: string[];
  };
  promptDomainsBrief?: string;
  runtimePacket?: {
    memory: any;
    activeState: any;
    relationshipDynamics: any;
    topContinuityEvents: Array<any>;
  };
  continuitySchema?: {
    schemaVersion: string | null;
    isV2Container: boolean;
    items: number;
    activeItems: number;
    resolvedItems: number;
    provisionalItems: number;
    events: number;
    personModels: number;
    extractionTimestamp?: string | null;
    lastRefreshDate?: string | null;
    lastProcessedAssistantTurn?: number | null;
    turnsSinceRefresh?: number | null;
    refreshSeq?: number | null;
    refreshDecision?: string | null;
    rejectedClaims?: Array<{ reason: string; statement: string }> | null;
  };
  promptSections?: {
    memoryPrompt: string;
    activeStatePrompt: any;
    relationshipDynamicsPrompt: string;
    continuityEventsPrompt: string;
    memoryBrief: string;
    promptDomainsPrompt: string;
  };
  status?: 'chat_not_created' | 'no_messages' | 'below_threshold' | 'ready';
};

function FieldList({
  items,
  emptyLabel = 'None',
}: {
  items?: string[];
  emptyLabel?: string;
}) {
  if (!items || items.length === 0) {
    return <div className="text-sm text-muted-foreground">{emptyLabel}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div key={`${item}-${index}`} className="text-sm leading-relaxed">
          {item}
        </div>
      ))}
    </div>
  );
}

function StatGrid({
  stats,
}: {
  stats?: Record<string, number> | null;
}) {
  if (!stats) {
    return <div className="text-sm text-muted-foreground">Not available</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {Object.entries(stats).map(([key, value]) => (
        <div
          key={key}
          className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
        >
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {key}
          </div>
          <div className="mt-1 font-medium">{value}/100</div>
        </div>
      ))}
    </div>
  );
}

function EventList({ events }: { events?: Array<any> | null }) {
  const normalizedEvents = (events || []).filter(
    (event) => event && (event.summary || event.statement),
  );
  if (normalizedEvents.length === 0) {
    return <div className="text-sm text-muted-foreground">No events stored</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {normalizedEvents.map((event, index) => (
        <div key={`${event.summary ?? event.statement}-${index}`} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>{event.type}</span>
            <span>{event.truthStatus}</span>
            {event.actuality ? <span>{event.actuality}</span> : null}
            <span>importance {event.importance ?? 'n/a'}</span>
            {event.unresolved ? <span>unresolved</span> : <span>resolved</span>}
          </div>
          <div className="mt-2 text-sm leading-relaxed">
            {event.summary ?? event.statement}
          </div>
          {event.relationshipImpact ? (
            <div className="mt-2 text-xs text-muted-foreground">
              Relationship impact: {event.relationshipImpact}
            </div>
          ) : null}
          {event.emotionalImpact ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Emotional impact: {event.emotionalImpact}
            </div>
          ) : null}
          {event.participants?.length ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Participants: {event.participants.join(', ')}
            </div>
          ) : null}
          {event.source_message_ids?.length ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Evidence messages: {event.source_message_ids.length}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PromptBlock({
  title,
  content,
}: {
  title: string;
  content?: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">
        {content || 'Not available'}
      </pre>
    </div>
  );
}

export function ChatDebugPanel({ chatId }: { chatId: string }) {
  const [open, setOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<'quick' | 'full'>('quick');
  const { data, error, isLoading, mutate } = useSWR<PreviewResponse>(
    open ? `/api/memory/preview?chatId=${chatId}&mode=${analysisMode}` : null,
    fetcher,
  );

  const stateCheck = data?.stateCheck;
  // Schema-tolerant check: the v2 container is an object, not a flat array.
  const persistedEvents = Array.isArray(data?.persistedContinuityEvents)
    ? (data.persistedContinuityEvents as any[])
    : (data?.persistedContinuityEvents as any)?.events ?? [];
  const hasPersistedState = Boolean(
    data?.persistedMemory ||
      data?.persistedActiveState ||
      data?.persistedRelationshipDynamics ||
      persistedEvents.length ||
      (data?.persistedContinuityEvents as any)?._v,
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="h-8 gap-2 text-xs md:text-sm"
        >
          <Bug className="size-4" />
          Inspector
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[92vw] sm:max-w-2xl overflow-y-auto px-4 py-5">
        <SheetHeader className="pr-8">
          <SheetTitle>Continuity Inspector</SheetTitle>
          <SheetDescription>
            Private view of canon memory, active scene state, dynamics, events,
            and the current runtime packet for this chat.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => mutate()}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            <Button
              variant={analysisMode === 'full' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAnalysisMode((current) => (current === 'quick' ? 'full' : 'quick'))}
            >
              {analysisMode === 'full' ? 'Deep Analysis' : 'Stored State'}
            </Button>
            {data ? (
              <div className="text-xs text-muted-foreground">
                {data.turns} turns, memory gate {data.minTurnsRequired}, mode {data.mode ?? analysisMode}
              </div>
            ) : null}
          </div>

          {isLoading ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Loading continuity state...
              </CardContent>
            </Card>
          ) : null}

          {error ? (
            <Card>
              <CardContent className="pt-6 text-sm text-red-500">
                Failed to load preview data.
              </CardContent>
            </Card>
          ) : null}

          {data && data.status !== 'ready' ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                {data.status === 'chat_not_created'
                  ? 'This chat thread has not been created in the database yet.'
                  : data.status === 'no_messages'
                    ? 'No messages have been saved for this chat yet.'
                    : 'Not enough conversation turns yet for continuity analysis.'}
              </CardContent>
            </Card>
          ) : null}

          {data ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Session routing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>Speaker: {data.sessionRouting?.actualSpeakerModel ?? 'not recorded'}</div>
                  <div>Worker: {data.sessionRouting?.workerModel ?? 'none'}</div>
                  <div>Decision: {data.sessionRouting?.decision ?? 'none'}</div>
                  <div>Reason: {data.sessionRouting?.routeReason ?? 'none'}</div>
                  <div>Re-entry: {data.sessionRouting?.reentryClass ?? 'none'} / {data.sessionRouting?.reentryTurnIndex ?? 'n/a'}</div>
                  <div>Objective: {data.sessionRouting?.currentObjective ?? 'none'}</div>
                  {data.sessionRouting?.previousObjective ? <div>Previous objective: {data.sessionRouting.previousObjective}</div> : null}
                  <div>Burst: {data.sessionRouting?.burst?.active ? `Gemini ${data.sessionRouting.burst.turnIndex}/${data.sessionRouting.burst.minimumTurns}` : 'inactive'}</div>
                  <div>High consequence: {data.sessionRouting?.highConsequence?.active ? `${data.sessionRouting.highConsequence.domain}: ${data.sessionRouting.highConsequence.reason}` : 'inactive'}</div>
                  <div>Relational familiarity: {data.sessionRouting?.relationship?.relationalFamiliarity ?? 'sparse'}</div>
                  <div>Initiative confidence: {data.sessionRouting?.relationship?.initiativeConfidence ?? 'low'}</div>
                  <div>Discovery need: {data.sessionRouting?.relationship?.discoveryNeed ?? 'high'}</div>
                  <div>Social / low-direction: {data.sessionRouting?.relationship?.socialLowDirection ? 'yes' : 'no'}</div>
                  <div>Early curiosity: {data.sessionRouting?.relationship?.earlyCuriosityActive ? 'active' : 'inactive'}</div>
                  <div>Conversational move: {data.sessionRouting?.relationship?.selectedConversationalMove ?? 'none'}</div>
                  <div>
                    Interest hypotheses: {Array.isArray(data.sessionRouting?.relationship?.topInterestHypotheses) && data.sessionRouting.relationship.topInterestHypotheses.length > 0
                      ? data.sessionRouting.relationship.topInterestHypotheses
                          .slice(0, 4)
                          .map((item: any) => `${item.label} (${item.confidence}, ${item.strength})`)
                          .join('; ')
                      : 'none'}
                  </div>
                  <div>Developer override: {data.sessionRouting?.developerOverride ? 'active' : 'off'}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scope</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>Chat ID: <span className="font-mono text-xs">{data.chatId || chatId}</span></div>
                  <div>Character: {data.characterId || 'Unknown'}</div>
                  <div>Status: {data.status || 'unknown'}</div>
                  <div>Persisted state present: {hasPersistedState ? 'yes' : 'no'}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Memory Gate</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>Memory slice enabled: {data.gate?.memorySliceEnabled ? 'yes' : 'no'}</div>
                  <div>Should summarize now: {data.gate?.shouldSummarize ? 'yes' : 'no'}</div>
                  <div>Turns: {data.turns} / {data.minTurnsRequired} required</div>
                  <div>Approx tokens: {data.gate?.tokensApprox ?? 'n/a'} / {data.gate?.minTokens ?? 'n/a'}</div>
                  <div>Salience: {data.gate?.salience ?? 'n/a'} / {data.gate?.minSalience ?? 'n/a'}</div>
                  <div>Recent window size: {data.recentWindowSize ?? 0} / {data.gate?.activeStateWindowMessages ?? 'n/a'}</div>
                </CardContent>
              </Card>

              {stateCheck ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Judge</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>{stateCheck.reason}</div>
                  <div className="text-muted-foreground">
                    Active update: {stateCheck.requires_active_state_update ? 'yes' : 'no'} | Memory update: {stateCheck.requires_chat_memory_update ? 'yes' : 'no'} | Confidence: {Math.round(stateCheck.confidence * 100)}%
                  </div>
                </CardContent>
              </Card>
              ) : null}

              {!stateCheck && analysisMode === 'quick' ? (
                <Card>
                  <CardContent className="pt-6 text-sm text-muted-foreground">
                    Showing persisted continuity state only. Switch to Deep Analysis to recompute extraction from the current transcript.
                  </CardContent>
                </Card>
              ) : null}

              <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Canon Memory</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Summary
                    </div>
                    <div className="mt-1 leading-relaxed">
                      {data.persistedMemory?.summary || data.structuredMemory?.summary || 'No summary yet'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Relationship State
                    </div>
                    <div className="mt-1 leading-relaxed">
                      {data.persistedMemory?.relationship_state || 'Not available'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Emotional State
                    </div>
                    <div className="mt-1 leading-relaxed">
                      {data.persistedMemory?.emotional_state || 'Not available'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Major Events
                    </div>
                    <div className="mt-2">
                      <FieldList items={data.persistedMemory?.major_events} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Open Threads
                    </div>
                    <div className="mt-2">
                      <FieldList items={data.persistedMemory?.open_emotional_threads} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Recent Scene Recap
                    </div>
                    <div className="mt-1 leading-relaxed">
                      {data.persistedMemory?.recent_scene_recap || 'Not available'}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Active Scene State</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>Scene: {data.persistedActiveState?.scene_mode || data.activeState?.scene_mode || 'Unknown'}</div>
                  <div>Location: {data.persistedActiveState?.location || data.activeState?.location || 'Unknown'}</div>
                  <div>Activity: {data.persistedActiveState?.current_activity || data.activeState?.current_activity || 'Unknown'}</div>
                  <div>Mood: {data.persistedActiveState?.primary_mood || data.activeState?.primary_mood || 'Unknown'} / {data.persistedActiveState?.emotional_direction || data.activeState?.emotional_direction || 'Unknown'}</div>
                  <div>Want: {data.persistedActiveState?.what_they_want || data.activeState?.what_they_want || 'Unknown'}</div>
                  <div>Avoiding: {data.persistedActiveState?.what_they_are_avoiding || data.activeState?.what_they_are_avoiding || 'Unknown'}</div>
                  <div>Boundary: {data.persistedActiveState?.current_boundary || data.activeState?.current_boundary || 'Unknown'}</div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Scene Locks
                    </div>
                    <div className="mt-2">
                      <FieldList items={data.persistedActiveState?.scene_locks || data.activeState?.scene_locks || []} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Expression Domains</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    {data.promptDomainsBrief || 'No prompt domain state yet'}
                  </div>
                  <StatGrid stats={data.promptDomains?.current || null} />
                  {data.promptDomains?.reasons?.length ? (
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Derivation Notes
                      </div>
                      <div className="mt-2">
                        <FieldList items={data.promptDomains.reasons} />
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Character Feelings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    {data.relationshipDynamicsBrief || 'No character feelings summary yet'}
                  </div>
                  <StatGrid stats={data.relationshipDynamics || null} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Continuity Store (Schema)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    Schema version:{' '}
                    <span className="font-mono text-xs">
                      {data.continuitySchema?.schemaVersion ?? (data.persistedContinuityEvents && !Array.isArray(data.persistedContinuityEvents) ? 'v2 container' : 'unknown')}
                    </span>
                  </div>
                  <div>
                    Items: {data.continuitySchema?.items ?? 0} (active{' '}
                    {data.continuitySchema?.activeItems ?? 0} | resolved/superseded{' '}
                    {data.continuitySchema?.resolvedItems ?? 0} | provisional{' '}
                    {data.continuitySchema?.provisionalItems ?? 0})
                  </div>
                  <div>Events stored: {data.continuitySchema?.events ?? 0}</div>
                  <div>Person models: {data.continuitySchema?.personModels ?? 0}</div>
                  <div>
                    Refresh: seq {data.continuitySchema?.refreshSeq ?? 'n/a'} | last turn{' '}
                    {data.continuitySchema?.lastProcessedAssistantTurn ?? 'n/a'} | turns since{' '}
                    {data.continuitySchema?.turnsSinceRefresh ?? 'n/a'}
                  </div>
                  <div>
                    Last refresh decision: {data.continuitySchema?.refreshDecision ?? 'n/a'}
                  </div>
                  {data.continuitySchema?.lastRefreshDate ? (
                    <div>Last refresh at: {data.continuitySchema.lastRefreshDate}</div>
                  ) : null}
                  {data.continuitySchema?.rejectedClaims?.length ? (
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Contradictions rejected
                      </div>
                      <div className="mt-2">
                        {data.continuitySchema.rejectedClaims.map((claim, index) => (
                          <div
                            key={`${claim.reason}-${claim.statement}-${index}`}
                            className="text-xs text-amber-600 dark:text-amber-400"
                          >
                            [{claim.reason}] {claim.statement}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Continuity Events</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    {data.continuityEventsBrief || 'No continuity beats captured yet'}
                  </div>
                  <EventList
                    events={data.topContinuityEvents?.length ? data.topContinuityEvents : persistedEvents}
                  />
                </CardContent>
              </Card>

              {data.ontologyData ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Ontology State</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.ontologyData.items.filter(i => i.status === 'active').length > 0 ? (
                      <>
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Items</div>
                        {['fact', 'interpretation', 'emotional_state', 'open_loop', 'trajectory'].map(type => {
                          const typeItems = data.ontologyData!.items.filter(i => i.type === type && i.status === 'active');
                          if (typeItems.length === 0) return null;
                          return (
                            <div key={type}>
                              <div className="text-xs font-medium capitalize">{type.replace('_', ' ')}s</div>
                              {typeItems.slice(-3).map((item, i) => (
                                <div key={i} className="text-sm mt-1 pl-2 border-l-2 border-muted">
                                  <div>{item.statement}</div>
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    scope={item.scope} | confidence={(item.confidence * 100).toFixed(0)}%
                                    {item.scope === 'scene' ? ' | volatile' : ''}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">No active ontology items</div>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Runtime Packet</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div>Runtime top events: {data.runtimePacket?.topContinuityEvents?.length ?? 0}</div>
                  <div>Runtime memory summary: {data.runtimePacket?.memory?.summary || 'Not available'}</div>
                  <div>Runtime scene: {data.runtimePacket?.activeState?.scene_mode || 'Not available'}</div>
                  <div>Runtime trust: {data.runtimePacket?.relationshipDynamics?.trust ?? 'Not available'}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recent Window</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.recentConversation?.length ? (
                    data.recentConversation.map((entry, index) => (
                      <div key={`${entry.role}-${index}`} className="rounded-md border p-3">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {entry.role}
                        </div>
                        <div className="mt-2 text-sm leading-relaxed">
                          {entry.content}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No recent conversation window available.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Prompt Sections</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <PromptBlock title="Memory Brief" content={data.promptSections?.memoryBrief} />
                  <PromptBlock title="Expression Domains Prompt" content={data.promptSections?.promptDomainsPrompt} />
                  <PromptBlock title="Character Feelings Prompt" content={data.promptSections?.relationshipDynamicsPrompt} />
                  <PromptBlock title="Continuity Events Prompt" content={data.promptSections?.continuityEventsPrompt} />
                  {data.ontologyPrompt ? <PromptBlock title="Ontology Prompt" content={data.ontologyPrompt} /> : null}
                </CardContent>
              </Card>
              </>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
