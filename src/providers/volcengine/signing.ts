// DESIGN: v2-provider-abstraction.md#volcengine-api
import { createHash, createHmac } from 'crypto';

export interface VolcengineQuotaCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** Fixed Coding Plan read request; V4 scope follows the official Volcengine SDK. */
export function signVolcengineQuotaRequest(credentials: VolcengineQuotaCredentials, now = new Date()) {
  const host = 'open.volcengineapi.com';
  const query = 'Action=GetCodingPlanUsage&Version=2024-01-01';
  const body = '{}';
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const scope = `${day}/cn-beijing/ark/request`;
  const signedHeaders = 'host;x-content-sha256;x-date';
  const canonical = ['POST', '/', query,
    `host:${host}\nx-content-sha256:${hash(body)}\nx-date:${date}\n`, signedHeaders, hash(body)].join('\n');
  let key = hmac(credentials.secretAccessKey, day);
  for (const part of ['cn-beijing', 'ark', 'request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(['HMAC-SHA256', date, scope, hash(canonical)].join('\n')).digest('hex');
  return {
    url: `https://${host}/?${query}`, body,
    headers: { 'Content-Type': 'application/json', Host: host, 'X-Date': date,
      'X-Content-Sha256': hash(body),
      Authorization: `HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
  };
}
