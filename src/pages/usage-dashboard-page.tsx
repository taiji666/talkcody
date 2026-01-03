// src/pages/usage-dashboard-page.tsx
// Unified dashboard page for displaying usage from multiple providers (Claude & OpenAI)

import { AlertCircle, CheckCircle2, Clock, Coins, Loader2, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUiNavigation } from '@/contexts/ui-navigation';
import { useLocale } from '@/hooks/use-locale';
import { useClaudeOAuthStore } from '@/providers/oauth/claude-oauth-store';
import { useGitHubCopilotOAuthStore } from '@/providers/oauth/github-copilot-oauth-store';
import { useOpenAIOAuthStore } from '@/providers/oauth/openai-oauth-store';
import {
  getRemainingPercentage as getClaudeRemainingPercentage,
  getTimeUntilReset as getClaudeTimeUntilReset,
  getUsageLevel as getClaudeUsageLevel,
  getWeeklyResetDisplay as getClaudeWeeklyResetDisplay,
} from '@/services/claude-usage-service';
import {
  getRemainingPercentage as getCopilotRemainingPercentage,
  getUsageLevel as getCopilotUsageLevel,
} from '@/services/github-copilot-usage-service';
import {
  getRemainingPercentage as getOpenAIRemainingPercentage,
  getTimeUntilReset as getOpenAITimeUntilReset,
  getUsageLevel as getOpenAIUsageLevel,
  getWeeklyResetDisplay as getOpenAIWeeklyResetDisplay,
} from '@/services/openai-usage-service';
import {
  getRemainingPercentage as getZhipuRemainingPercentage,
  getTimeUntilReset as getZhipuTimeUntilReset,
  getUsageLevel as getZhipuUsageLevel,
} from '@/services/zhipu-usage-service';
import { useClaudeUsageStore } from '@/stores/claude-usage-store';
import { useGitHubCopilotUsageStore } from '@/stores/github-copilot-usage-store';
import { useOpenAIUsageStore } from '@/stores/openai-usage-store';
import { useZhipuUsageStore } from '@/stores/zhipu-usage-store';
import { NavigationView } from '@/types/navigation';

// Helper to get color classes based on usage level
function getLevelColor(level: string): string {
  switch (level) {
    case 'low':
      return 'text-green-600 dark:text-green-400';
    case 'medium':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'high':
      return 'text-orange-600 dark:text-orange-400';
    case 'critical':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-muted-foreground';
  }
}

// Claude Usage Tab Component
function ClaudeUsageTab() {
  const { t } = useLocale();

  // Claude OAuth state
  const isOAuthConnected = useClaudeOAuthStore((state) => state.isConnected);
  const startOAuth = useClaudeOAuthStore((state) => state.startOAuth);

  // Usage state
  const usageData = useClaudeUsageStore((state) => state.usageData);
  const isLoading = useClaudeUsageStore((state) => state.isLoading);
  const error = useClaudeUsageStore((state) => state.error);
  const initialize = useClaudeUsageStore((state) => state.initialize);
  const refresh = useClaudeUsageStore((state) => state.refresh);

  // Initialize on mount
  useEffect(() => {
    if (isOAuthConnected) {
      initialize();
    }
  }, [isOAuthConnected, initialize]);

  // Handle OAuth login
  const handleConnect = async () => {
    try {
      const url = await startOAuth();
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to start OAuth:', err);
    }
  };

  // Handle refresh
  const handleRefresh = async () => {
    await refresh();
  };

  // Not connected state
  if (!isOAuthConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.usage.title}</CardTitle>
          <CardDescription>{t.usage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.usage.notConnected}</AlertTitle>
            <AlertDescription>{t.usage.connectPrompt}</AlertDescription>
          </Alert>
          <Button onClick={handleConnect}>{t.usage.connectButton}</Button>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.usage.title}</CardTitle>
          <CardDescription>{t.usage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.usage.error}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.usage.refreshing}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t.usage.retry}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading && !usageData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.usage.title}</CardTitle>
          <CardDescription>{t.usage.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!usageData || !usageData.five_hour || !usageData.seven_day) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.usage.title}</CardTitle>
          <CardDescription>{t.usage.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.usage.noData}</AlertTitle>
            <AlertDescription>{t.usage.noDataDescription}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Get usage levels with safe access
  const fiveHourLevel = getClaudeUsageLevel(usageData.five_hour?.utilization_pct ?? 0);
  const sevenDayLevel = getClaudeUsageLevel(usageData.seven_day?.utilization_pct ?? 0);

  // Calculate remaining percentages
  const fiveHourRemaining = getClaudeRemainingPercentage(usageData.five_hour?.utilization_pct ?? 0);
  const sevenDayRemaining = getClaudeRemainingPercentage(usageData.seven_day?.utilization_pct ?? 0);

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button onClick={handleRefresh} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t.usage.refreshing}
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t.usage.refresh}
            </>
          )}
        </Button>
      </div>

      {/* 5-Hour Session Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.usage.fiveHour.title}</CardTitle>
              <CardDescription>{t.usage.fiveHour.description}</CardDescription>
            </div>
            {usageData.five_hour.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.usage.resetsIn}: {getClaudeTimeUntilReset(usageData.five_hour.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.usage.used}: {(usageData.five_hour?.utilization_pct ?? 0).toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(fiveHourLevel)}`}>
                {t.usage.remaining}: {fiveHourRemaining.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.five_hour?.utilization_pct ?? 0} className="h-2" />
          </div>
          {fiveHourLevel === 'critical' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t.usage.criticalWarning}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 7-Day Weekly Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.usage.sevenDay.title}</CardTitle>
              <CardDescription>{t.usage.sevenDay.description}</CardDescription>
            </div>
            {usageData.seven_day.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.usage.resetsIn}: {getClaudeWeeklyResetDisplay(usageData.seven_day.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.usage.used}: {(usageData.seven_day?.utilization_pct ?? 0).toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(sevenDayLevel)}`}>
                {t.usage.remaining}: {sevenDayRemaining.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.seven_day?.utilization_pct ?? 0} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Model-Specific Usage */}
      {(usageData.seven_day_sonnet || usageData.seven_day_opus) && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Sonnet Usage */}
          {usageData.seven_day_sonnet && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t.usage.sonnet.title}</CardTitle>
                    <CardDescription>{t.usage.sonnet.description}</CardDescription>
                  </div>
                  {usageData.seven_day_sonnet.reset_at && (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t.usage.resetsIn}:{' '}
                      {getClaudeWeeklyResetDisplay(usageData.seven_day_sonnet.reset_at)}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {(usageData.seven_day_sonnet?.utilization_pct ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <Progress
                    value={usageData.seven_day_sonnet?.utilization_pct ?? 0}
                    className="h-2"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Opus Usage */}
          {usageData.seven_day_opus && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t.usage.opus.title}</CardTitle>
                    <CardDescription>{t.usage.opus.description}</CardDescription>
                  </div>
                  {usageData.seven_day_opus.reset_at && (
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t.usage.resetsIn}:{' '}
                      {getClaudeWeeklyResetDisplay(usageData.seven_day_opus.reset_at)}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {(usageData.seven_day_opus?.utilization_pct ?? 0).toFixed(1)}%
                    </span>
                  </div>
                  <Progress
                    value={usageData.seven_day_opus?.utilization_pct ?? 0}
                    className="h-2"
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Extra Usage */}
      {usageData.extra_usage && (
        <Card>
          <CardHeader>
            <CardTitle>{t.usage.extra.title}</CardTitle>
            <CardDescription>{t.usage.extra.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t.usage.extra.currentSpending}</p>
                <p className="text-2xl font-bold">
                  ${(usageData.extra_usage?.current_spending ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-sm text-muted-foreground">{t.usage.extra.budgetLimit}</p>
                <p className="text-2xl font-bold">
                  ${(usageData.extra_usage?.budget_limit ?? 0).toFixed(2)}
                </p>
              </div>
            </div>
            <Progress
              value={
                ((usageData.extra_usage?.current_spending ?? 0) /
                  (usageData.extra_usage?.budget_limit ?? 1)) *
                100
              }
              className="h-2"
            />
          </CardContent>
        </Card>
      )}

      {/* Plan Info */}
      {usageData.rate_limit_tier && (
        <Card>
          <CardHeader>
            <CardTitle>{t.usage.plan.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-medium">{usageData.rate_limit_tier}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// GitHub Copilot Usage Tab Component
function GitHubCopilotUsageTab() {
  const { t } = useLocale();
  const { setActiveView } = useUiNavigation();

  // GitHub Copilot OAuth state
  const isOAuthConnected = useGitHubCopilotOAuthStore((state) => state.isConnected);

  // Usage state
  const usageData = useGitHubCopilotUsageStore((state) => state.usageData);
  const isLoading = useGitHubCopilotUsageStore((state) => state.isLoading);
  const error = useGitHubCopilotUsageStore((state) => state.error);
  const initialize = useGitHubCopilotUsageStore((state) => state.initialize);
  const refresh = useGitHubCopilotUsageStore((state) => state.refresh);

  // Initialize on mount
  useEffect(() => {
    if (isOAuthConnected) {
      initialize();
    }
  }, [isOAuthConnected, initialize]);

  // Handle navigate to settings for connection
  const handleConnect = () => {
    setActiveView(NavigationView.SETTINGS);
  };

  // Handle refresh
  const handleRefresh = async () => {
    await refresh();
  };

  // Not connected state
  if (!isOAuthConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.githubCopilotUsage.title}</CardTitle>
          <CardDescription>{t.githubCopilotUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.githubCopilotUsage.notConnected}</AlertTitle>
            <AlertDescription>{t.githubCopilotUsage.connectPrompt}</AlertDescription>
          </Alert>
          <Button onClick={handleConnect}>{t.githubCopilotUsage.connectButton}</Button>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.githubCopilotUsage.title}</CardTitle>
          <CardDescription>{t.githubCopilotUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.githubCopilotUsage.error}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.githubCopilotUsage.refreshing}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t.githubCopilotUsage.retry}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading && !usageData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.githubCopilotUsage.title}</CardTitle>
          <CardDescription>{t.githubCopilotUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!usageData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.githubCopilotUsage.title}</CardTitle>
          <CardDescription>{t.githubCopilotUsage.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.githubCopilotUsage.noData}</AlertTitle>
            <AlertDescription>{t.githubCopilotUsage.noDataDescription}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Get usage level
  const usageLevel = getCopilotUsageLevel(usageData.utilization_pct);
  const remainingPercentage = getCopilotRemainingPercentage(usageData.utilization_pct);

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button onClick={handleRefresh} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t.githubCopilotUsage.refreshing}
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t.githubCopilotUsage.refresh}
            </>
          )}
        </Button>
      </div>

      {/* Usage Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.githubCopilotUsage.usage.title}</CardTitle>
              <CardDescription>{t.githubCopilotUsage.usage.description}</CardDescription>
            </div>
            {usageData.reset_date && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.githubCopilotUsage.resetsOn}:{' '}
                {new Date(usageData.reset_date).toLocaleDateString()}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.githubCopilotUsage.used}: {usageData.utilization_pct.toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(usageLevel)}`}>
                {t.githubCopilotUsage.remaining}: {remainingPercentage.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.utilization_pct} className="h-2" />
          </div>

          {usageData.entitlement !== undefined && (
            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t.githubCopilotUsage.used}
                </p>
                <p className="text-lg font-bold">
                  <span className="text-orange-500">{Math.round(usageData.used ?? 0)}</span>
                  <span className="text-muted-foreground ml-2 text-sm">
                    ({usageData.utilization_pct.toFixed(1)}%)
                  </span>
                </p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t.githubCopilotUsage.remaining}
                </p>
                <p className="text-lg font-bold">
                  <span className="text-green-500">{Math.round(usageData.remaining ?? 0)}</span>
                  <span className="text-muted-foreground ml-2 text-sm">
                    ({remainingPercentage.toFixed(1)}%)
                  </span>
                </p>
              </div>
            </div>
          )}

          {usageLevel === 'critical' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t.githubCopilotUsage.criticalWarning}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Plan Info */}
      {usageData.plan && (
        <Card>
          <CardHeader>
            <CardTitle>{t.githubCopilotUsage.plan.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-medium">{usageData.plan}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// OpenAI Usage Tab Component
function OpenAIUsageTab() {
  const { t } = useLocale();

  // OpenAI OAuth state
  const isOAuthConnected = useOpenAIOAuthStore((state) => state.isConnected);
  const startOAuth = useOpenAIOAuthStore((state) => state.startOAuthWithAutoCallback);

  // Usage state
  const usageData = useOpenAIUsageStore((state) => state.usageData);
  const isLoading = useOpenAIUsageStore((state) => state.isLoading);
  const error = useOpenAIUsageStore((state) => state.error);
  const initialize = useOpenAIUsageStore((state) => state.initialize);
  const refresh = useOpenAIUsageStore((state) => state.refresh);

  // Initialize on mount
  useEffect(() => {
    if (isOAuthConnected) {
      initialize();
    }
  }, [isOAuthConnected, initialize]);

  // Handle OAuth login
  const handleConnect = async () => {
    try {
      const url = await startOAuth();
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to start OAuth:', err);
    }
  };

  // Handle refresh
  const handleRefresh = async () => {
    await refresh();
  };

  // Not connected state
  if (!isOAuthConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.openaiUsage.title}</CardTitle>
          <CardDescription>{t.openaiUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.openaiUsage.notConnected}</AlertTitle>
            <AlertDescription>{t.openaiUsage.connectPrompt}</AlertDescription>
          </Alert>
          <Button onClick={handleConnect}>{t.openaiUsage.connectButton}</Button>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.openaiUsage.title}</CardTitle>
          <CardDescription>{t.openaiUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.openaiUsage.error}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.openaiUsage.refreshing}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t.openaiUsage.retry}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading && !usageData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.openaiUsage.title}</CardTitle>
          <CardDescription>{t.openaiUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!usageData || !usageData.five_hour || !usageData.seven_day) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.openaiUsage.title}</CardTitle>
          <CardDescription>{t.openaiUsage.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.openaiUsage.noData}</AlertTitle>
            <AlertDescription>{t.openaiUsage.noDataDescription}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Get usage levels with safe access
  const fiveHourLevel = getOpenAIUsageLevel(usageData.five_hour?.utilization_pct ?? 0);
  const sevenDayLevel = getOpenAIUsageLevel(usageData.seven_day?.utilization_pct ?? 0);

  // Calculate remaining percentages
  const fiveHourRemaining = getOpenAIRemainingPercentage(usageData.five_hour?.utilization_pct ?? 0);
  const sevenDayRemaining = getOpenAIRemainingPercentage(usageData.seven_day?.utilization_pct ?? 0);

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button onClick={handleRefresh} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t.openaiUsage.refreshing}
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t.openaiUsage.refresh}
            </>
          )}
        </Button>
      </div>

      {/* 5-Hour Session Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.openaiUsage.fiveHour.title}</CardTitle>
              <CardDescription>{t.openaiUsage.fiveHour.description}</CardDescription>
            </div>
            {usageData.five_hour.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.openaiUsage.resetsIn}: {getOpenAITimeUntilReset(usageData.five_hour.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.openaiUsage.used}: {(usageData.five_hour?.utilization_pct ?? 0).toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(fiveHourLevel)}`}>
                {t.openaiUsage.remaining}: {fiveHourRemaining.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.five_hour?.utilization_pct ?? 0} className="h-2" />
          </div>
          {fiveHourLevel === 'critical' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t.openaiUsage.criticalWarning}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 7-Day Weekly Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.openaiUsage.sevenDay.title}</CardTitle>
              <CardDescription>{t.openaiUsage.sevenDay.description}</CardDescription>
            </div>
            {usageData.seven_day.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.openaiUsage.resetsIn}:{' '}
                {getOpenAIWeeklyResetDisplay(usageData.seven_day.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.openaiUsage.used}: {(usageData.seven_day?.utilization_pct ?? 0).toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(sevenDayLevel)}`}>
                {t.openaiUsage.remaining}: {sevenDayRemaining.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.seven_day?.utilization_pct ?? 0} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Credits */}
      {usageData.credits && (
        <Card>
          <CardHeader>
            <CardTitle>{t.openaiUsage.credits.title}</CardTitle>
            <CardDescription>{t.openaiUsage.credits.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Coins className="h-8 w-8 text-yellow-500" />
              <div>
                <p className="text-sm text-muted-foreground">{t.openaiUsage.credits.balance}</p>
                <p className="text-2xl font-bold">
                  {usageData.credits.unlimited
                    ? t.openaiUsage.credits.unlimited
                    : usageData.credits.balance.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Code Review Usage */}
      {typeof usageData.code_review_utilization === 'number' && (
        <Card>
          <CardHeader>
            <CardTitle>{t.openaiUsage.codeReview.title}</CardTitle>
            <CardDescription>{t.openaiUsage.codeReview.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.openaiUsage.used}: {usageData.code_review_utilization.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.code_review_utilization} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Plan Info */}
      {usageData.rate_limit_tier && (
        <Card>
          <CardHeader>
            <CardTitle>{t.openaiUsage.plan.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-medium">{usageData.rate_limit_tier}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Zhipu AI Usage Tab Component
function ZhipuUsageTab() {
  const { t } = useLocale();
  const { setActiveView } = useUiNavigation();

  // Usage state
  const usageData = useZhipuUsageStore((state) => state.usageData);
  const isLoading = useZhipuUsageStore((state) => state.isLoading);
  const error = useZhipuUsageStore((state) => state.error);
  const initialize = useZhipuUsageStore((state) => state.initialize);
  const refresh = useZhipuUsageStore((state) => state.refresh);

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Handle navigate to settings for API key configuration
  const handleConfigure = () => {
    setActiveView(NavigationView.SETTINGS);
  };

  // Handle refresh
  const handleRefresh = async () => {
    await refresh();
  };

  // Not configured state (no API key)
  if (error?.includes('API key not configured')) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.zhipuUsage.title}</CardTitle>
          <CardDescription>{t.zhipuUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.zhipuUsage.notConfigured}</AlertTitle>
            <AlertDescription>{t.zhipuUsage.configurePrompt}</AlertDescription>
          </Alert>
          <Button onClick={handleConfigure}>{t.zhipuUsage.configureButton}</Button>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.zhipuUsage.title}</CardTitle>
          <CardDescription>{t.zhipuUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.zhipuUsage.error}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.zhipuUsage.refreshing}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t.zhipuUsage.retry}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading && !usageData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.zhipuUsage.title}</CardTitle>
          <CardDescription>{t.zhipuUsage.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!usageData || !usageData.five_hour) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.zhipuUsage.title}</CardTitle>
          <CardDescription>{t.zhipuUsage.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t.zhipuUsage.noData}</AlertTitle>
            <AlertDescription>{t.zhipuUsage.noDataDescription}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Get usage level
  const usageLevel = getZhipuUsageLevel(usageData.five_hour.utilization_pct);
  const remainingPercentage = getZhipuRemainingPercentage(usageData.five_hour.utilization_pct);

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button onClick={handleRefresh} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t.zhipuUsage.refreshing}
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t.zhipuUsage.refresh}
            </>
          )}
        </Button>
      </div>

      {/* 5-Hour Session Usage */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t.zhipuUsage.fiveHour.title}</CardTitle>
              <CardDescription>{t.zhipuUsage.fiveHour.description}</CardDescription>
            </div>
            {usageData.five_hour.reset_at && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t.zhipuUsage.resetsIn}: {getZhipuTimeUntilReset(usageData.five_hour.reset_at)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t.zhipuUsage.used}: {usageData.five_hour.utilization_pct.toFixed(1)}%
              </span>
              <span className={`text-sm font-medium ${getLevelColor(usageLevel)}`}>
                {t.zhipuUsage.remaining}: {remainingPercentage.toFixed(1)}%
              </span>
            </div>
            <Progress value={usageData.five_hour.utilization_pct} className="h-2" />
          </div>

          <div className="grid grid-cols-3 gap-4 border-t pt-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t.zhipuUsage.used}
              </p>
              <p className="text-lg font-bold">
                <span className="text-orange-500">
                  {(usageData.five_hour.used ?? 0).toLocaleString()}
                </span>
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t.zhipuUsage.remaining}
              </p>
              <p className="text-lg font-bold">
                <span className="text-green-500">
                  {(usageData.five_hour.remaining ?? 0).toLocaleString()}
                </span>
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {t.zhipuUsage.limit}
              </p>
              <p className="text-lg font-bold">
                <span className="text-blue-500">
                  {(usageData.five_hour.limit ?? 0).toLocaleString()}
                </span>
              </p>
            </div>
          </div>

          {usageLevel === 'critical' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t.zhipuUsage.criticalWarning}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Model-Specific Usage */}
      {usageData.usage_details && usageData.usage_details.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t.zhipuUsage.modelUsage.title}</CardTitle>
            <CardDescription>{t.zhipuUsage.modelUsage.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {usageData.usage_details.map((detail) => (
                <div key={detail.model} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{detail.model}</span>
                    <span className="text-sm text-muted-foreground">
                      {(detail.used ?? 0).toLocaleString()}
                      {detail.limit > 0 && ` / ${detail.limit.toLocaleString()}`}
                    </span>
                  </div>
                  {detail.limit > 0 && (
                    <Progress
                      value={detail.limit > 0 ? (detail.used / detail.limit) * 100 : 0}
                      className="h-2"
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan Info */}
      {usageData.plan_name && (
        <Card>
          <CardHeader>
            <CardTitle>{t.zhipuUsage.plan.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-medium">{usageData.plan_name}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Main Usage Dashboard Page
export function UsageDashboardPage() {
  return (
    <div className="container mx-auto p-6">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Usage Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor your AI subscription usage across providers
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="claude" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="claude">Claude</TabsTrigger>
            <TabsTrigger value="openai">OpenAI</TabsTrigger>
            <TabsTrigger value="github-copilot">GitHub Copilot</TabsTrigger>
            <TabsTrigger value="zhipu">Zhipu AI</TabsTrigger>
          </TabsList>
          <TabsContent value="claude" className="mt-6">
            <ClaudeUsageTab />
          </TabsContent>
          <TabsContent value="openai" className="mt-6">
            <OpenAIUsageTab />
          </TabsContent>
          <TabsContent value="github-copilot" className="mt-6">
            <GitHubCopilotUsageTab />
          </TabsContent>
          <TabsContent value="zhipu" className="mt-6">
            <ZhipuUsageTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
