/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runLocalContainer } from '../local-container.js';

const { port, image, containerName } = JSON.parse(
  readFileSync(new URL('./config.json', import.meta.url), 'utf-8'),
).localDev;

// The OIDC server local dev signs in with instead of Cognito (#226). It keeps
// no state: each sign-in issues tokens with the claims the login page posts,
// mirroring a Cognito access token's (sub, username, email, cognito:groups).
runLocalContainer({
  containerEngine: 'docker',
  containerName,
  image,
  options: [
    '-p',
    `${port}:8080`,
    '-v',
    `${fileURLToPath(new URL('.', import.meta.url))}:/login:ro`,
    '-e',
    `JSON_CONFIG=${JSON.stringify({
      interactiveLogin: true,
      loginPagePath: '/login/login.html',
    })}`,
  ],
});
