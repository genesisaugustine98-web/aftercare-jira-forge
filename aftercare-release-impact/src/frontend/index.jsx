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
  const [gitLabProjectId, setGitLabProjectId] = useState('');
  const [gitLabToken, setGitLabToken] = useState('');
  const [gitLabBusy, setGitLabBusy] = useState(false);
  const [showGitLabTokenForm, setShowGitLabTokenForm] = useState(false);
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
          setGitLabConnection({ status: 'ready', ...result });
          setGitLabProjectId(result.project?.projectId ? String(result.project.projectId) : '');
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

  const connectGitLab = useCallback(async () => {
    setGitLabBusy(true);
    setGitLabError(null);
    setGitLabMessage(null);

    try {
      const result = await invoke('saveGitLabConnection', {
        projectKey,
        projectId: gitLabProjectId,
        token: gitLabToken,
      });
      setGitLabConnection({
        status: 'ready',
        connected: true,
        canManage: true,
        project: result.project,
      });
      setGitLabProjectId(String(result.project.id));
      setShowGitLabTokenForm(false);
      setGitLabToken('');
      setGitLabMessage('GitLab is connected. Its access token is stored encrypted and is never shown again.');
    } catch (error) {
      setGitLabError(error instanceof Error ? error.message : 'GitLab could not be connected.');
    } finally {
      setGitLabBusy(false);
    }
  }, [projectKey, gitLabProjectId, gitLabToken]);

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
      setShowGitLabTokenForm(false);
      setEvidenceByIssue({});
      setGitLabProjectId('');
      setGitLabMessage('GitLab has been disconnected and its stored access token deleted.');
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
      const snapshot = await invoke('syncGitLabIssueEvidence', { projectKey, issueKey });
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
        ) : gitLabConnection.connected && !showGitLabTokenForm ? (
          <SectionMessage appearance="success" title="GitLab connected">
            <Stack space="space.100">
              <Text>
                {gitLabConnection.project?.projectName || gitLabConnection.project?.name}
                {' · '}
                {gitLabConnection.project?.projectPath || gitLabConnection.project?.path}
              </Text>
              <Text>
                Read-only GitLab.com access. The stored token expires from Aftercare
                after 90 days; GitLab may expire it sooner.
              </Text>
              <Inline>
                <Button onClick={() => setShowGitLabTokenForm(true)} isDisabled={gitLabBusy}>
                  Replace access token
                </Button>
                <Button onClick={disconnectGitLab} isDisabled={gitLabBusy}>
                  Disconnect GitLab
                </Button>
              </Inline>
            </Stack>
          </SectionMessage>
        ) : (
          <SectionMessage appearance="information" title={gitLabConnection.connected ? 'Replace GitLab access token' : 'Connect a GitLab project'}>
            <Stack space="space.100">
              <Text>
                Connect one GitLab.com project using an access token with the
                read_api scope. Use a project token where possible. Aftercare
                stores the token in Forge's encrypted secret store, never displays
                it again, and allows only Jira project administrators to inspect
                the connected evidence.
              </Text>
              <Label labelFor="gitlab-project-id">GitLab numeric project ID</Label>
              <Textfield
                id="gitlab-project-id"
                value={gitLabProjectId}
                onChange={(event) => setGitLabProjectId(event.target.value)}
              />
              <Label labelFor="gitlab-access-token">GitLab access token</Label>
              <Textfield
                id="gitlab-access-token"
                type="password"
                value={gitLabToken}
                onChange={(event) => setGitLabToken(event.target.value)}
              />
              <Inline>
                <Button
                  onClick={connectGitLab}
                  isDisabled={gitLabBusy || !gitLabProjectId.trim() || !gitLabToken.trim()}
                >
                  {gitLabConnection.connected ? 'Update access token' : 'Connect GitLab'}
                </Button>
                {gitLabConnection.connected ? (
                  <Button
                    onClick={() => {
                      setShowGitLabTokenForm(false);
                      setGitLabToken('');
                    }}
                    isDisabled={gitLabBusy}
                  >
                    Cancel
                  </Button>
                ) : null}
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
                          {evidenceLoading[issue.key] ? 'Inspecting GitLab…' : 'Inspect GitLab evidence'}
                        </Button>
                      </Inline>
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
          Jira project administrator connects GitLab, it can collect explicitly
          linked merge requests, pipeline status, CI job results and test-report
          evidence against the exact merge-request head commit. A successful
          security_scan job is recorded only as job-execution evidence; it is not
          a claim that vulnerability findings are clear. Aftercare does not yet
          analyse source diffs or deployment records, change Jira data, or
          authorize a production release.
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
