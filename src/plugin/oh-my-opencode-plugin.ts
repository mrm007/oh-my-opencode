import type { Plugin, ToolDefinition } from "@opencode-ai/plugin";

import type { AvailableSkill } from "../agents/dynamic-agent-prompt-builder";
import {
  createTodoContinuationEnforcer,
  createContextWindowMonitorHook,
  createSessionRecoveryHook,
  createSessionNotification,
  createCommentCheckerHooks,
  createToolOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEmptyTaskResponseDetectorHook,
  createThinkModeHook,
  createClaudeCodeHooksHook,
  createAnthropicContextWindowLimitRecoveryHook,
  createRulesInjectorHook,
  createBackgroundNotificationHook,
  createAutoUpdateCheckerHook,
  createKeywordDetectorHook,
  createAgentUsageReminderHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,
  createThinkingBlockValidatorHook,
  createCategorySkillReminderHook,
  createRalphLoopHook,
  createAutoSlashCommandHook,
  createEditErrorRecoveryHook,
  createDelegateTaskRetryHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createAtlasHook,
  createPrometheusMdOnlyHook,
  createSisyphusJuniorNotepadHook,
  createQuestionLabelTruncatorHook,
  createSubagentQuestionBlockerHook,
  createStopContinuationGuardHook,
  createCompactionContextInjector,
  createUnstableAgentBabysitterHook,
  createPreemptiveCompactionHook,
  createTasksTodowriteDisablerHook,
  createWriteExistingFileGuardHook,
} from "../hooks";
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "../features/context-injector";
import {
  applyAgentVariant,
  resolveAgentVariant,
  resolveVariantForModel,
} from "../shared/agent-variant";
import { createFirstMessageVariantGate } from "../shared/first-message-variant";
import {
  discoverUserClaudeSkills,
  discoverProjectClaudeSkills,
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  mergeSkills,
} from "../features/opencode-skill-loader";
import { mapScopeToLocation } from "./skill-location";
import { createBuiltinSkills } from "../features/builtin-skills";
import { getSystemMcpServerNames } from "../features/claude-code-mcp-loader";
import {
  setMainSession,
  getMainSessionID,
  setSessionAgent,
  updateSessionAgent,
  clearSessionAgent,
} from "../features/claude-code-session-state";
import {
  builtinTools,
  createCallOmoAgent,
  createBackgroundTools,
  createLookAt,
  createSkillTool,
  createSkillMcpTool,
  createSlashcommandTool,
  discoverCommandsSync,
  sessionExists,
  createDelegateTask,
  interactive_bash,
  startTmuxCheck,
  lspManager,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
} from "../tools";
import {
  CATEGORY_DESCRIPTIONS,
  DEFAULT_CATEGORIES,
} from "../tools/delegate-task/constants";
import { BackgroundManager } from "../features/background-agent";
import { SkillMcpManager } from "../features/skill-mcp-manager";
import { initTaskToastManager } from "../features/task-toast-manager";
import { TmuxSessionManager } from "../features/tmux-subagent";
import { clearBoulderState } from "../features/boulder-state";
import { type HookName } from "../config";
import {
  log,
  detectExternalNotificationPlugin,
  getNotificationConflictWarning,
  resetMessageCursor,
  hasConnectedProvidersCache,
  getOpenCodeVersion,
  isOpenCodeVersionAtLeast,
  OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
  injectServerAuthIntoClient,
} from "../shared";
import { filterDisabledTools } from "../shared/disabled-tools";
import { loadPluginConfig } from "../plugin-config";
import { createModelCacheState } from "../plugin-state";
import { createConfigHandler } from "../plugin-handlers";
import { createChatMessageHandler } from "./chat-message-handler";
import { createExperimentalHandlers } from "./experimental-handlers";
import { createEventHandler } from "./event-handler";
import { createToolExecuteHandlers } from "./tool-execute-handlers";
import { createPluginTools } from "./create-plugin-tools";

import type { MessagesTransformOutput } from "./plugin-types";

export function createOhMyOpenCodePlugin(): Plugin {
  const OhMyOpenCodePlugin: Plugin = async (ctx) => {
    log("[OhMyOpenCodePlugin] ENTRY - plugin loading", {
      directory: ctx.directory,
    });
    injectServerAuthIntoClient(ctx.client);
    // Start background tmux check immediately
    startTmuxCheck();

    const pluginConfig = loadPluginConfig(ctx.directory, ctx);
    const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);

    const firstMessageVariantGate = createFirstMessageVariantGate();

    const tmuxConfig = {
      enabled: pluginConfig.tmux?.enabled ?? false,
      layout: pluginConfig.tmux?.layout ?? "main-vertical",
      main_pane_size: pluginConfig.tmux?.main_pane_size ?? 60,
      main_pane_min_width: pluginConfig.tmux?.main_pane_min_width ?? 120,
      agent_pane_min_width: pluginConfig.tmux?.agent_pane_min_width ?? 40,
    } as const;
    const isHookEnabled = (hookName: HookName) => !disabledHooks.has(hookName);

    const modelCacheState = createModelCacheState();

    const contextWindowMonitor = isHookEnabled("context-window-monitor")
      ? createContextWindowMonitorHook(ctx)
      : null;
    const preemptiveCompaction =
      isHookEnabled("preemptive-compaction") &&
      pluginConfig.experimental?.preemptive_compaction
        ? createPreemptiveCompactionHook(ctx)
        : null;
    const sessionRecovery = isHookEnabled("session-recovery")
      ? createSessionRecoveryHook(ctx, {
          experimental: pluginConfig.experimental,
        })
      : null;

    // Check for conflicting notification plugins before creating session-notification
    let sessionNotification = null;
    if (isHookEnabled("session-notification")) {
      const forceEnable = pluginConfig.notification?.force_enable ?? false;
      const externalNotifier = detectExternalNotificationPlugin(ctx.directory);

      if (externalNotifier.detected && !forceEnable) {
        // External notification plugin detected - skip our notification to avoid conflicts
        log(getNotificationConflictWarning(externalNotifier.pluginName!));
        log("session-notification disabled due to external notifier conflict", {
          detected: externalNotifier.pluginName,
          allPlugins: externalNotifier.allPlugins,
        });
      } else {
        sessionNotification = createSessionNotification(ctx);
      }
    }

    const commentChecker = isHookEnabled("comment-checker")
      ? createCommentCheckerHooks(pluginConfig.comment_checker)
      : null;
    const toolOutputTruncator = isHookEnabled("tool-output-truncator")
      ? createToolOutputTruncatorHook(ctx, {
          experimental: pluginConfig.experimental,
        })
      : null;
    // Check for native OpenCode AGENTS.md injection support before creating hook
    let directoryAgentsInjector = null;
    if (isHookEnabled("directory-agents-injector")) {
      const currentVersion = getOpenCodeVersion();
      const hasNativeSupport =
        currentVersion !== null &&
        isOpenCodeVersionAtLeast(OPENCODE_NATIVE_AGENTS_INJECTION_VERSION);

      if (hasNativeSupport) {
        log(
          "directory-agents-injector auto-disabled due to native OpenCode support",
          {
            currentVersion,
            nativeVersion: OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
          },
        );
      } else {
        directoryAgentsInjector = createDirectoryAgentsInjectorHook(ctx);
      }
    }
    const directoryReadmeInjector = isHookEnabled("directory-readme-injector")
      ? createDirectoryReadmeInjectorHook(ctx)
      : null;
    const emptyTaskResponseDetector = isHookEnabled(
      "empty-task-response-detector",
    )
      ? createEmptyTaskResponseDetectorHook(ctx)
      : null;
    const thinkMode = isHookEnabled("think-mode") ? createThinkModeHook() : null;
    const claudeCodeHooks = createClaudeCodeHooksHook(
      ctx,
      {
        disabledHooks: (pluginConfig.claude_code?.hooks ?? true)
          ? undefined
          : true,
        keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
      },
      contextCollector,
    );
    const anthropicContextWindowLimitRecovery = isHookEnabled(
      "anthropic-context-window-limit-recovery",
    )
      ? createAnthropicContextWindowLimitRecoveryHook(ctx, {
          experimental: pluginConfig.experimental,
        })
      : null;
    const rulesInjector = isHookEnabled("rules-injector")
      ? createRulesInjectorHook(ctx)
      : null;
    const autoUpdateChecker = isHookEnabled("auto-update-checker")
      ? createAutoUpdateCheckerHook(ctx, {
          showStartupToast: isHookEnabled("startup-toast"),
          isSisyphusEnabled: pluginConfig.sisyphus_agent?.disabled !== true,
          autoUpdate: pluginConfig.auto_update ?? true,
        })
      : null;
    const keywordDetector = isHookEnabled("keyword-detector")
      ? createKeywordDetectorHook(ctx, contextCollector)
      : null;
    const contextInjectorMessagesTransform =
      createContextInjectorMessagesTransformHook(contextCollector);
    const agentUsageReminder = isHookEnabled("agent-usage-reminder")
      ? createAgentUsageReminderHook(ctx)
      : null;
    const nonInteractiveEnv = isHookEnabled("non-interactive-env")
      ? createNonInteractiveEnvHook(ctx)
      : null;
    const interactiveBashSession = isHookEnabled("interactive-bash-session")
      ? createInteractiveBashSessionHook(ctx)
      : null;

    const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
      ? createThinkingBlockValidatorHook()
      : null;

    const ralphLoop = isHookEnabled("ralph-loop")
      ? createRalphLoopHook(ctx, {
          config: pluginConfig.ralph_loop,
          checkSessionExists: async (sessionId) => sessionExists(sessionId),
        })
      : null;

    const editErrorRecovery = isHookEnabled("edit-error-recovery")
      ? createEditErrorRecoveryHook(ctx)
      : null;

    const delegateTaskRetry = isHookEnabled("delegate-task-retry")
      ? createDelegateTaskRetryHook(ctx)
      : null;

    const startWork = isHookEnabled("start-work") ? createStartWorkHook(ctx) : null;

    const prometheusMdOnly = isHookEnabled("prometheus-md-only")
      ? createPrometheusMdOnlyHook(ctx)
      : null;

    const sisyphusJuniorNotepad = isHookEnabled("sisyphus-junior-notepad")
      ? createSisyphusJuniorNotepadHook(ctx)
      : null;

    const tasksTodowriteDisabler = isHookEnabled("tasks-todowrite-disabler")
      ? createTasksTodowriteDisablerHook({
          experimental: pluginConfig.experimental,
        })
      : null;

    const questionLabelTruncator = createQuestionLabelTruncatorHook();
    const subagentQuestionBlocker = createSubagentQuestionBlockerHook();
    const writeExistingFileGuard = isHookEnabled("write-existing-file-guard")
      ? createWriteExistingFileGuardHook(ctx)
      : null;

    const taskResumeInfo = createTaskResumeInfoHook();

    const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig);

    const backgroundManager = new BackgroundManager(
      ctx,
      pluginConfig.background_task,
      {
        tmuxConfig,
        onSubagentSessionCreated: async (event) => {
          log("[index] onSubagentSessionCreated callback received", {
            sessionID: event.sessionID,
            parentID: event.parentID,
            title: event.title,
          });
          await tmuxSessionManager.onSessionCreated({
            type: "session.created",
            properties: {
              info: {
                id: event.sessionID,
                parentID: event.parentID,
                title: event.title,
              },
            },
          });
          log("[index] onSubagentSessionCreated callback completed");
        },
        onShutdown: () => {
          tmuxSessionManager.cleanup().catch((error) => {
            log("[index] tmux cleanup error during shutdown:", error);
          });
        },
      },
    );

    const atlasHook = isHookEnabled("atlas")
      ? createAtlasHook(ctx, { directory: ctx.directory, backgroundManager })
      : null;

    initTaskToastManager(ctx.client);

    const stopContinuationGuard = isHookEnabled("stop-continuation-guard")
      ? createStopContinuationGuardHook(ctx)
      : null;

    const compactionContextInjector = isHookEnabled("compaction-context-injector")
      ? createCompactionContextInjector()
      : null;

    const experimentalHandlers = createExperimentalHandlers({
      contextInjectorMessagesTransform,
      thinkingBlockValidator,
      compactionContextInjector,
    });

    const {
      filteredTools,
      configHandler,
      categorySkillReminder,
      autoSlashCommand,
      skillMcpManager,
    } = await createPluginTools({
      ctx: { directory: ctx.directory, client: ctx.client },
      pluginConfig,
      modelCacheState,
      backgroundManager,
      tmuxSessionManager,
      isHookEnabled,
    });

    const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
      ? createTodoContinuationEnforcer(ctx, {
          backgroundManager,
          isContinuationStopped: stopContinuationGuard?.isStopped,
        })
      : null;

    const toolExecuteHandlers = createToolExecuteHandlers({
      directory: ctx.directory,
      getMainSessionID,
      ralphLoop,
      stopContinuationGuard,
      todoContinuationEnforcer,
      subagentQuestionBlocker,
      writeExistingFileGuard,
      questionLabelTruncator,
      claudeCodeHooks,
      nonInteractiveEnv,
      commentChecker,
      directoryAgentsInjector,
      directoryReadmeInjector,
      rulesInjector,
      tasksTodowriteDisabler,
      prometheusMdOnly,
      sisyphusJuniorNotepad,
      atlasHook,
      toolOutputTruncator,
      preemptiveCompaction,
      contextWindowMonitor,
      emptyTaskResponseDetector,
      agentUsageReminder,
      categorySkillReminder,
      interactiveBashSession,
      editErrorRecovery,
      delegateTaskRetry,
      taskResumeInfo,
    });

    const unstableAgentBabysitter = isHookEnabled("unstable-agent-babysitter")
      ? createUnstableAgentBabysitterHook(
          {
            directory: ctx.directory,
            client: {
              session: {
                messages: async (args) => {
                  const result = await ctx.client.session.messages(args);
                  if (Array.isArray(result)) return result;
                  if (
                    typeof result === "object" &&
                    result !== null &&
                    "data" in result
                  ) {
                    const record = result as Record<string, unknown>;
                    return { data: record.data };
                  }
                  return [];
                },
                prompt: async (args) => {
                  await ctx.client.session.prompt(args);
                },
                promptAsync: async (args) => {
                  await ctx.client.session.promptAsync(args);
                },
              },
            },
          },
          {
            backgroundManager,
            config: pluginConfig.babysitting,
          },
        )
      : null;

    if (sessionRecovery && todoContinuationEnforcer) {
      sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering);
      sessionRecovery.setOnRecoveryCompleteCallback(
        todoContinuationEnforcer.markRecoveryComplete,
      );
    }

    const backgroundNotificationHook = isHookEnabled("background-notification")
      ? createBackgroundNotificationHook(backgroundManager)
      : null;


    return {
      tool: filteredTools,

      "chat.message": createChatMessageHandler({
        client: ctx.client,
        pluginConfig,
        firstMessageVariantGate,
        stopContinuationGuard,
        keywordDetector,
        claudeCodeHooks,
        autoSlashCommand,
        startWork,
        ralphLoop,
      }),

      "experimental.chat.messages.transform":
        experimentalHandlers.chatMessagesTransform[
          "experimental.chat.messages.transform"
        ],

      config: configHandler as ReturnType<typeof createConfigHandler>,

      event: createEventHandler({
        directory: ctx.directory,
        client: ctx.client,
        firstMessageVariantGate,
        tmuxSessionManager,
        skillMcpManager,
        sessionRecovery,
        stopContinuationGuard,
        hooks: {
          autoUpdateChecker,
          claudeCodeHooks,
          backgroundNotificationHook,
          sessionNotification,
          todoContinuationEnforcer,
          unstableAgentBabysitter,
          contextWindowMonitor,
          directoryAgentsInjector,
          directoryReadmeInjector,
          rulesInjector,
          thinkMode,
          anthropicContextWindowLimitRecovery,
          agentUsageReminder,
          categorySkillReminder,
          interactiveBashSession,
          ralphLoop,
          stopContinuationGuardEventHook: stopContinuationGuard,
          atlasHook,
        },
      }),

      "tool.execute.before": toolExecuteHandlers.before,

      "tool.execute.after": toolExecuteHandlers.after,

      "experimental.session.compacting": experimentalHandlers.sessionCompacting,
    };
  };

  return OhMyOpenCodePlugin;
}
