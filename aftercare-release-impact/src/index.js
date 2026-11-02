import api, { fetch as forgeFetch } from '@forge/api';
import { kvs } from '@forge/kvs';
import Resolver from '@forge/resolver';
import { GitLabApiError, fetchGitLabProject } from './backend/gitlab-client.mjs';
import { collectGitLabIssueEvidence } from './backend/gitlab-evidence-service.mjs';

const resolver = new Resolver();
const getGitLabTokenKey = (projectKey) => `aftercare.gitlab.${projectKey}.access-token`;
const getGitLabConfigKey = (projectKey) => `aftercare.gitlab.${projectKey}.project-config`;

function getProjectKey(context, payload) {
  const projectKey = context?.extension?.project?.key || payload?.projectKey;
  if (typeof projectKey !== 'string' || !/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    throw new Error('Aftercare could not identify the Jira project for this request.');
  }
  return projectKey;
}

async function hasProjectAdminPermission(projectKey) {
  const response = await api.asUser().requestJira(
    `/rest/api/3/mypermissions?projectKey=${encodeURIComponent(projectKey)}&permissions=ADMINISTER_PROJECTS`,
  );

  if (!response.ok) {
    throw new Error('Aftercare could not verify your Jira project administration permission.');
  }

  const result = await response.json();
  return result.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
}

async function requireProjectAdmin(projectKey) {
  if (!(await hasProjectAdminPermission(projectKey))) {
    throw new Error('Only Jira project administrators can configure or inspect this project’s connected GitLab evidence.');
  }
}

async function requireVisibleIssue(projectKey, issueKey) {
  if (typeof issueKey !== 'string'
    || !new RegExp(`^${projectKey}-\\d+$`).test(issueKey)) {
    throw new Error('The Jira issue key does not belong to this project.');
  }

  const response = await api.asUser().requestJira(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary`,
  );

  if (!response.ok) {
    throw new Error('The Jira issue is not visible to your account or could not be retrieved.');
  }
}

resolver.define('getGitLabConnectionStatus', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  const canManage = await hasProjectAdminPermission(projectKey);

  if (!canManage) {
    return { connected: false, canManage: false, project: null };
  }

  const [config, token] = await Promise.all([
    kvs.get(getGitLabConfigKey(projectKey)),
    kvs.getSecret(getGitLabTokenKey(projectKey)),
  ]);

  return {
    connected: Boolean(config && typeof token === 'string' && token.length > 0),
    canManage: true,
    project: config || null,
  };
});

resolver.define('saveGitLabConnection', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  await requireProjectAdmin(projectKey);

  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
  if (token.length < 10 || /[\r\n]/.test(token)) {
    throw new Error('Enter a valid GitLab access token with read_api access.');
  }

  const projectId = Number(payload?.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error('Enter the numeric GitLab project ID.');
  }

  let project;
  try {
    project = await fetchGitLabProject(projectId, token, forgeFetch);
  } catch (error) {
    if (error instanceof GitLabApiError && error.status === 401) {
      throw new Error('GitLab rejected this token. Check that it is valid and has read_api access.');
    }
    if (error instanceof GitLabApiError && error.status === 404) {
      throw new Error('GitLab could not find this project or the token cannot access it.');
    }
    throw new Error('Aftercare could not verify the GitLab project. Check the project ID and token permissions.');
  }

  const projectUrl = new URL(project.web_url);
  if (projectUrl.origin !== 'https://gitlab.com') {
    throw new Error('Only GitLab.com projects are supported by this development integration.');
  }

  const config = {
    projectId: project.id,
    projectPath: project.path_with_namespace,
    projectName: project.name,
    webUrl: project.web_url,
    connectedAt: new Date().toISOString(),
  };

  const tokenKey = getGitLabTokenKey(projectKey);
  const configKey = getGitLabConfigKey(projectKey);
  const previousToken = await kvs.getSecret(tokenKey);
  await kvs.setSecret(tokenKey, token, {
    ttl: { unit: 'DAYS', value: 90 },
  });

  try {
    await kvs.set(configKey, config);
  } catch (error) {
    if (typeof previousToken === 'string' && previousToken.length > 0) {
      await kvs.setSecret(tokenKey, previousToken, {
        ttl: { unit: 'DAYS', value: 90 },
      });
    } else {
      await kvs.deleteSecret(tokenKey);
    }
    throw error;
  }

  return {
    connected: true,
    project: {
      id: config.projectId,
      name: config.projectName,
      path: config.projectPath,
      webUrl: config.webUrl,
    },
  };
});

resolver.define('disconnectGitLab', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  await requireProjectAdmin(projectKey);
  await kvs.deleteSecret(getGitLabTokenKey(projectKey));
  await kvs.delete(getGitLabConfigKey(projectKey));
  return { connected: false };
});

resolver.define('syncGitLabIssueEvidence', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  await requireProjectAdmin(projectKey);
  const issueKey = payload?.issueKey;
  await requireVisibleIssue(projectKey, issueKey);

  const [config, token] = await Promise.all([
    kvs.get(getGitLabConfigKey(projectKey)),
    kvs.getSecret(getGitLabTokenKey(projectKey)),
  ]);

  if (!config || typeof token !== 'string' || token.length === 0) {
    throw new Error('GitLab is not connected to this Jira project yet.');
  }

  let snapshot;
  try {
    snapshot = await collectGitLabIssueEvidence({
      issueKey,
      projectId: config.projectId,
      token,
      fetchImpl: forgeFetch,
    });
  } catch (error) {
    if (error instanceof GitLabApiError && error.status === 401) {
      throw new Error('The GitLab token has expired or been revoked. Replace the token in Aftercare and try again.');
    }
    if (error instanceof GitLabApiError && error.status === 403) {
      throw new Error('The GitLab token does not have read_api access to the configured project.');
    }
    throw error;
  }

  await kvs.set(`aftercare.evidence.${projectKey}.${issueKey}`, snapshot);
  return snapshot;
});

resolver.define('getGitLabIssueEvidence', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  await requireProjectAdmin(projectKey);
  const issueKey = payload?.issueKey;
  await requireVisibleIssue(projectKey, issueKey);
  return (await kvs.get(`aftercare.evidence.${projectKey}.${issueKey}`)) || null;
});

export const handler = resolver.getDefinitions();
