import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Badge,
  Button,
  Heading,
  Inline,
  Label,
  Link,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
  useProductContext,
} from '@forge/react';
import { invoke, requestJira } from '@forge/bridge';
import {
  MAX_RECENT_ISSUES,
  fetchProjectDashboard,
  formatUpdatedDate,
  getProjectTypeLabel,
  getStatusAppearance,
} from './project-dashboard-logic.mjs';

const App = () => {
  // Forge provides the project key for the Jira project page. The context is
  // loaded asynchronously, so it is undefined during the first render.
  const context = useProductContext();
  const projectKey = context?.extension?.project?.key;

  const [refreshSequence, setRefreshSequence] = useState(0);
  const [dashboard, setDashboard] = useState({
    status: 'loading',
    project: null,
    issues: [],
    error: null,
  });

  const [gitLabConnection, setGitLabConnection] = useState({
    status: 'loading',
    connected: false,
    canManage: false,
    project: null,
  });
  const [gitLabProjectId, setGitLabProjectId] = useState('87726693');
  const [gitLabSetupSecret, setGitLabSetupSecret] = useState('');
  const [gitLabBusy, setGitLabBusy] = useState(false);
  const [gitLabError, setGitLabError] = useState(null);
  const [gitLabMessage, setGitLabMessage] = useState(null);
  const [evidenceByIssue, setEvidenceByIssue] = useState({});
  const [evidenceLoading, setEvidenceLoading] = useState({});

  const refresh = useCallback(() => {
    setRefreshSequence((currentSequence) => currentSequence + 1);
  }, []);

  useEffect(() => {
    if (!projectKey) {
      return undefined;
    }

    let isActive = true;
    invoke('getGitLabConnectionStatus', { projectKey })
      .then((result) => {
        if (isActive) {
          setGitLabConnection({
            status: 'ready',
            connected: result.configured,
            canManage: result.canManage,
            project: result.project,
            webhookUrl: result.webhookUrl,
          });
          setGitLabProjectId(result.project?.projectId ? String(result.project.projectId) : '87726693');
        }
      })
      .catch((error) => {
        if (isActive) {
          setGitLabConnection({
            status: 'error',
            connected: false,
            canManage: false,
            project: null,
          });
          setGitLabError(error instanceof Error ? error.message : 'GitLab connection status could not be loaded.');
        }
      });

    return () => {
      isActive = false;
    };
  }, [projectKey]);

  const refreshGitLabStatus = useCallback(async () => {
    setGitLabBusy(true);
    setGitLabError(null);
    try {
      const result = await invoke('getGitLabConnectionStatus', { projectKey });
      setGitLabConnection({
        status: 'ready',
        connected: result.configured,
        canManage: result.canManage,
        project: result.project,
        webhookUrl: result.webhookUrl,
      });
      if (result.project?.projectId) {
        setGitLabProjectId(String(result.project.projectId));
      }
    } catch (error) {
      setGitLabError(error instanceof Error ? error.message : 'Webhook status could not be refreshed.');
    } finally {
      setGitLabBusy(false);
    }
  }, [projectKey]);

  const connectGitLab = useCallback(async () => {
    setGitLabBusy(true);
    setGitLabError(null);
    setGitLabMessage(null);

    try {
      const result = await invoke('generateGitLabWebhookSetup', {
        projectKey,
        projectId: gitLabProjectId,
      });
      setGitLabConnection({
        status: 'ready',
        connected: true,
        canManage: true,
        project: result.project,
        webhookUrl: result.webhookUrl,
      });
      setGitLabProjectId(String(result.project.projectId));
      setGitLabSetupSecret(result.secret);
      setGitLabMessage('Webhook details generated. Copy the secret now; it will not be shown again after this page is refreshed.');
    } catch (error) {
      setGitLabError(error instanceof Error ? error.message : 'GitLab could not be connected.');
    } finally {
      setGitLabBusy(false);
    }
  }, [projectKey, gitLabProjectId]);

  const disconnectGitLab = useCallback(async () => {
    setGitLabBusy(true);
    setGitLabError(null);
    setGitLabMessage(null);

    try {
      await invoke('disconnectGitLab', { projectKey });
      setGitLabConnection({
        status: 'ready',
        connected: false,
        canManage: true,
        project: null,
      });
      setGitLabSetupSecret('');
      setEvidenceByIssue({});
      setGitLabProjectId('87726693');
      setGitLabMessage('GitLab webhook credentials have been deleted. Remove the old webhook from GitLab project settings to stop its retries.');
    } catch (error) {
      setGitLabError(error instanceof Error ? error.message : 'GitLab could not be disconnected.');
    } finally {
      setGitLabBusy(false);
    }
  }, [projectKey]);

  const inspectGitLabEvidence = useCallback(async (issueKey) => {
    setEvidenceLoading((current) => ({ ...current, [issueKey]: true }));
    setGitLabError(null);

    try {
      const snapshot = await invoke('getGitLabIssueEvidence', { projectKey, issueKey });
      setEvidenceByIssue((current) => ({ ...current, [issueKey]: snapshot }));
    } catch (error) {
      setGitLabError(error instanceof Error ? error.message : 'GitLab evidence could not be retrieved.');
    } finally {
      setEvidenceLoading((current) => ({ ...current, [issueKey]: false }));
    }
  }, [projectKey]);

  useEffect(() => {
    if (!projectKey) {
      return undefined;
    }

    let isActive = true;

    const loadProjectDashboard = async () => {
      setDashboard({
        status: 'loading',
        project: null,
        issues: [],
        error: null,
      });

      try {
        // requestJira runs as the currently signed-in user. Jira's own project
        // permissions and issue-security rules therefore remain in force.
        const result = await fetchProjectDashboard(projectKey, requestJira);

        if (isActive) {
          setDashboard({
            status: 'ready',
            project: result.project,
            issues: result.issues,
            error: null,
          });
        }
      } catch (error) {
        if (isActive) {
          setDashboard({
            status: 'error',
            project: null,
            issues: [],
            error: error instanceof Error
              ? error.message
              : 'An unexpected error occurred while loading Jira project data.',
          });
        }
      }
    };

    loadProjectDashboard();

    return () => {
      // Ignore results from an earlier project or refresh after the component
      // has moved on. This prevents stale responses from replacing newer data.
      isActive = false;
    };
  }, [projectKey, refreshSequence]);

  if (!context) {
    return (
      <Stack space="space.200" alignInline="start">
        <Heading as="h1">Aftercare</Heading>
        <Inline space="space.100" alignBlock="center">
          <Spinner />
          <Text>Loading Jira project context…</Text>
        </Inline>
      </Stack>
    );
  }

  if (!projectKey) {
    return (
      <Stack space="space.200">
        <Heading as="h1">Aftercare</Heading>
        <SectionMessage appearance="warning" title="Project context unavailable">
          <Text>
            Aftercare could not identify the Jira project for this page. Open
            the app from a Jira project page and try again.
          </Text>
        </SectionMessage>
      </Stack>
    );
  }

  if (dashboard.status === 'loading') {
    return (
      <Stack space="space.200" alignInline="start">
        <Heading as="h1">Aftercare</Heading>
        <Inline space="space.100" alignBlock="center">
          <Spinner />
          <Text>Loading project information and recent work items…</Text>
        </Inline>
      </Stack>
    );
  }

  if (dashboard.status === 'error') {
    return (
      <Stack space="space.200">
        <Heading as="h1">Aftercare</Heading>
        <SectionMessage appearance="error" title="Unable to load project data">
          <Text>{dashboard.error}</Text>
        </SectionMessage>
        <Inline>
          <Button onClick={refresh}>Try again</Button>
        </Inline>
      </Stack>
    );
  }

  const { project, issues } = dashboard;
  const description = typeof project.description === 'string'
    ? project.description.trim()
    : '';

  return (
    <Stack space="space.300">
      <Inline space="space.200" alignBlock="center">
        <Stack space="space.050">
          <Heading as="h1">Aftercare</Heading>
          <Text>Release impact workspace</Text>
        </Stack>
        <Button onClick={refresh}>Refresh</Button>
      </Inline>

      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center">
          <Heading as="h2">{project.name || project.key}</Heading>
          <Lozenge appearance="neutral">{project.key}</Lozenge>
        </Inline>
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance="information">
            {getProjectTypeLabel(project.projectTypeKey)}
          </Lozenge>
        </Inline>
        <Text>
          {description || 'No project description has been added in Jira.'}
        </Text>
      </Stack>

      <Stack space="space.200">
        <Heading as="h3">GitLab evidence source</Heading>
        {gitLabConnection.status === 'loading' ? (
          <Inline space="space.100" alignBlock="center">
            <Spinner />
            <Text>Checking GitLab connection…</Text>
          </Inline>
        ) : !gitLabConnection.canManage ? (
          <SectionMessage appearance="information" title="Project administrator access required">
            <Text>
              Only Jira project administrators can configure, refresh or inspect
              this project's connected GitLab evidence.
            </Text>
          </SectionMessage>
        ) : gitLabConnection.connected ? (
          <SectionMessage appearance="success" title="GitLab webhook endpoint ready">
            <Stack space="space.100">
              <Text>
                GitLab project ID: {gitLabConnection.project?.projectId}
              </Text>
              <Text>
                Webhook URL: {gitLabConnection.webhookUrl}
              </Text>
              {gitLabSetupSecret ? (
                <Text>Secret token (copy into GitLab now): {gitLabSetupSecret}</Text>
              ) : (
                <Text>
                  The secret is stored securely and is not displayed again.
                  Generate a new secret if you need to replace the GitLab webhook token.
                </Text>
              )}
              <Text>
                In GitLab, open Settings → Webhooks. Paste the URL and secret,
                enable Merge request events, Pipeline events and Job events,
                and leave SSL verification enabled.
              </Text>
              <Text>
                Last event: {gitLabConnection.project?.lastEventAt || 'Waiting for the first webhook event'}
                {gitLabConnection.project?.lastEventKind ? ` · ${gitLabConnection.project.lastEventKind}` : ''}
              </Text>
              <Inline>
                <Button onClick={refreshGitLabStatus} isDisabled={gitLabBusy}>
                  Refresh webhook status
                </Button>
                <Button onClick={connectGitLab} isDisabled={gitLabBusy}>
                  Generate / rotate secret
                </Button>
                <Button onClick={disconnectGitLab} isDisabled={gitLabBusy}>
                  Disconnect GitLab
                </Button>
              </Inline>
            </Stack>
          </SectionMessage>
        ) : (
          <SectionMessage appearance="information" title="Configure a GitLab webhook">
            <Stack space="space.100">
              <Text>
                Aftercare uses signed, inbound GitLab webhooks. It does not need
                a GitLab access token and does not make outbound requests to GitLab.
                Only Jira project administrators can configure or inspect evidence.
              </Text>
              <Text>
                I found your active Aftercare GitLab project with ID 87726693.
                It is prefilled below; change the ID if this Jira project should
                receive events from another GitLab project.
              </Text>
              <Label labelFor="gitlab-project-id">GitLab numeric project ID</Label>
              <Textfield
                id="gitlab-project-id"
                value={gitLabProjectId}
                onChange={(event) => setGitLabProjectId(event.target.value)}
              />
              <Inline>
                <Button
                  onClick={connectGitLab}
                  isDisabled={gitLabBusy || !gitLabProjectId.trim()}
                >
                  Generate webhook URL and secret
                </Button>
              </Inline>
            </Stack>
          </SectionMessage>
        )}
        {gitLabError ? (
          <SectionMessage appearance="error" title="GitLab action failed">
            <Text>{gitLabError}</Text>
          </SectionMessage>
        ) : null}
        {gitLabMessage ? (
          <SectionMessage appearance="success" title="GitLab connection updated">
            <Text>{gitLabMessage}</Text>
          </SectionMessage>
        ) : null}
      </Stack>

      <Stack space="space.200">
        <Inline space="space.100" alignBlock="center">
          <Heading as="h3">Recently updated work items</Heading>
          <Badge>{issues.length}</Badge>
        </Inline>
        <Text>
          Showing up to {MAX_RECENT_ISSUES} of the most recently updated
          work items visible to your Jira account. This is not a total project
          issue count.
        </Text>

        {issues.length === 0 ? (
          <Text>
            No visible work items were returned for this project.
          </Text>
        ) : (
          <Stack space="space.200">
            {issues.map((issue) => {
              const fields = issue.fields || {};
              const statusName = fields.status?.name || 'Unknown status';
              const issueType = fields.issuetype?.name || 'Work item';
              const priority = fields.priority?.name;
              const assignee = fields.assignee?.displayName || 'Unassigned';

              return (
                <Stack key={issue.id || issue.key} space="space.050">
                  <Inline space="space.100" alignBlock="center">
                    <Text as="strong">{issue.key}</Text>
                    <Lozenge appearance={getStatusAppearance(statusName)}>
                      {statusName}
                    </Lozenge>
                  </Inline>
                  <Text>{fields.summary || 'No summary provided'}</Text>
                  <Text>
                    {issueType}
                    {priority ? ` · ${priority}` : ''}
                    {` · ${assignee} · Updated ${formatUpdatedDate(fields.updated)}`}
                  </Text>

                  {gitLabConnection.connected && gitLabConnection.canManage ? (
                    <Stack space="space.100">
                      <Inline>
                        <Button
                          onClick={() => inspectGitLabEvidence(issue.key)}
                          isDisabled={Boolean(evidenceLoading[issue.key])}
                        >
                          {evidenceLoading[issue.key] ? 'Loading GitLab evidence…' : 'Load GitLab evidence'}
                        </Button>
                      </Inline>
                      {evidenceByIssue[issue.key] === null ? (
                        <Text>
                          No webhook evidence has been received for this Jira issue yet.
                          A merge request must explicitly include this issue key, and
                          GitLab must send merge request, pipeline and job events.
                        </Text>
                      ) : null}
                      {evidenceByIssue[issue.key] ? (
                        <Stack space="space.050">
                          <Inline space="space.100" alignBlock="center">
                            <Text>Evidence state</Text>
                            <Lozenge
                              appearance={evidenceByIssue[issue.key].status === 'evidence_current'
                                ? 'success'
                                : evidenceByIssue[issue.key].status === 'needs_review'
                                  ? 'warning'
                                  : 'danger'}
                            >
                              {evidenceByIssue[issue.key].status}
                            </Lozenge>
                          </Inline>
                          {evidenceByIssue[issue.key].mergeRequest ? (
                            <Link href={evidenceByIssue[issue.key].mergeRequest.webUrl}>
                              GitLab MR !{evidenceByIssue[issue.key].mergeRequest.iid}: {evidenceByIssue[issue.key].mergeRequest.title}
                            </Link>
                          ) : null}
                          {evidenceByIssue[issue.key].pipeline?.webUrl ? (
                            <Link href={evidenceByIssue[issue.key].pipeline.webUrl}>
                              Pipeline #{evidenceByIssue[issue.key].pipeline.id}: {evidenceByIssue[issue.key].pipeline.status}
                            </Link>
                          ) : null}
                          {evidenceByIssue[issue.key].expectedCommitSha ? (
                            <Text>Reviewed commit: {evidenceByIssue[issue.key].expectedCommitSha}</Text>
                          ) : null}
                          {evidenceByIssue[issue.key].summary?.missingKinds?.length ? (
                            <Text>
                              Missing required evidence: {evidenceByIssue[issue.key].summary.missingKinds.join(', ')}
                            </Text>
                          ) : null}
                          {evidenceByIssue[issue.key].assessments?.slice(0, 8).map((assessment) => (
                            <Text key={assessment.id}>
                              {assessment.kind}: {assessment.status}
                              {assessment.freshness ? ` · ${assessment.freshness}` : ''}
                            </Text>
                          ))}
                          {evidenceByIssue[issue.key].summary ? (
                            <Text>
                              {evidenceByIssue[issue.key].summary.counts.passed} passed
                              {' · '}{evidenceByIssue[issue.key].summary.counts.failed} failed
                              {' · '}{evidenceByIssue[issue.key].summary.counts.stale} stale
                              {' · '}{evidenceByIssue[issue.key].summary.counts.missing} missing
                              {' · '}{evidenceByIssue[issue.key].summary.counts.unavailable} unavailable
                            </Text>
                          ) : null}
                          {evidenceByIssue[issue.key].message ? (
                            <Text>{evidenceByIssue[issue.key].message}</Text>
                          ) : null}
                          {evidenceByIssue[issue.key].notes?.map((note) => (
                            <Text key={note}>{note}</Text>
                          ))}
                        </Stack>
                      ) : null}
                    </Stack>
                  ) : null}
                </Stack>
              );
            })}
          </Stack>
        )}
      </Stack>

      <SectionMessage appearance="information" title="Current assessment scope">
        <Text>
          Aftercare reads Jira project details and recent work items. When a
          Jira project administrator configures the static GitLab webhook, it
          receives explicitly linked merge requests, pipeline status and CI job
          results, then checks them against the exact merge-request head commit.
          A successful security_scan job is recorded only as job-execution
          evidence; it is not a claim that vulnerability findings are clear.
          Events are collected from the time the webhook is enabled; historical
          pipeline and job events are not backfilled. Aftercare does not analyse
          source diffs or deployment records, change Jira data, or authorize a
          production release.
        </Text>
      </SectionMessage>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
