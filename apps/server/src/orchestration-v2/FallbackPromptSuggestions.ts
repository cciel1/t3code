import type { OrchestrationV2ConversationMessage, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

/** Drivers whose adapters already emit a native `prompt_suggestion.updated`. */
const NATIVE_SUGGESTION_DRIVERS = new Set(["claudeAgent", "codex"]);
const CONTEXT_MESSAGES = 8;
const MESSAGE_CHARS = 1_500;
const SUGGESTION_MAX_CHARS = 200;
// Opening an old thread should not spend a request on a conversation the user has moved on from.
const STALE_RUN = Duration.hours(2);

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}…`;

function buildPromptSuggestionPrompt(
  messages: ReadonlyArray<Pick<OrchestrationV2ConversationMessage, "role" | "text">>,
): string {
  const transcript = messages
    .map(
      (message) =>
        `<${message.role}>\n${clip(message.text.trim(), MESSAGE_CHARS)}\n</${message.role}>`,
    )
    .join("\n");
  return `You predict the next message a user will type to their coding agent.

Read the conversation below and write the single most likely next user message.
- Write it exactly as the user would type it, in the same language and tone the user uses (for example, Korean if the user writes Korean).
- Keep it under 20 words. No quotes, no preamble, no explanation.
- Prefer a concrete next step the assistant just offered or asked about (for example, accepting a proposed option).
- If there is no clear next step, return an empty string.

Return it in the "transcription" field.

<conversation>
${transcript}
</conversation>`;
}

/**
 * Fills the prompt-suggestion slot for providers without a native one (Antigravity and other ACP
 * agents) by asking the text generation model once per completed run, only when a composer
 * subscribes, so idle threads cost nothing.
 */
export const make = Effect.gen(function* () {
  // Optional so transports built without text generation (tests) still construct.
  const textGenerationService = yield* Effect.serviceOption(TextGeneration.TextGeneration);
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const attempted = new Set<string>();

  const generate = Effect.fn("FallbackPromptSuggestions.generate")(
    function* (threadId: ThreadId) {
      if (Option.isNone(textGenerationService)) return;
      const textGeneration = textGenerationService.value;
      const settings = yield* serverSettings.getSettings;
      if (!settings.promptSuggestionsEnabled) return;
      const records = yield* threads.getThreadRecords(threadId, ["runs"], {
        runStatuses: [],
        includeLatestRun: true,
      });
      if (records.thread.deletedAt !== null) return;
      const run = records.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0];
      if (run === undefined || run.status !== "completed" || run.completedAt === null) return;
      const now = yield* DateTime.now;
      if (Duration.isGreaterThan(DateTime.distance(run.completedAt, now), STALE_RUN)) return;
      const instanceId = run.modelSelection.instanceId;
      const driver = settings.providerInstances[instanceId]?.driver ?? instanceId;
      if (NATIVE_SUGGESTION_DRIVERS.has(driver)) return;
      const key = `${threadId}\u0000${run.id}`;
      if (attempted.has(key)) return;
      attempted.add(key);
      for (const old of attempted) {
        if (attempted.size <= 1_024) break;
        attempted.delete(old);
      }
      const existing = yield* sessions.getPromptSuggestion(threadId);
      if (existing?.runId === run.id) return;

      const { messages } = yield* threads.getThreadRecords(threadId, ["messages"], {
        messageRoles: ["user", "assistant"],
      });
      const context = messages
        .filter((message) => !message.streaming && message.notification === undefined)
        .filter((message) => message.text.trim().length > 0)
        .slice(-CONTEXT_MESSAGES);
      if (context.at(-1)?.role !== "assistant") return;

      // The model only reads the transcript; keep it out of the checkout.
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-prompt-suggestion-" });
      const generated = yield* textGeneration.generateTranscriptionPostProcessing({
        cwd,
        prompt: buildPromptSuggestionPrompt(context),
        modelSelection: settings.textGenerationModelSelection,
      });
      const text = generated.transcription.trim().replace(/^["'“]|["'”]$/g, "");
      if (text.length === 0 || text.length > SUGGESTION_MAX_CHARS) return;
      // The user may have sent again while the model ran.
      const latest = yield* threads.getThreadRecords(threadId, ["runs"], {
        runStatuses: [],
        includeLatestRun: true,
      });
      const latestRun = latest.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0];
      if (latestRun?.id !== run.id) return;
      yield* sessions.publishPromptSuggestion(threadId, { runId: run.id, text });
    },
    Effect.scoped,
    Effect.catchCause((cause) =>
      Effect.logDebug("orchestration-v2.fallback-prompt-suggestion-failed", { cause }),
    ),
  );

  const request = (threadId: ThreadId) => generate(threadId).pipe(Effect.forkDetach, Effect.asVoid);

  return {
    /**
     * Emits nothing; while subscribed, generates for the latest completed run now and after each
     * run that completes, so only threads someone is looking at spend a request.
     */
    watch: (threadId: ThreadId): Stream.Stream<never> =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* request(threadId);
          return threads.streamDomainEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "run.updated" &&
                event.threadId === threadId &&
                event.payload.status === "completed",
            ),
            Stream.mapEffect(() => request(threadId)),
          );
        }),
      ).pipe(
        Stream.drain,
        Stream.catchCause(() => Stream.empty),
      ),
  };
});
