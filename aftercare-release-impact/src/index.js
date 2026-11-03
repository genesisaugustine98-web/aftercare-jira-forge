import api, { route, webTrigger } from '@forge/api';
import { kvs } from '@forge/kvs';
import Resolver from '@forge/resolver';
import { randomBytes } from 'node:crypto';
import { processGitLabWebhookEvent, recomputeGitLabIssueEvidence } from './backend/gitlab-webhook-service.mjs';
import {
  fingerprintGitLabEvent,
  getHeader,
  getQueryValue,
  safeSecretEqual,
} from './backend/gitlab-webhook-security.mjs';

const resolver = new Resolver();
const getGitLabSecretKey = (projectKey) => `aftercare.gitlab.${projectKey}.webhook-secret`;
const getGitLabConfigKey = (projectKey) => `aftercare.gitlab.${projectKey}.webhook-config`;

function getProjectKey(context, payload) {
  const projectKey = context?.extension?.project?.key || payload?.projectKey;
  if (typeof projectKey !== 'string' || !/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    throw new Error('Aftercare could not identify the Jira project for this request.');
  }
  return projectKey;
}

async function hasProjectAdminPermission(projectKey) {
  const response = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`,
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
    route`/rest/api/3/issue/${issueKey}?fields=summary`,
  );

  if (!response.ok) {
    throw new Error('The Jira issue is not visible to your account or could not be retrieved.');
  }
}

function buildWebhookUrl(baseUrl, projectKey) {
  const url = new URL(baseUrl);
  url.searchParams.set('projectKey', projectKey);
  return url.toString();
}


resolver.define('getGitLabConnectionStatus', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  const canManage = await hasProjectAdminPermission(projectKey);

  if (!canManage) {
    return {
      configured: false,
      canManage: false,
      project: null,
      webhookUrl: null,
    };
  }

  const [config, secret] = await Promise.all([
    kvs.get(getGitLabConfigKey(projectKey)),
    kvs.getSecret(getGitLabSecretKey(projectKey)),
  ]);
  const baseUrl = await webTrigger.getUrl('gitlab-webhook');

  return {
    configured: Boolean(config && typeof secret === 'string' && secret.length > 0),
    canManage: true,
    project: config || null,
    webhookUrl: buildWebhookUrl(baseUrl, projectKey),
  };
});

resolver.define('generateGitLabWebhookSetup', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  await requireProjectAdmin(projectKey);

  const projectId = Number(payload?.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error('Enter the numeric GitLab project ID.');
  }

  const baseUrl = await webTrigger.getUrl('gitlab-webhook');
  const webhookUrl = buildWebhookUrl(baseUrl, projectKey);
  const secret = randomBytes(32).toString('hex');
  const secretKey = getGitLabSecretKey(projectKey);
  const configKey = getGitLabConfigKey(projectKey);
  const previousSecret = await kvs.getSecret(secretKey);

  await kvs.setSecret(secretKey, secret, {
    ttl: { unit: 'DAYS', value: 90 },
  });

  const config = {
    projectId,
    webhookUrl,
    configuredAt: new Date().toISOString(),
    lastEventAt: null,
    lastEventKind: null,
  };

  try {
    await kvs.set(configKey, config);
  } catch (error) {
    if (typeof previousSecret === 'string' && previousSecret.length > 0) {
      await kvs.setSecret(secretKey, previousSecret, {
        ttl: { unit: 'DAYS', value: 90 },
      });
    } else {
      await kvs.deleteSecret(secretKey);
    }
    throw error;
  }

  return {
    configured: true,
    project: config,
    webhookUrl,
    secret,
  };
});

resolver.define('disconnectGitLab', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  await requireProjectAdmin(projectKey);
  await kvs.deleteSecret(getGitLabSecretKey(projectKey));
  await kvs.delete(getGitLabConfigKey(projectKey));
  return { configured: false };
});

resolver.define('getGitLabIssueEvidence', async ({ payload, context }) => {
  const projectKey = getProjectKey(context, payload);
  await requireProjectAdmin(projectKey);
  const issueKey = payload?.issueKey;
  await requireVisibleIssue(projectKey, issueKey);
  const config = await kvs.get(getGitLabConfigKey(projectKey));
  if (!config) return null;
  return recomputeGitLabIssueEvidence({
    projectKey,
    projectId: config.projectId,
    issueKey,
    store: kvs,
    now: Date.now(),
  });
});

export async function gitlabWebhook(request) {
  try {
    if (request?.method !== 'POST') {
      return { outputKey: 'invalid' };
    }

    const projectKey = getQueryValue(request.queryParameters, 'projectKey');
    if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
      return { outputKey: 'invalid' };
    }

    const suppliedSecret = getHeader(request.headers, 'x-gitlab-token');
    const [expectedSecret, config] = await Promise.all([
      kvs.getSecret(getGitLabSecretKey(projectKey)),
      kvs.get(getGitLabConfigKey(projectKey)),
    ]);

    if (!config || !safeSecretEqual(suppliedSecret, expectedSecret)) {
      return { outputKey: 'unauthorized' };
    }

    const body = typeof request.body === 'string' ? request.body : '';
    if (!body || body.length > 250_000) {
      return { outputKey: 'invalid' };
    }

    let event;
    try {
      event = JSON.parse(body);
    } catch {
      return { outputKey: 'invalid' };
    }

    if (Number(event.project?.id) !== Number(config.projectId)) {
      return { outputKey: 'invalid' };
    }

    const eventKind = String(
      event.object_kind || getHeader(request.headers, 'x-gitlab-event') || 'unknown',
    );
    const eventUuid = getHeader(request.headers, 'x-gitlab-event-uuid');
    const eventFingerprint = fingerprintGitLabEvent(eventKind, body, eventUuid);
    const eventKey = `aftercare.gitlab.${projectKey}.event.${eventFingerprint}`;

    if (await kvs.get(eventKey)) {
      return { outputKey: 'accepted' };
    }

    const result = await processGitLabWebhookEvent({
      projectKey,
      projectId: config.projectId,
      event,
      store: kvs,
    });

    await kvs.set(eventKey, true, {
      ttl: { unit: 'DAYS', value: 7 },
    });
    await kvs.set(getGitLabConfigKey(projectKey), {
      ...config,
      lastEventAt: new Date().toISOString(),
      lastEventKind: eventKind,
      lastAffectedIssueCount: result.affectedIssues.length,
    });

    return { outputKey: 'accepted' };
  } catch (error) {
    // Never log webhook payloads, headers, or shared secrets.
    return { outputKey: error instanceof TypeError ? 'invalid' : 'error' };
  }
}

export const handler = resolver.getDefinitions();
