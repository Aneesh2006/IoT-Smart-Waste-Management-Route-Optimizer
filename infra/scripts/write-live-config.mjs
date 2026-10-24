// Turn `cdk deploy --outputs-file` output into the web app's live-config.json,
// so `pnpm dev` on a laptop talks to the deployed cloud too.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const rawPath = new URL('../../apps/web/public/live-config.raw.json', import.meta.url);
const outPath = new URL('../../apps/web/public/live-config.json', import.meta.url);
const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const o = raw.BinSight ?? Object.values(raw)[0];
const config = {
  region: o.Region,
  city: o.City,
  identityPoolId: o.IdentityPoolId,
  guestRoleArn: o.GuestRoleArn,
  iotEndpoint: o.IotEndpoint,
  apiUrl: o.ApiUrl,
  userPoolClientId: o.UserPoolClientId,
};
writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`);
rmSync(rawPath);
console.log(`Live config written. Site: ${o.SiteUrl}\nCreate an operator with:\n  aws cognito-idp admin-create-user --user-pool-id ${o.UserPoolId} --username operator\n  aws cognito-idp admin-set-user-password --user-pool-id ${o.UserPoolId} --username operator --password <choose one> --permanent`);
