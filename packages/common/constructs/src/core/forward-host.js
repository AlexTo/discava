/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
function handler(event) {
  var request = event.request;
  var host = request.headers.host;
  if (host) {
    request.headers['x-discava-host'] = { value: host.value };
  }
  return request;
}
