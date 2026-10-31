import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Badge,
  Button,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  useProductContext,
} from '@forge/react';
import { requestJira } from '@forge/bridge';
import {
  MAX_RECENT_ISSUES,
  buildRecentIssuesPath,
  formatUpdatedDate,
  getJiraErrorMessage,
  getProjectTypeLabel,
  getStatusAppearance,
} from './project-dashboard-logic.mjs';

// Keep the API error formatter in the pure logic module so its edge cases can
// be tested without needing a live Jira tenant.
async function readJiraJson(response, resource) {
  if (!response.ok) {
    throw new Error(getJiraErrorMessage(response.status, resource));
  }

  return response.json();
}

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

  const refresh = useCallback(() => {
    setRefreshSequence((currentSequence) => currentSequence + 1);
  }, []);

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
        const projectPath = `/rest/api/3/project/${encodeURIComponent(projectKey)}`;
        const issuesPath = buildRecentIssuesPath(projectKey);

        const [projectResponse, issuesResponse] = await Promise.all([
          requestJira(projectPath, {
            headers: { Accept: 'application/json' },
          }),
          requestJira(issuesPath, {
            headers: { Accept: 'application/json' },
          }),
        ]);

        const [project, issueResult] = await Promise.all([
          readJiraJson(projectResponse, 'project details'),
          readJiraJson(issuesResponse, 'recent project work items'),
        ]);

        if (isActive) {
          setDashboard({
            status: 'ready',
            project,
            issues: Array.isArray(issueResult.issues) ? issueResult.issues : [],
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
                </Stack>
              );
            })}
          </Stack>
        )}
      </Stack>

      <SectionMessage appearance="information" title="Current assessment scope">
        <Text>
          This first dashboard reads Jira project details and recent work items.
          It does not yet analyse source changes, CI/CD results, security scans,
          deployment evidence or release readiness. It does not change Jira
          data or authorize a production release.
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
