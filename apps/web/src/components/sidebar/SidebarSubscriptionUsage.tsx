import { useAtomValue } from "@effect/atom-react";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { Link } from "@tanstack/react-router";
import { T, useGT, Var } from "gt-react";
import { memo } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { usePrimarySettings } from "../../hooks/useSettings";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ClaudeAI, OpenAI, type Icon } from "../Icons";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const GeminiIcon: Icon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 0a12 12 0 0 0 12 12 12 12 0 0 0-12 12A12 12 0 0 0 0 12 12 12 0 0 0 12 0Z" />
  </svg>
);

const PROVIDERS = [
  { driver: "codex", name: "GPT / Codex", logo: OpenAI, color: "text-foreground" },
  { driver: "claudeAgent", name: "Claude", logo: ClaudeAI, color: "text-[#cf704d]" },
  { driver: "antigravity", name: "Gemini", logo: GeminiIcon, color: "text-[#6b83ea]" },
] as const;

const RING_LENGTH = 100;

export const SidebarSubscriptionUsage = memo(function SidebarSubscriptionUsage() {
  const gt = useGT();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const now = Date.parse(`${useNowMinute()}Z`);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const { isMobile, setOpenMobile } = useSidebar();
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const pools = collectLimitPools(collectLimitAccounts(presentations), now);
  const connectedProviders = [...presentations.values()]
    .filter((presentation) => presentation.connection.phase === "connected")
    .flatMap((presentation) => presentation.serverConfig?.providers ?? []);

  function refreshVisibleLimits() {
    for (const [environmentId, presentation] of presentations) {
      if (presentation.connection.phase !== "connected") continue;
      const installed = presentation.serverConfig?.providers.some(
        (provider) =>
          provider.installed &&
          provider.enabled &&
          PROVIDERS.some(({ driver }) => driver === provider.driver),
      );
      if (!installed) continue;
      void refreshUsageLimits(
        environmentId,
        () => refreshProviders({ environmentId, input: {} }),
        true,
      ).catch(() => undefined);
    }
  }

  return (
    <div
      role="group"
      aria-label={gt("Subscription usage")}
      className="flex items-center gap-1 group-data-[collapsible=icon]:hidden"
    >
      {PROVIDERS.map(({ driver, name, logo: Logo, color }) => {
        const pool = pools.find((candidate) => candidate.driver === driver);
        const windows = (pool?.windows ?? []).filter(
          (window) => driver !== "antigravity" || window.id.startsWith("gemini-"),
        );
        // Prefer the all-model weekly limit on Claude. When Gemini has several weekly
        // buckets, its ring shows the lowest remaining bucket and the tooltip lists each one.
        const weekly = windows.filter((window) => window.kind === "weekly");
        const ring =
          weekly.find((window) => driver === "claudeAgent" && window.id === "seven_day") ??
          (weekly.length > 0 ? weekly : windows).reduce<(typeof windows)[number] | undefined>(
            (lowest, window) =>
              !lowest || window.remainingPercent < lowest.remainingPercent ? window : lowest,
            undefined,
          );
        const unavailable = connectedProviders.find(
          (provider) =>
            provider.enabled &&
            provider.driver === driver &&
            provider.usageLimits?.unavailable?.message &&
            (driver !== "antigravity" || provider.usageLimits.unavailable.reason !== "unsupported"),
        )?.usageLimits?.unavailable?.message;
        const remaining = ring?.remainingPercent;
        const ringNeedsRefresh = ring?.resets.some(({ at }) => at <= now) ?? false;

        return (
          <Tooltip key={driver} onOpenChange={(open) => open && refreshVisibleLimits()}>
            <TooltipTrigger
              render={
                <Link
                  to="/usage"
                  onClick={() => isMobile && setOpenMobile(false)}
                  aria-label={gt("{name} subscription usage", { name })}
                  className="relative grid size-9 place-items-center rounded-md outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:size-11"
                />
              }
            >
              <svg
                aria-hidden="true"
                className="absolute size-7 -rotate-90"
                fill="none"
                viewBox="0 0 32 32"
                strokeWidth="2.5"
              >
                <circle
                  cx="16"
                  cy="16"
                  r="13"
                  pathLength={RING_LENGTH}
                  className="stroke-sidebar-foreground/25"
                  strokeDasharray={remaining === undefined || ringNeedsRefresh ? "4 3" : undefined}
                />
                {remaining !== undefined && remaining > 0 && !ringNeedsRefresh ? (
                  <circle
                    cx="16"
                    cy="16"
                    r="13"
                    pathLength={RING_LENGTH}
                    className="stroke-sidebar-foreground/85"
                    strokeDasharray={`${remaining} ${RING_LENGTH}`}
                    strokeLinecap="round"
                  />
                ) : null}
              </svg>
              <Logo aria-hidden="true" className={`size-3.5 ${color}`} />
            </TooltipTrigger>
            <TooltipPopup side="top" align="start" className="max-w-[min(19rem,90vw)]">
              <div className="space-y-2 py-1">
                <div className="font-medium text-foreground">
                  {pool && pool.accounts.length > 1
                    ? gt("{name} · {count} accounts", { name, count: pool.accounts.length })
                    : name}
                </div>
                {windows.length > 0 ? (
                  <ul className="space-y-1.5">
                    {windows.map((window) => {
                      const nextReset = window.resets.find(({ at }) => at > now);
                      const needsRefresh = window.resets.some(({ at }) => at <= now);
                      return (
                        <li key={window.id}>
                          <div className="flex justify-between gap-4 text-foreground">
                            <span>{window.label}</span>
                            <span className="shrink-0 tabular-nums">
                              <T>
                                <Var>{window.remainingPercent}</Var>% left
                              </T>
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            {nextReset
                              ? needsRefresh
                                ? gt("Last reported · Resets {time}", {
                                    time: formatUpcomingTimestamp(
                                      new Date(nextReset.at).toISOString(),
                                      timestampFormat,
                                      now,
                                    ),
                                  })
                                : gt("Resets {time}", {
                                    time: formatUpcomingTimestamp(
                                      new Date(nextReset.at).toISOString(),
                                      timestampFormat,
                                      now,
                                    ),
                                  })
                              : needsRefresh
                                ? gt("Last reported · Reset time passed")
                                : gt("Reset time unavailable")}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    {unavailable ??
                      (driver === "antigravity"
                        ? gt(
                            "Antigravity did not report Gemini limits. Quota availability depends on the runtime and sign-in method.",
                          )
                        : gt("No subscription limits reported."))}
                  </p>
                )}
              </div>
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
});
